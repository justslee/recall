"use strict";

// Build a local release candidate. This script deliberately has no upload mode.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { prepareResources } = require("./build-ipad.cjs");
const root = path.resolve(__dirname, "..");
const modes = new Set([
  "--plan",
  "--check",
  "--unsigned",
  "--archive",
  "--export",
  "--verify-export",
]);

function parseOptions(args) {
  const options = {
    mode: "--plan",
    version: "0.1.0",
    build: "1",
    provisioning: false,
  };
  let selected = false;

  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (modes.has(argument)) {
      if (selected) throw new Error("Choose exactly one operation.");
      options.mode = argument;
      selected = true;
    } else if (argument === "--version" || argument === "--build") {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error("Version and build options require a value.");
      options[argument.slice(2)] = value;
    } else if (argument === "--allow-provisioning-updates") {
      options.provisioning = true;
    } else {
      throw new Error("Unknown archive option. See docs/DISTRIBUTION.md.");
    }
  }

  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(options.version)) {
    throw new Error("Use a numeric release version such as 0.1.0.");
  }

  if (!/^[1-9]\d{0,8}$/.test(options.build)) {
    throw new Error(
      "Use a positive numeric build number; increase it for each upload.",
    );
  }

  if (
    options.provisioning &&
    !["--archive", "--export"].includes(options.mode)
  ) {
    throw new Error(
      "Provisioning access is available only for explicit signed archive/export operations.",
    );
  }

  return options;
}

function candidatePaths(options, base = root) {
  const folder = path.join(
    base,
    "apps/ipad/.build/distribution",
    `${options.version}-${options.build}`,
  );
  const archiveName =
    options.mode === "--unsigned"
      ? "RecallPad-unsigned.xcarchive"
      : "RecallPad.xcarchive";
  return {
    folder,
    archive: path.join(folder, archiveName),
    derived: path.join(
      folder,
      options.mode === "--unsigned" ? "DerivedData-unsigned" : "DerivedData",
    ),
    export: path.join(folder, "Export"),
    exportOptions: path.join(folder, "ExportOptions.plist"),
    log: path.join(folder, `${options.mode.slice(2)}.log`),
  };
}

function assertSourceContract(base = root) {
  const source = (name) =>
    fs.readFileSync(path.join(base, "apps/ipad", name), "utf8");
  const info = source("RecallPad/Info.plist");
  const privacy = source("RecallPad/Resources/PrivacyInfo.xcprivacy");
  const project = source("RecallPad.xcodeproj/project.pbxproj");
  const release = project.match(
    /1B104479E55E37CF8A63CBDF = .*name = Release; };/,
  )?.[0];

  if (
    !release ||
    !release.includes('INFOPLIST_FILE = "RecallPad/Info.plist"') ||
    !release.includes('ENABLE_TESTABILITY = "NO"') ||
    !release.includes('ENABLE_PREVIEWS = "NO"') ||
    !release.includes('IPHONEOS_DEPLOYMENT_TARGET = "17.0"') ||
    !release.includes('ASSETCATALOG_COMPILER_APPICON_NAME = "AppIcon"')
  ) {
    throw new Error(
      "Release configuration failed its iPad, privacy or debug-boundary check.",
    );
  }

  if (
    !info.includes("$(MARKETING_VERSION)") ||
    !info.includes("$(CURRENT_PROJECT_VERSION)") ||
    /NSAllowsArbitraryLoads|NSExceptionAllowsInsecureHTTPLoads/.test(info) ||
    !/<key>NSAllowsLocalNetworking<\/key>\s*<true\s*\/>/.test(info) ||
    !info.includes("NSCameraUsageDescription") ||
    !info.includes("NSLocalNetworkUsageDescription")
  ) {
    throw new Error(
      "Release Info.plist failed its transport, permission or version check.",
    );
  }

  if (
    !/<key>NSPrivacyTracking<\/key>\s*<false\s*\/>/.test(privacy) ||
    !/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\s*\/>/.test(privacy) ||
    !privacy.includes("NSPrivacyAccessedAPICategoryUserDefaults") ||
    !privacy.includes("CA92.1") ||
    !privacy.includes("NSPrivacyAccessedAPICategoryFileTimestamp") ||
    !privacy.includes("C617.1")
  ) {
    throw new Error("Release privacy manifest needs a fresh privacy review.");
  }

  return {
    encryptionDeclarationPresent: info.includes(
      "ITSAppUsesNonExemptEncryption",
    ),
  };
}

// Stat permissions only. Never parse, print or copy the developer's signing values.
function assertPrivateSigningConfig(base = root) {
  let stat;
  try {
    stat = fs.lstatSync(path.join(base, "apps/ipad/Local.xcconfig"));
  } catch {
    throw new Error(
      "Create ignored apps/ipad/Local.xcconfig with your signing configuration first.",
    );
  }

  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(
      "Local.xcconfig must be a regular file owned by you with owner-only permissions (chmod 600).",
    );
  }
}

function archiveCommand(options, paths, base = root) {
  const command = [
    "-project",
    path.join(base, "apps/ipad/RecallPad.xcodeproj"),
    "-scheme",
    "RecallPad",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS",
    "-derivedDataPath",
    paths.derived,
    "-archivePath",
    paths.archive,
    "-hideShellScriptEnvironment",
    "-disableAutomaticPackageResolution",
    "-skipPackageUpdates",
    `MARKETING_VERSION=${options.version}`,
    `CURRENT_PROJECT_VERSION=${options.build}`,
  ];

  if (options.mode === "--unsigned") {
    command.push(
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
      "CODE_SIGN_IDENTITY=",
      "DEVELOPMENT_TEAM=",
    );
  } else if (options.provisioning) {
    command.push("-allowProvisioningUpdates");
  }

  command.push("archive");
  return command;
}

function exportCommand(options, paths) {
  const command = [
    "-exportArchive",
    "-archivePath",
    paths.archive,
    "-exportPath",
    paths.export,
    "-exportOptionsPlist",
    paths.exportOptions,
  ];
  if (options.provisioning) command.push("-allowProvisioningUpdates");
  return command;
}

function exportOptions() {
  // Current Xcode export keys. Keep build numbers stable and never upload.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>signingStyle</key><string>automatic</string>
<key>manageAppVersionAndBuildNumber</key><false/>
<key>uploadSymbols</key><true/>
</dict></plist>
`;
}

function ensurePrivateDirectory(folder) {
  // Do not follow a pre-existing symlink into another user's files.
  const absolute = path.resolve(folder);
  const components = absolute
    .slice(path.parse(absolute).root.length)
    .split(path.sep);
  let current = path.parse(absolute).root;
  for (const part of components) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(
        "Release output directories must not contain symbolic links.",
      );
    }
  }

  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  fs.chmodSync(absolute, 0o700);
}

function runPrivate(command, args, log, dependencies, combined = false) {
  const env = { ...dependencies.env };
  // No tutor provider credential should become a build-script environment value.
  for (const name of Object.keys(env)) {
    if (/^(OPENAI_|ANTHROPIC_|RECALL_.*(?:KEY|TOKEN|SECRET))/i.test(name))
      delete env[name];
  }

  const result = dependencies.spawn(command, args, {
    cwd: dependencies.base,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  fs.appendFileSync(log, output, { mode: 0o600 });
  if (result.error || result.status !== 0) {
    throw new Error(
      "The release command failed. Details are retained only in its owner-only local log.",
    );
  }

  return combined ? output : result.stdout || "";
}

function assertBuiltApp(options, paths, dependencies) {
  const app =
    paths.app ||
    path.join(paths.archive, "Products/Applications/RecallPad.app");
  const json = runPrivate(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", path.join(app, "Info.plist")],
    paths.log,
    dependencies,
  );
  let info;
  try {
    info = JSON.parse(json);
  } catch {
    throw new Error("The archived app metadata is unreadable.");
  }
  const ats = info.NSAppTransportSecurity || {};
  if (
    info.CFBundleShortVersionString !== options.version ||
    info.CFBundleVersion !== options.build ||
    Number.parseFloat(info.MinimumOSVersion) < 17 ||
    !/^\d+(\.\d+)*$/.test(info.MinimumOSVersion || "") ||
    ats.NSAllowsArbitraryLoads ||
    ats.NSAllowsArbitraryLoadsInWebContent ||
    ats.NSAllowsArbitraryLoadsForMedia ||
    ats.NSExceptionDomains ||
    !ats.NSAllowsLocalNetworking ||
    !info.NSCameraUsageDescription ||
    !info.NSLocalNetworkUsageDescription ||
    !Array.isArray(info.UIDeviceFamily) ||
    info.UIDeviceFamily.length !== 1 ||
    info.UIDeviceFamily[0] !== 2
  ) {
    throw new Error(
      "The archive failed its release version, iPad-only or transport-boundary check.",
    );
  }

  if (
    !fs.existsSync(path.join(app, "PrivacyInfo.xcprivacy")) ||
    !fs.existsSync(path.join(app, "Assets.car"))
  ) {
    throw new Error(
      "The archive is missing the privacy manifest or compiled app icon.",
    );
  }

  const privacyJSON = runPrivate(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", path.join(app, "PrivacyInfo.xcprivacy")],
    paths.log,
    dependencies,
  );
  let privacy;
  try {
    privacy = JSON.parse(privacyJSON);
  } catch {
    throw new Error("The archived privacy manifest is unreadable.");
  }
  const requiredReasons = new Map([
    ["NSPrivacyAccessedAPICategoryUserDefaults", "CA92.1"],
    ["NSPrivacyAccessedAPICategoryFileTimestamp", "C617.1"],
  ]);
  if (
    privacy.NSPrivacyTracking !== false ||
    !Array.isArray(privacy.NSPrivacyCollectedDataTypes) ||
    privacy.NSPrivacyCollectedDataTypes.length !== 0 ||
    !Array.isArray(privacy.NSPrivacyAccessedAPITypes) ||
    ![...requiredReasons].every(([category, reason]) =>
      privacy.NSPrivacyAccessedAPITypes.some(
        (item) =>
          item.NSPrivacyAccessedAPIType === category &&
          item.NSPrivacyAccessedAPITypeReasons?.includes(reason),
      ),
    )
  ) {
    throw new Error(
      "The archived privacy manifest failed its declared-use check.",
    );
  }

  if (options.mode !== "--unsigned") {
    runPrivate(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", app],
      paths.log,
      dependencies,
    );
  }
  return info;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function assertDistributionPolicy(
  {
    info,
    signature,
    entitlements,
    profile,
    leafHash,
    profileCertificateHashes,
  },
  now = new Date(),
) {
  const appId = entitlements["application-identifier"];
  const team = entitlements["com.apple.developer.team-identifier"];
  const profileEntitlements = profile.Entitlements || {};
  if (
    !/^Apple Distribution: /.test(signature.authority || "") ||
    !signature.team ||
    signature.team !== team ||
    signature.identifier !== info.CFBundleIdentifier ||
    !Array.isArray(profile.TeamIdentifier) ||
    !profile.TeamIdentifier.includes(team) ||
    profileEntitlements["com.apple.developer.team-identifier"] !== team ||
    profileEntitlements["application-identifier"] !== appId ||
    !Array.isArray(profile.ApplicationIdentifierPrefix) ||
    !profile.ApplicationIdentifierPrefix.some(
      (prefix) => appId === `${prefix}.${info.CFBundleIdentifier}`,
    )
  ) {
    throw new Error(
      "The exported app is not distribution-signed with matching bundle, team and application identifiers.",
    );
  }

  if (
    entitlements["get-task-allow"] !== false ||
    profileEntitlements["get-task-allow"] !== false ||
    Object.hasOwn(profile, "ProvisionedDevices") ||
    profile.ProvisionsAllDevices === true ||
    profileEntitlements["beta-reports-active"] !== true
  ) {
    throw new Error(
      "The exported app contains debugger access or a development, device-limited or enterprise profile.",
    );
  }

  const allowedEntitlements = new Set([
    "application-identifier",
    "com.apple.developer.team-identifier",
    "get-task-allow",
    "beta-reports-active",
    "keychain-access-groups",
  ]);
  if (Object.keys(entitlements).some((key) => !allowedEntitlements.has(key))) {
    throw new Error(
      "The exported app contains an unexpected entitlement; distribution review is required.",
    );
  }

  const groups = entitlements["keychain-access-groups"] || [];
  const authorizedGroups = profileEntitlements["keychain-access-groups"] || [];
  if (
    !Array.isArray(groups) ||
    !Array.isArray(authorizedGroups) ||
    groups.some(
      (group) =>
        !authorizedGroups.some(
          (authorized) =>
            typeof group === "string" &&
            typeof authorized === "string" &&
            (group === authorized ||
              (authorized.endsWith(".*") &&
                group.startsWith(authorized.slice(0, -1)))),
        ),
    )
  ) {
    throw new Error(
      "The exported app has a Keychain group not authorized by its profile.",
    );
  }

  const expiration = new Date(profile.ExpirationDate);
  if (
    !Number.isFinite(expiration.getTime()) ||
    expiration <= now ||
    !leafHash ||
    !profileCertificateHashes.includes(leafHash)
  ) {
    throw new Error(
      "The exported app has an expired profile or a signing certificate absent from its profile.",
    );
  }

  return {
    distributionIdentity: true,
    debuggerDisabled: true,
    profileHasNoDeviceList: true,
    profileNotEnterprise: true,
    appAndTeamIdentifiersMatch: true,
    profileUnexpired: true,
    certificateIncludedInProfile: true,
    entitlementsReviewed: true,
  };
}

function inspectIpaEntries(entries) {
  if (!entries.length || entries.length > 10000)
    throw new Error("The IPA contains an unexpected number of files.");
  let total = 0;
  const apps = new Set();
  const names = new Set();
  for (const entry of entries) {
    const name = entry.entryName;
    const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
    if (
      !normalized ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      normalized
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      names.has(name) ||
      ((entry.header.attr >>> 16) & 0o170000) === 0o120000 ||
      entry.header.size > 128 * 1024 * 1024
    ) {
      throw new Error(
        "The IPA contains an unsafe path, link, duplicate or oversized file.",
      );
    }

    names.add(name);
    total += entry.header.size;
    if (total > 512 * 1024 * 1024)
      throw new Error("The expanded IPA exceeds the release inspection limit.");
    const match = /^Payload\/([^/]+\.app)(?:\/|$)/.exec(name);
    if (match) apps.add(match[1]);
  }

  if (apps.size !== 1 || [...apps][0] !== "RecallPad.app") {
    throw new Error("The IPA must contain exactly one RecallPad application.");
  }
}

function assertBundledWeb(app, base = root) {
  const expected = [
    ["katex/dist/katex.min.js", "katex.min.js"],
    ["katex/dist/katex.min.css", "katex.min.css"],
    ["katex/dist/contrib/auto-render.min.js", "auto-render.min.js"],
    ["dompurify/dist/purify.min.js", "purify.min.js"],
    ["katex/LICENSE", "KATEX-LICENSE.txt"],
    ["dompurify/LICENSE", "DOMPURIFY-LICENSE.txt"],
  ];
  const fontFolder = path.join(base, "node_modules/katex/dist/fonts");
  for (const name of fs.readdirSync(fontFolder))
    expected.push([`katex/dist/fonts/${name}`, `fonts/${name}`]);
  for (const [source, bundled] of expected) {
    const local = path.join(base, "node_modules", source);
    const shipped = path.join(app, "Web", bundled);
    if (
      !fs.existsSync(shipped) ||
      !fs.lstatSync(shipped).isFile() ||
      sha256(fs.readFileSync(local)) !== sha256(fs.readFileSync(shipped))
    ) {
      throw new Error(
        "The exported app differs from its installed locked offline web resources.",
      );
    }
  }
}

function verifyExportedIpa(options, paths, dependencies) {
  const ipaNames = fs
    .readdirSync(paths.export)
    .filter((name) => name.endsWith(".ipa"));
  if (ipaNames.length !== 1)
    throw new Error("The export must contain exactly one IPA.");
  const ipaPath = path.join(paths.export, ipaNames[0]);
  const stat = fs.lstatSync(ipaPath);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256 * 1024 * 1024) {
    throw new Error(
      "The exported IPA must be a regular local file within the inspection size limit.",
    );
  }

  const before = sha256(fs.readFileSync(ipaPath));
  const AdmZip = require("adm-zip");
  let zip;
  try {
    zip = new AdmZip(ipaPath);
  } catch {
    throw new Error("The exported IPA is not a readable ZIP archive.");
  }
  inspectIpaEntries(zip.getEntries());
  const stage = fs.mkdtempSync(path.join(paths.folder, ".verify-"));
  fs.chmodSync(stage, 0o700);
  const privateFile = (name) => path.join(stage, name);
  const run = (command, args, combined = false) =>
    runPrivate(command, args, paths.log, dependencies, combined);
  const parseJSON = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("Export signing metadata could not be decoded.");
    }
  };
  const extract = (file, key, format = "json") =>
    run("/usr/bin/plutil", ["-extract", key, format, "-o", "-", file]);
  try {
    run("/usr/bin/ditto", ["-x", "-k", ipaPath, stage]);
    const app = path.join(stage, "Payload/RecallPad.app");
    const info = assertBuiltApp(options, { ...paths, app }, dependencies);
    assertBundledWeb(app, dependencies.base);
    run("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      "-R=anchor apple generic",
      app,
    ]);
    const metadata = run(
      "/usr/bin/codesign",
      ["--display", "--verbose=4", app],
      true,
    );
    const signature = {
      identifier: /^Identifier=(.+)$/m.exec(metadata)?.[1]?.trim(),
      team: /^TeamIdentifier=(.+)$/m.exec(metadata)?.[1]?.trim(),
      authority: /^Authority=(.+)$/m.exec(metadata)?.[1]?.trim(),
    };
    const entitlementOutput = run("/usr/bin/codesign", [
      "--display",
      "--xml",
      "--entitlements",
      "-",
      app,
    ]);
    const xml = entitlementOutput.match(/<plist[\s\S]*<\/plist>/)?.[0];
    if (!xml)
      throw new Error("The exported signature has no readable entitlements.");
    const entitlementFile = privateFile("entitlements.plist");
    fs.writeFileSync(entitlementFile, xml, { mode: 0o600 });
    const entitlements = parseJSON(
      run("/usr/bin/plutil", ["-convert", "json", "-o", "-", entitlementFile]),
    );

    const profileFile = path.join(app, "embedded.mobileprovision");
    const decoded = privateFile("profile.plist");
    run("/usr/bin/security", ["cms", "-D", "-i", profileFile, "-o", decoded]);
    fs.chmodSync(decoded, 0o600);
    const profileXML = fs.readFileSync(decoded, "utf8");
    const profile = {
      Entitlements: parseJSON(extract(decoded, "Entitlements")),
      TeamIdentifier: parseJSON(extract(decoded, "TeamIdentifier")),
      ApplicationIdentifierPrefix: parseJSON(
        extract(decoded, "ApplicationIdentifierPrefix"),
      ),
      ExpirationDate: extract(decoded, "ExpirationDate", "raw").trim(),
      ProvisionsAllDevices:
        /<key>ProvisionsAllDevices<\/key>\s*<true\s*\/>/.test(profileXML),
    };
    if (/<key>ProvisionedDevices<\/key>/.test(profileXML))
      profile.ProvisionedDevices = [];
    const certificateCount = Number(
      extract(decoded, "DeveloperCertificates", "raw").trim(),
    );
    if (
      !Number.isInteger(certificateCount) ||
      certificateCount < 1 ||
      certificateCount > 10
    ) {
      throw new Error(
        "The exported provisioning profile has invalid certificate metadata.",
      );
    }

    const profileCertificateHashes = [];
    for (let i = 0; i < certificateCount; i += 1) {
      profileCertificateHashes.push(
        sha256(
          Buffer.from(
            extract(decoded, `DeveloperCertificates.${i}`, "raw").replace(
              /\s/g,
              "",
            ),
            "base64",
          ),
        ),
      );
    }

    const certificatePrefix = privateFile("signing-");
    run("/usr/bin/codesign", [
      "--display",
      `--extract-certificates=${certificatePrefix}`,
      app,
    ]);
    const leafHash = sha256(fs.readFileSync(`${certificatePrefix}0`));
    const checks = assertDistributionPolicy({
      info,
      signature,
      entitlements,
      profile,
      leafHash,
      profileCertificateHashes,
    });
    const after = sha256(fs.readFileSync(ipaPath));
    if (before !== after)
      throw new Error(
        "The IPA changed during verification; stop and prepare a new candidate.",
      );
    return {
      schemaVersion: 1,
      platform: "iPadOS",
      version: options.version,
      build: options.build,
      ipaSha256: after,
      verifiedAt: new Date().toISOString(),
      uploadPerformed: false,
      checks: {
        ...checks,
        signatureAppleAnchored: true,
        infoAndPrivacyValidated: true,
        compiledIconPresent: true,
        lockedOfflineResourcesMatch: true,
        immutableIpa: true,
      },
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function saveExportReceipt(receipt, paths) {
  fs.writeFileSync(
    path.join(paths.folder, "export-verification.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
}

function main(args, injected = {}) {
  const options = parseOptions(args);
  const dependencies = {
    base: root,
    platform: process.platform,
    env: process.env,
    spawn: spawnSync,
    resources: prepareResources,
    exportValidator: verifyExportedIpa,
    write: console.log,
    ...injected,
  };
  const source = assertSourceContract(dependencies.base);
  const paths = candidatePaths(options, dependencies.base);

  if (["--plan", "--check"].includes(options.mode)) {
    dependencies.write(
      `PASS iPad release source checks. Candidate ${options.version} (${options.build}); iPadOS 17+, Release configuration.`,
    );
    dependencies.write(
      "No signing values read, files changed, Apple requests made or uploads performed.",
    );
    dependencies.write(
      source.encryptionDeclarationPresent
        ? "Reconfirm the existing encryption declaration and App Privacy answers before submission."
        : "Export compliance remains an owner-reviewed App Store Connect questionnaire; no declaration is assumed.",
    );
    return { options, paths };
  }

  if (dependencies.platform !== "darwin")
    throw new Error("Release compilation requires a Mac with full Xcode.");
  if (!["--unsigned", "--verify-export"].includes(options.mode))
    assertPrivateSigningConfig(dependencies.base);
  if (options.mode === "--verify-export") {
    if (!fs.existsSync(paths.export))
      throw new Error("Create the matching exported IPA before verification.");
    if (fs.existsSync(path.join(paths.folder, "export-verification.json"))) {
      throw new Error(
        "This candidate already has a verification receipt; do not overwrite it.",
      );
    }
  } else if (options.mode === "--export") {
    if (!fs.existsSync(paths.archive))
      throw new Error("Create the matching signed archive before exporting.");
    if (fs.existsSync(paths.export))
      throw new Error(
        "The export already exists. Use a new build number instead of replacing it.",
      );
  } else if (fs.existsSync(paths.archive)) {
    throw new Error(
      "The archive already exists. Use a new build number instead of replacing it.",
    );
  }

  ensurePrivateDirectory(paths.folder);
  if (options.mode === "--verify-export" && fs.existsSync(paths.log)) {
    paths.log = path.join(
      paths.folder,
      `verify-export-${crypto.randomUUID()}.log`,
    );
  }
  const logHandle = fs.openSync(paths.log, "wx", 0o600);
  fs.closeSync(logHandle);
  const previousMask = process.umask(0o077);
  try {
    if (options.mode === "--verify-export") {
      saveExportReceipt(
        dependencies.exportValidator(options, paths, dependencies),
        paths,
      );
    } else if (options.mode === "--export") {
      assertBuiltApp(options, paths, dependencies);
      fs.writeFileSync(paths.exportOptions, exportOptions(), {
        mode: 0o600,
        flag: "wx",
      });
      runPrivate(
        "xcodebuild",
        exportCommand(options, paths),
        paths.log,
        dependencies,
      );
      const ipa = fs
        .readdirSync(paths.export)
        .filter((name) => name.endsWith(".ipa"));
      if (ipa.length !== 1)
        throw new Error(
          "Export did not produce exactly one IPA; inspect the local export log.",
        );
      saveExportReceipt(
        dependencies.exportValidator(options, paths, dependencies),
        paths,
      );
    } else {
      dependencies.resources();
      runPrivate(
        "xcodebuild",
        archiveCommand(options, paths, dependencies.base),
        paths.log,
        dependencies,
      );
      assertBuiltApp(options, paths, dependencies);
    }

    dependencies.write(
      `PASS local iPad ${options.mode.slice(2)} preparation for ${options.version} (${options.build}). No upload was performed.`,
    );
    dependencies.write(
      `Candidate: apps/ipad/.build/distribution/${options.version}-${options.build}/`,
    );
  } finally {
    process.umask(previousMask);
  }

  return { options, paths };
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseOptions,
  candidatePaths,
  assertSourceContract,
  assertPrivateSigningConfig,
  archiveCommand,
  exportCommand,
  exportOptions,
  ensurePrivateDirectory,
  runPrivate,
  assertBuiltApp,
  assertDistributionPolicy,
  inspectIpaEntries,
  assertBundledWeb,
  verifyExportedIpa,
  saveExportReceipt,
  main,
};
