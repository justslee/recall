// Explicit local bundle imports share the app's writer; they are not learning
// captures. Requests never contain native-code execution approvals.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const bundles = require("./bundles.cjs"),
  files = require("./private-files.cjs"),
  { atomic } = require("./config.cjs"),
  { stable } = require("./catalog.cjs");
const root = (folder) => path.join(folder, "card-imports");
const digest = (value) =>
  crypto.createHash("sha256").update(stable(value)).digest("hex");
function payload(raw, widgets) {
  const pack = bundles.normalizePack(raw);
  return {
    pack: {
      schemaVersion: 1,
      id: pack.id,
      title: pack.title,
      cards: pack.cards,
    },
    widgets: widgets === true,
  };
}
function status(folder, id) {
  if (!/^[a-f0-9]{64}$/.test(id || ""))
    throw Error("Invalid import request ID");
  const directory = root(folder),
    stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Unsafe private directory");
  const item = JSON.parse(
    files.read(path.join(directory, id + ".json"), 20_000_000),
  );
  return {
    requestId: id,
    mode: item.status,
    receipt: item.receipt || null,
    error: item.error || null,
  };
}
function enqueue(folder, raw, { widgets = false } = {}) {
  const value = payload(raw, widgets),
    id = digest(value);
  const directory = files.directory(root(folder));
  const file = path.join(directory, id + ".json");
  const temp = path.join(directory, crypto.randomUUID() + ".tmp");
  const text = JSON.stringify({
    version: 1,
    id,
    status: "queued",
    createdAt: new Date().toISOString(),
    ...value,
  });
  if (Buffer.byteLength(text) > 20_000_000)
    throw Error("Import request exceeds the 20 MB limit; split the bundle");
  files.write(temp, text);
  try {
    try {
      fs.linkSync(temp, file);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return status(folder, id);
}
function applyPending(store) {
  const directory = root(store.folder);
  let applied = 0,
    inserted = 0;
  if (!fs.existsSync(directory)) return { applied, inserted };
  files.directory(directory);

  for (const name of fs
    .readdirSync(directory)
    .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
    const file = path.join(directory, name);
    let item;
    try {
      item = JSON.parse(files.read(file, 20_000_000));
      if (item.status !== "queued") continue;

      if (
        item.version !== 1 ||
        item.id !== name.slice(0, -5) ||
        digest(payload(item.pack, item.widgets)) !== item.id
      )
        throw Error("Import request content does not match its identity");

      const receipt = bundles.importPack(store, item.pack, {
        apply: true,
        widgets: item.widgets === true,
      });
      atomic(file, {
        version: 1,
        id: item.id,
        status: "imported",
        createdAt: item.createdAt,
        appliedAt: new Date().toISOString(),
        receipt,
      });
      applied++;
      inserted += receipt.inserted;
    } catch (error) {
      // Keep malformed files for inspection. Do not overwrite a symlink or
      // trust a request-provided status/receipt as an execution approval.
      if (
        item?.status === "queued" &&
        fs.existsSync(file) &&
        !fs.lstatSync(file).isSymbolicLink()
      )
        atomic(file, { ...item, status: "blocked", error: error.message });
    }
  }
  return { applied, inserted };
}
module.exports = { enqueue, applyPending, status };
