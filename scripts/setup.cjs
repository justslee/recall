#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function requirements({
  version = process.versions.node,
  platform = process.platform,
  arch = process.arch,
  release = os.release(),
} = {}) {
  const [major, minor] = version.split(".").map(Number);
  const issues = [];
  if (!Number.isFinite(major) || major < 22 || (major === 22 && minor < 18))
    issues.push(
      `Node ${version} is too old. Install Node 22.18 or later from https://nodejs.org/en/download and reopen your terminal.`,
    );
  if (platform !== "darwin" || arch !== "arm64")
    issues.push(
      `This beta is verified for Apple Silicon macOS. Detected ${platform}/${arch}. Other platforms do not yet have a supported setup path.`,
    );
  if (platform === "darwin" && Number(release.split(".")[0]) < 22)
    issues.push(
      "Recall requires macOS 13 Ventura or later. Update macOS before running setup.",
    );
  return issues;
}
function plan({ launch = true } = {}) {
  return [
    { label: "Install the locked dependencies", args: ["ci"] },
    {
      label: "Download the locked desktop runtime",
      script: "node_modules/electron/install.js",
    },
    { label: "Build Recall", args: ["run", "build"] },
    ...(launch ? [{ label: "Open Recall", args: ["start"] }] : []),
  ];
}
function main(
  args = process.argv.slice(2),
  { run = spawnSync, log = console.log, environment = process.env } = {},
) {
  if (args.includes("--help")) {
    log(
      "Usage: npm run setup [-- --no-launch | --check]\nChecks this Mac, installs locked dependencies and the desktop runtime, builds Recall and opens it.\n--no-launch prepares the app without opening a profile.\n--check only checks prerequisites; it does not install anything.",
    );
    return 0;
  }
  const unknown = args.filter((a) => !["--no-launch", "--check"].includes(a));
  if (unknown.length)
    throw Error("Unknown option: " + unknown.join(" ") + ". Use --help.");
  const issues = requirements();
  if (issues.length) throw Error(issues.join("\n"));
  if (!fs.existsSync(path.join(root, "package-lock.json")))
    throw Error(
      "package-lock.json is missing. Download or clone the complete Recall repository.",
    );
  log(`Recall setup · Node ${process.versions.node} · Apple Silicon macOS`);
  if (args.includes("--check")) {
    log("Ready. Python, C++ and AI connections are optional.");
    return 0;
  }
  const npmCli = environment.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli))
    throw Error("Run this through npm: npm run setup");
  const steps = plan({ launch: !args.includes("--no-launch") });
  for (const [i, step] of steps.entries()) {
    log(`\n${i + 1}/${steps.length} · ${step.label}`);
    const invocationArgs = step.script
      ? [path.join(root, step.script)]
      : [npmCli, ...step.args];
    const result = run(process.execPath, invocationArgs, {
      cwd: root,
      env: environment,
      stdio: "inherit",
    });
    if (result.error) throw Error(`${step.label}: ${result.error.message}`);
    if (result.status !== 0)
      throw Error(
        `${step.label} did not finish${result.signal ? " (" + result.signal + ")" : ""}. Resolve the error above, then rerun npm run setup. Your study data is stored separately from this checkout.`,
      );
  }
  if (args.includes("--no-launch"))
    log("\nReady. Run npm start, then choose Try the demo.");
  return 0;
}
if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error("\n" + e.message);
    process.exitCode = 1;
  }
}
module.exports = { requirements, plan, main };
