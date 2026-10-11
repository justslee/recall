const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { spawn } = require("node:child_process");

const MAX_PROTOCOL_BYTES = 100000,
  RESULT_STATES = new Set(["starting", "stopped"]),
  unavailable = () => ({ available: false, advertising: false });

function resolveHelper({
  helperPath,
  resourcesPath = process.resourcesPath,
} = {}) {
  const candidates = helperPath
    ? [helperPath]
    : [
        resourcesPath &&
          path.join(
            resourcesPath,
            "app.asar.unpacked/dist-native/RecallPadHandoff",
          ),
        resourcesPath &&
          path.join(resourcesPath, "dist-native/RecallPadHandoff"),
        path.resolve(__dirname, "../dist-native/RecallPadHandoff"),
      ].filter(Boolean);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;

    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;

      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {}
  }
  return null;
}

function safeEnvironment(environment = process.env) {
  const result = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" };
  for (const key of [
    "HOME",
    "TMPDIR",
    "USER",
    "LOGNAME",
    "__CF_USER_TEXT_ENCODING",
  ])
    if (typeof environment[key] === "string") result[key] = environment[key];
  return result;
}

function cleanResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid handoff response.");

  const result = {};
  if (Object.hasOwn(value, "available"))
    result.available = value.available === true;
  if (Object.hasOwn(value, "advertising"))
    result.advertising = value.advertising === true;
  if (RESULT_STATES.has(value.state)) result.state = value.state;
  return result;
}

function cleanEvent(value) {
  if (
    value.event === "bonjour" &&
    ["advertising", "unavailable"].includes(value.state)
  )
    return { event: "bonjour", state: value.state };

  return null;
}

function createPadHandoff({
  helperPath,
  resourcesPath,
  onEvent = () => {},
  spawnImpl = spawn,
  environment,
  platform = process.platform,
  timeoutMs = 6000,
} = {}) {
  let child = null,
    buffer = "",
    closed = false;
  const pending = new Map();
  const notify = (value) => {
    try {
      onEvent(value);
    } catch {}
  };
  const stop = (reason = "helper-stopped") => {
    const current = child;
    child = null;
    buffer = "";
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(
        Error("Recall's handwriting helper stopped. Your work is saved."),
      );
    }
    pending.clear();
    current?.kill();
    if (current) notify({ event: "helper", state: reason });
  };

  function start() {
    if (closed || platform !== "darwin") return false;
    if (child) return true;

    const binary = resolveHelper({ helperPath, resourcesPath });
    if (!binary) return false;

    try {
      const current = spawnImpl(binary, [], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        env: safeEnvironment(environment),
        windowsHide: true,
      });
      child = current;
      current.stdout.setEncoding("utf8");
      current.stdout.on("data", (chunk) => {
        if (current !== child) return;

        buffer += chunk;
        if (Buffer.byteLength(buffer) > MAX_PROTOCOL_BYTES) {
          stop("protocol-error");
          return;
        }

        let index;
        while ((index = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          let result;
          try {
            result = JSON.parse(line);
          } catch {
            stop("protocol-error");
            return;
          }

          if (typeof result.id !== "string") {
            const event = cleanEvent(result);
            if (event) notify(event);
            continue;
          }
          const item = pending.get(result.id);
          if (!item) continue;

          pending.delete(result.id);
          clearTimeout(item.timer);
          if (result.ok !== true) {
            item.reject(
              Error(
                "The handwriting handoff could not complete. Your work is saved.",
              ),
            );
            continue;
          }
          try {
            item.resolve(cleanResult(result.result));
          } catch {
            item.reject(
              Error("The handwriting helper returned an invalid response."),
            );
          }
        }
      });
      // Deliberately discard native diagnostics: stdout is the bounded protocol,
      // and no raw stderr text crosses into logs or the renderer.
      current.stderr.resume();
      current.once("error", () => {
        if (child === current) stop();
      });
      current.once("exit", () => {
        if (child === current) stop();
      });
      return true;
    } catch {
      stop();
      return false;
    }
  }

  function request(command, args = {}) {
    if (!start())
      return Promise.reject(
        Error(
          "Local discovery is unavailable. Pair using the Mac QR code instead.",
        ),
      );
    if (pending.size >= 30)
      return Promise.reject(Error("The handwriting helper is busy."));

    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(),
        timer = setTimeout(
          () => stop("helper-timeout"),
          Math.max(50, Math.min(timeoutMs, 10000)),
        );
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ version: 1, id, command, args }) + "\n",
        (error) => {
          if (error) stop();
        },
      );
    });
  }

  return {
    async status() {
      if (!start()) return unavailable();

      try {
        return await request("status");
      } catch {
        return unavailable();
      }
    },
    advertise({ port, installationId } = {}) {
      if (
        !Number.isSafeInteger(port) ||
        port < 1024 ||
        port > 65535 ||
        typeof installationId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(installationId)
      )
        return Promise.reject(Error("Invalid Recall Pad advertisement."));

      return request("advertise", { port, installationId });
    },
    stopAdvertising: () =>
      child
        ? request("stopAdvertising")
        : Promise.resolve({ state: "stopped" }),
    dispose() {
      closed = true;
      stop("disposed");
    },
  };
}

module.exports = {
  createPadHandoff,
  resolveHelper,
  safeEnvironment,
};
