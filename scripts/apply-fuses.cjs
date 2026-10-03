// Flip Electron fuses on the packaged app so the shipped binary cannot be
// steered by NODE_OPTIONS and loads only its integrity-checked asar. RunAsNode stays on: the connections launcher runs the CLI through it.
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
const app =
  process.argv[2] ||
  path.resolve(__dirname, "../release/Recall-darwin-arm64/Recall.app");
flipFuses(app, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: true,
  [FuseV1Options.RunAsNode]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // Kept on: Playwright attaches to the packaged app through --inspect, and
  // the packaged security/connection smoke tests depend on that.
  [FuseV1Options.EnableNodeCliInspectArguments]: true,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
})
  .then(() => console.log("Fuses applied to " + app))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
