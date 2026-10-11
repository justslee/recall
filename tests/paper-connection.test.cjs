const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http"),
  { spawn } = require("node:child_process"),
  { PassThrough } = require("node:stream");
const {
  startPaperConnection,
  paperRequest,
  runtimeStatus,
  socketPath,
  endpointFile,
} = require("../electron/paper-connection.cjs");
const { servePaperMcp } = require("../cli/paper-mcp.cjs");
const {
  connectPaper,
  paperConnectionStatus,
} = require("../electron/paper-install.cjs");
function fixture(t) {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-paper-connection-test-"),
  );
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}
test("assistant socket is owner-only, authenticated, bounded, and cleans up without opening LAN ports", async (t) => {
  const folder = fixture(t),
    calls = [];
  const receiver = await startPaperConnection(
    folder,
    async (operation, input) => {
      calls.push({ operation, input });
      return { title: input.title };
    },
  );
  t.after(() => receiver.close());
  assert.equal(fs.statSync(endpointFile(folder)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(socketPath(folder)).mode & 0o777, 0o600);
  assert.deepEqual(
    await paperRequest(folder, "start", { title: "Synthetic writing" }),
    { title: "Synthetic writing" },
  );
  assert.equal(calls.length, 1);
  const denied = await new Promise((resolve, reject) => {
    const request = http.request(
      { socketPath: socketPath(folder), path: "/paper", method: "POST" },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify({ operation: "start", input: {} }));
  });
  assert.equal(denied, 401);
  assert.equal(calls.length, 1);
  const malformed = await new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: socketPath(folder),
        path: "/paper",
        method: "POST",
        headers: { Authorization: "Bearer " + "é".repeat(64) },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify({ operation: "start", input: {} }));
  });
  assert.equal(malformed, 401);
  assert.deepEqual(
    await paperRequest(folder, "status", { title: "Still running" }),
    { title: "Still running" },
  );
  await assert.rejects(paperRequest(folder, "shell", {}), /Unknown paper/);
  await assert.rejects(
    paperRequest(folder, "publish", { prompt: "x".repeat(200000) }),
    /too large/,
  );
  fs.chmodSync(endpointFile(folder), 0o644);
  assert.equal(runtimeStatus(folder).available, false);
  await assert.rejects(paperRequest(folder, "start", {}), /Open Recall/);
  fs.chmodSync(endpointFile(folder), 0o600);
  assert.equal(runtimeStatus(folder).available, true);
});
test("a live receiver is preserved even without discovery metadata; an interrupted startup socket recovers", async (t) => {
  const folder = fixture(t),
    socket = socketPath(folder);
  fs.mkdirSync(path.dirname(socket), { recursive: true, mode: 0o700 });
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const fs = require('node:fs'), net = require('node:net');
    net.createServer().listen(process.argv[1], () => {
      fs.chmodSync(process.argv[1], 0o600);
      process.stdout.write('ready');
    });
  `,
      socket,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    child.kill("SIGKILL");
    fs.rmSync(path.dirname(socket), { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(Error(`Fixture exited early: ${code}`)),
    );
  });
  await assert.rejects(
    startPaperConnection(folder, async () => ({})),
    /Another Recall/,
  );
  assert.ok(fs.existsSync(socket));
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGKILL");
  });
  assert.ok(fs.existsSync(socket));
  const receiver = await startPaperConnection(folder, async () => ({
    recovered: true,
  }));
  t.after(() => receiver.close());
  assert.deepEqual(await paperRequest(folder, "status", {}), {
    recovered: true,
  });
});
function mcp(t, request, client = "codex") {
  const input = new PassThrough(),
    output = new PassThrough(),
    results = [],
    waiting = new Map();
  let buffer = "";
  output.on("data", (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const value = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      results.push(value);
      waiting.get(value.id)?.(value);
      waiting.delete(value.id);
    }
  });
  const server = servePaperMcp("synthetic-profile", {
    input,
    output,
    client,
    request,
  });
  t.after(() => {
    server.stop();
    input.destroy();
    output.destroy();
  });
  let id = 0;
  return {
    results,
    async call(method, params = {}) {
      const current = ++id;
      return new Promise((resolve) => {
        waiting.set(current, resolve);
        input.write(
          JSON.stringify({ jsonrpc: "2.0", id: current, method, params }) +
            "\n",
        );
      });
    },
  };
}
test("MCP initializes, validates schemas, binds configured client and returns actual ordered images to the invoking request", async (t) => {
  const calls = [],
    png = Buffer.from("synthetic-image").toString("base64");
  const server = mcp(
    t,
    async (_folder, operation, input) => {
      calls.push({ operation, input });
      if (operation === "start")
        return { sessionId: "s", capability: "private-binding" };
      if (operation === "read")
        return {
          submissionId: input.submissionId,
          pageCount: 2,
          nextPageIndexes: [],
          problem: { title: "Original prompt" },
          pages: [0, 1].map((index) => ({
            index,
            mime: "image/png",
            name: `Page ${index + 1}`,
            data: png,
          })),
        };
      return { status: "active", submissions: [], cursor: 0 };
    },
    "claude",
  );
  assert.equal((await server.call("tools/list")).error.code, -32000);
  assert.equal(
    (await server.call("initialize", { protocolVersion: "2025-06-18" })).result
      .serverInfo.name,
    "recall-paper",
  );
  const tools = (await server.call("tools/list")).result.tools;
  assert.equal(tools.length, 6);
  assert.ok(
    tools.every(
      (tool) => !/paste|send.message|shell|export.library/i.test(tool.name),
    ),
  );
  assert.equal(
    (
      await server.call("tools/call", {
        name: "paper_start_session",
        arguments: { title: "Notes" },
      })
    ).result.isError,
    undefined,
  );
  assert.equal(calls[0].input.client, "claude");
  assert.equal(
    (
      await server.call("tools/call", {
        name: "paper_start_session",
        arguments: { title: "Notes", arbitraryPath: "/etc/passwd" },
      })
    ).error.code,
    -32602,
  );
  const binding = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    capability: "c".repeat(43),
  };
  assert.equal(
    (
      await server.call("tools/call", {
        name: "paper_wait_submission",
        arguments: { ...binding, timeoutMs: 60000 },
      })
    ).error.code,
    -32602,
  );
  const read = await server.call("tools/call", {
    name: "paper_read_submission",
    arguments: {
      ...binding,
      submissionId: "22222222-2222-4222-8222-222222222222",
    },
  });
  assert.equal(
    read.result.content.filter((item) => item.type === "image").length,
    2,
  );
  assert.ok(
    read.result.content
      .filter((item) => item.type === "image")
      .every((item) => item.data === png),
  );
  assert.equal(read.result.structuredContent.pages, undefined);
  assert.equal(read.result.structuredContent.problem.title, "Original prompt");
  assert.equal(calls.length, 2);
});
test("MCP errors preserve a draft and never substitute provider evaluation or a chat action", async (t) => {
  const server = mcp(t, async () => {
    throw Error("Open Recall on this Mac to resume your paper session.");
  });
  await server.call("initialize");
  const failed = await server.call("tools/call", {
    name: "paper_start_session",
    arguments: { title: "Notes" },
  });
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /Open Recall/);
  assert.deepEqual((await server.call("ping")).result, {});
});
test("managed connection preserves unrelated config and skills, is repeatable, and checks registration separately from live delivery", async (t) => {
  const folder = fixture(t),
    home = path.join(folder, "home"),
    profile = path.join(folder, "profile");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  const original = '# Keep this comment\nmodel = "synthetic-model"\n';
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), original);
  let server = null,
    enabled = true,
    adds = 0;
  const options = {
    home,
    environment: {},
    resolveExecutable: () => "/synthetic/codex",
    run: async (_binary, args) => {
      if (args[1] === "get")
        return server
          ? {
              code: 0,
              stdout: JSON.stringify({ transport: server, enabled }),
              stderr: "",
            }
          : { code: 1, stdout: "", stderr: "No MCP server found" };
      adds++;
      server = { command: args[4], args: args.slice(5), type: "stdio" };
      return { code: 0, stdout: "installed", stderr: "" };
    },
  };
  assert.equal((await connectPaper(profile, "codex", options)).mode, "preview");
  assert.equal(adds, 0);
  const connected = await connectPaper(profile, "codex", {
    ...options,
    apply: true,
  });
  assert.equal(connected.installed, true);
  assert.equal(
    fs.readFileSync(path.join(connected.backup, "assistant-config"), "utf8"),
    original,
  );
  assert.equal(
    fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"),
    original,
  );
  assert.match(fs.readFileSync(connected.command, "utf8"), /paper "\$@"/);
  await connectPaper(profile, "codex", { ...options, apply: true });
  assert.equal(adds, 1);
  const status = await paperConnectionStatus(profile, options);
  assert.equal(status.hosts.codex.registered, true);
  assert.equal(status.hosts.codex.skillInstalled, true);
  assert.equal(status.hosts.codex.liveDeliveryVerified, false);
  enabled = false;
  const disabled = await paperConnectionStatus(profile, options);
  assert.equal(disabled.hosts.codex.registered, false);
  assert.equal(disabled.hosts.codex.disabled, true);
  assert.equal((await connectPaper(profile, "codex", options)).disabled, true);
  await assert.rejects(
    connectPaper(profile, "codex", { ...options, apply: true }),
    /server is disabled/,
  );
  assert.equal(adds, 1);
  server = { command: "/somebody/else", args: [] };
  await assert.rejects(
    connectPaper(profile, "codex", { ...options, apply: true }),
    /unrelated/,
  );
  assert.equal(adds, 1);
});
test("unrelated personal skill is preserved before any assistant config or launcher mutation", async (t) => {
  const folder = fixture(t),
    home = path.join(folder, "home"),
    skill = path.join(home, ".codex/skills/paper-learning/SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, "An unrelated personal workflow");
  await assert.rejects(
    connectPaper(path.join(folder, "profile"), "codex", {
      apply: true,
      home,
      environment: {},
      resolveExecutable: () => "/synthetic/codex",
      run: async () => ({ code: 1, stdout: "", stderr: "No MCP server found" }),
    }),
    /unrelated paper-learning/,
  );
  assert.equal(
    fs.readFileSync(skill, "utf8"),
    "An unrelated personal workflow",
  );
  assert.equal(
    fs.existsSync(path.join(folder, "profile/connections/recall-paper")),
    false,
  );
});
