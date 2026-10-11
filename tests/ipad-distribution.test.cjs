"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const release = require("../scripts/archive-ipad.cjs");
const sourceRoot = path.resolve(__dirname, "..");

function fixture(t) {
  const base = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "recall-ipad-release-"),
  );
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const name of [
    "RecallPad/Info.plist",
    "RecallPad/Resources/PrivacyInfo.xcprivacy",
    "RecallPad.xcodeproj/project.pbxproj",
  ]) {
    const target = path.join(base, "apps/ipad", name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, "apps/ipad", name), target);
  }

  return base;
}

function appMetadata(options) {
  return {
    CFBundleShortVersionString: options.version,
    CFBundleVersion: options.build,
    MinimumOSVersion: "17.0",
    UIDeviceFamily: [2],
    NSCameraUsageDescription: "Pair locally",
    NSLocalNetworkUsageDescription: "Send work to paired Mac",
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
  };
}

function mockBuild(paths) {
  const app = path.join(paths.archive, "Products/Applications/RecallPad.app");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, "PrivacyInfo.xcprivacy"), "fixture");
  fs.writeFileSync(path.join(app, "Assets.car"), "fixture");
}

function plistOutput(args, options) {
  if (args.at(-1).endsWith("PrivacyInfo.xcprivacy")) {
    return JSON.stringify({
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["C617.1"],
        },
      ],
    });
  }

  return JSON.stringify(appMetadata(options));
}

test("release planning needs no signing, Xcode, network or generated resources", (t) => {
  const base = fixture(t);
  const messages = [];
  const result = release.main([], {
    base,
    platform: "linux",
    write: (value) => messages.push(value),
    spawn: () => assert.fail("Planning must not run a command"),
    resources: () => assert.fail("Planning must not copy resources"),
  });
  assert.equal(result.options.mode, "--plan");
  assert.equal(fs.existsSync(result.paths.folder), false);
  assert.match(messages.join("\n"), /No signing values read/);
  assert.match(messages.join("\n"), /no declaration is assumed/);
  assert.doesNotMatch(messages.join("\n"), /\/Users\//);
});

test("release options fail closed for upload, injected settings and unintended provisioning", () => {
  for (const args of [
    ["--upload"],
    ["--archive", "--export"],
    ["--version", "1.2.3;touch x"],
    ["--build", "../secret"],
    ["--build", "0"],
    ["--unsigned", "--allow-provisioning-updates"],
    ["--team", "PRIVATE_TEAM"],
    ["--version"],
  ]) {
    assert.throws(() => release.parseOptions(args));
  }

  assert.deepEqual(
    release.parseOptions([
      "--archive",
      "--version",
      "1.2.3",
      "--build",
      "8",
      "--allow-provisioning-updates",
    ]),
    { mode: "--archive", version: "1.2.3", build: "8", provisioning: true },
  );
});

test("release source preflight rejects an insecure transport and Debug configuration", (t) => {
  const base = fixture(t);
  const info = path.join(base, "apps/ipad/RecallPad/Info.plist");
  fs.appendFileSync(info, "<key>NSAllowsArbitraryLoads</key><true/>");
  assert.throws(() => release.assertSourceContract(base), /transport/);
  fs.copyFileSync(
    path.join(sourceRoot, "apps/ipad/RecallPad/Info.plist"),
    info,
  );
  const project = path.join(
    base,
    "apps/ipad/RecallPad.xcodeproj/project.pbxproj",
  );
  fs.writeFileSync(
    project,
    fs
      .readFileSync(project, "utf8")
      .replace('ENABLE_TESTABILITY = "NO"', 'ENABLE_TESTABILITY = "YES"'),
  );
  assert.throws(() => release.assertSourceContract(base), /debug-boundary/);
});

test("release preflight requires the app-container metadata privacy reason", (t) => {
  const base = fixture(t);
  const manifest = path.join(
    base,
    "apps/ipad/RecallPad/Resources/PrivacyInfo.xcprivacy",
  );
  fs.writeFileSync(
    manifest,
    fs.readFileSync(manifest, "utf8").replace("C617.1", "DDA9.1"),
  );
  assert.throws(() => release.assertSourceContract(base), /privacy review/);
});

test("signing configuration checks ownership and permissions without parsing secrets", (t) => {
  const base = fixture(t);
  const config = path.join(base, "apps/ipad/Local.xcconfig");
  assert.throws(
    () => release.assertPrivateSigningConfig(base),
    /Create ignored/,
  );
  fs.writeFileSync(
    config,
    "This is deliberately not a valid config and must never be parsed",
    { mode: 0o644 },
  );
  assert.throws(() => release.assertPrivateSigningConfig(base), /owner-only/);
  fs.chmodSync(config, 0o600);
  assert.doesNotThrow(() => release.assertPrivateSigningConfig(base));
  const link = path.join(base, "linked-config");
  fs.renameSync(config, link);
  fs.symlinkSync(link, config);
  assert.throws(() => release.assertPrivateSigningConfig(base), /regular file/);
});

test("unsigned Release archive avoids signing, preserves existing artifacts and removes provider credentials", (t) => {
  const base = fixture(t);
  const options = release.parseOptions(["--unsigned", "--build", "7"]);
  const paths = release.candidatePaths(options, base);
  const commands = [];
  let resourceCopies = 0;
  const dependencies = {
    base,
    platform: "darwin",
    write: () => {},
    env: {
      DEVELOPER_DIR: "/public/xcode",
      OPENAI_API_KEY: "PRIVATE_CANARY",
      ANTHROPIC_API_KEY: "PRIVATE_CANARY",
    },
    resources: () => {
      resourceCopies += 1;
    },
    spawn: (command, args, config) => {
      commands.push({ command, args });
      assert.equal(config.env.OPENAI_API_KEY, undefined);
      assert.equal(config.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(config.env.DEVELOPER_DIR, "/public/xcode");
      if (command === "xcodebuild") mockBuild(paths);
      return {
        status: 0,
        stdout: command.endsWith("plutil")
          ? plistOutput(args, options)
          : "Built locally",
        stderr: "",
      };
    },
  };
  release.main(["--unsigned", "--build", "7"], dependencies);
  assert.equal(resourceCopies, 1);
  const args = commands[0].args;
  assert.ok(args.includes("Release"));
  assert.ok(args.includes("generic/platform=iOS"));
  assert.ok(args.includes("CODE_SIGNING_ALLOWED=NO"));
  assert.ok(args.includes("DEVELOPMENT_TEAM="));
  assert.ok(args.includes("CURRENT_PROJECT_VERSION=7"));
  assert.equal(
    commands.some((item) => item.command.endsWith("codesign")),
    false,
  );
  assert.equal(fs.statSync(paths.folder).mode & 0o777, 0o700);
  assert.equal(fs.statSync(paths.log).mode & 0o777, 0o600);
  assert.throws(
    () => release.main(["--unsigned", "--build", "7"], dependencies),
    /already exists/,
  );
  assert.equal(
    commands.length,
    3,
    "Existing candidates must not be overwritten or rebuilt",
  );
});

test("signed export checks the archived app and explicitly exports locally with fixed build numbers", (t) => {
  const base = fixture(t);
  fs.writeFileSync(
    path.join(base, "apps/ipad/Local.xcconfig"),
    "private signing fixture",
    { mode: 0o600 },
  );
  const options = release.parseOptions(["--export", "--build", "8"]);
  const paths = release.candidatePaths(options, base);
  mockBuild(paths);
  const commands = [];
  release.main(["--export", "--build", "8"], {
    base,
    platform: "darwin",
    env: {},
    write: () => {},
    exportValidator: (checkedOptions, checkedPaths) => {
      assert.equal(checkedOptions.build, "8");
      assert.equal(checkedPaths.export, paths.export);
      return {
        schemaVersion: 1,
        ipaSha256: "fixture hash",
        uploadPerformed: false,
        checks: { distributionIdentity: true },
      };
    },
    resources: () => assert.fail("Export must not alter offline resources"),
    spawn: (command, args) => {
      commands.push({ command, args });
      if (command === "xcodebuild") {
        const plist = fs.readFileSync(paths.exportOptions, "utf8");
        assert.match(
          plist,
          /<key>method<\/key><string>app-store-connect<\/string>/,
        );
        assert.match(plist, /<key>destination<\/key><string>export<\/string>/);
        assert.match(
          plist,
          /<key>manageAppVersionAndBuildNumber<\/key><false\/>/,
        );
        assert.doesNotMatch(plist, /teamID|upload<\/string>/);
        fs.mkdirSync(paths.export);
        fs.writeFileSync(
          path.join(paths.export, "RecallPad.ipa"),
          "local fixture",
        );
      }

      return {
        status: 0,
        stdout: command.endsWith("plutil") ? plistOutput(args, options) : "",
        stderr: "",
      };
    },
  });
  assert.equal(commands[2].command, "/usr/bin/codesign");
  assert.equal(commands[3].args[0], "-exportArchive");
  assert.equal(commands[3].args.includes("-allowProvisioningUpdates"), false);
  assert.equal(fs.statSync(paths.exportOptions).mode & 0o777, 0o600);
  assert.equal(
    fs.statSync(path.join(paths.folder, "export-verification.json")).mode &
      0o777,
    0o600,
  );
});

function distributionFixture() {
  const entitlements = {
    "application-identifier": "fixture-prefix.org.example.pad",
    "com.apple.developer.team-identifier": "fixture-team",
    "get-task-allow": false,
    "beta-reports-active": true,
    "keychain-access-groups": ["fixture-prefix.org.example.pad"],
  };
  return {
    info: { CFBundleIdentifier: "org.example.pad" },
    signature: {
      authority: "Apple Distribution: Synthetic Fixture",
      identifier: "org.example.pad",
      team: "fixture-team",
    },
    entitlements,
    profile: {
      Entitlements: {
        ...entitlements,
        "keychain-access-groups": ["fixture-prefix.*"],
      },
      TeamIdentifier: ["fixture-team"],
      ApplicationIdentifierPrefix: ["fixture-prefix"],
      ExpirationDate: "2099-01-01T00:00:00Z",
    },
    leafHash: "fixture-leaf-hash",
    profileCertificateHashes: ["fixture-leaf-hash"],
  };
}

test("shipping policy rejects development/debug/device-limited/enterprise artifacts", () => {
  const valid = distributionFixture();
  const receipt = release.assertDistributionPolicy(valid);
  assert.equal(receipt.debuggerDisabled, true);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /fixture-team|org.example|Synthetic Fixture/,
  );
  for (const mutate of [
    (data) => {
      data.signature.authority = "Apple Development: Synthetic Fixture";
    },
    (data) => {
      data.entitlements["get-task-allow"] = true;
    },
    (data) => {
      delete data.entitlements["get-task-allow"];
    },
    (data) => {
      data.profile.Entitlements["get-task-allow"] = true;
    },
    (data) => {
      data.profile.ProvisionedDevices = [];
    },
    (data) => {
      data.profile.ProvisionsAllDevices = true;
    },
    (data) => {
      data.profile.Entitlements["beta-reports-active"] = false;
    },
  ]) {
    const invalid = distributionFixture();
    mutate(invalid);
    assert.throws(() => release.assertDistributionPolicy(invalid));
  }
});

test("shipping policy rejects mismatched identifiers, unauthorized entitlements and expired profiles", () => {
  for (const mutate of [
    (data) => {
      data.signature.team = "different-team";
    },
    (data) => {
      data.signature.identifier = "org.example.other";
    },
    (data) => {
      data.profile.Entitlements["application-identifier"] =
        "fixture-prefix.org.example.other";
    },
    (data) => {
      data.profile.TeamIdentifier = ["different-team"];
    },
    (data) => {
      data.entitlements["com.apple.private.synthetic"] = true;
    },
    (data) => {
      data.entitlements["keychain-access-groups"] = ["foreign-group.secret"];
    },
    (data) => {
      data.profileCertificateHashes = ["different-leaf-hash"];
    },
    (data) => {
      data.profile.ExpirationDate = "2000-01-01T00:00:00Z";
    },
  ]) {
    const invalid = distributionFixture();
    mutate(invalid);
    assert.throws(() => release.assertDistributionPolicy(invalid));
  }
});

test("IPA inspection rejects traversal, links, ambiguous apps and oversized expansion", () => {
  const entry = (name, size = 1, attr = 0) => ({
    entryName: name,
    header: { size, attr },
  });
  const valid = [entry("Payload/RecallPad.app/Info.plist")];
  assert.doesNotThrow(() => release.inspectIpaEntries(valid));
  for (const entries of [
    [entry("../outside")],
    [entry("/outside")],
    [entry("Payload\\outside")],
    [entry("Payload/RecallPad.app/link", 1, 0o120000 << 16)],
    [...valid, entry("Payload/Other.app/Info.plist")],
    [...valid, ...valid],
    [entry("Payload/RecallPad.app/large", 129 * 1024 * 1024)],
  ])
    assert.throws(() => release.inspectIpaEntries(entries));
});

test("shipped offline math resources must match the installed locked packages", (t) => {
  const base = fixture(t);
  fs.symlinkSync(
    path.join(sourceRoot, "node_modules"),
    path.join(base, "node_modules"),
  );
  const app = path.join(base, "RecallPad.app");
  const web = path.join(app, "Web");
  fs.mkdirSync(web, { recursive: true });
  for (const [source, target] of [
    ["katex/dist/katex.min.js", "katex.min.js"],
    ["katex/dist/katex.min.css", "katex.min.css"],
    ["katex/dist/contrib/auto-render.min.js", "auto-render.min.js"],
    ["dompurify/dist/purify.min.js", "purify.min.js"],
    ["katex/LICENSE", "KATEX-LICENSE.txt"],
    ["dompurify/LICENSE", "DOMPURIFY-LICENSE.txt"],
  ])
    fs.copyFileSync(
      path.join(sourceRoot, "node_modules", source),
      path.join(web, target),
    );
  fs.cpSync(
    path.join(sourceRoot, "node_modules/katex/dist/fonts"),
    path.join(web, "fonts"),
    { recursive: true },
  );
  assert.doesNotThrow(() => release.assertBundledWeb(app, base));
  fs.appendFileSync(
    path.join(web, "purify.min.js"),
    "\n/* changed after dependency locking */",
  );
  assert.throws(
    () => release.assertBundledWeb(app, base),
    /locked offline web resources/,
  );
});

test("verification-only operation never archives, exports, provisions or reads a signing config", (t) => {
  const base = fixture(t);
  const options = release.parseOptions(["--verify-export", "--build", "11"]);
  const paths = release.candidatePaths(options, base);
  fs.mkdirSync(paths.export, { recursive: true });
  release.main(["--verify-export", "--build", "11"], {
    base,
    platform: "darwin",
    env: {},
    write: () => {},
    resources: () => assert.fail("Verification must not prepare resources"),
    spawn: () => assert.fail("Injected verification needs no Xcode operation"),
    exportValidator: () => ({
      schemaVersion: 1,
      uploadPerformed: false,
      checks: { immutableIpa: true },
    }),
  });
  assert.equal(fs.existsSync(paths.archive), false);
  assert.equal(
    fs.statSync(path.join(paths.folder, "export-verification.json")).mode &
      0o777,
    0o600,
  );
  assert.throws(
    () =>
      release.main(["--verify-export", "--build", "11"], {
        base,
        platform: "darwin",
      }),
    /already has a verification receipt/,
  );
});

test("invalid or stale archived metadata prevents signing/export and retains the failure locally", (t) => {
  const base = fixture(t);
  const options = release.parseOptions(["--unsigned", "--build", "9"]);
  const paths = release.candidatePaths(options, base);
  const metadata = appMetadata(options);
  metadata.NSAppTransportSecurity.NSAllowsArbitraryLoads = true;
  const messages = [];
  assert.throws(
    () =>
      release.main(["--unsigned", "--build", "9"], {
        base,
        platform: "darwin",
        env: {},
        write: (value) => messages.push(value),
        resources: () => {},
        spawn: (command) => {
          if (command === "xcodebuild") mockBuild(paths);
          return {
            status: 0,
            stdout: command.endsWith("plutil") ? JSON.stringify(metadata) : "",
            stderr: "",
          };
        },
      }),
    /transport-boundary/,
  );
  assert.equal(messages.length, 0);
  assert.ok(
    fs.existsSync(paths.archive),
    "Failed validation must retain the candidate for local diagnosis",
  );
});

test("failed commands never echo signing details into stdout and retain an owner-only log", (t) => {
  const base = fixture(t);
  const options = release.parseOptions(["--unsigned", "--build", "10"]);
  const paths = release.candidatePaths(options, base);
  const messages = [];
  assert.throws(
    () =>
      release.main(["--unsigned", "--build", "10"], {
        base,
        platform: "darwin",
        env: {},
        write: (value) => messages.push(value),
        resources: () => {},
        spawn: () => ({
          status: 65,
          stdout: "",
          stderr: "PRIVATE_TEAM PRIVATE_ACCOUNT",
        }),
      }),
    (error) => {
      assert.doesNotMatch(error.message, /PRIVATE_TEAM|PRIVATE_ACCOUNT/);
      return /owner-only local log/.test(error.message);
    },
  );
  assert.equal(messages.length, 0);
  assert.match(
    fs.readFileSync(paths.log, "utf8"),
    /PRIVATE_TEAM PRIVATE_ACCOUNT/,
  );
  assert.equal(fs.statSync(paths.log).mode & 0o777, 0o600);
});

test("release outputs reject symlink paths", (t) => {
  const base = fixture(t);
  const target = path.join(base, "elsewhere");
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(base, "apps/ipad/.build"));
  assert.throws(
    () =>
      release.ensurePrivateDirectory(
        path.join(base, "apps/ipad/.build/distribution"),
      ),
    /symbolic links/,
  );
  assert.equal(fs.existsSync(path.join(target, "distribution")), false);
});
