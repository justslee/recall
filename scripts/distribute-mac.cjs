const fs = require("node:fs"),
  path = require("node:path");
const {
  BUNDLE_ID,
  failure,
  within,
  defaultRun,
  plistJSON,
  inspectBundleLayout,
  verifySigned,
  hashFile,
} = require("../skills/recall-upgrade/scripts/mac-release.cjs");

const TOKEN = /^[A-Za-z0-9_.-]{1,128}$/;
const HELPER_IDS = {
  "Recall Helper.app": BUNDLE_ID + ".helper",
  "Recall Helper (Renderer).app": BUNDLE_ID + ".helper.renderer",
  "Recall Helper (GPU).app": BUNDLE_ID + ".helper.gpu",
  "Recall Helper (Plugin).app": BUNDLE_ID + ".helper.plugin",
};

function parseArgs(args) {
  const options = { sign: false, notarize: false, staple: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--check", "--dry-run"].includes(arg)) options.check = true;
    else if (["--sign", "--notarize", "--staple"].includes(arg))
      options[arg.slice(2)] = true;
    else if (["--app", "--build-number"].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw failure("A release option is missing its value.");

      options[arg === "--app" ? "app" : "buildNumber"] = args[++i];
    } else throw failure("Unknown release option. Use --check or --sign.");
  }
  if (options.check && (options.sign || options.notarize || options.staple))
    throw failure(
      "Read-only checks cannot be combined with signing or uploads.",
    );
  if (options.notarize && !options.sign)
    throw failure("--notarize requires an explicit --sign.");
  if (options.staple && !options.notarize)
    throw failure("--staple requires an explicit --notarize.");

  return options;
}

function sourceApp(root, candidate) {
  const release = path.join(root, "release");
  const app = path.resolve(
    root,
    candidate || "release/Recall-darwin-arm64/Recall.app",
  );
  if (!within(release, app) || path.basename(app) !== "Recall.app")
    throw failure(
      "Use a packaged Recall.app under this checkout's release directory.",
    );
  if (!fs.existsSync(app))
    throw failure("No packaged app found. Run npm run package first.");

  // Never follow a user-controlled release-directory alias into /Applications.
  if (fs.realpathSync(release) !== release || fs.realpathSync(app) !== app)
    throw failure("The packaged app path must not be a symbolic-link alias.");

  return app;
}

function configForSigning(root, app, identity) {
  const native = path.join(
    app,
    "Contents/Resources/app.asar.unpacked/dist-native/RecallPadHandoff",
  );
  return {
    app,
    platform: "darwin",
    type: "distribution",
    identity,
    identityValidation: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    binaries: [native],
    optionsForFile(file) {
      return {
        entitlements: path.join(
          root,
          "packaging",
          file === native
            ? "mac-native-entitlements.plist"
            : "mac-entitlements.plist",
        ),
        hardenedRuntime: true,
      };
    },
  };
}

async function defaultSign(options) {
  // osx-sign's optional DEBUG output includes identities and command arguments.
  const previousDebug = process.env.DEBUG;
  process.env.DEBUG = "";
  try {
    const { sign } = await import("@electron/osx-sign");
    await sign(options);
  } catch {
    throw failure(
      "Developer ID signing failed. Check the selected certificate and private key in Xcode; no candidate was published.",
    );
  } finally {
    if (previousDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = previousDebug;
  }
}

async function prepare({
  root = path.resolve(__dirname, ".."),
  options = {},
  env = process.env,
  platform = process.platform,
  run = defaultRun,
  sign = defaultSign,
  fuses,
  log = console.log,
} = {}) {
  if (platform !== "darwin")
    throw failure(
      "Mac distribution preparation requires macOS and Apple Command Line Tools.",
    );
  root = fs.realpathSync(root);
  const app = sourceApp(root, options.app);
  inspectBundleLayout(app);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const version = /^(\d+\.\d+\.\d+)(?:-[A-Za-z0-9.-]+)?$/.exec(
    pkg.version,
  )?.[1];
  if (!version)
    throw failure(
      "Set a valid three-part package version before distributing.",
    );

  const info = plistJSON(path.join(app, "Contents/Info.plist"), run);
  if (
    info.CFBundleExecutable !== "Recall" ||
    info.CFBundleName !== "Recall" ||
    info.CFBundleShortVersionString !== pkg.version
  )
    throw failure(
      "The packaged app is stale or does not match this checkout. Rebuild it first.",
    );

  const native = path.join(
    app,
    "Contents/Resources/app.asar.unpacked/dist-native/RecallPadHandoff",
  );
  if (!fs.existsSync(native) || !fs.statSync(native).isFile())
    throw failure(
      "The packaged Bonjour helper is missing. Build it, then package again.",
    );
  if (fs.realpathSync(native) !== native)
    throw failure(
      "The packaged Bonjour helper must not be a symbolic-link alias.",
    );

  for (const binary of [path.join(app, "Contents/MacOS/Recall"), native]) {
    const result = run("/usr/bin/lipo", ["-archs", binary], {
      releaseError:
        "The packaged executable architecture could not be inspected.",
    });
    if (result.stdout.trim() !== "arm64")
      throw failure(
        "This distribution path accepts an Apple Silicon arm64-only app and helper.",
      );
  }

  const buildNumber = String(
    options.buildNumber || env.RECALL_MAC_BUILD_NUMBER || "",
  );
  const validBuild = /^[1-9]\d{0,8}$/.test(buildNumber);
  const identity = env.RECALL_MAC_SIGN_IDENTITY;
  const validIdentity =
    typeof identity === "string" &&
    /^(?:Developer ID Application: [^\r\n]+ \([A-Z0-9]{10}\)|[A-Fa-f0-9]{40})$/.test(
      identity,
    );
  const profile = env.RECALL_NOTARY_PROFILE;
  if (profile && !TOKEN.test(profile))
    throw failure(
      "Use a simple keychain-profile name for RECALL_NOTARY_PROFILE.",
    );
  if (env.DEBUG || env.ELECTRON_OSX_SIGN_DEBUG)
    throw failure(
      "Disable DEBUG/ELECTRON_OSX_SIGN_DEBUG before release preparation so private signing metadata is not logged.",
    );

  // Both audits apply before code signatures alter the native helper bytes.
  for (const script of ["audit-release.cjs", "audit-package.cjs"])
    run(
      process.execPath,
      [
        path.join(root, "scripts", script),
        ...(script === "audit-package.cjs"
          ? [path.join(app, "Contents/Resources/app.asar")]
          : []),
      ],
      {
        cwd: root,
        releaseError:
          script === "audit-release.cjs"
            ? "The source/history privacy audit failed; distribution stopped."
            : "The packaged privacy audit failed; distribution stopped.",
      },
    );

  fuses ||= await import("@electron/fuses");
  const wire = await fuses.getCurrentFuseWire(app);
  const { FuseV1Options: keys, FuseState } = fuses;
  for (const [key, enabled] of [
    [keys.RunAsNode, true],
    [keys.EnableNodeOptionsEnvironmentVariable, false],
    [keys.EnableEmbeddedAsarIntegrityValidation, true],
    [keys.OnlyLoadAppFromAsar, true],
  ])
    if (wire[key] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE))
      throw failure(
        "The packaged app's security fuses do not match Recall's required policy.",
      );

  const blockers = [
    ...(!validIdentity
      ? [
          "Set RECALL_MAC_SIGN_IDENTITY to a Developer ID Application certificate name or fingerprint.",
        ]
      : []),
    ...(!validBuild
      ? [
          "Set a new numeric build number with --build-number or RECALL_MAC_BUILD_NUMBER.",
        ]
      : []),
    ...(options.notarize && !profile
      ? [
          "Set RECALL_NOTARY_PROFILE to a previously stored notarytool keychain-profile name.",
        ]
      : []),
  ];
  if (!options.sign) {
    log(
      "PASS source/history and packaged privacy checks; app/helper metadata and required fuses inspected.",
    );
    log(
      "No files changed, identity queried, signing performed or upload started.",
    );
    for (const blocker of blockers) log("Not ready: " + blocker);
    if (!blockers.length)
      log(
        "Configured for signing; certificate availability and release quality still require verification.",
      );

    return { mode: "check", configured: !blockers.length, blockers };
  }
  if (blockers.length) throw failure(blockers.join(" "));

  const out = path.join(root, "release/distribution");
  if (fs.existsSync(out) && fs.realpathSync(out) !== out)
    throw failure(
      "The distribution directory must not be a symbolic-link alias.",
    );
  fs.mkdirSync(out, { recursive: true });
  const stage = fs.mkdtempSync(path.join(out, "candidate-"));
  const stagedApp = path.join(stage, "Recall.app");
  const name = `Recall-${pkg.version}-macos-arm64.zip`;
  const archive = path.join(stage, name);
  const receiptPath = path.join(stage, "release-receipt.json");
  const receipt = {
    schemaVersion: 1,
    version: pkg.version,
    buildNumber,
    bundleIdentifier: BUNDLE_ID,
    architecture: "arm64",
    signatureVerified: false,
    notarization: "not-requested",
    stapled: false,
    gatekeeperAccepted: false,
    releaseQualityVerified: false,
    sourceArchiveSha256: hashFile(
      path.join(app, "Contents/Resources/app.asar"),
    ),
    sourceNativeHelperSha256: hashFile(native),
    installationNote:
      "The stable production bundle ID may require fresh macOS consent or login-item registration when replacing a development package. Preparation does not modify an installed app or Recall profile.",
  };
  const saveReceipt = () =>
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
    });
  saveReceipt();
  const unlock = require("../electron/config.cjs").lock(stage);
  try {
    run("/usr/bin/ditto", ["--rsrc", "--extattr", app, stagedApp], {
      releaseError: "Copying the separate distribution candidate failed.",
    });
    inspectBundleLayout(stagedApp);
    // Remove copied Finder/quarantine/download metadata from the new candidate,
    // including potential origin URLs. The source package stays untouched.
    run("/usr/bin/xattr", ["-cr", stagedApp], {
      releaseError:
        "Removing copied download metadata from the candidate failed.",
    });
    const bundleMetadata = [
      [stagedApp, BUNDLE_ID],
      ...Object.entries(HELPER_IDS)
        .filter(([name]) =>
          fs.existsSync(path.join(stagedApp, "Contents/Frameworks", name)),
        )
        .map(([name, identifier]) => [
          path.join(stagedApp, "Contents/Frameworks", name),
          identifier,
        ]),
    ];
    for (const [bundle, identifier] of bundleMetadata) {
      const plist = path.join(bundle, "Contents/Info.plist");
      for (const [key, value] of [
        ["CFBundleIdentifier", identifier],
        ["CFBundleShortVersionString", version],
        ["CFBundleVersion", buildNumber],
        ...(bundle === stagedApp
          ? [["LSApplicationCategoryType", "public.app-category.education"]]
          : []),
      ])
        run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], {
          releaseError: "Updating public distribution metadata failed.",
        });
    }

    await fuses.flipFuses(stagedApp, {
      version: fuses.FuseVersion.V1,
      resetAdHocDarwinSignature: true,
      [keys.EnableNodeCliInspectArguments]: false,
    });
    if (
      (await fuses.getCurrentFuseWire(stagedApp))[
        keys.EnableNodeCliInspectArguments
      ] !== FuseState.DISABLE
    )
      throw failure(
        "The distribution candidate still allows Node inspector arguments.",
      );

    log(
      "Signing the separate candidate with hardened runtime; no original or installed app is modified.",
    );
    await sign(configForSigning(root, stagedApp, identity));
    verifySigned(stagedApp, run);
    receipt.signatureVerified = true;
    saveReceipt();
    const zip = () =>
      run(
        "/usr/bin/ditto",
        ["-c", "-k", "--sequesterRsrc", "--keepParent", stagedApp, archive],
        {
          releaseError: "Creating the distribution ZIP failed.",
        },
      );
    zip();
    if (options.notarize) {
      receipt.notarization = "submitted-or-uncertain";
      saveReceipt();
      log(
        "Uploading this signed app to Apple's notarization service (--notarize was explicitly selected).",
      );
      const result = run(
        "/usr/bin/xcrun",
        [
          "notarytool",
          "submit",
          archive,
          "--keychain-profile",
          profile,
          "--wait",
          "--output-format",
          "json",
        ],
        {
          timeout: 30 * 60 * 1000,
          releaseError:
            "Notarization did not finish. Check the submission with notarytool before retrying; the separate candidate is kept.",
        },
      );
      let response;
      try {
        response = JSON.parse(result.stdout);
      } catch {
        throw failure(
          "Notarization returned an unreadable response. Check Apple's submission history before retrying.",
        );
      }
      if (
        typeof response.id !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(response.id)
      )
        throw failure(
          "Notarization returned no verifiable submission ID. Check Apple's submission history before retrying.",
        );

      receipt.notarizationSubmissionId = response.id;
      receipt.notarization =
        response.status === "Accepted" ? "accepted" : "not-accepted";
      saveReceipt();
      if (response.status !== "Accepted")
        throw failure(
          "Apple did not accept this candidate. Inspect its notarization log privately; nothing was published.",
        );
    }
    if (options.staple) {
      run("/usr/bin/xcrun", ["stapler", "staple", stagedApp], {
        releaseError:
          "Notarization passed but stapling failed; do not publish the current ZIP.",
      });
      inspectBundleLayout(stagedApp, { verifyStapledTicket: true, run });
      verifySigned(stagedApp, run);
      run(
        "/usr/sbin/spctl",
        ["--assess", "--type", "execute", "--verbose=2", stagedApp],
        {
          releaseError:
            "The stapled candidate did not pass Gatekeeper assessment.",
        },
      );
      receipt.stapled = true;
      receipt.gatekeeperAccepted = true;
      // The downloadable ZIP must contain the stapled app, not the earlier copy.
      fs.unlinkSync(archive);
      zip();
    }
    receipt.archive = name;
    receipt.sha256 = hashFile(archive);
    saveReceipt();
    fs.writeFileSync(
      path.join(stage, "SHA256SUMS"),
      `${receipt.sha256}  ${name}\n`,
      { mode: 0o600 },
    );
    log(
      `Candidate saved under ${path.relative(root, stage)}; SHA256SUMS and a non-secret receipt included.`,
    );
    log(
      options.staple
        ? "Signature, notarization, stapling and Gatekeeper checks passed. Clean-Mac installation and product release gates remain required."
        : "The signed ZIP is a preparation candidate. Notarization/stapling and clean-Mac release checks remain required.",
    );

    return { mode: "candidate", stage, receipt };
  } catch (error) {
    // Preserve staged output and receipt for diagnosis; never retry a provider
    // submission automatically or overwrite the existing development package.
    saveReceipt();
    log(
      `Preparation stopped; recovery files remain under ${path.relative(root, stage)}.`,
    );
    throw error;
  } finally {
    unlock();
  }
}

if (require.main === module) {
  Promise.resolve()
    .then(() => prepare({ options: parseArgs(process.argv.slice(2)) }))
    .then((result) => {
      if (result.mode === "check" && !result.configured) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(
        error.releaseMessage ||
          "Mac release preparation failed; private tool output was suppressed.",
      );
      process.exitCode = 1;
    });
}
module.exports = {
  parseArgs,
  prepare,
  configForSigning,
  verifySigned,
  defaultRun,
  BUNDLE_ID,
  inspectBundleLayout,
  hashFile,
};
