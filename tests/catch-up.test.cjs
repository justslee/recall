const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { saveConfig, atomic } = require("../electron/config.cjs");
const connections = require("../electron/connections.cjs"),
  inbox = require("../electron/inbox.cjs");
const { scan } = require("../electron/catch-up.cjs");
function fixture(t, host = "codex") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "recall-checkpoint-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const folder = path.join(home, "profile"),
    project = path.join(home, "project");
  fs.mkdirSync(project);
  saveConfig(folder, { captureEnabled: true });
  connections.connect(folder, host, { home, apply: true });
  connections.save(folder, {
    catchUp: {
      enabled: true,
      allProjects: true,
      projects: [],
      exclude: [],
      since: "2026-09-27T04:00:00Z",
    },
  });
  const file = path.join(
    home,
    "." + host,
    host === "codex" ? "sessions" : "projects",
    "session.jsonl",
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const meta = { type: "session_meta", payload: { id: "s1", cwd: project } };
  const row = (role, text, at = "2026-09-29T20:00:00Z") =>
    host === "codex"
      ? {
          timestamp: at,
          type: "response_item",
          payload: {
            type: "message",
            role,
            channel: role === "assistant" ? "final" : undefined,
            content: [{ type: "text", text }],
          },
        }
      : {
          timestamp: at,
          type: role,
          cwd: project,
          sessionId: "s1",
          message: { role, content: text },
        };
  const write = (rows) =>
    fs.writeFileSync(
      file,
      rows.map((x) => JSON.stringify(x)).join("\n") + "\n",
    );
  const stateFile = path.join(folder, "learning-inbox/catch-up.json"),
    key = inbox.hash(file);
  const state = () => JSON.parse(fs.readFileSync(stateFile));
  return {
    home,
    folder,
    project,
    file,
    meta,
    row,
    write,
    stateFile,
    key,
    state,
    run: () => scan(folder, { home }),
    items: () => inbox.read(folder).items,
  };
}
test("legacy worker errors are recovered from metadata without reading excluded bodies", (t) => {
  const f = fixture(t);
  f.meta.payload.source = { subagent: { other: "guardian" } };
  f.write([f.meta]);
  fs.appendFileSync(f.file, "unreadable worker-only body\n");
  f.run();
  const state = f.state();
  state.files[f.key] = {
    offset: 17,
    mtime: fs.statSync(f.file).mtimeMs,
    excluded: true,
    error: "Unexpected token",
  };
  state.issues = [{ source: f.file, error: "Unexpected token" }];
  atomic(f.stateFile, state);
  const result = f.run();
  assert.equal(result.excludedFiles, 1);
  assert.deepEqual(result.issues, []);
  assert.equal(result.queued, 0);
  assert.equal(f.state().files[f.key].offset, fs.statSync(f.file).size);
  assert.equal(f.items().length, 0);
  assert.deepEqual(f.run().issues, []);
  // A replacement user session must not inherit an old worker exclusion.
  delete f.meta.payload.source;
  f.write([
    f.meta,
    f.row("user", "Real user question"),
    f.row("assistant", "Real explanation"),
  ]);
  assert.equal(f.run().queued, 1);
});
test("rewritten prefixes recover without duplicating legacy IDs or changing resolved items", (t) => {
  const f = fixture(t),
    q = f.row("user", "Why λ?"),
    a = f.row("assistant", "Weights 🧠");
  f.write([f.meta, q, a]);
  f.run();
  const state = f.state();
  const item = f.items()[0];
  const legacyId = "catchup/codex/s1/123";
  fs.rmSync(inbox.itemFile(f.folder, item.id));
  inbox.enqueue(f.folder, { ...item.input, id: legacyId });
  inbox.update(f.folder, legacyId, {
    status: "dismissed",
    reason: "Already captured",
  });
  const original = fs.readFileSync(inbox.itemFile(f.folder, legacyId));
  delete state.files[f.key].version;
  delete state.files[f.key].prefixHash;
  state.files[f.key].error = "Unexpected token in old byte position";
  atomic(f.stateFile, state);
  f.meta.payload.addedMetadata =
    "longer metadata changes every following byte offset";
  f.write([
    f.meta,
    q,
    a,
    f.row("user", "New question", "2026-09-29T20:10:00Z"),
    f.row("assistant", "New answer", "2026-09-29T20:11:00Z"),
  ]);
  const result = f.run();
  assert.equal(result.queued, 1);
  assert.equal(result.replayedFiles, 1);
  assert.deepEqual(result.issues, []);
  assert.equal(f.items().length, 2);
  assert.deepEqual(
    fs.readFileSync(inbox.itemFile(f.folder, legacyId)),
    original,
  );
  assert.equal(f.run().queued, 0);
  // Same-length changes also invalidate the prefix; line alignment is insufficient.
  let bytes = fs.readFileSync(f.file, "utf8");
  const beforeSize = Buffer.byteLength(bytes);
  bytes = bytes.replace("New answer", "New reason");
  fs.writeFileSync(f.file, bytes);
  assert.equal(Buffer.byteLength(bytes), beforeSize);
  assert.equal(f.run().replayedFiles, 1);
  assert.equal(f.items().length, 3);
  assert.deepEqual(
    fs.readFileSync(inbox.itemFile(f.folder, legacyId)),
    original,
  );
});
for (const host of ["codex", "claude"])
  test(
    host +
      " retains unfinished multibyte turns and replays rewrites idempotently",
    (t) => {
      const f = fixture(t, host),
        head = host === "codex" ? [f.meta] : [];
      const q = f.row("user", "Explain 日本語 and λ 🧠");
      f.write([...head, q]);
      assert.equal(f.run().pendingTurns, 1);
      fs.appendFileSync(
        f.file,
        JSON.stringify(f.row("assistant", "An explanation")) + "\n",
      );
      assert.equal(f.run().queued, 1);
      const priorIds = f.items().map((x) => x.id);
      f.write([
        ...head,
        { type: "ignored", padding: "metadata added" },
        q,
        f.row("assistant", "An explanation"),
      ]);
      assert.equal(f.run().queued, 0);
      assert.deepEqual(
        f.items().map((x) => x.id),
        priorIds,
      );
      assert.deepEqual(f.run().issues, []);
    },
  );
test("truncation does not mix a stale pending question with a replacement session", (t) => {
  const f = fixture(t);
  f.write([
    f.meta,
    f.row("user", "Old unfinished question " + ".".repeat(1000)),
  ]);
  f.run();
  f.write([
    f.meta,
    f.row("user", "Replacement question"),
    f.row("assistant", "Replacement answer"),
  ]);
  const result = f.run();
  assert.equal(result.queued, 1);
  assert.equal(result.pendingTurns, 0);
  assert.equal(f.items()[0].input.messages[0].text, "Replacement question");
  assert(!JSON.stringify(f.items()).includes("Old unfinished"));
});
test("actual malformed user records stay visible and are retried only after a source change", (t) => {
  const f = fixture(t);
  f.write([f.meta]);
  fs.appendFileSync(f.file, "{broken}\n");
  const result = f.run();
  assert.equal(result.issues.length, 1);
  assert.equal(f.run().checked, 0);
  assert.equal(f.run().issues.length, 1);
  f.write([
    f.meta,
    f.row("user", "Repaired question"),
    f.row("assistant", "Valid answer"),
  ]);
  assert.deepEqual(f.run().issues, []);
  assert.equal(f.items().length, 1);
});
