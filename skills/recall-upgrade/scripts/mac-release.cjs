// Bundle verification must bypass Electron's path-keyed ASAR cache.
const fs = process.versions.electron
  ? require("original-fs")
  : require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const BUNDLE_ID = "com.justslee.recall";
const NATIVE_IDENTIFIER = "com.recall.pad-handoff";
const HELPER_IDS = {
  "Recall Helper.app": BUNDLE_ID + ".helper",
  "Recall Helper (Renderer).app": BUNDLE_ID + ".helper.renderer",
  "Recall Helper (GPU).app": BUNDLE_ID + ".helper.gpu",
  "Recall Helper (Plugin).app": BUNDLE_ID + ".helper.plugin",
};

function failure(message) {
  const error = Error(message);
  error.releaseMessage = message;
  return error;
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function guiEnvironment(env = process.env) {
  const next = { ...env };
  // The helper uses Electron as Node. Carrying that flag through LaunchServices
  // makes the replacement exit as a command-line process instead of opening UI.
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.NODE_OPTIONS;
  delete next.NODE_PATH;
  return next;
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
    // Provider/tool errors can contain local paths, credentials or identities.
    // Capture them; publish only the fixed operation-level error below.
    stdio: options.input === undefined ? "pipe" : undefined,
  });
  if (result.error || result.status !== 0)
    throw failure(
      options.releaseError || "A release tool failed; preparation stopped.",
    );

  return { stdout: result.stdout || "", stderr: result.stderr || "" };
}

function plistJSON(file, run) {
  const result = run("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], {
    releaseError: "The packaged app metadata could not be inspected.",
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw failure("The packaged app metadata was invalid.");
  }
}

function inspectBundleLayout(
  app,
  { verifyStapledTicket = false, requireStapler = true, run = defaultRun } = {},
) {
  const contents = path.join(app, "Contents");
  const allowed = new Set([
    "Info.plist",
    "PkgInfo",
    "_CodeSignature",
    "MacOS",
    "Frameworks",
    "Resources",
  ]);
  if (verifyStapledTicket === true) {
    // Apple stapler adds this separate binary ticket after signing. A matching
    // filename or header is insufficient: Apple must validate the ticket too.
    const ticket = path.join(contents, "CodeResources");
    let metadata, header;
    try {
      metadata = fs.lstatSync(ticket);
      if (!metadata.isFile() || metadata.size < 16 || metadata.size > 65536)
        throw Error("invalid ticket");

      const fd = fs.openSync(
        ticket,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        header = Buffer.alloc(4);
        if (fs.readSync(fd, header, 0, 4, 0) !== 4)
          throw Error("invalid ticket");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      throw failure(
        "The stapled ticket must be a regular, bounded binary file.",
      );
    }
    if (!header.equals(Buffer.from("s8ch")))
      throw failure("The stapled ticket has an unexpected binary format.");

    allowed.add("CodeResources");
  }
  if (fs.readdirSync(contents).some((name) => !allowed.has(name)))
    throw failure(
      "The app has an unexpected loose bundle item; review it before distribution.",
    );

  if (
    fs
      .readdirSync(path.join(contents, "MacOS"))
      .some((name) => name !== "Recall")
  )
    throw failure("The app has an unexpected main executable item.");
  const resources = path.join(contents, "Resources");
  for (const name of fs.readdirSync(resources)) {
    if (
      !["app.asar", "app.asar.unpacked", "electron.icns"].includes(name) &&
      !/^[a-z]{2,3}(?:_(?:[A-Z]{2}|\d{3}))?\.lproj$/.test(name)
    )
      throw failure(
        "The app has an unexpected loose resource; private source files must not ship outside the audited archive.",
      );
  }
  const frameworks = new Set([
    "Electron Framework.framework",
    "ReactiveObjC.framework",
    "Squirrel.framework",
    "Mantle.framework",
    "Recall Helper.app",
    "Recall Helper (Renderer).app",
    "Recall Helper (GPU).app",
    "Recall Helper (Plugin).app",
  ]);
  if (
    fs
      .readdirSync(path.join(contents, "Frameworks"))
      .some((name) => !frameworks.has(name))
  )
    throw failure("The app has an unexpected framework or executable bundle.");

  const unpacked = path.join(resources, "app.asar.unpacked");
  if (
    fs.readdirSync(unpacked).some((name) => name !== "dist-native") ||
    fs
      .readdirSync(path.join(unpacked, "dist-native"))
      .some((name) => name !== "RecallPadHandoff")
  )
    throw failure("The app has unexpected unpacked first-party files.");

  const sensitive =
    /(?:^|\/)(?:\.env[^/]*|auth\.json|openai\.key|Local\.xcconfig|credentials|pad-identity|paper-authority)(?:\/|$)|\.(?:p12|p8|pem|key|mobileprovision|provisionprofile|sqlite\d*|db|db-wal|db-shm)$/i;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (sensitive.test(path.relative(app, file).split(path.sep).join("/")))
        throw failure(
          "A private credential, profile or data file is present in the app bundle.",
        );
      if (entry.isSymbolicLink()) {
        if (!within(app, fs.realpathSync(file)))
          throw failure("A bundle symbolic link points outside the candidate.");
      } else if (entry.isDirectory()) walk(file);
      else if (!entry.isFile())
        throw failure("A non-regular file is present in the app bundle.");
    }
  }
  walk(contents);
  if (verifyStapledTicket === true && requireStapler)
    run("/usr/bin/xcrun", ["stapler", "validate", app], {
      releaseError: "Apple could not validate the app's stapled ticket.",
    });
}

function entitledCode(metadata, expectedEntitlements, run) {
  const text = metadata.stdout + "\n" + metadata.stderr;
  const xml = text.match(/<plist[\s\S]*<\/plist>/)?.[0];
  // codesign may omit the XML entirely for a component with no entitlements.
  if (
    !xml &&
    !metadata.stdout.trim() &&
    !Object.keys(expectedEntitlements).length
  )
    return;
  if (!xml)
    throw failure("A signed component's entitlements could not be inspected.");

  let actual;
  try {
    actual = JSON.parse(
      run("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
        input: xml,
        releaseError: "A signed component's entitlements were invalid.",
      }).stdout,
    );
  } catch {
    throw failure("A signed component's entitlements were invalid.");
  }
  const keys = Object.keys(actual).sort();
  if (
    JSON.stringify(keys) !==
      JSON.stringify(Object.keys(expectedEntitlements).sort()) ||
    keys.some((key) => actual[key] !== expectedEntitlements[key])
  )
    throw failure(
      "A signed component has unexpected entitlements. Distribution stopped.",
    );
}

function verifySigned(app, run) {
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
    releaseError: "Strict verification of the signed bundle failed.",
  });
  const frameworks = path.join(app, "Contents/Frameworks");
  const apps = fs
    .readdirSync(frameworks)
    .filter((name) => name.endsWith(".app"));
  const native = path.join(
    app,
    "Contents/Resources/app.asar.unpacked/dist-native/RecallPadHandoff",
  );
  let team;
  for (const component of [
    app,
    ...apps.map((name) => path.join(frameworks, name)),
    native,
  ]) {
    const metadata = run(
      "/usr/bin/codesign",
      ["-d", "--verbose=4", component],
      {
        releaseError: "A signed component's identity could not be inspected.",
      },
    );
    const text = metadata.stdout + "\n" + metadata.stderr;
    const currentTeam = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(text)?.[1];
    const timestamp = /^Timestamp=(.+)$/m.exec(text)?.[1];
    if (
      !currentTeam ||
      (team && team !== currentTeam) ||
      !/^Authority=Developer ID Application:/m.test(text) ||
      !/^CodeDirectory .*flags=.*\bruntime\b/m.test(text) ||
      !timestamp ||
      /^none$/i.test(timestamp)
    )
      throw failure(
        "Signed components must use the same Developer ID team, hardened runtime and secure timestamp.",
      );

    team = currentTeam;
    const expectedId =
      component === app
        ? BUNDLE_ID
        : component === native
          ? NATIVE_IDENTIFIER
          : HELPER_IDS[path.basename(component)];
    if (expectedId && !text.split("\n").includes("Identifier=" + expectedId))
      throw failure(
        "A signed component has an unexpected application identifier.",
      );

    const expectedEntitlements =
      component === native
        ? {}
        : {
            "com.apple.security.cs.allow-jit": true,
            "com.apple.security.device.audio-input": true,
          };
    entitledCode(
      run(
        "/usr/bin/codesign",
        ["-d", "--xml", "--entitlements", "-", component],
        {
          releaseError:
            "A signed component's entitlements could not be inspected.",
        },
      ),
      expectedEntitlements,
      run,
    );
  }
  return team;
}

function hashFile(file, io = fs) {
  const hash = crypto.createHash("sha256");
  // Hash incrementally: the Electron archive can be hundreds of megabytes.
  const fd = io.openSync(file, "r"),
    buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    while ((bytes = io.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, bytes));
  } finally {
    io.closeSync(fd);
  }
  return hash.digest("hex");
}

function directory(folder) {
  if (!fs.lstatSync(folder).isDirectory() || fs.realpathSync(folder) !== folder)
    throw Error("A release directory is missing or aliased.");
}

function regular(file) {
  if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file)
    throw Error("A release file is missing or aliased.");
}

function validateApp(folder, { stapled, run }) {
  directory(folder);
  inspectBundleLayout(folder, { verifyStapledTicket: stapled, run });
  const team = verifySigned(folder, run);
  if (stapled)
    run("/usr/sbin/spctl", ["--assess", "--type", "execute", folder], {
      releaseError: "Release Gatekeeper verification failed.",
    });
  return team;
}

let cachedZip;
function loadZip() {
  if (cachedZip) return cachedZip;
  let Zip;
  try {
    Zip = require("adm-zip");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    const marker = ".app/Contents/MacOS/";
    const offset = process.execPath.indexOf(marker);
    if (offset < 0)
      throw Error("Run this helper with Recall's bundled runtime.");
    const installed = process.execPath.slice(0, offset + 4);
    Zip = require(
      path.join(installed, "Contents/Resources/app.asar/node_modules/adm-zip"),
    );
  }
  cachedZip = Zip;
  return Zip;
}

function inspectMacArchive(file) {
  if (fs.statSync(file).size > 512 * 1024 * 1024)
    throw Error("The release ZIP exceeds the inspection limit.");

  const entries = new (loadZip())(file).getEntries();
  if (!entries.length || entries.length > 10000)
    throw Error("The release ZIP contains an unexpected number of files.");

  // macOS paths can alias through case and Unicode normalization.
  const folded = (name) =>
    name.normalize("NFD").toUpperCase().toLowerCase().normalize("NFD");
  const names = new Set();
  const apps = new Set();
  const links = new Set();
  let bytes = 0;
  for (const entry of entries) {
    const name = entry.entryName.replace(/\/$/, "");
    const parts = name.split("/");
    if (
      !name ||
      entry.entryName.includes("\\") ||
      name.includes("\0") ||
      parts.some((part) => !part || part === "." || part === "..") ||
      names.has(folded(name)) ||
      entry.header.size > 512 * 1024 * 1024
    )
      throw Error("The release ZIP contains an unsafe or duplicate path.");

    names.add(folded(name));
    bytes += entry.header.size;
    if (bytes > 2 * 1024 * 1024 * 1024)
      throw Error("The expanded release ZIP exceeds the inspection limit.");

    if (parts[0] !== "__MACOSX") apps.add(parts[0]);
    const type = (entry.header.attr >>> 16) & 0o170000;
    if (![0, 0o100000, 0o040000, 0o120000].includes(type))
      throw Error("The release ZIP contains an unsupported file type.");

    if (type === 0o120000) {
      if (entry.header.size > 4096 || parts[0] === "__MACOSX")
        throw Error("The release ZIP contains an unsafe symbolic link.");

      const target = entry.getData().toString("utf8");
      const resolved = path.posix.resolve(
        "/",
        path.posix.dirname(name),
        target,
      );
      if (
        !target ||
        target.includes("\0") ||
        target.includes("\\") ||
        path.posix.isAbsolute(target) ||
        (resolved !== "/" + parts[0] &&
          !resolved.startsWith("/" + parts[0] + "/"))
      )
        throw Error("A release ZIP link escapes its application.");

      links.add(folded(name));
    }
  }
  if (apps.size !== 1 || !/^[A-Za-z0-9 _-]+\.app$/.test([...apps][0]))
    throw Error("The release ZIP must contain exactly one application.");

  for (const name of names) {
    let parent = path.posix.dirname(name.replace(/^__macosx\//, ""));
    while (parent !== ".") {
      if (links.has(parent))
        throw Error("A release ZIP entry traverses a symbolic link.");

      parent = path.posix.dirname(parent);
    }
  }
  return [...apps][0];
}

function sameApp(expected, actual) {
  const expectedFiles = tree(expected, fs.readdirSync(expected).sort());
  const actualFiles = tree(actual, fs.readdirSync(actual).sort());
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles))
    throw Error(
      "The staged or installed app differs from the final release ZIP.",
    );
}

function tree(folder, payloads, io = fs) {
  const result = {};
  function visit(file) {
    const stat = io.lstatSync(file);
    const name = path.relative(folder, file);
    if (stat.isSymbolicLink()) result[name] = { link: io.readlinkSync(file) };
    else if (stat.isDirectory()) {
      result[name] = { directory: true };
      for (const child of io.readdirSync(file).sort())
        visit(path.join(file, child));
    } else if (stat.isFile()) result[name] = { sha256: hashFile(file, io) };
    else throw Error("Unexpected release payload file type.");
  }
  for (const name of payloads) {
    const file = path.join(folder, name);
    if (io.lstatSync(file, { throwIfNoEntry: false })) visit(file);
  }
  return result;
}

function hashApp(app, io = fs) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(tree(app, io.readdirSync(app).sort(), io)))
    .digest("hex");
}
module.exports = {
  guiEnvironment,
  BUNDLE_ID,
  failure,
  within,
  defaultRun,
  plistJSON,
  inspectBundleLayout,
  verifySigned,
  hashFile,
  directory,
  regular,
  validateApp,
  inspectMacArchive,
  sameApp,
  tree,
  hashApp,
  loadZip,
};
