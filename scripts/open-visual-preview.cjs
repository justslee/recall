// Open the actual app with three synthetic cards in its own private profile.
// This never opens, imports into, or borrows credentials from the live profile.
const fs = require("node:fs"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
const { Store } = require("../electron/store.cjs"),
  { cardLink } = require("../electron/card-links.cjs");
const root = path.resolve(__dirname, ".."),
  pack = require("../examples/visual-benchmarks/preview-pack.json");
fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
const folder = fs.mkdtempSync(
  path.join(root, "evidence/visual-preview-profile-"),
);
fs.chmodSync(folder, 0o700);
const store = new Store(folder);
try {
  store.import(pack.cards);
} finally {
  store.close();
}
const child = spawn(require("electron"), [root, cardLink(pack.cards[0].id)], {
  env: { ...process.env, RECALL_DATA_DIR: folder },
  detached: true,
  stdio: "ignore",
});
child.once("error", (error) => {
  console.error("Preview could not open: " + error.message);
  process.exitCode = 1;
});
child.unref();
console.log(
  "Opened a separate Recall visual preview with three synthetic cards. Reveal the answer, choose Load interactive, then use Next card to explore the others. Your regular library stays separate.\nPreview profile: " +
    folder,
);
