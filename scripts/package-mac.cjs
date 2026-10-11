"use strict";

// Packaging is a local build. Signing, notarization and publication stay in
// separate, explicitly selected operations.
const path = require("node:path");

const runtimeDirectories = new Set([
  "adapters",
  "cli",
  "dist",
  "electron",
  "node_modules",
  "schemas",
  "shared",
  "skills",
]);
const runtimeFiles = new Set([
  "package.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "dist-native/RecallPadHandoff",
  "examples/cards.json",
  "examples/demo.json",
  "examples/knowledge.json",
  "examples/mutants.json",
  "examples/validation.json",
  "examples/LICENSE.md",
]);
const privateName =
  /(?:^|\/)(?:\.git|\.env[^/]*|auth\.json|\.credentials\.json|config\.local\.json|openai\.key|Local\.xcconfig|credentials|private|pad-identity|paper-authority|learning-inbox|card-imports|self-tests|backups|xcuserdata)(?:\/|$)|(?:^|\/)node_modules\/\.bin(?:\/|$)|\.(?:p12|p8|pem|key|cer|mobileprovision|provisionprofile|sqlite\d*|db|db-wal|db-shm|enc|log|ipa|bcsymbolmap|symbols|xcuserstate|xcactivitylog|o|obj)(?:$|\/)|(?:\.app|\.xcarchive|\.dSYM|\.xcresult)(?:$|\/)/i;

function ignore(file) {
  if (file === "" || file === "/") return false;
  if (typeof file !== "string" || !file.startsWith("/")) return true;

  const name = file.slice(1);
  if (
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((part) => !part || part === "." || part === "..") ||
    privateName.test(name)
  )
    return true;

  if (runtimeFiles.has(name)) return false;
  if (name === "dist-native" || name === "examples") return false;

  return !runtimeDirectories.has(name.split("/")[0]);
}

function packageOptions(root = path.resolve(__dirname, "..")) {
  return {
    dir: root,
    name: "Recall",
    platform: "darwin",
    arch: "arm64",
    asar: { unpackDir: "dist-native" },
    icon: path.join(root, "packaging/icon.icns"),
    extendInfo: path.join(root, "packaging/mac-info.plist"),
    protocols: [{ schemes: ["recall"], name: "Recall" }],
    out: path.join(root, "release"),
    overwrite: true,
    ignore,
  };
}

async function main() {
  const { packager } = await import("@electron/packager");
  await packager(packageOptions());
}

if (require.main === module) {
  main().catch(() => {
    // Tool errors can contain paths and environment values. Keep user-facing
    // failures fixed; the packaged archive is audited by npm's postpackage.
    console.error("Mac packaging failed. No app was signed or published.");
    process.exitCode = 1;
  });
}

module.exports = { ignore, packageOptions };
