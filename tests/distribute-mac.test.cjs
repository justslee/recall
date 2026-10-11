const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {
  parseArgs,
  prepare,
  configForSigning,
  defaultRun,
  BUNDLE_ID,
} = require("../scripts/distribute-mac.cjs");
const sourceRoot = path.resolve(__dirname, "..");
const certificate =
  "Developer ID Application: Synthetic Contributor (XXXXXXXXXX)";

function fixture(t, overrides = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "recall-distribution-test-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "release/Recall-darwin-arm64/Recall.app");
  const native =
    "Contents/Resources/app.asar.unpacked/dist-native/RecallPadHandoff";
  const write = (name, value) => {
    const file = path.join(app, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  write("Contents/Info.plist", "synthetic original metadata");
  write("Contents/MacOS/Recall", "synthetic original executable");
  write(native, "synthetic original helper");
  write("Contents/Resources/app.asar", "synthetic archive");
  write(
    "Contents/Frameworks/Recall Helper.app/Contents/MacOS/Recall Helper",
    "helper",
  );
  write(
    "Contents/Frameworks/Recall Helper.app/Contents/Info.plist",
    "helper metadata",
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "0.6.0-beta.3" }),
  );
  const calls = [],
    logs = [],
    signed = [];
  const keys = {
    RunAsNode: 0,
    EnableNodeOptionsEnvironmentVariable: 2,
    EnableNodeCliInspectArguments: 3,
    EnableEmbeddedAsarIntegrityValidation: 4,
    OnlyLoadAppFromAsar: 5,
  };
  const wire = { 0: 49, 2: 48, 3: 49, 4: 49, 5: 49, ...overrides.wire };
  const fuses = {
    FuseV1Options: keys,
    FuseVersion: { V1: "1" },
    FuseState: { ENABLE: 49, DISABLE: 48 },
    async getCurrentFuseWire(file) {
      calls.push({ command: "read-fuses", file });
      return file === app ? wire : { ...wire, 3: 48 };
    },
    async flipFuses(file, settings) {
      calls.push({ command: "flip-fuses", file, settings });
    },
  };
  const plist = {
    CFBundleName: "Recall",
    CFBundleExecutable: "Recall",
    CFBundleShortVersionString: "0.6.0-beta.3",
    ...overrides.info,
  };
  const env = {
    RECALL_MAC_SIGN_IDENTITY: certificate,
    RECALL_MAC_BUILD_NUMBER: "3",
    RECALL_NOTARY_PROFILE: "synthetic-notary",
    ...overrides.env,
  };
  const run = (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (overrides.fail?.(command, args))
      throw Error("untrusted private tool output");
    if (command === "/usr/bin/plutil") {
      const data = options.input
        ? options.input.includes("allow-jit")
          ? {
              "com.apple.security.cs.allow-jit": true,
              "com.apple.security.device.audio-input": true,
              ...overrides.entitlements,
            }
          : {}
        : plist;
      return { stdout: JSON.stringify(data), stderr: "" };
    }
    if (command === "/usr/bin/lipo")
      return { stdout: overrides.arch || "arm64\n", stderr: "" };
    if (command === "/usr/bin/ditto") {
      if (args[0] === "--rsrc")
        fs.cpSync(args[2], args[3], { recursive: true });
      else fs.writeFileSync(args.at(-1), "ordered synthetic archive");
    }
    if (command === "/usr/bin/codesign" && args[0] === "-d") {
      const isNative = args.at(-1).endsWith("RecallPadHandoff");
      if (args.includes("--entitlements"))
        return {
          stdout: `<plist><dict>${isNative ? "" : "<key>com.apple.security.cs.allow-jit</key><true/>"}</dict></plist>`,
          stderr: "",
        };
      const id = isNative
        ? "com.recall.pad-handoff"
        : args.at(-1).includes("Helper.app")
          ? BUNDLE_ID + ".helper"
          : BUNDLE_ID;
      return {
        stdout: "",
        stderr: `Identifier=${id}\nTeamIdentifier=${overrides.team || "XXXXXXXXXX"}\nAuthority=Developer ID Application: Synthetic Contributor (XXXXXXXXXX)\nCodeDirectory v=20500 flags=${overrides.runtime === false ? "0x0(none)" : "0x10000(runtime)"}\nTimestamp=Synthetic timestamp\n`,
      };
    }
    if (command === "/usr/bin/xcrun" && args[0] === "notarytool")
      return {
        stdout: JSON.stringify({
          id: "00000000-0000-4000-8000-000000000000",
          status: overrides.notaryStatus || "Accepted",
          privateField: "never stored",
        }),
        stderr: "",
      };
    return { stdout: "", stderr: "" };
  };
  const sign = async (options) => {
    signed.push(options);
    if (overrides.signError) throw Error("private signing error");
  };
  const execute = (options = {}) =>
    prepare({
      root,
      options,
      env,
      platform: "darwin",
      run,
      sign,
      fuses,
      log: (message) => logs.push(message),
    });
  return { root, app, native, calls, logs, signed, fuses, env, execute };
}

test("Mac preparation is read-only by default and cannot smuggle in an upload", async (t) => {
  assert.deepEqual(parseArgs([]), {
    sign: false,
    notarize: false,
    staple: false,
  });
  for (const flags of [
    ["--notarize"],
    ["--sign", "--staple"],
    ["--check", "--sign"],
    ["--dry-run", "--sign"],
    ["--password", "secret"],
    ["--app"],
  ])
    assert.throws(() => parseArgs(flags));

  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.app, "Contents/Info.plist"));
  const result = await f.execute();
  assert.equal(result.mode, "check");
  assert.equal(result.configured, true);
  assert.equal(f.signed.length, 0);
  assert(
    !f.calls.some((call) =>
      [
        "flip-fuses",
        "/usr/bin/ditto",
        "/usr/bin/codesign",
        "/usr/bin/xcrun",
        "/usr/libexec/PlistBuddy",
      ].includes(call.command),
    ),
  );
  assert(!fs.existsSync(path.join(f.root, "release/distribution")));
  assert.deepEqual(
    fs.readFileSync(path.join(f.app, "Contents/Info.plist")),
    before,
  );
  assert(!f.logs.join("\n").includes(certificate));
});

test("Missing or invalid release configuration blocks before mutating a bundle", async (t) => {
  for (const env of [
    { RECALL_MAC_SIGN_IDENTITY: undefined },
    { RECALL_MAC_SIGN_IDENTITY: "Apple Development: synthetic" },
    { RECALL_MAC_BUILD_NUMBER: "beta.3" },
    { RECALL_NOTARY_PROFILE: undefined },
  ]) {
    const f = fixture(t, { env });
    await assert.rejects(f.execute({ sign: true, notarize: true }));
    assert.equal(f.signed.length, 0);
    assert(!fs.existsSync(path.join(f.root, "release/distribution")));
  }
});

test("Installed paths, symbolic aliases and stale or wrong-architecture bundles fail closed", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.execute({ app: "/Applications/Recall.app" }),
    /under this checkout/,
  );
  const alias = path.join(f.root, "release/alias/Recall.app");
  fs.mkdirSync(path.dirname(alias));
  fs.symlinkSync(f.app, alias);
  await assert.rejects(f.execute({ app: alias }), /symbolic-link alias/);
  const stale = fixture(t, { info: { CFBundleShortVersionString: "0.5.0" } });
  await assert.rejects(stale.execute(), /stale/);
  const intel = fixture(t, { arch: "x86_64" });
  await assert.rejects(intel.execute(), /arm64-only/);
  for (const active of [f, stale, intel]) assert.equal(active.signed.length, 0);
});

test("Privacy audit and required fuse failures stop before signing", async (t) => {
  for (const overrides of [
    {
      fail: (_command, args) =>
        args.some((arg) => arg.endsWith("audit-package.cjs")),
    },
    { wire: { 2: 49 } },
    { wire: { 4: 48 } },
    { wire: { 0: 48 } },
  ]) {
    const f = fixture(t, overrides);
    await assert.rejects(f.execute({ sign: true }));
    assert(!fs.existsSync(path.join(f.root, "release/distribution")));
    assert.equal(f.signed.length, 0);
  }
});

test("Loose private files and bundle symlinks escaping the app stop before audits or signing", async (t) => {
  for (const item of [
    "Contents/embedded.provisionprofile",
    "Contents/Resources/openai.key",
    "Contents/Resources/app.asar.unpacked/dist-native/notes.md",
  ]) {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.app, item), "synthetic private data");
    await assert.rejects(f.execute({ sign: true }), /unexpected|private/);
    assert.equal(f.signed.length, 0);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(t);
  const extra = path.join(
    f.app,
    "Contents/Frameworks/Recall Helper.app/Contents/Resources",
  );
  fs.symlinkSync(f.root, extra);
  await assert.rejects(f.execute({ sign: true }), /outside the candidate/);
  assert.equal(f.signed.length, 0);
});

test("Signing stages a copy, disables inspector, keeps bridge RunAsNode and writes hashes without uploading", async (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.app, f.native));
  const result = await f.execute({ sign: true });
  const options = f.signed[0];
  assert.notEqual(options.app, f.app);
  assert.equal(options.identityValidation, true);
  assert.equal(options.platform, "darwin");
  assert.equal(options.preAutoEntitlements, false);
  assert.equal(options.preEmbedProvisioningProfile, false);
  assert.equal(options.strictVerify, true);
  const flip = f.calls.find((call) => call.command === "flip-fuses");
  assert.equal(flip.settings[3], false);
  assert.equal(flip.settings[0], undefined);
  assert.equal(
    f.calls.filter((call) => call.command === "/usr/bin/ditto").length,
    2,
  );
  assert(!f.calls.some((call) => call.command === "/usr/bin/xcrun"));
  assert.equal(result.receipt.signatureVerified, true);
  for (const call of f.calls.filter(
    (call) =>
      call.command === "/usr/bin/codesign" &&
      call.args.includes("--entitlements"),
  )) {
    assert(call.args.includes("--xml"));
    assert.equal(call.args[call.args.indexOf("--entitlements") + 1], "-");
  }
  assert.equal(result.receipt.notarization, "not-requested");
  assert.equal(result.receipt.releaseQualityVerified, false);
  const archive = path.join(result.stage, result.receipt.archive);
  assert.equal(
    result.receipt.sha256,
    crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"),
  );
  assert.equal(
    fs.readFileSync(path.join(result.stage, "SHA256SUMS"), "utf8"),
    `${result.receipt.sha256}  ${result.receipt.archive}\n`,
  );
  assert.deepEqual(fs.readFileSync(path.join(f.app, f.native)), original);
  const receipt = fs.readFileSync(
    path.join(result.stage, "release-receipt.json"),
    "utf8",
  );
  for (const secret of [
    certificate,
    f.env.RECALL_NOTARY_PROFILE,
    f.root,
    "never stored",
  ])
    assert(!receipt.includes(secret));
});

test("Entitlements are limited to V8 JIT and microphone with no native-helper privileges", () => {
  const app = "/synthetic/Recall.app";
  const options = configForSigning(sourceRoot, app, certificate);
  for (const file of [
    app,
    path.join(app, "Contents/Frameworks/Recall Helper.app"),
  ]) {
    const policy = options.optionsForFile(file);
    assert.equal(policy.hardenedRuntime, true);
    const text = fs.readFileSync(policy.entitlements, "utf8");
    assert.deepEqual(
      [...text.matchAll(/<key>(.*?)<\/key>/g)].map((m) => m[1]).sort(),
      [
        "com.apple.security.cs.allow-jit",
        "com.apple.security.device.audio-input",
      ],
    );
  }
  const native = options.optionsForFile(options.binaries[0]);
  assert.equal(native.hardenedRuntime, true);
  assert(!fs.readFileSync(native.entitlements, "utf8").includes("<key>"));
});

test("Unexpected entitlements, missing hardened runtime or failed signing keep recovery without a release ZIP", async (t) => {
  for (const overrides of [
    {
      entitlements: {
        "com.apple.security.cs.disable-library-validation": true,
      },
    },
    { runtime: false },
    { signError: true },
  ]) {
    const f = fixture(t, overrides);
    await assert.rejects(f.execute({ sign: true }));
    const out = path.join(f.root, "release/distribution");
    const stage = path.join(out, fs.readdirSync(out)[0]);
    assert(fs.existsSync(path.join(stage, "release-receipt.json")));
    assert(!fs.readdirSync(stage).some((name) => name.endsWith(".zip")));
  }
});

test("Explicit accepted notarization then stapling regenerates the final ZIP and verifies Gatekeeper", async (t) => {
  const f = fixture(t);
  const result = await f.execute({ sign: true, notarize: true, staple: true });
  const notary = f.calls.find(
    (call) =>
      call.command === "/usr/bin/xcrun" && call.args[0] === "notarytool",
  );
  assert(notary.args.includes("--keychain-profile"));
  assert(
    !notary.args.some((arg) =>
      ["--password", "--apple-id", "--key"].includes(arg),
    ),
  );
  assert.equal(
    f.calls.filter((call) => call.command === "/usr/bin/ditto").length,
    3,
  );
  assert(f.calls.some((call) => call.command === "/usr/sbin/spctl"));
  assert.equal(result.receipt.notarization, "accepted");
  assert.equal(result.receipt.stapled, true);
  assert.equal(result.receipt.gatekeeperAccepted, true);
  assert.equal(result.receipt.releaseQualityVerified, false);
  const receipt = fs.readFileSync(
    path.join(result.stage, "release-receipt.json"),
    "utf8",
  );
  assert(!receipt.includes("never stored"));
  assert(!f.logs.join("\n").includes("synthetic-notary"));
});

test("Rejected or interrupted notarization never staples, publishes or silently retries", async (t) => {
  for (const overrides of [
    { notaryStatus: "Invalid" },
    {
      fail: (command, args) =>
        command === "/usr/bin/xcrun" && args[0] === "notarytool",
    },
  ]) {
    const f = fixture(t, overrides);
    await assert.rejects(
      f.execute({ sign: true, notarize: true, staple: true }),
    );
    assert.equal(
      f.calls.filter(
        (call) =>
          call.command === "/usr/bin/xcrun" && call.args[0] === "notarytool",
      ).length,
      1,
    );
    assert(
      !f.calls.some(
        (call) =>
          call.command === "/usr/bin/xcrun" && call.args[0] === "stapler",
      ),
    );
    const out = path.join(f.root, "release/distribution");
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(out, fs.readdirSync(out)[0], "release-receipt.json"),
        "utf8",
      ),
    );
    assert(
      ["not-accepted", "submitted-or-uncertain"].includes(receipt.notarization),
    );
    assert.equal(receipt.signatureVerified, true);
    assert.equal(receipt.stapled, false);
    assert.equal(receipt.releaseQualityVerified, false);
  }
});

test("Tool failures suppress raw stdout, stderr and credential-bearing exception messages", () => {
  assert.throws(
    () =>
      defaultRun(
        process.execPath,
        [
          "-e",
          "process.stderr.write('untrusted-provider-detail'); process.exit(1)",
        ],
        {
          releaseError: "A safe fixed operation error",
        },
      ),
    (error) =>
      error.message === "A safe fixed operation error" &&
      !error.message.includes("untrusted-provider-detail"),
  );
});
