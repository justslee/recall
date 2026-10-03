const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { Store } = require("../electron/store.cjs"),
  { saveConfig } = require("../electron/config.cjs"),
  c = require("../electron/connections.cjs"),
  inbox = require("../electron/inbox.cjs"),
  scan = require("../electron/catch-up.cjs"),
  st = require("../electron/self-test.cjs");
function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "recall-connect-")),
    folder = path.join(home, "profile");
  saveConfig(folder, { captureEnabled: true, timeZone: "America/New_York" });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, folder };
}
const entry = (id = "q1") => ({
  id,
  sessionId: "session",
  title: "Weighted mean",
  objective: "Explain weighting",
  context: "Asked why weights change an average",
  at: "2026-09-27T15:00:00Z",
  evidence: "discussed",
  cardIds: [],
});
test("global connection preview, installation, repetition and disconnect preserve user instructions", (t) => {
  const { home, folder } = setup(t);
  const f = path.join(home, ".codex/AGENTS.md");
  fs.mkdirSync(path.dirname(f));
  fs.writeFileSync(f, "My other project rules.\n");
  c.connect(folder, "codex", { home });
  assert.equal(fs.readFileSync(f, "utf8"), "My other project rules.\n");
  c.connect(folder, "codex", { home, apply: true });
  const first = fs.readFileSync(f, "utf8");
  c.connect(folder, "codex", { home, apply: true });
  assert.equal(fs.readFileSync(f, "utf8"), first);
  assert(c.status(folder).hosts.codex.connected);
  assert(
    fs.existsSync(
      path.join(folder, "connections/skills/recall-source/references/inbox.md"),
    ),
  );
  c.disconnect(folder, "codex", { home });
  assert(fs.readFileSync(f, "utf8").includes("My other project rules."));
  assert(!c.status(folder).hosts.codex.connected);
  assert.throws(
    () => c.replaceBlock("<!-- recall-connection:begin -->broken", "x"),
    /damaged/,
  );
});
test("custom Codex home installation, catch-up and disconnect keep their selected scope after environment changes", (t) => {
  const { home, folder } = setup(t);
  const codexHome = path.join(home, "selected-codex"),
    project = path.join(home, "project");
  fs.mkdirSync(project);
  c.connect(folder, "codex", {
    home,
    environment: { CODEX_HOME: codexHome },
    apply: true,
  });
  assert(fs.existsSync(path.join(codexHome, "AGENTS.md")));
  assert(!fs.existsSync(path.join(home, ".codex/AGENTS.md")));
  c.save(folder, {
    catchUp: {
      enabled: true,
      allProjects: true,
      projects: [],
      exclude: [],
      since: "2026-09-27T04:00:00Z",
    },
  });
  const file = path.join(codexHome, "sessions/session.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      { type: "session_meta", payload: { id: "custom-home", cwd: project } },
      ...["user", "assistant"].map((role) => ({
        type: "response_item",
        timestamp: "2026-09-27T15:00:00Z",
        payload: {
          type: "message",
          role,
          channel: role === "assistant" ? "final" : undefined,
          content: [
            {
              type: "text",
              text:
                role === "user"
                  ? "Explain a weighted mean"
                  : "Weights specify relative importance.",
            },
          ],
        },
      })),
    ]
      .map(JSON.stringify)
      .join("\n") + "\n",
  );
  assert.equal(scan.scan(folder, { home }).queued, 1);
  assert.equal(inbox.read(folder).items[0].input.source, file);
  c.disconnect(folder, "codex", { home, environment: {} });
  assert(
    !fs
      .readFileSync(path.join(codexHome, "AGENTS.md"), "utf8")
      .includes("recall-connection:begin"),
  );
  assert(!fs.existsSync(path.join(codexHome, "skills/recall-bridge/SKILL.md")));
  assert(!fs.existsSync(path.join(home, ".codex")));
});
test("a displaced profile cannot report or disconnect another profile's active global bridge", (t) => {
  for (const legacy of [false, true]) {
    const { home, folder } = setup(t),
      second = path.join(home, "second-profile");
    saveConfig(second, { captureEnabled: true });
    c.connect(folder, "codex", { home, apply: true });
    c.connect(second, "codex", { home, apply: true });
    const instructions = path.join(home, ".codex/AGENTS.md"),
      skill = path.join(home, ".codex/skills/recall-bridge/SKILL.md");
    if (legacy) {
      for (const file of [instructions, skill])
        fs.writeFileSync(
          file,
          fs
            .readFileSync(file, "utf8")
            .replace(/<!-- recall-profile:[a-f0-9]{64} -->\n/g, ""),
        );
    }
    const beforeInstructions = fs.readFileSync(instructions, "utf8"),
      beforeSkill = fs.readFileSync(skill, "utf8");
    assert.equal(c.status(folder).hosts.codex.connected, false);
    assert.equal(c.status(second).hosts.codex.connected, true);
    assert.equal(
      c.disconnect(folder, "codex", { home }).preservedOtherConnection,
      true,
    );
    assert.equal(fs.readFileSync(instructions, "utf8"), beforeInstructions);
    assert.equal(fs.readFileSync(skill, "utf8"), beforeSkill);
    assert.equal(c.status(second).hosts.codex.connected, true);
    c.disconnect(second, "codex", { home });
    assert.equal(c.status(second).hosts.codex.connected, false);
    assert(!fs.existsSync(skill));
  }
});

test("manual skill installation defaults to the custom Codex home without writing on preview", (t) => {
  const { home, folder } = setup(t),
    codexHome = path.join(home, "selected-codex");
  const { execFileSync } = require("node:child_process");
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(__dirname, "../cli/recall.cjs"),
        "--data",
        folder,
        "skills",
        "install",
      ],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, CODEX_HOME: codexHome },
      },
    ),
  );
  assert.equal(result.mode, "preview");
  assert.equal(result.destination, path.join(codexHome, "skills"));
  assert(result.skills.includes("recall-source"));
  assert(!fs.existsSync(codexHome));
});

test("inbox reuses cards while writer open, resolves additions without altering old schedules, blocks bad imports", (t) => {
  const { folder } = setup(t),
    s = new Store(folder);
  t.after(() => s.close());
  s.import(require("../examples/demo.json").cards);
  const before = s.cards(),
    e = entry();
  e.cardIds = [before[0].id];
  assert.equal(inbox.add(folder, e, s.cards()).status, "ready");
  assert.equal(inbox.add(folder, e, s.cards()).inserted, false);
  assert.equal(st.read(folder).entries.length, 1);
  assert.throws(() => inbox.retry(folder, e.id), /Only blocked/);
  const missing = entry("missing");
  inbox.add(folder, missing, s.cards());
  const card = { ...before[0], id: "new-concept", conceptId: "new-concept" };
  delete card.schedule;
  delete card.presentation;
  inbox.submit(folder, "missing", {
    captures: [{ cardIds: [card.id] }],
    pack: { schemaVersion: 1, id: "new", title: "New", cards: [card] },
    quality: {
      reviewedCardIds: [card.id],
      evidence: "Verified in isolated profile",
    },
  });
  assert.equal(inbox.applyPending(s).applied, 1);
  assert.equal(s.cards().length, before.length + 1);
  assert.deepEqual(
    s.cards().filter((x) => x.id !== card.id),
    before,
  );
  assert.equal(
    st.read(folder).entries.find((e) => e.id === "missing").cardIds[0],
    card.id,
  );
  inbox.add(folder, entry("bad"), s.cards());
  inbox.submit(folder, "bad", { captures: [{ cardIds: ["nonexistent"] }] });
  inbox.applyPending(s);
  assert.equal(
    inbox.read(folder).items.find((i) => i.id === "bad").status,
    "blocked",
  );
  assert.equal(s.cards().length, before.length + 1);
  saveConfig(folder, { captureEnabled: false });
  assert.throws(() => inbox.add(folder, entry("paused"), s.cards()), /paused/);
  assert(inbox.applyPending(s).paused);
});
test("incremental catch-up keeps unfinished turns, filters tools, preserves errors and applies project/date scope", (t) => {
  const { home, folder } = setup(t);
  for (const name of ["excluded", "project", "second"])
    fs.mkdirSync(path.join(home, name));
  c.connect(folder, "codex", { home, apply: true });
  c.connect(folder, "claude", { home, apply: true });
  const scope = {
    enabled: true,
    allProjects: true,
    projects: [],
    exclude: [path.join(home, "excluded")],
    since: "2026-09-27T04:00:00Z",
  };
  c.save(folder, { catchUp: scope });
  const dir = path.join(home, ".codex/sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude/projects"), { recursive: true });
  const f = path.join(dir, "test.jsonl");
  const row = (role, text, at = "2026-09-27T15:00:00Z") => ({
    timestamp: at,
    type: "response_item",
    payload: {
      type: "message",
      role,
      channel: role === "assistant" ? "final" : undefined,
      content: [{ type: "text", text }],
    },
  });
  const append = (x) => fs.appendFileSync(f, JSON.stringify(x) + "\n");
  append({
    type: "session_meta",
    payload: { id: "session", cwd: path.join(home, "project") },
  });
  append(row("user", "Old question", "2026-09-26T23:00:00Z"));
  append(row("assistant", "Old answer", "2026-09-26T23:01:00Z"));
  append(row("user", "What is weighted mean?"));
  assert.equal(scan.scan(folder, { home }).queued, 0);
  append({
    type: "response_item",
    payload: { type: "function_call_output", output: "SECRET TOOL CONTENT" },
  });
  append(row("assistant", "An average adjusted by weights."));
  assert.equal(scan.scan(folder, { home }).queued, 1);
  assert.equal(scan.scan(folder, { home }).queued, 0);
  const item = inbox.read(folder).items[0];
  assert.equal(item.input.messages.length, 2);
  assert(!JSON.stringify(item).includes("SECRET"));
  fs.appendFileSync(f, '{"type":');
  assert.equal(scan.scan(folder, { home }).issues.length, 1);
  assert.equal(scan.scan(folder, { home }).issues.length, 1);
  fs.appendFileSync(f, '"ignored"}\n');
  assert.equal(scan.scan(folder, { home }).issues.length, 0);
  const cf = path.join(home, ".claude/projects/one.jsonl");
  fs.writeFileSync(
    cf,
    [
      {
        type: "user",
        timestamp: "2026-09-27T16:00:00Z",
        cwd: path.join(home, "second"),
        sessionId: "c1",
        message: { role: "user", content: "Explain variance" },
      },
      {
        type: "assistant",
        timestamp: "2026-09-27T16:01:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Squared deviation." }],
        },
      },
    ]
      .map(JSON.stringify)
      .join("\n") + "\n",
  );
  assert.equal(scan.scan(folder, { home }).queued, 1);
  c.save(folder, { catchUp: { ...scope, exclude: [home] } });
  assert.equal(scan.scan(folder, { home }).queued, 0);
  assert.equal(inbox.read(folder).items.length, 2);
});
test("new coding cards remain untrusted and invented capture timestamps are blocked", (t) => {
  const { folder } = setup(t),
    s = new Store(folder);
  t.after(() => s.close());
  const code = require("../examples/demo.json").cards.find(
    (c) => c.kind === "code",
  );
  inbox.add(folder, entry(), []);
  inbox.submit(folder, "q1", {
    captures: [{ cardIds: [code.id] }],
    pack: { schemaVersion: 1, id: "code", title: "code", cards: [code] },
    quality: { reviewedCardIds: [code.id], evidence: "Reviewed fixture" },
  });
  inbox.applyPending(s);
  assert.equal(s.cards().length, 1);
  assert.equal(s.get("validated-code:" + code.id), null);
  assert.equal(inbox.read(folder).items[0].status, "ready");
  inbox.enqueue(folder, {
    id: "session-turn",
    type: "session",
    sessionId: "session",
    title: "test",
    messages: [{ at: "2026-09-27T10:00:00Z" }],
  });
  inbox.submit(folder, "session-turn", {
    captures: [{ ...entry(), at: "2026-01-01T00:00:00Z", cardIds: [code.id] }],
  });
  inbox.applyPending(s);
  assert.equal(s.cards().length, 1);
  assert.equal(
    inbox.read(folder).items.find((i) => i.id === "session-turn").status,
    "blocked",
  );
});
test("bounded worker submits mocked results and reports provider failures", async (t) => {
  const { home, folder } = setup(t),
    s = new Store(folder);
  t.after(() => s.close());
  const codexHome = path.join(home, "selected-codex");
  c.connect(folder, "codex", {
    home,
    environment: { CODEX_HOME: codexHome },
    apply: true,
  });
  s.import(require("../examples/demo.json").cards);
  inbox.add(folder, entry(), s.cards());
  const worker = require("../electron/learning-worker.cjs");
  const { EventEmitter } = require("node:events"),
    { PassThrough } = require("node:stream");
  function fake(binary, args, opts) {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => {
      const output = args[args.indexOf("--output-last-message") + 1];
      fs.writeFileSync(
        output,
        JSON.stringify({ captures: [{ cardIds: [s.cards()[0].id] }] }),
      );
      child.emit("close", 0);
    });
    return child;
  }
  assert.equal(
    (
      await worker.prepare(folder, s.cards(), {
        spawnProcess: fake,
        resolveExecutable: () => "/fake",
        verifyProvider: () => {},
        createInvocation: (agent, binary, stage, prompt, options) => {
          assert.equal(options.codexHome, codexHome);
          return {
            binary,
            args: [
              "--output-last-message",
              path.join(stage, "last-message.txt"),
            ],
            output: path.join(stage, "last-message.txt"),
            env: {},
          };
        },
      })
    ).prepared,
    1,
  );
  inbox.applyPending(s);
  assert.equal(inbox.read(folder).items[0].status, "ready");
  assert.equal(st.read(folder).entries.length, 1);
  inbox.add(folder, entry("fail"), s.cards());
  const fail = (...a) => {
    const child = fake(...a);
    process.nextTick(() => {});
    return child;
  };
  await assert.rejects(
    () =>
      worker.prepare(folder, s.cards(), {
        resolveExecutable: () => {
          throw Error("Not installed");
        },
      }),
    /Not installed/,
  );
  assert.equal(
    inbox.read(folder).items.find((i) => i.id === "fail").status,
    "pending",
  );
});

test("Claude tool-use commentary does not prematurely complete a learning turn", () => {
  assert.equal(
    scan.message(
      {
        type: "assistant",
        timestamp: "2026-09-27T12:00:00Z",
        message: {
          role: "assistant",
          stop_reason: "tool_use",
          content: [{ type: "text", text: "Let me inspect that" }],
        },
      },
      "claude",
    ),
    null,
  );
  assert.equal(
    scan.message(
      {
        type: "assistant",
        timestamp: "2026-09-27T12:01:00Z",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Here is the explanation" }],
        },
      },
      "claude",
    ).role,
    "assistant",
  );
});
