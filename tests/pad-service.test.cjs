const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Store } = require("../electron/store.cjs"),
  { PadService } = require("../electron/pad-service.cjs"),
  contract = require("../shared/handwriting-contract.cjs");
const cards = require("../examples/demo.json").cards,
  PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
    "base64",
  );

function success() {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  verdict: "solid",
                  summary: "The visible method matches the reference.",
                  strengths: ["The method is valid."],
                  findings: [],
                  firstMistake: null,
                  followUp: "Can you explain why this method works?",
                }),
              },
            ],
          },
        ],
      }),
  };
}

async function settle(predicate) {
  for (let tries = 0; tries < 100; tries++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert(predicate(), "Expected asynchronous handoff state");
}

function setup(t, { fetchImpl = async () => success() } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-pad-service-")),
    store = new Store(folder),
    calls = [],
    copies = [],
    events = [],
    logins = [];
  store.import(cards);
  const helper = {
    status: async () => {
      calls.push(["status"]);
      return { available: true, advertising: false };
    },
    advertise: async () => calls.push(["advertise"]),
    stopAdvertising: async () => calls.push(["stopAdvertising"]),
    dispose: () => calls.push(["dispose"]),
  };
  const service = new PadService({
    store,
    key: () => "synthetic-assessment-credential",
    fetchImpl,
    copyImage: (bytes) => copies.push(Buffer.from(bytes)),
    emit: (event) => events.push(event),
    login: (enabled) => logins.push(enabled),
    helperFactory: () => helper,
  });
  // No system settings or network listener is needed for these service checks.
  service.bridge.stop = async () => {
    service.bridge.server = null;
  };
  t.after(async () => {
    await service.close();
    await settle(() => !service.assessment.active);
    store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { folder, store, service, helper, calls, copies, events, logins };
}

function study(f, evaluate = true) {
  const a = f.service.paper.import(cards[0].id, [
    { name: "Synthetic work.png", mime: "image/png", bytes: PNG },
  ]);
  if (evaluate) {
    f.store.db
      .prepare("UPDATE paper_attempts SET manifest=? WHERE id=?")
      .run(JSON.stringify({ ...a.manifest, evaluate: true }), a.id);
  }
  return f.service.paper.attempt(a.id);
}

function tutor(
  f,
  {
    handoffId = crypto.randomUUID(),
    createdAt = new Date().toISOString(),
    target = "clipboard",
    legacy = false,
  } = {},
) {
  const m = {
    version: 1,
    id: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    mode: "tutor",
    questionId: null,
    handoffId,
    createdAt,
    evaluate: false,
    drawing: null,
    ...(legacy ? {} : { target }),
    pages: [
      {
        index: 0,
        hash: contract.digest(PNG),
        mime: "image/png",
        name: "Synthetic tutor.png",
        width: 1,
        height: 1,
      },
    ],
  };
  f.service.paper.prepare("synthetic-ipad", m);
  f.service.paper.stage("synthetic-ipad", m.id, m.pages[0].hash, PNG);
  f.service.paper.commit("synthetic-ipad", m.id);
  return f.service.paper.attempt(m.id);
}

test("generic Tutor Pad start preserves Study and needs no native permission checks", async (t) => {
  const f = setup(t);
  assert.deepEqual(await f.service.tutorStatus(), {
    enabled: false,
    receiving: false,
    manualReady: false,
    target: "clipboard",
    lastState: "idle",
  });
  await assert.rejects(f.service.tutorStart(), /Enable Recall Pad/);
  f.service.bridge.server = {};
  f.service.bridge.session = {
    mode: "study",
    handoffId: crypto.randomUUID(),
    questions: [],
  };
  const before = structuredClone(f.service.bridge.session);
  f.store.set("pad:pasteEnabled", true);
  f.store.set("pad:tutorTarget", "codex");
  const status = await f.service.tutorStart();
  assert.equal(status.manualReady, true);
  assert.equal(status.target, "clipboard");
  assert.equal(status.lastState, "receiving");
  const handoffId = f.service.bridge.tutorSession.handoffId;
  await f.service.tutorStart();
  assert.equal(f.service.bridge.tutorSession.handoffId, handoffId);
  assert.deepEqual(f.service.bridge.session, before);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.copies, []);
});

test("fresh, deferred, sleeping and historical Tutor arrivals only save work with no clipboard or evaluation side effects", async (t) => {
  let evaluations = 0;
  const f = setup(t, {
    fetchImpl: async () => {
      evaluations++;
      return success();
    },
  });
  f.store.set("pad:pasteEnabled", true);
  f.store.set("pad:assessmentConsent", true);
  const beforeCards = f.store.db
    .prepare("SELECT * FROM cards ORDER BY id")
    .all();
  for (const options of [
    {},
    { target: "codex" },
    { target: "chatgpt" },
    { legacy: true },
  ]) {
    const a = tutor(f, options);
    const beforeManifest = f.store.db
      .prepare("SELECT manifest,manifest_hash FROM paper_attempts WHERE id=?")
      .get(a.id);
    await f.service.received({ ...a, deliveryFresh: true });
    await f.service.suspend();
    await f.service.received({ ...a, deliveryFresh: false });
    assert.equal(f.service.paper.attempt(a.id).status, "received");
    assert.equal(f.service.paper.receipt(a.deviceId, a.id).state, "received");
    assert.equal(f.service.paper.pages(a.id).length, 1);
    assert.deepEqual(
      f.store.db
        .prepare("SELECT manifest,manifest_hash FROM paper_attempts WHERE id=?")
        .get(a.id),
      beforeManifest,
    );
  }
  assert.deepEqual(f.copies, []);
  assert.deepEqual(f.calls, []);
  assert.equal(evaluations, 0);
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    beforeCards,
  );
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM reviews").get().n, 0);
});

test("Copy page is the sole clipboard action and does not invent a chat delivery receipt", async (t) => {
  const f = setup(t),
    first = tutor(f),
    second = tutor(f, { target: "codex" });
  await f.service.received(first);
  await f.service.received(second);
  assert.deepEqual(f.copies, []);
  assert.deepEqual(
    await f.service.copyPage({ attemptId: second.id, index: 0 }),
    { state: "copied", copiedPage: 0 },
  );
  assert.deepEqual(f.copies, [PNG]);
  assert.equal(
    f.service.paper.receipt(second.deviceId, second.id).state,
    "received",
  );
  await assert.rejects(
    f.service.copyPage({ attemptId: first.id, index: 9 }),
    /Page not found/,
  );
  await assert.rejects(
    f.service.copyPage({ attemptId: study(f).id, index: 0 }),
    /Choose a Tutor Pad/,
  );
  assert.equal(f.copies.length, 1);
});

test("removed draft APIs cannot be revived by stale settings and closing loses no received work", async (t) => {
  const f = setup(t),
    a = tutor(f);
  for (const method of ["tutorConfigure", "tutorArm", "resume", "deliver"])
    assert.equal(f.service[method], undefined);
  for (const input of [
    { pasteEnabled: true },
    { pasteEnabled: false },
    { target: "codex" },
  ])
    await assert.rejects(f.service.configure(input), /no longer supported/);
  await f.service.close();
  await f.service.received(a);
  await assert.rejects(
    f.service.copyPage({ attemptId: a.id, index: 0 }),
    /closing/,
  );
  await assert.rejects(f.service.tutorStart(), /closing/);
  assert.equal(f.service.paper.attempt(a.id).status, "received");
  assert.deepEqual(f.copies, []);
});

test("explicit iPad assessments serialize and do not change review schedules", async (t) => {
  const releases = [],
    providerCalls = [];
  const f = setup(t, {
      fetchImpl: async (url, options) => {
        providerCalls.push({ url, options });
        return new Promise((resolve) =>
          releases.push(() => resolve(success())),
        );
      },
    }),
    first = study(f),
    second = study(f);
  f.store.set("pad:assessmentConsent", true);
  const before = f.store.db.prepare("SELECT * FROM cards ORDER BY id").all();
  await f.service.received(first);
  await f.service.received(second);
  assert.equal(providerCalls.length, 1);
  assert.equal(f.service.paper.attempt(second.id).status, "queued");
  releases.shift()();
  await settle(() => providerCalls.length === 2);
  releases.shift()();
  await settle(() => !f.service.assessment.active && !f.service.draining);
  assert.equal(f.service.paper.attempt(first.id).status, "feedback_ready");
  assert.equal(f.service.paper.attempt(second.id).status, "feedback_ready");
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before,
  );
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM reviews").get().n, 0);
});

test("iPad work arriving during a manual assessment waits rather than losing its queued job", async (t) => {
  const releases = [],
    providerCalls = [];
  const f = setup(t, {
      fetchImpl: async (url, options) => {
        providerCalls.push({ url, options });
        return new Promise((resolve) =>
          releases.push(() => resolve(success())),
        );
      },
    }),
    first = study(f),
    second = study(f);
  f.store.set("pad:assessmentConsent", true);
  const manual = f.service.evaluate({ attemptId: first.id });
  await f.service.received(second);
  assert.equal(providerCalls.length, 1);
  releases.shift()();
  await manual;
  await settle(() => providerCalls.length === 2);
  releases.shift()();
  await settle(() => !f.service.assessment.active && !f.service.draining);
  assert.equal(f.service.paper.attempt(second.id).status, "feedback_ready");
});

test("cancel preserves active and queued work and requires deliberate retry", async (t) => {
  const providerCalls = [];
  const f = setup(t, {
      fetchImpl: async (url, { signal }) => {
        providerCalls.push(url);
        return new Promise((resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(Error("Synthetic abort")),
            { once: true },
          ),
        );
      },
    }),
    first = study(f),
    second = study(f);
  f.store.set("pad:assessmentConsent", true);
  await f.service.received(first);
  await f.service.received(second);
  f.service.cancel();
  await settle(() => !f.service.assessment.active && !f.service.draining);
  assert.equal(providerCalls.length, 1);
  assert.equal(f.service.paper.attempt(first.id).status, "interrupted");
  assert.equal(f.service.paper.attempt(second.id).status, "received");
  assert.equal(f.service.paper.pages(first.id).length, 1);
  assert.equal(f.service.paper.pages(second.id).length, 1);
  assert.deepEqual(f.service.jobs, []);
});

test("receipt ingestion and restored operations cannot grant assessment consent", async (t) => {
  const requests = [];
  const f = setup(t, {
    fetchImpl: async (url) => {
      requests.push(url);
      return success();
    },
  });
  await f.service.received(study(f));
  assert.equal(requests.length, 0);
  f.store.set("pad:assessmentConsent", true);
  f.store.set("pad:restoreNeedsResubmission", true);
  await f.service.received(study(f));
  assert.equal(requests.length, 0);
  assert.equal(
    f.calls.filter(([command]) => command === "accessibility").length,
    0,
  );
  assert.equal(f.service.tutorConfigure, undefined);
});

test("assistant paper tools save prompts while receiver is off and return only explicitly requested own images", async (t) => {
  const f = setup(t),
    s = await f.service.paperSessionCall("start", { title: "Tutoring" }),
    auth = { sessionId: s.sessionId, capability: s.capability },
    p = await f.service.paperSessionCall("publish", {
      ...auth,
      prompt: "Write notes about linear transformations.",
      kind: "note",
    });
  assert.equal(s.receiverReady, false);
  assert.equal(p.displayed, false);
  const m = {
    version: 2,
    id: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    mode: "tutor",
    target: "assistant",
    questionId: p.problem.id,
    handoffId: s.sessionId,
    createdAt: new Date().toISOString(),
    evaluate: false,
    drawing: null,
    pages: [
      {
        index: 0,
        hash: contract.digest(PNG),
        mime: "image/png",
        name: "Notes.png",
        width: 1,
        height: 1,
      },
    ],
  };
  f.service.bridge.forDevice({ id: "synthetic-ipad" }, p.session);
  f.service.paper.prepare("synthetic-ipad", m);
  f.service.paper.stage("synthetic-ipad", m.id, m.pages[0].hash, PNG);
  const pending = f.service.paperSessionCall("wait", {
    ...auth,
    timeoutMs: 1000,
  });
  f.service.paper.commit("synthetic-ipad", m.id);
  await f.service.received(f.service.paper.attempt(m.id));
  assert.equal((await pending).submissions[0].submissionId, m.id);
  const read = await f.service.paperSessionCall("read", {
    ...auth,
    submissionId: m.id,
  });
  assert.deepEqual(Buffer.from(read.pages[0].data, "base64"), PNG);
  assert.equal(read.receiverReady, false);
  assert.deepEqual(f.copies, []);
  assert.deepEqual(f.calls, []);
  assert.equal(f.service.paper.attempt(m.id).feedback, null);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM reviews").get().n, 0);
});
