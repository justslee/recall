const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
function dataDir(override) {
  return path.resolve(
    override ||
      process.env.RECALL_DATA_DIR ||
      (process.platform === "darwin"
        ? path.join(os.homedir(), "Library/Application Support/Recall")
        : path.join(os.homedir(), ".local/share/Recall")),
  );
}
function atomic(file, value) {
  require("./private-files.cjs").atomicText(
    file,
    JSON.stringify(value, null, 2) + "\n",
  );
}
function config(folder = dataDir()) {
  const file = path.join(folder, "config.json");
  const value = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
  if (value.version && value.version !== 1)
    throw Error("Unsupported configuration version");
  const result = {
    version: 1,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    captureEnabled: false,
    sources: [],
    ...value,
  };
  new Intl.DateTimeFormat("en", { timeZone: result.timeZone });
  if (typeof result.captureEnabled !== "boolean")
    throw Error("captureEnabled must be a boolean");
  if (!Array.isArray(result.sources)) throw Error("sources must be an array");
  const ids = new Set();
  for (const source of result.sources) {
    if (
      !source.id ||
      ids.has(source.id) ||
      !["markdown", "obsidian", "notion"].includes(source.type)
    )
      throw Error("Invalid or duplicate source");
    if (source.write !== undefined && typeof source.write !== "boolean")
      throw Error("Source write must be a boolean");
    ids.add(source.id);
  }
  return result;
}
function saveConfig(folder, patch) {
  const next = { ...config(folder), ...patch, version: 1 };
  new Intl.DateTimeFormat("en", { timeZone: next.timeZone });
  if (typeof next.captureEnabled !== "boolean" || !Array.isArray(next.sources))
    throw Error("Invalid capture/source configuration");
  atomic(path.join(folder, "config.json"), next);
  return next;
}
function lock(folder) {
  require("./private-files.cjs").directory(folder);
  const file = path.join(folder, ".writer.lock");
  const owner = JSON.stringify({ pid: process.pid, id: crypto.randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, owner, { flag: "wx", mode: 0o600 });
      return () => {
        if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === owner)
          fs.unlinkSync(file);
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const old = fs.readFileSync(file, "utf8");
      let pid;
      try {
        pid = JSON.parse(old).pid;
      } catch {
        throw Error("Unreadable profile lock; inspect it before recovery.");
      }
      let dead = false;
      try {
        process.kill(pid, 0);
      } catch (e) {
        dead = e.code === "ESRCH";
      }
      if (dead && fs.readFileSync(file, "utf8") === old) {
        fs.unlinkSync(file);
        continue;
      }
      const error = Error(
        "Recall is using this library. Quit the app before a CLI write or restore.",
      );
      error.code = "RECALL_WRITER_BUSY";
      throw error;
    }
  }
  throw Error("Could not acquire library lock");
}
module.exports = { dataDir, config, saveConfig, atomic, lock };
