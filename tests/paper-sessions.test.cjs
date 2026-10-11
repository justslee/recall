const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Store } = require("../electron/store.cjs"),
  { PaperStore } = require("../electron/paper-store.cjs"),
  { PaperSessions } = require("../electron/paper-sessions.cjs"),
  { PadBridge } = require("../electron/pad-bridge.cjs"),
  contract = require("../shared/handwriting-contract.cjs"),
  backups = require("../electron/backup.cjs");
const cards = require("../examples/demo.json").cards,
  PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
    "base64",
  );
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-paper-session-")),
    folder = path.join(root, "profile"),
    store = new Store(folder);
  store.import(cards);
  const paper = new PaperStore(store),
    bridge = new PadBridge({ store, paper }),
    readEvents = [],
    sessions = new PaperSessions({
      store,
      paper,
      onChange: (s) => bridge.setAssistantSession(s),
      onRead: (id) => readEvents.push(id),
    });
  bridge.assistantSession = () => sessions.activeSession();
  t.after(() => {
    sessions.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, folder, store, paper, bridge, sessions, readEvents };
}
const authorization = (session) => ({
  sessionId: session.sessionId,
  capability: session.capability,
});
function publish(
  f,
  session,
  prompt = "Explain why $Ax=b$ has a solution.",
  kind = "problem",
) {
  return f.sessions.call("publish", {
    ...authorization(session),
    title: "Linear algebra",
    prompt,
    kind,
  });
}
function manifest(session, p, options = {}) {
  return {
    version: 2,
    id: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    mode: "tutor",
    target: "assistant",
    questionId: p.id,
    handoffId: session.sessionId,
    createdAt: new Date().toISOString(),
    pages: [
      {
        index: 0,
        hash: contract.digest(PNG),
        mime: "image/png",
        name: "Work.png",
        width: 1,
        height: 1,
      },
    ],
    drawing: null,
    evaluate: false,
    ...options,
  };
}
function accept(f, m, device = "synthetic-ipad") {
  f.paper.prepare(device, m);
  f.paper.stage(device, m.id, m.pages[0].hash, PNG);
  const receipt = f.paper.commit(device, m.id);
  f.sessions.notify();
  return receipt;
}
function grant(f, session, device = "synthetic-ipad") {
  f.bridge.forDevice({ id: device }, f.sessions.session(session.sessionId));
}

test("assistant sessions publish immutable problems and note prompts without cards or answer references", async (t) => {
  const f = setup(t),
    before = f.store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    session = await f.sessions.call("start", {
      title: "Linear algebra tutoring",
      client: "codex",
      conversationId: "synthetic-current-chat",
    }),
    first = await publish(f, session);
  assert.equal(first.session.target, "assistant");
  assert.deepEqual(first.session.questions, []);
  assert.equal(first.problem.revision, 1);
  assert.match(first.problem.prompt, /\$Ax=b\$/);
  const notes = await publish(
    f,
    session,
    "Write notes about the column space.",
    "note",
  );
  assert.equal(notes.problem.kind, "note");
  for (let i = 0; i < 3; i++)
    await publish(f, session, `Work on example ${i}.`);
  const latest = f.sessions.session(session.sessionId);
  assert.equal(latest.problems.length, 3);
  assert.equal(latest.currentProblemId, latest.problems.at(-1).id);
  assert.equal(
    f.store.db
      .prepare("SELECT prompt FROM paper_tutor_problems WHERE id=?")
      .get(first.problem.id).prompt,
    first.problem.prompt,
  );
  assert.equal(
    f.store.db.prepare("SELECT count(*) n FROM paper_questions").get().n,
    0,
  );
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before,
  );
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM reviews").get().n, 0);
  assert.equal(Object.hasOwn(latest, "capability"), false);
  assert.equal(Object.hasOwn(first.problem, "reference"), false);
  await assert.rejects(
    publish(f, session, "<iframe src='https://invalid.test'></iframe>"),
    /interactive or vector/,
  );
  await assert.rejects(
    f.sessions.call("publish", {
      ...authorization(session),
      prompt: "Next",
      expectedRevision: 0,
    }),
    /prompt changed/,
  );
});

test("scoped capabilities reject cross-session reads and survive ordinary restart outside backups", async (t) => {
  const f = setup(t),
    a = await f.sessions.call("start", { title: "Chat A" }),
    p = (await publish(f, a)).problem;
  grant(f, a);
  const m = manifest(a, p);
  accept(f, m);
  const b = await f.sessions.call("start", { title: "Chat B" });
  await assert.rejects(
    f.sessions.call("status", {
      sessionId: a.sessionId,
      capability: b.capability,
    }),
    /not authorized/,
  );
  await assert.rejects(
    f.sessions.call("read", { ...authorization(b), submissionId: m.id }),
    /another paper session/,
  );
  const file = path.join(f.folder, "paper-authority", "credentials.json"),
    saved = fs.readFileSync(file, "utf8");
  assert.equal(saved.includes(a.capability), false);
  assert.equal(saved.includes(b.capability), false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  const restarted = new PaperSessions({ store: f.store, paper: f.paper });
  try {
    assert.equal(
      (await restarted.call("status", authorization(a))).submissions[0]
        .submissionId,
      m.id,
    );
    assert.equal(restarted.activeSession().handoffId, b.sessionId);
  } finally {
    restarted.close();
  }
});

test("late and offline work binds to its issued problem before durable acknowledgment and retries preserve hashes", async (t) => {
  const f = setup(t),
    s = await f.sessions.call("start", {}),
    first = (await publish(f, s)).problem;
  grant(f, s);
  const m = manifest(s, first),
    hash = contract.digest(JSON.stringify(contract.manifest(m)));
  f.paper.prepare("synthetic-ipad", m);
  await publish(f, s, "A later question.");
  const other = await f.sessions.call("start", {});
  await publish(f, other, "An unrelated tutor context.");
  f.paper.stage("synthetic-ipad", m.id, m.pages[0].hash, PNG);
  assert.equal(f.paper.receipt("synthetic-ipad", m.id).state, "staging");
  const receipt = f.paper.commit("synthetic-ipad", m.id);
  const binding = f.store.db
    .prepare("SELECT * FROM paper_tutor_attempt_bindings WHERE attempt_id=?")
    .get(m.id);
  assert.equal(binding.session_id, s.sessionId);
  assert.equal(binding.problem_id, first.id);
  assert.equal(receipt.state, "received");
  assert.deepEqual(f.paper.commit("synthetic-ipad", m.id), receipt);
  assert.equal(f.paper.prepare("synthetic-ipad", m).state, "received");
  assert.equal(
    f.store.db
      .prepare("SELECT manifest_hash FROM paper_attempts WHERE id=?")
      .get(m.id).manifest_hash,
    hash,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT count(*) n FROM paper_tutor_attempt_bindings")
      .get().n,
    1,
  );
  const response = await f.sessions.call("read", {
    ...authorization(s),
    submissionId: m.id,
  });
  assert.equal(response.problem.id, first.id);
  assert.equal(response.problem.prompt, first.prompt);
  assert.deepEqual(Buffer.from(response.pages[0].data, "base64"), PNG);
  assert.equal(
    f.paper.receipt("synthetic-ipad", m.id).state,
    "available_to_tutor",
  );
  assert.equal(f.paper.attempt(m.id).status, "received");
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM reviews").get().n, 0);
});

test("device grants and original sheet bindings reject fabricated, cross-session and revoked uploads", async (t) => {
  const f = setup(t),
    a = await f.sessions.call("start", {}),
    pa = (await publish(f, a)).problem,
    b = await f.sessions.call("start", {}),
    pb = (await publish(f, b)).problem;
  grant(f, a);
  grant(f, b);
  assert.throws(
    () => f.paper.prepare("other-ipad", manifest(a, pa)),
    /not issued/,
  );
  assert.throws(
    () => f.paper.prepare("synthetic-ipad", manifest(a, pb)),
    /not issued/,
  );
  const original = manifest(a, pa);
  accept(f, original);
  assert.throws(
    () =>
      f.paper.prepare(
        "synthetic-ipad",
        manifest(b, pb, { documentId: original.documentId, revision: 2 }),
      ),
    /original writing prompt/,
  );
  const staged = manifest(b, pb);
  f.paper.prepare("synthetic-ipad", staged);
  f.paper.stage("synthetic-ipad", staged.id, staged.pages[0].hash, PNG);
  f.store.db
    .prepare(
      "DELETE FROM paper_device_grants WHERE device_id=? AND handoff_id=?",
    )
    .run("synthetic-ipad", b.sessionId);
  assert.throws(
    () => f.paper.commit("synthetic-ipad", staged.id),
    /not issued/,
  );
  assert.equal(f.paper.receipt("synthetic-ipad", staged.id).state, "staging");
});

test("bounded waits return durable cursors and ordered progressive images without evaluating or consuming work", async (t) => {
  const f = setup(t),
    s = await f.sessions.call("start", {}),
    p = (await publish(f, s)).problem;
  grant(f, s);
  const pending = f.sessions.call("wait", {
    ...authorization(s),
    after: 0,
    timeoutMs: 1000,
  });
  const m = manifest(s, p, {
    pages: Array.from({ length: 4 }, (_, index) => ({
      index,
      hash: contract.digest(PNG),
      mime: "image/png",
      name: `Page ${index + 1}.png`,
      width: 1,
      height: 1,
    })),
  });
  accept(f, m);
  const found = await pending;
  assert.equal(found.submissions.length, 1);
  assert.equal(found.submissions[0].submissionId, m.id);
  assert.ok(found.cursor > 0);
  const empty = await f.sessions.call("wait", {
    ...authorization(s),
    after: found.cursor,
    timeoutMs: 5,
  });
  assert.deepEqual(empty.submissions, []);
  assert.equal(empty.cursor, found.cursor);
  const first = await f.sessions.call("read", {
    ...authorization(s),
    submissionId: m.id,
  });
  assert.deepEqual(
    first.pages.map((page) => page.index),
    [0, 1],
  );
  assert.deepEqual(first.nextPageIndexes, [2, 3]);
  const second = await f.sessions.call("read", {
    ...authorization(s),
    submissionId: m.id,
    pageIndexes: [3, 2],
  });
  assert.deepEqual(
    second.pages.map((page) => page.index),
    [2, 3],
  );
  await assert.rejects(
    f.sessions.call("wait", { ...authorization(s), timeoutMs: 30001 }),
    /30 seconds/,
  );
  await assert.rejects(
    f.sessions.call("read", {
      ...authorization(s),
      submissionId: m.id,
      pageIndexes: [0, 0],
    }),
    /valid ordered/,
  );
  assert.equal(f.paper.attempt(m.id).feedback, null);
  assert.equal(f.paper.attempt(m.id).status, "received");
});

test("ending and generic receiver entry preserve issued unfinished work and never overwrite an active assistant desk", async (t) => {
  const f = setup(t),
    s = await f.sessions.call("start", {}),
    p = (await publish(f, s)).problem;
  grant(f, s);
  const generic = await f.bridge.startTutor("clipboard");
  assert.equal(generic.target, "assistant");
  assert.equal(generic.handoffId, s.sessionId);
  const ended = await f.sessions.call("end", authorization(s));
  assert.equal(ended.status, "ended");
  assert.equal(f.sessions.activeSession(), null);
  await assert.rejects(publish(f, s), /has ended/);
  const m = manifest(s, p);
  accept(f, m);
  assert.equal(
    (await f.sessions.call("read", { ...authorization(s), submissionId: m.id }))
      .problem.id,
    p.id,
  );
  assert.equal((await f.bridge.startTutor()).target, "clipboard");
});

test("backup restore retains bound work and stable cursors but loses session authority and automatic desk activation", async (t) => {
  const f = setup(t),
    s = await f.sessions.call("start", {}),
    p = (await publish(f, s)).problem;
  grant(f, s);
  const m = manifest(s, p);
  accept(f, m);
  const original = f.store.db
      .prepare("SELECT * FROM paper_attempts WHERE id=?")
      .get(m.id),
    binding = f.store.db
      .prepare("SELECT * FROM paper_tutor_attempt_bindings WHERE attempt_id=?")
      .get(m.id),
    backup = backups.backup(f.store, path.join(f.root, "backup")).backup;
  assert.equal(fs.existsSync(path.join(backup, "paper-authority")), false);
  const destination = path.join(f.root, "restored");
  backups.restore(destination, backup);
  const restored = new Store(destination),
    restoredPaper = new PaperStore(restored),
    restoredSessions = new PaperSessions({
      store: restored,
      paper: restoredPaper,
    });
  try {
    assert.equal(restoredSessions.activeSession(), null);
    await assert.rejects(
      restoredSessions.call("read", {
        ...authorization(s),
        submissionId: m.id,
      }),
      /not authorized/,
    );
    assert.deepEqual(
      restored.db.prepare("SELECT * FROM paper_attempts WHERE id=?").get(m.id),
      original,
    );
    assert.deepEqual(
      restored.db
        .prepare(
          "SELECT * FROM paper_tutor_attempt_bindings WHERE attempt_id=?",
        )
        .get(m.id),
      binding,
    );
    assert.deepEqual(restoredPaper.pages(m.id)[0].bytes, PNG);
    assert.equal(
      restored.db
        .prepare("SELECT prompt FROM paper_tutor_problems WHERE id=?")
        .get(p.id).prompt,
      p.prompt,
    );
  } finally {
    restoredSessions.close();
    restored.close();
  }
});

test("legacy version-1 normalization is unchanged while version-2 assistant work requires explicit binding", (t) => {
  const f = setup(t),
    m = {
      ...manifest(
        { sessionId: crypto.randomUUID() },
        { id: crypto.randomUUID() },
      ),
      version: 1,
      target: "codex",
      questionId: null,
    };
  assert.deepEqual(contract.manifest(m), m);
  assert.throws(
    () => contract.manifest({ ...m, version: 2 }),
    /assistant paper session/,
  );
  assert.throws(
    () => contract.manifest({ ...m, version: 2, target: "assistant" }),
    /identifier/,
  );
  assert.throws(
    () => contract.manifest({ ...m, version: 1, target: "assistant" }),
    /destination/,
  );
  assert.throws(
    () =>
      contract.manifest({
        ...m,
        version: 2,
        target: "assistant",
        questionId: crypto.randomUUID(),
        evaluate: true,
      }),
    /evaluation/,
  );
});

test("restored session status revokes stale private authorization without changing saved work", async (t) => {
  const f = setup(t),
    s = await f.sessions.call("start", {}),
    p = (await publish(f, s)).problem;
  grant(f, s);
  const m = manifest(s, p);
  accept(f, m);
  f.store.db.prepare("UPDATE paper_tutor_sessions SET status='restored'").run();
  assert.equal(f.sessions.activeSession(), null);
  await assert.rejects(
    f.sessions.call("status", authorization(s)),
    /new chat authorization/,
  );
  await assert.rejects(
    f.sessions.call("read", { ...authorization(s), submissionId: m.id }),
    /new chat authorization/,
  );
  assert.deepEqual(f.paper.pages(m.id)[0].bytes, PNG);
  const next = await f.sessions.call("start", {
    title: "New authorized tutor",
  });
  assert.equal(
    (await f.sessions.call("status", authorization(next))).status,
    "active",
  );
});

test("simultaneously staged bound sheets cannot change their problem or repurpose generic work", async (t) => {
  const f = setup(t),
    s = await f.sessions.call("start", {}),
    first = (await publish(f, s)).problem,
    second = (await publish(f, s, "A second problem.")).problem;
  grant(f, s);
  const a = manifest(s, first),
    b = manifest(s, second, { documentId: a.documentId, revision: 2 });
  f.paper.prepare("synthetic-ipad", a);
  f.paper.prepare("synthetic-ipad", b);
  for (const m of [a, b])
    f.paper.stage("synthetic-ipad", m.id, m.pages[0].hash, PNG);
  f.paper.commit("synthetic-ipad", a.id);
  assert.throws(
    () => f.paper.commit("synthetic-ipad", b.id),
    /original writing prompt/,
  );
  const generic = {
    ...manifest(s, first),
    version: 1,
    target: "clipboard",
    questionId: null,
  };
  accept(f, generic);
  assert.throws(
    () =>
      f.paper.prepare(
        "synthetic-ipad",
        manifest(s, first, { documentId: generic.documentId, revision: 2 }),
      ),
    /original writing prompt/,
  );
});

test("assistant host labels grant identical scoped authority and reject unsupported hosts", async (t) => {
  const f = setup(t);
  for (const client of ["codex", "claude", "chatgpt"]) {
    const s = await f.sessions.call("start", {
      title: `${client} tutoring`,
      client,
    });
    assert.equal(
      (await f.sessions.call("status", authorization(s))).status,
      "active",
    );
    assert.equal(
      f.store.db
        .prepare("SELECT client FROM paper_tutor_sessions WHERE id=?")
        .get(s.sessionId).client,
      client,
    );
  }
  await assert.rejects(
    f.sessions.call("start", { client: "arbitrary-app" }),
    /supported assistant/,
  );
});

test("authority and database failures roll back session creation and prompt publication", async (t) => {
  const f = setup(t),
    s = await f.sessions.call("start", {});
  await publish(f, s);
  const saved = fs.readFileSync(f.sessions.file, "utf8"),
    originalTransaction = f.store.transaction.bind(f.store);
  f.store.transaction = (fn) =>
    originalTransaction(() => {
      fn();
      throw Error("Synthetic commit failure");
    });
  await assert.rejects(
    f.sessions.call("start", {}),
    /Synthetic commit failure/,
  );
  assert.equal(fs.readFileSync(f.sessions.file, "utf8"), saved);
  assert.equal(
    f.store.db.prepare("SELECT count(*) n FROM paper_tutor_sessions").get().n,
    1,
  );
  await assert.rejects(
    publish(f, s, "A failed prompt."),
    /Synthetic commit failure/,
  );
  assert.equal(fs.readFileSync(f.sessions.file, "utf8"), saved);
  assert.equal(
    f.store.db.prepare("SELECT count(*) n FROM paper_tutor_problems").get().n,
    1,
  );
  f.store.transaction = originalTransaction;
  const originalSave = f.sessions.saveAuthority.bind(f.sessions);
  let failures = 1;
  f.sessions.saveAuthority = () => {
    if (failures-- > 0) throw Error("Synthetic disk full");
    originalSave();
  };
  await assert.rejects(
    publish(f, s, "Another failed prompt."),
    /Synthetic disk full/,
  );
  assert.equal(fs.readFileSync(f.sessions.file, "utf8"), saved);
  assert.equal(
    f.store.db.prepare("SELECT count(*) n FROM paper_tutor_problems").get().n,
    1,
  );
  assert.equal(f.sessions.activeSession().handoffId, s.sessionId);
});
