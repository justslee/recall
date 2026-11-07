// Durable assistant requests are applied by the profile's existing writer.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const taxonomy = require("./taxonomy.cjs"),
  files = require("./private-files.cjs");
const { atomic } = require("./config.cjs");
const directory = (folder) => path.join(folder, "taxonomy-requests");
function status(folder, id) {
  if (!/^[a-f0-9]{64}$/.test(id || ""))
    throw Error("Invalid taxonomy request ID");
  const dir = directory(folder),
    stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Unsafe taxonomy request directory");
  const item = JSON.parse(
    files.read(path.join(dir, id + ".json"), taxonomy.MAX_BYTES + 10000),
  );
  return {
    requestId: id,
    mode: item.status,
    receipt: item.receipt || null,
    error: item.error || null,
  };
}
function enqueue(folder, raw) {
  const plan = taxonomy.normalizePlan(raw),
    id = taxonomy.digest(plan),
    dir = files.directory(directory(folder));
  const dest = path.join(dir, id + ".json"),
    temp = path.join(dir, crypto.randomUUID() + ".tmp");
  files.write(
    temp,
    JSON.stringify({
      version: 1,
      id,
      plan,
      status: "queued",
      createdAt: new Date().toISOString(),
    }),
  );
  try {
    try {
      fs.linkSync(temp, dest);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const old = JSON.parse(files.read(dest, taxonomy.MAX_BYTES + 10000));
      // An explicit CLI apply after a restore is new authorization. Merely
      // opening the restored profile never resumes a pending taxonomy write.
      if (old.status === "needs_resubmission")
        atomic(dest, {
          version: 1,
          id,
          plan,
          status: "queued",
          createdAt: new Date().toISOString(),
        });
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return status(folder, id);
}
function applyPending(store, { limit = 16 } = {}) {
  const dir = directory(store.folder);
  let applied = 0,
    changed = 0,
    processed = 0;
  if (!fs.existsSync(dir)) return { applied, changed };
  files.directory(dir);
  for (const name of fs
    .readdirSync(dir)
    .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
    .sort()) {
    const file = path.join(dir, name);
    let item;
    try {
      item = JSON.parse(files.read(file, taxonomy.MAX_BYTES + 10000));
      if (item.status !== "queued") continue;
      if (processed++ >= limit) break;
      if (
        item.version !== 1 ||
        item.id !== name.slice(0, -5) ||
        taxonomy.digest(taxonomy.normalizePlan(item.plan)) !== item.id
      )
        throw Error("Taxonomy request content does not match its identity");
      const receipt = taxonomy.apply(store, item.plan);
      atomic(file, {
        version: 1,
        id: item.id,
        status: "applied",
        createdAt: item.createdAt,
        appliedAt: new Date().toISOString(),
        receipt,
      });
      applied++;
      if (receipt.changed && !receipt.alreadyApplied) changed++;
    } catch (error) {
      if (
        item?.status === "queued" &&
        fs.existsSync(file) &&
        !fs.lstatSync(file).isSymbolicLink()
      )
        atomic(file, { ...item, status: "blocked", error: error.message });
    }
  }
  return { applied, changed };
}
module.exports = { enqueue, applyPending, status };
