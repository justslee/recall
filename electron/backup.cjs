const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { atomic, lock } = require("./config.cjs");
const paths = [
  "self-tests",
  "learning-inbox",
  "learning-connections.json",
  "knowledge",
  "packs",
  "config.json",
  "presentations.json",
];
function backup(store, target) {
  const dir = path.resolve(
    target ||
      path.join(
        store.folder,
        "backups",
        "profile-" + Date.now() + "-" + crypto.randomUUID(),
      ),
  );
  if (dir === store.folder) throw Error("Backup must have its own directory");

  if (fs.existsSync(dir)) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Unsafe private directory");

    if (fs.readdirSync(dir).length)
      throw Error("Backup destination must be an empty directory");
  }

  require("./private-files.cjs").directory(dir);
  const dbfile = path.join(dir, "recall.sqlite");
  store.db.exec(`VACUUM INTO '${dbfile.replaceAll("'", "''")}'`);
  for (const name of paths) {
    const file = path.join(store.folder, name);
    if (fs.existsSync(file))
      fs.cpSync(file, path.join(dir, name), {
        recursive: true,
        filter: (f) => {
          // Temporary authoring contexts are not durable learning data.
          if (
            path.relative(store.folder, f) ===
            path.join("learning-inbox", "jobs")
          )
            return false;
          if (fs.lstatSync(f).isSymbolicLink())
            throw Error("Backup contains an unsafe symbolic link");
          return !f.endsWith(".writer.lock") && !f.endsWith(".tmp");
        },
      });
  }
  const checksums = {};
  function walk(base = "") {
    for (const item of fs.readdirSync(path.join(dir, base))) {
      const rel = path.join(base, item),
        file = path.join(dir, rel);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink())
        throw Error("Backup contains an unsafe symbolic link");
      fs.chmodSync(file, stat.isDirectory() ? 0o700 : 0o600);
      if (stat.isDirectory()) walk(rel);
      else
        checksums[rel] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex");
    }
  }
  walk();
  atomic(path.join(dir, "manifest.json"), {
    version: 1,
    at: new Date().toISOString(),
    checksums,
  });
  return { backup: dir };
}
function restore(folder, input) {
  const dir = fs.realpathSync(input),
    manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
  if (manifest.version !== 1 || !manifest.checksums?.["recall.sqlite"])
    throw Error("Invalid backup manifest");
  const release = lock(folder),
    stage = path.join(folder, ".restore-stage-" + crypto.randomUUID());
  fs.mkdirSync(stage, { mode: 0o700 });
  const saved = path.join(
      folder,
      "backups",
      "before-restore-" + Date.now() + "-" + crypto.randomUUID(),
    ),
    moved = [],
    created = [];
  try {
    for (const [rel, hash] of Object.entries(manifest.checksums)) {
      const top = rel.split(path.sep)[0];
      if (top !== "recall.sqlite" && !paths.includes(top))
        throw Error("Unexpected backup member");
      const file = path.resolve(dir, rel),
        target = path.resolve(stage, rel);
      if (
        !file.startsWith(dir + path.sep) ||
        !target.startsWith(stage + path.sep) ||
        !fs.realpathSync(file).startsWith(dir + path.sep) ||
        fs.lstatSync(file).isSymbolicLink()
      )
        throw Error("Unsafe backup path");
      require("./private-files.cjs").directory(path.dirname(target));
      fs.copyFileSync(file, target);
      fs.chmodSync(target, 0o600);
      if (
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(target))
          .digest("hex") !== hash
      )
        throw Error("Backup checksum mismatch: " + rel);
    }
    const check = new DatabaseSync(path.join(stage, "recall.sqlite"), {
      readOnly: true,
    });
    try {
      if (
        check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
      )
        throw Error("Backup is corrupt");
      if (check.prepare("PRAGMA user_version").get().user_version > 2)
        throw Error("Backup needs a newer app");
      if (
        check
          .prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' LIMIT 1")
          .get()
      )
        throw Error("Backup contains unsupported database triggers");
      check.prepare("SELECT id,content,schedule FROM cards LIMIT 1").all();
    } finally {
      check.close();
    }
    // A backup is portable data, not authority to execute its native code.
    // Verify the original archive first, then revoke only execution approvals
    // in the staged copy. The live library and all other restored rows remain
    // unchanged until the normal restore commit below.
    const staged = new DatabaseSync(path.join(stage, "recall.sqlite"));
    let executionApprovalsCleared;
    try {
      // Keep the staged changes in the database copied into place, without a
      // sidecar WAL that could be discarded during the directory swap.
      staged.exec("PRAGMA journal_mode=DELETE");
      executionApprovalsCleared = staged
        .prepare("DELETE FROM settings WHERE key GLOB 'validated-code:*'")
        .run().changes;
    } finally {
      staged.close();
    }
    require("./private-files.cjs").directory(saved);
    for (const name of [
      "recall.sqlite",
      "recall.sqlite-wal",
      "recall.sqlite-shm",
      ...paths,
    ]) {
      const file = path.join(folder, name);
      if (fs.existsSync(file)) {
        fs.renameSync(file, path.join(saved, name));
        moved.push(name);
      }
    }
    for (const name of ["recall.sqlite", ...paths])
      if (fs.existsSync(path.join(stage, name))) {
        fs.renameSync(path.join(stage, name), path.join(folder, name));
        created.push(name);
      }
    return { restored: folder, previous: saved, executionApprovalsCleared };
  } catch (e) {
    for (const name of created)
      fs.rmSync(path.join(folder, name), { recursive: true, force: true });
    for (const name of moved)
      fs.renameSync(path.join(saved, name), path.join(folder, name));
    throw e;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    release();
  }
}
module.exports = { backup, restore };
