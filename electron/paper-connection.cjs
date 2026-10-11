// A local assistant channel, separate from the paired iPad's LAN transport.
// Recall's main process owns all operations and remains the database writer.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  net = require("node:net"),
  crypto = require("node:crypto");
const privateFiles = require("./private-files.cjs");
const operations = new Set([
  "start",
  "publish",
  "status",
  "wait",
  "read",
  "end",
]);
const REQUEST_LIMIT = 192 * 1024;
const RESPONSE_LIMIT = 96 * 1024 * 1024;
const endpointFile = (folder) =>
  path.join(folder, "paper-runtime", "endpoint.json");
function socketPath(folder) {
  const hash = crypto
    .createHash("sha256")
    .update(path.resolve(folder))
    .digest("hex")
    .slice(0, 20);
  // Unix socket paths have a small platform limit, even for a long profile path.
  return path.join(
    os.tmpdir(),
    `recall-paper-${process.getuid?.() ?? "user"}-${hash}`,
    "main.sock",
  );
}
function ownerFile(file, { socket = false } = {}) {
  const stat = fs.lstatSync(file);
  if (
    stat.isSymbolicLink() ||
    (socket ? !stat.isSocket() : !stat.isFile()) ||
    (process.getuid && stat.uid !== process.getuid()) ||
    stat.mode & 0o077
  )
    throw Error("The paper connection has unsafe permissions. Reopen Recall.");
  return stat;
}
function readEndpoint(folder) {
  const file = endpointFile(folder);
  ownerFile(file);
  const value = JSON.parse(privateFiles.read(file, 4096));
  if (
    value.version !== 1 ||
    value.socket !== socketPath(folder) ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid < 1
  )
    throw Error("The paper connection is invalid. Reopen Recall.");
  ownerFile(value.socket, { socket: true });
  return value;
}
async function startPaperConnection(folder, call) {
  const socket = socketPath(folder),
    file = endpointFile(folder);
  privateFiles.directory(path.dirname(socket));
  privateFiles.directory(path.dirname(file));
  if (fs.existsSync(socket)) {
    const previous = ownerFile(socket, { socket: true });
    // A crash can leave a socket before endpoint.json exists, or its PID can
    // later be reused. Probe the owner-only socket instead of trusting a PID.
    await new Promise((resolve, reject) => {
      const probe = net.createConnection(socket);
      probe.once("connect", () => {
        probe.destroy();
        reject(
          Error("Another Recall paper receiver is running for this profile."),
        );
      });
      probe.once("error", (error) => {
        probe.destroy();
        if (error.code === "ECONNREFUSED") resolve();
        else reject(error);
      });
      probe.setTimeout(1000, () => {
        probe.destroy();
        reject(
          Error(
            "The existing paper receiver could not be checked. Reopen Recall.",
          ),
        );
      });
    });
    const current = ownerFile(socket, { socket: true });
    if (current.ino !== previous.ino || current.dev !== previous.dev)
      throw Error(
        "The paper receiver changed while reconnecting. Reopen Recall.",
      );
    fs.unlinkSync(socket);
  }
  const token = crypto.randomBytes(32).toString("hex"),
    sockets = new Set();
  let closing = false;
  const send = (response, code, value) => {
    if (response.destroyed) return;
    response.writeHead(code, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    if (closing)
      return send(response, 503, {
        error: "Recall is closing. Your work is saved.",
      });
    if (request.method !== "POST" || request.url !== "/paper")
      return send(response, 404, { error: "Unknown paper operation." });
    const auth = request.headers.authorization;
    if (
      typeof auth !== "string" ||
      Buffer.byteLength(auth) !== token.length + 7 ||
      !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from("Bearer " + token))
    )
      return send(response, 401, {
        error: "The local paper connection is not authorized.",
      });
    let length = 0;
    const chunks = [];
    try {
      for await (const chunk of request) {
        length += chunk.length;
        if (length > REQUEST_LIMIT)
          throw Error("The paper request is too large.");
        chunks.push(chunk);
      }
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !message ||
        !operations.has(message.operation) ||
        !message.input ||
        typeof message.input !== "object" ||
        Array.isArray(message.input)
      )
        throw Error("Invalid paper operation.");
      const result = await call(message.operation, message.input);
      send(response, 200, { result });
    } catch (error) {
      send(response, 400, {
        error: String(error.message || "Paper operation failed.").slice(0, 512),
      });
    }
  });
  server.requestTimeout = 40000;
  server.headersTimeout = 5000;
  server.on("connection", (connection) => {
    sockets.add(connection);
    connection.on("close", () => sockets.delete(connection));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  try {
    fs.chmodSync(socket, 0o600);
    privateFiles.atomicText(
      file,
      JSON.stringify({ version: 1, pid: process.pid, socket, token }),
    );
  } catch (error) {
    server.close();
    fs.rmSync(socket, { force: true });
    throw error;
  }
  return {
    async close() {
      closing = true;
      for (const connection of sockets) connection.destroy();
      await new Promise((resolve) => server.close(resolve));
      try {
        if (JSON.parse(privateFiles.read(file, 4096)).token === token)
          fs.unlinkSync(file);
      } catch {}
      fs.rmSync(socket, { force: true });
    },
  };
}
function paperRequest(folder, operation, input = {}, { signal } = {}) {
  if (!operations.has(operation))
    return Promise.reject(Error("Unknown paper operation."));
  let endpoint;
  try {
    endpoint = readEndpoint(folder);
  } catch {
    return Promise.reject(
      Error(
        "Open Recall on this Mac to use your paper session. Your iPad work remains saved.",
      ),
    );
  }
  const body = JSON.stringify({ operation, input });
  if (Buffer.byteLength(body) > REQUEST_LIMIT)
    return Promise.reject(Error("The paper request is too large."));
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: endpoint.socket,
        path: "/paper",
        method: "POST",
        signal,
        headers: {
          Authorization: "Bearer " + endpoint.token,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];
        let length = 0;
        response.on("data", (chunk) => {
          length += chunk.length;
          if (length > RESPONSE_LIMIT)
            return request.destroy(Error("Read fewer paper pages at once."));
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (response.statusCode !== 200 || value.error)
              throw Error(value.error || "Paper operation failed.");
            resolve(value.result);
          } catch (error) {
            reject(error);
          }
        });
        response.on("error", reject);
      },
    );
    request.setTimeout(40000, () =>
      request.destroy(
        Error(
          "Recall did not respond. Your work remains saved; check the session again.",
        ),
      ),
    );
    request.on("error", (error) =>
      reject(
        error.code === "ECONNREFUSED"
          ? Error("Open Recall on this Mac to resume your paper session.")
          : error,
      ),
    );
    request.end(body);
  });
}
function runtimeStatus(folder) {
  try {
    const endpoint = readEndpoint(folder);
    process.kill(endpoint.pid, 0);
    return {
      available: true,
      verification: "endpoint_metadata",
      message:
        "Local endpoint found. Starting a paper session verifies that the receiver responds.",
    };
  } catch {
    return {
      available: false,
      message: "Open Recall on this Mac to receive paper work.",
    };
  }
}
module.exports = {
  startPaperConnection,
  paperRequest,
  runtimeStatus,
  socketPath,
  endpointFile,
};
