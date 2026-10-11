// Actual Electron writer + assistant MCP child + authenticated iPad transfer.
// Only synthetic profiles/pages are used. No provider or human chat is opened.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  https = require("node:https"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test"),
  { Store } = require("../electron/store.cjs");
const repo = path.resolve(__dirname, ".."),
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-paper-journey-"));
const fixture = new Store(folder);
fixture.import(require("../examples/demo.json").cards);
const before = {
  cards: fixture.db.prepare("SELECT * FROM cards ORDER BY id").all(),
  reviews: fixture.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
};
fixture.close();
function mcpChild() {
  const executable = process.env.RECALL_TEST_EXECUTABLE || process.execPath,
    cli = process.env.RECALL_TEST_EXECUTABLE
      ? path.join(
          path.dirname(process.env.RECALL_TEST_EXECUTABLE),
          "../Resources/app.asar/cli/recall.cjs",
        )
      : path.join(repo, "cli/recall.cjs");
  const child = spawn(executable, [cli, "--data", folder, "paper", "mcp"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", OPENAI_API_KEY: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let counter = 0,
    buffer = "";
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const value = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      const current = pending.get(value.id);
      if (current) {
        clearTimeout(current.timer);
        pending.delete(value.id);
        value.error
          ? current.reject(Error(value.error.message))
          : current.resolve(value.result);
      }
    }
  });
  // Never dump capabilities or image bytes into a diagnostic log.
  child.stderr.resume();
  child.on("exit", () => {
    for (const current of pending.values()) {
      clearTimeout(current.timer);
      current.reject(Error("Synthetic MCP child exited before responding."));
    }
    pending.clear();
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++counter,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Synthetic MCP request timed out."));
        }, 35000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  return {
    child,
    call,
    async tool(name, args) {
      const result = await call("tools/call", { name, arguments: args });
      if (result.isError) throw Error(result.content[0].text);
      return result;
    },
  };
}
function request(
  connection,
  route,
  { method = "GET", body, token, headers = {} } = {},
) {
  const bytes =
    body === undefined
      ? null
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      new URL(route, `https://127.0.0.1:${connection.port}`),
      {
        method,
        ca: connection.cert,
        rejectUnauthorized: true,
        agent: false,
        timeout: 5000,
        headers: {
          ...headers,
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(bytes
            ? {
                "Content-Type": Buffer.isBuffer(body)
                  ? "application/octet-stream"
                  : "application/json",
                "Content-Length": bytes.length,
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            value: JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () =>
      req.destroy(Error("Synthetic iPad transfer timed out.")),
    );
    req.end(bytes);
  });
}
(async () => {
  let app, tutor;
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [repo] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, OPENAI_API_KEY: "" },
    });
    const window = await app.firstWindow();
    await expect(window.locator(".index-brand")).toBeVisible();
    await app.evaluate(({ app }) => {
      const require = process.mainModule.require.bind(process.mainModule),
        path = require("node:path"),
        { PadService } = require(
          path.join(app.getAppPath(), "electron/pad-service.cjs"),
        );
      const original = PadService.prototype.tutorStatus;
      PadService.prototype.tutorStatus = function (...args) {
        globalThis.__paperJourney = this;
        return original.apply(this, args);
      };
    });
    await window.evaluate(() => window.recall.tutorStatus());
    const connection = await app.evaluate(async ({ nativeImage }) => {
      const service = globalThis.__paperJourney;
      service.bridge.host = "127.0.0.1";
      service.bridge.helper = {
        advertise: async () => ({}),
        stopAdvertising: async () => ({}),
        status: async () => ({}),
        dispose() {},
      };
      await service.configure({ enabled: true });
      const pairing = await service.bridge.pairing();
      const bytes = nativeImage
        .createFromBitmap(Buffer.from([30, 40, 32, 255]), {
          width: 1,
          height: 1,
        })
        .toPNG();
      return {
        port: service.bridge.server.address().port,
        cert: service.bridge.identity.cert,
        secret: pairing.payload.bootstrapSecret,
        png: bytes.toString("base64"),
      };
    });
    const deviceId = crypto.randomUUID(),
      pending = await request(connection, "/v1/pair/request", {
        method: "POST",
        body: {
          version: 1,
          bootstrapSecret: connection.secret,
          deviceId,
          deviceName: "Synthetic paper iPad",
        },
      });
    assert.equal(pending.status, 202);
    await app.evaluate(
      (_electron, id) =>
        globalThis.__paperJourney.bridge.confirm({ id, allow: true }),
      pending.value.requestId,
    );
    const approval = await request(
      connection,
      `/v1/pair/requests/${pending.value.requestId}`,
      { headers: { "X-Pair-Secret": connection.secret } },
    );
    const token = approval.value.credential;
    assert.equal(typeof token, "string");
    tutor = mcpChild();
    await tutor.call("initialize", { protocolVersion: "2025-06-18" });
    assert.equal((await tutor.call("tools/list")).tools.length, 6);
    const started = (
        await tutor.tool("paper_start_session", {
          title: "Synthetic paper conversation",
        })
      ).structuredContent,
      binding = {
        sessionId: started.sessionId,
        capability: started.capability,
      };
    const prompt = (
      await tutor.tool("paper_publish_prompt", {
        ...binding,
        title: "First writing prompt",
        prompt: "<p>Explain one step of $Ax=b$.</p>",
        kind: "note",
        expectedRevision: 0,
      })
    ).structuredContent;
    const front = await request(connection, "/v1/session/tutor", { token });
    assert.equal(front.value.currentProblemId, prompt.problem.id);
    assert.equal(front.value.problems[0].kind, "note");
    assert.equal(front.value.questions.length, 0);
    assert.ok(!JSON.stringify(front.value).includes(binding.capability));
    assert.ok(!JSON.stringify(front.value).includes("reference"));
    // Back-and-forth status checks leave the sheet/prompt untouched.
    const status = (await tutor.tool("paper_session_status", binding))
      .structuredContent;
    assert.equal(status.session.currentProblemId, prompt.problem.id);
    const png = Buffer.from(connection.png, "base64"),
      hash = crypto.createHash("sha256").update(png).digest("hex"),
      attemptId = crypto.randomUUID();
    const manifest = {
      version: 2,
      id: attemptId,
      documentId: crypto.randomUUID(),
      revision: 1,
      mode: "tutor",
      target: "assistant",
      questionId: prompt.problem.id,
      handoffId: binding.sessionId,
      createdAt: new Date().toISOString(),
      pages: [
        {
          index: 0,
          hash,
          mime: "image/png",
          name: "Synthetic work.png",
          width: 1,
          height: 1,
        },
      ],
      drawing: null,
      evaluate: false,
    };
    const waiting = tutor.tool("paper_wait_submission", {
      ...binding,
      after: 0,
      timeoutMs: 10000,
    });
    assert.equal(
      (
        await request(connection, `/v1/attempts/${attemptId}/manifest`, {
          method: "POST",
          token,
          body: manifest,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(connection, `/v1/attempts/${attemptId}/assets/${hash}`, {
          method: "PUT",
          token,
          body: png,
        })
      ).status,
      200,
    );
    const receipt = await request(
      connection,
      `/v1/attempts/${attemptId}/commit`,
      { method: "POST", token },
    );
    assert.equal(receipt.value.state, "received");
    assert.equal(
      (await waiting).structuredContent.submissions[0].submissionId,
      attemptId,
    );
    await tutor.tool("paper_publish_prompt", {
      ...binding,
      title: "Second writing prompt",
      prompt: "Work on the next example when ready.",
      kind: "problem",
      expectedRevision: 1,
    });
    const images = await tutor.tool("paper_read_submission", {
      ...binding,
      submissionId: attemptId,
    });
    assert.equal(images.structuredContent.problem.id, prompt.problem.id);
    assert.equal(
      images.content.find((item) => item.type === "image").data,
      connection.png,
    );
    assert.equal(
      (await request(connection, `/v1/attempts/${attemptId}`, { token })).value
        .state,
      "available_to_tutor",
    );
    await assert.rejects(
      tutor.tool("paper_read_submission", {
        ...binding,
        capability: "z".repeat(43),
        submissionId: attemptId,
      }),
      /not authorized/,
    );
    await tutor.tool("paper_end_session", binding);
    await window
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await window
      .getByRole("button", { name: "iPad & handwriting", exact: true })
      .first()
      .click();
    await expect(
      window.getByText("Learn on paper with your tutor", { exact: true }),
    ).toBeVisible();
    await expect(
      window.getByRole("button", { name: "Connect Codex", exact: true }),
    ).toBeVisible();
    await expect(
      window.getByRole("button", { name: "Connect Claude Code", exact: true }),
    ).toBeVisible();
    await expect(
      window.getByText(/first submission verifies the chat connection/),
    ).toBeVisible();
    await expect(
      window.getByText(/ChatGPT desktop can reuse the Codex tools/),
    ).toBeVisible();
    const check = await app.evaluate(() => {
      const db = globalThis.__paperJourney.store.db;
      return {
        cards: db.prepare("SELECT * FROM cards ORDER BY id").all(),
        reviews: db.prepare("SELECT * FROM reviews ORDER BY id").all(),
        count: db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
      };
    });
    assert.equal(JSON.stringify(check.cards), JSON.stringify(before.cards));
    assert.equal(JSON.stringify(check.reviews), JSON.stringify(before.reviews));
    assert.equal(check.count, 1);
    console.log(
      "Paper learning passed: actual MCP → main writer → paired transfer → same requesting tool images; note/problem prompts, late work, auth rejection and unchanged cards/reviews.",
    );
  } finally {
    tutor?.child.stdin.end();
    tutor?.child.kill();
    await app?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
