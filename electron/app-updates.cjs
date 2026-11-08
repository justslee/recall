const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { inspectSource } = require("./update-source.cjs");
const { atomic } = require("./config.cjs");
const terminal = new Set(["complete", "error", "interrupted", "cancelled"]);
function read(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw Error("The local update record needs attention.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function live(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
function refreshConnections(
  profile,
  expected,
  api = require("./connections.cjs"),
  options = {},
) {
  const outcomes = [];
  for (const host of ["codex", "claude"]) {
    const saved = expected?.[host];
    if (!saved?.connected) continue;
    try {
      const current = api.settings(profile).hosts[host];
      if (
        !current?.connected ||
        current.instructions !== saved.instructions ||
        current.skill !== saved.skill
      )
        throw Error(
          "The connection changed during the update; refresh it in Connections.",
        );
      const root = path.dirname(saved.instructions);
      const hostOptions =
        host === "codex"
          ? { home: path.dirname(root), environment: { CODEX_HOME: root } }
          : { home: path.dirname(root), environment: {} };
      const preview = api.connect(profile, host, {
        ...hostOptions,
        ...options,
      });
      if (
        preview.instructions !== saved.instructions ||
        preview.skill !== saved.skill
      )
        throw Error(
          "The connection paths changed; review them in Connections.",
        );
      if (!api.ownsConnection(profile, saved))
        throw Error(
          "The connection belongs to another library or was edited; review it in Connections.",
        );
      api.connect(profile, host, { ...hostOptions, ...options, apply: true });
      outcomes.push({ host, status: "refreshed" });
    } catch (error) {
      outcomes.push({ host, status: "attention", message: error.message });
    }
  }
  return outcomes;
}
class AppUpdates {
  constructor({
    profile,
    appPath,
    executable = process.execPath,
    packaged,
    emit = () => {},
    busy = () => false,
    quit = () => {},
    spawnWorker = spawn,
    platform = process.platform,
    arch = process.arch,
    version,
  }) {
    Object.assign(this, {
      profile,
      appPath,
      executable,
      emit,
      busy,
      quit,
      spawnWorker,
      version,
    });
    this.supported = packaged && platform === "darwin" && arch === "arm64";
    this.folder = path.join(profile, "updates");
    this.stateFile = path.join(this.folder, "state.json");
    this.configFile = path.join(this.folder, "preferences.json");
    this.child = null;
  }
  prepareFolder() {
    fs.mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(this.folder).isSymbolicLink())
      throw Error("The update folder must be local to this profile.");
  }
  status() {
    let state = read(this.stateFile);
    if (state && !terminal.has(state.phase) && !live(state.pid)) {
      state = {
        ...state,
        phase: "interrupted",
        error:
          "The update was interrupted. Check again to safely resume; your learning library is unchanged.",
      };
    }
    // Refresh only after the replacement has opened the profile and the worker
    // committed it. A failed launch must leave the prior assistant kit intact.
    let refreshError = null;
    try {
      this.refreshAfterRestart();
    } catch {
      refreshError =
        "The app update finished, but assistant instructions could not refresh. Review Connections.";
    }
    return {
      supported: this.supported,
      appPath: this.appPath,
      sourceFolder: read(this.configFile)?.sourceFolder || null,
      busy: !!state && !terminal.has(state.phase),
      state,
      connections: read(path.join(this.folder, "connections-result.json")),
      refreshError,
    };
  }
  async chooseSource(folder) {
    if (this.status().busy)
      throw Error("Wait for the current update to finish.");
    const source = folder ? await inspectSource(folder) : null;
    this.prepareFolder();
    atomic(this.configFile, { sourceFolder: source?.folder || null });
    return this.status();
  }
  refreshAfterRestart() {
    const pending = read(path.join(this.folder, "refresh.json"));
    const state = read(this.stateFile);
    if (
      !pending ||
      pending.app !== this.appPath ||
      pending.version !== this.version ||
      state?.id !== pending.id ||
      state.phase !== "complete" ||
      state.result?.status !== "upgraded"
    )
      return;
    if (
      read(path.join(this.folder, "connections-result.json"))?.id === pending.id
    )
      return;
    const outcomes = refreshConnections(this.profile, pending.hosts);
    atomic(path.join(this.folder, "connections-result.json"), {
      id: pending.id,
      outcomes,
    });
  }
  confirmReady(version) {
    const pending = read(path.join(this.folder, "refresh.json"));
    if (!pending || pending.app !== this.appPath || pending.version !== version)
      return;
    if (read(path.join(this.folder, "ready.json"))?.id === pending.id) return;
    atomic(path.join(this.folder, "ready.json"), {
      id: pending.id,
      app: this.appPath,
      version,
    });
  }
  cancel() {
    const state = read(this.stateFile);
    if (
      !this.child ||
      this.restartApproved ||
      !["starting", "checking", "downloading", "verifying"].includes(
        state?.phase,
      )
    )
      throw Error("The update is finishing; wait for Recall to reopen.");
    this.cancelled = true;
    this.child.kill("SIGTERM");
    atomic(this.stateFile, {
      ...state,
      phase: "cancelled",
      error:
        "Update cancelled. Your installed app is unchanged. Check again whenever you’re ready.",
    });
    this.emit(this.status());
    return this.status();
  }
  start(apply) {
    if (typeof apply !== "boolean") throw Error("Choose Check or Update.");
    if (!this.supported)
      throw Error(
        "Install the signed Apple Silicon Mac release to use in-app updates. Source checkouts keep their existing build workflow.",
      );
    if (this.status().busy || this.child)
      throw Error("An update is already in progress.");
    if (apply && this.busy())
      throw Error(
        "Finish the active recording, evaluation, coding run or preparation before updating.",
      );
    if (
      this.appPath.includes("/AppTranslocation/") ||
      this.appPath.startsWith("/Volumes/")
    )
      throw Error(
        "Move Recall to Applications and open it there before updating.",
      );
    fs.accessSync(path.dirname(this.appPath), fs.constants.W_OK);
    this.prepareFolder();
    const worker = path.join(this.folder, "worker");
    fs.mkdirSync(worker, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(worker).isSymbolicLink())
      throw Error("The update worker folder needs attention.");
    // Code comes only from this installed app, never from the selected checkout.
    for (const [name, source] of [
      ["update-worker.cjs", path.join(__dirname, "update-worker.cjs")],
      ["update-source.cjs", path.join(__dirname, "update-source.cjs")],
      ...["upgrade.cjs", "mac-release.cjs"].map((name) => [
        name,
        path.join(__dirname, "../skills/recall-upgrade/scripts", name),
      ]),
    ]) {
      const file = path.join(worker, name);
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (stat && (!stat.isFile() || stat.isSymbolicLink()))
        throw Error("The update helper files need attention.");
      fs.writeFileSync(file, fs.readFileSync(source), { mode: 0o600 });
    }
    const id = crypto.randomUUID();
    const input = {
      id,
      app: this.appPath,
      profile: this.profile,
      parentPid: process.pid,
      apply,
      sourceFolder: read(this.configFile)?.sourceFolder,
      hosts: require("./connections.cjs").settings(this.profile).hosts,
    };
    const inputFile = path.join(this.folder, "request.json");
    atomic(inputFile, input);
    const state = {
      id,
      apply,
      phase: "starting",
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    atomic(this.stateFile, state);
    const child = this.spawnWorker(
      this.executable,
      [path.join(worker, "update-worker.cjs"), inputFile],
      {
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    );
    this.child = child;
    this.restartApproved = false;
    this.cancelled = false;
    child.on("message", (message) => {
      if (message?.type === "state" && !this.cancelled)
        this.emit(this.status());
      if (message?.type === "request-restart") {
        if (this.cancelled) return;
        if (this.busy())
          child.send({
            type: "restart-blocked",
            error:
              "Finish the active work before restarting Recall, then retry the update.",
          });
        else {
          this.restartApproved = true;
          child.send({ type: "restart-approved" }, (error) => {
            if (!error) this.quit();
          });
        }
      }
    });
    child.on("error", () => {
      atomic(this.stateFile, {
        ...state,
        phase: "error",
        error:
          "The updater could not start. Your app and learning library were left in place.",
      });
      this.child = null;
      this.emit(this.status());
    });
    child.on("exit", () => {
      this.child = null;
      const result = read(this.stateFile);
      if (result?.id === id && (this.cancelled || !terminal.has(result.phase)))
        atomic(this.stateFile, {
          ...result,
          phase: this.cancelled ? "cancelled" : "interrupted",
          error: this.cancelled
            ? "Update cancelled. Your installed app is unchanged."
            : "The updater stopped before finishing. Check again to resume safely.",
        });
      this.emit(this.status());
    });
    child.unref();
    this.emit(this.status());
    return this.status();
  }
}
module.exports = { AppUpdates, refreshConnections };
