// Invisible QA is permitted only in a marked, disposable OS temporary profile.
// It uses the real renderer and widget sandbox, never the reader's profile.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const marker = ".recall-verification-profile";
function createProfile() {
  const folder = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "recall-verify-"),
  );
  fs.writeFileSync(
    path.join(folder, marker),
    "recall-invisible-verification-v1\n",
    { mode: 0o600 },
  );
  return folder;
}
function enabled(env = process.env) {
  if (env.RECALL_VERIFY !== "1") return false;

  const folder = env.RECALL_DATA_DIR;
  if (!folder || !path.isAbsolute(folder) || !fs.existsSync(folder))
    throw Error(
      "Invisible verification requires a disposable verification profile.",
    );

  const real = fs.realpathSync(folder),
    temp = fs.realpathSync(os.tmpdir());
  if (
    fs.lstatSync(folder).isSymbolicLink() ||
    path.dirname(real) !== temp ||
    !path.basename(real).startsWith("recall-verify-") ||
    fs.lstatSync(path.join(real, marker)).isSymbolicLink() ||
    fs.readFileSync(path.join(real, marker), "utf8") !==
      "recall-invisible-verification-v1\n"
  )
    throw Error(
      "Refusing verification outside a disposable verification profile.",
    );

  return true;
}
module.exports = { createProfile, enabled };
