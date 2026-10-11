const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");

function build({
  root = path.resolve(__dirname, ".."),
  run = execFileSync,
} = {}) {
  if (process.platform !== "darwin")
    throw Error(
      "The Recall Pad handoff helper requires macOS and Apple Command Line Tools.",
    );

  const source = path.join(root, "native/mac-handoff/Sources/RecallPadHandoff"),
    infoPlist = path.join(root, "native/mac-handoff/Info.plist"),
    output = path.join(root, "dist-native"),
    binary = path.join(output, "RecallPadHandoff");
  fs.mkdirSync(output, { recursive: true });
  const swiftc = run("/usr/bin/xcrun", ["--find", "swiftc"], {
    encoding: "utf8",
  }).trim();
  const sdk = run("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
    encoding: "utf8",
  }).trim();
  if (!path.isAbsolute(swiftc) || !path.isAbsolute(sdk))
    throw Error("Apple Swift compiler is unavailable.");

  run(
    swiftc,
    [
      "-O",
      "-swift-version",
      "5",
      "-target",
      `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx13.0`,
      "-sdk",
      sdk,
      "-module-cache-path",
      path.join(output, ".swift-module-cache"),
      path.join(source, "Policy.swift"),
      path.join(source, "main.swift"),
      "-Xlinker",
      "-sectcreate",
      "-Xlinker",
      "__TEXT",
      "-Xlinker",
      "__info_plist",
      "-Xlinker",
      infoPlist,
      "-o",
      binary,
    ],
    { stdio: "inherit", timeout: 120000 },
  );
  fs.chmodSync(binary, 0o755);
  run(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      "-",
      "--identifier",
      "com.recall.pad-handoff",
      binary,
    ],
    { stdio: "inherit", timeout: 10000 },
  );
  return binary;
}

if (require.main === module) {
  try {
    console.log(build());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { build };
