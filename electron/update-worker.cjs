// Detached from the UI so verification and replacement survive a normal quit.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { upgrade, quit } = require("./upgrade.cjs");
const mac = require("./mac-release.cjs");
const { updateSource } = require("./update-source.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function atomic(file, value) {
  const temp = file + "." + crypto.randomUUID();
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function main() {
  const inputFile = process.argv[2];
  const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const folder = path.dirname(inputFile),
    stateFile = path.join(folder, "state.json");
  let state = {
    id: input.id,
    apply: input.apply,
    pid: process.pid,
    phase: "checking",
    startedAt: new Date().toISOString(),
  };
  const publish = (patch) => {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() };
    atomic(stateFile, state);
    if (process.connected) process.send({ type: "state", state });
  };
  const notifyQuit = async () => {
    if (!process.connected)
      throw Error(
        "Recall closed before the update was ready. Reopen it and retry the update.",
      );
    publish({ phase: "ready_to_restart" });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          finish(
            Error("Recall did not approve the restart. Reopen it and retry."),
          ),
        30000,
      );
      const receive = (message) => {
        if (message?.type === "restart-approved") finish();
        if (message?.type === "restart-blocked")
          finish(Error(message.error || "Finish your active work and retry."));
      };
      const disconnected = () =>
        finish(Error("Recall closed before approving the restart."));
      const finish = (error) => {
        clearTimeout(timer);
        process.off("message", receive);
        process.off("disconnect", disconnected);
        error ? reject(error) : resolve();
      };
      process.on("message", receive);
      process.once("disconnect", disconnected);
      process.send({ type: "request-restart" });
    });
    for (let i = 0; i < 180; i++) {
      if (!alive(input.parentPid)) return;
      await pause(250);
    }
    throw Error(
      "Recall is still saving or could not quit. Your installed app was left in place; quit and retry.",
    );
  };
  try {
    publish({});
    if (input.apply && input.sourceFolder) {
      publish({ phase: "updating_source" });
      try {
        publish({ source: await updateSource(input.sourceFolder) });
      } catch (error) {
        publish({ source: { status: "attention", message: error.message } });
      }
    }
    const result = await upgrade({
      app: input.app,
      apply: input.apply,
      progress: publish,
      quitApp: (target, run) =>
        alive(input.parentPid) ? notifyQuit() : quit(target, run),
      beforeLaunch: async (result) => {
        // The new main process refreshes only these already owned connections.
        atomic(path.join(folder, "refresh.json"), {
          id: input.id,
          app: input.app,
          hosts: input.hosts,
          version: result.installedVersion,
        });
        publish({ phase: "restarting", result });
      },
      launch: async (target) => {
        mac.defaultRun(
          "/usr/bin/open",
          ["-n", target, "--env", `RECALL_DATA_DIR=${input.profile}`],
          {
            env: mac.guiEnvironment(),
            releaseError:
              "The update was installed but Recall could not reopen. Open it from its existing Applications location.",
          },
        );
        // LaunchServices accepting 'open' does not establish that Recall opened
        // the same profile. Wait for its first successful library snapshot.
        for (let i = 0; i < 240; i++) {
          const file = path.join(folder, "ready.json");
          const ready =
            fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8"));
          if (
            ready?.id === input.id &&
            ready.app === input.app &&
            ready.version === state.result.installedVersion
          )
            return;
          await pause(250);
        }
        throw Error(
          "The new app did not finish opening your library. The previous app will be restored; your learning data is kept.",
        );
      },
    });
    publish({ phase: "complete", result });
  } catch (error) {
    publish({
      phase: "error",
      error: String(error.releaseMessage || error.message).slice(0, 700),
    });
    // If replacement failed after an approved quit, the core restores the prior app.
    // Reopen it only if its bundle survived recovery; never restore a learning DB.
    if (input.apply && !alive(input.parentPid) && fs.existsSync(input.app)) {
      try {
        mac.defaultRun(
          "/usr/bin/open",
          ["-n", input.app, "--env", `RECALL_DATA_DIR=${input.profile}`],
          { env: mac.guiEnvironment() },
        );
      } catch {}
    }
  } finally {
    if (process.connected) process.disconnect();
  }
}
if (require.main === module)
  main().catch(() => {
    process.exitCode = 1;
  });
module.exports = { atomic, alive };
