const path = require("node:path");
// Fail before launching an older installed app that would ignore RECALL_VERIFY
// and display a window. Source runs use the checkout's verified entrypoint.
module.exports = async function requireInvisibleRuntime(executable) {
  if (!executable) return;
  const archive = path.resolve(
    path.dirname(executable),
    "../Resources/app.asar",
  );
  try {
    const asar = require("@electron/asar");
    const main = asar.extractFile(archive, "electron/main.cjs").toString();
    const policy = asar
      .extractFile(archive, "electron/verification-mode.cjs")
      .toString();
    if (
      !main.includes('require("./verification-mode.cjs").enabled()') ||
      !main.includes("show: !invisibleVerification") ||
      !policy.includes("recall-invisible-verification-v1")
    )
      throw Error();
  } catch {
    throw Error(
      "This executable has not been verified for invisible QA. Use the current source runtime; do not launch the reader’s app for card checks.",
    );
  }
  const { getCurrentFuseWire, FuseV1Options, FuseState } =
    await import("@electron/fuses");
  const wire = await getCurrentFuseWire(
    path.resolve(path.dirname(executable), "../.."),
  );
  if (wire[FuseV1Options.EnableNodeCliInspectArguments] !== FuseState.ENABLE)
    throw Error(
      "This distribution build disables the Node inspector. Use the current source runtime or the development package for invisible Playwright QA; do not weaken its signing or fuses.",
    );
};
