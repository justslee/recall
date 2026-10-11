const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  https = require("node:https"),
  { WebSocket } = require("ws");
const { Store } = require("../electron/store.cjs"),
  { PaperStore } = require("../electron/paper-store.cjs"),
  { PaperSessions } = require("../electron/paper-sessions.cjs"),
  { PadBridge, privateAddress } = require("../electron/pad-bridge.cjs"),
  contract = require("../shared/handwriting-contract.cjs");
const cards = require("../examples/demo.json").cards,
  PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
    "base64",
  );

async function setup(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-pad-bridge-")),
    store = new Store(folder),
    helperCalls = [],
    received = [],
    helper = {
      advertise: async (args) => helperCalls.push(["advertise", args]),
      stopAdvertising: async () => helperCalls.push(["stopAdvertising"]),
      status: async () => ({ available: false, advertising: false }),
    };
  let now = Date.now();
  store.import(cards);
  store.set("synthetic-private-reference", "DO-NOT-EXPORT-DEVICE-SECRET");
  const paper = new PaperStore(store),
    bridge = new PadBridge({
      store,
      paper,
      helper,
      host: "127.0.0.1",
      now: () => now,
      received: async (attempt) => received.push(attempt.id),
    });
  t.after(async () => {
    await bridge.stop();
    store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  await bridge.start();
  return {
    folder,
    store,
    paper,
    helperCalls,
    bridge,
    received,
    advance: (ms) => {
      now += ms;
    },
  };
}

function request(
  f,
  route,
  {
    method = "GET",
    body,
    token,
    headers = {},
    ca = f.bridge.identity.cert,
  } = {},
) {
  const bytes =
    body === undefined
      ? null
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      new URL(route, `https://127.0.0.1:${f.bridge.server.address().port}`),
      {
        method,
        ca,
        rejectUnauthorized: true,
        agent: false,
        timeout: 3000,
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(bytes
            ? {
                "Content-Type": Buffer.isBuffer(body)
                  ? "application/octet-stream"
                  : "application/json",
                "Content-Length": bytes.length,
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode,
              value: JSON.parse(Buffer.concat(chunks).toString()),
              headers: response.headers,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.once("error", reject);
    req.once("timeout", () =>
      req.destroy(Error("Synthetic local request timed out")),
    );
    if (bytes) req.write(bytes);
    req.end();
  });
}

async function pendingPair(f, deviceId = crypto.randomUUID()) {
  const code = await f.bridge.pairing(),
    input = {
      version: 1,
      bootstrapSecret: code.payload.bootstrapSecret,
      deviceId,
      deviceName: "Synthetic iPad",
    },
    result = await request(f, "/v1/pair/request", {
      method: "POST",
      body: input,
    });
  assert.equal(result.status, 202);
  return { code, input, id: result.value.requestId, deviceId };
}

async function pair(f) {
  const pending = await pendingPair(f);
  f.bridge.confirm({ id: pending.id, allow: true });
  const approved = await request(f, `/v1/pair/requests/${pending.id}`, {
    headers: { "X-Pair-Secret": pending.code.payload.bootstrapSecret },
  });
  assert.equal(approved.value.state, "approved");
  const token = approved.value.credential;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const ack = await request(f, `/v1/pair/requests/${pending.id}/ack`, {
    method: "POST",
    token,
  });
  assert.equal(ack.value.acknowledged, true);
  return { ...pending, token };
}

function openSocket(f, token, headers) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `wss://127.0.0.1:${f.bridge.server.address().port}/v1/events`,
      {
        ca: f.bridge.identity.cert,
        rejectUnauthorized: true,
        handshakeTimeout: 3000,
        headers: { Authorization: "Bearer " + token, ...headers },
      },
    );
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Expected synthetic local event")),
      2000,
    );
    socket.once("message", (bytes) => {
      clearTimeout(timer);
      resolve(JSON.parse(bytes.toString()));
    });
  });
}

function manifest(front, session, overrides = {}) {
  return {
    version: 1,
    id: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    mode: "study",
    questionId: front?.id ?? null,
    handoffId: session.handoffId,
    createdAt: new Date().toISOString(),
    evaluate: false,
    drawing: null,
    pages: [
      {
        index: 0,
        hash: contract.digest(PNG),
        mime: "image/png",
        name: "Synthetic reasoning.png",
        width: 1,
        height: 1,
      },
    ],
    ...overrides,
  };
}

async function submit(f, device, m) {
  const options = { method: "POST", token: device.token };
  const prepared = await request(f, `/v1/attempts/${m.id}/manifest`, {
    ...options,
    body: m,
  });
  assert.equal(prepared.status, 200);
  for (const hash of prepared.value.missing) {
    const asset = await request(f, `/v1/attempts/${m.id}/assets/${hash}`, {
      method: "PUT",
      token: device.token,
      body: PNG,
    });
    assert.equal(asset.status, 200);
  }
  const commit = await request(f, `/v1/attempts/${m.id}/commit`, options);
  assert.equal(commit.status, 200);
  return commit.value;
}

test("large issued-question histories migrate to SQLite and keep pairing identity readable across restarts", async (t) => {
  const f = await setup(t);
  const paired = await pair(f);
  const questionIds = Array.from({ length: 200 }, () => crypto.randomUUID());
  const legacy = Array.from({ length: 320 }, () => ({
    id: crypto.randomUUID(),
    mode: "study",
    questions: questionIds,
  }));
  f.bridge.identity.data.devices[0].grants = legacy;
  f.bridge.saveIdentity();
  assert(fs.statSync(f.bridge.identity.file).size > 2_000_000);
  const pin = f.bridge.identity.spkiSha256;
  await f.bridge.stop();
  await f.bridge.start();
  assert.equal(f.bridge.identity.spkiSha256, pin);
  assert(fs.statSync(f.bridge.identity.file).size < 10_000);
  assert(
    !fs.readFileSync(f.bridge.identity.file, "utf8").includes(questionIds[0]),
  );
  assert.deepEqual(
    f.bridge.grant(paired.deviceId, legacy[0].id).questions,
    questionIds,
  );
  assert.equal(
    f.paper.db
      .prepare("SELECT count(*) n FROM paper_device_grants WHERE device_id=?")
      .get(paired.deviceId).n,
    320,
  );
  assert.equal(
    (await request(f, "/v1/session", { token: paired.token })).status,
    200,
  );
  f.bridge.revoke(paired.deviceId);
  assert.equal(
    f.paper.db.prepare("SELECT count(*) n FROM paper_device_grants").get().n,
    0,
  );
  assert.equal(
    (await request(f, "/v1/session", { token: paired.token })).status,
    401,
  );
});

test("local bridge pairing requires Mac approval, consumes QR once, keeps only credential hashes and survives restart", async (t) => {
  const f = await setup(t),
    pending = await pendingPair(f);
  assert.equal((await request(f, "/v1/session")).status, 401);
  const waiting = await request(f, `/v1/pair/requests/${pending.id}`, {
    headers: { "X-Pair-Secret": pending.code.payload.bootstrapSecret },
  });
  assert.deepEqual(waiting.value, { state: "pending" });
  assert.equal(
    (
      await request(f, "/v1/pair/request", {
        method: "POST",
        body: pending.input,
      })
    ).status,
    401,
  );
  f.bridge.confirm({ id: pending.id, allow: true });
  const approval = await request(f, `/v1/pair/requests/${pending.id}`, {
    headers: { "X-Pair-Secret": pending.code.payload.bootstrapSecret },
  });
  const token = approval.value.credential;
  const saved = fs.readFileSync(f.bridge.identity.file, "utf8");
  assert(!saved.includes(token));
  assert(!saved.includes(pending.code.payload.bootstrapSecret));
  assert.equal(JSON.parse(saved).devices[0].hash, contract.digest(token));
  assert.equal(fs.statSync(f.bridge.identity.file).mode & 0o777, 0o600);
  const before = f.bridge.identity.spkiSha256;
  await f.bridge.stop();
  await f.bridge.start();
  assert.equal(f.bridge.identity.spkiSha256, before);
  assert.equal((await request(f, "/v1/session", { token })).status, 200);
});

test("expiry, origin, unauthorized clients, unsupported routes and wrong TLS trust fail closed", async (t) => {
  const f = await setup(t),
    code = await f.bridge.pairing();
  f.advance(300001);
  const expired = await request(f, "/v1/pair/request", {
    method: "POST",
    body: {
      version: 1,
      deviceId: crypto.randomUUID(),
      deviceName: "Expired",
      bootstrapSecret: code.payload.bootstrapSecret,
    },
  });
  assert.equal(expired.status, 401);
  const device = await pair(f);
  assert.equal(
    (
      await request(f, "/v1/session", {
        token: device.token,
        headers: { Origin: "https://untrusted.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(f, "/v1/session", { token: "a".repeat(43) })).status,
    401,
  );
  assert.equal(
    (await request(f, "/v1/library", { token: device.token })).status,
    404,
  );
  assert.equal(
    (await request(f, "/v1/session?export=1", { token: device.token })).status,
    400,
  );
  await assert.rejects(
    request(f, "/v1/session", { token: device.token, ca: [] }),
    /certificate|self.signed/i,
  );
  await assert.rejects(
    openSocket(f, device.token, { Origin: "https://untrusted.invalid" }),
  );
  assert.equal(privateAddress("8.8.8.8"), false);
  assert.equal(privateAddress("192.168.1.2"), true);
  assert.equal(privateAddress("::ffff:10.0.0.2"), true);
});

test("front-only study packages and owned submissions preserve references, cards, schedules and durable idempotent receipts", async (t) => {
  const f = await setup(t),
    first = await pair(f),
    second = await pair(f),
    before = f.store.db.prepare("SELECT * FROM cards ORDER BY id").all();
  await f.bridge.startStudy({
    cardId: cards[0].id,
    cardIds: cards.map((card) => card.id),
  });
  const response = await request(f, "/v1/session", { token: first.token }),
    session = response.value;
  assert.equal(response.status, 200);
  assert(
    session.questions.every((question) =>
      ["math", "concept"].includes(question.kind),
    ),
  );
  assert(!JSON.stringify(session).includes(cards[0].answer));
  assert(!JSON.stringify(session).includes("DO-NOT-EXPORT"));
  assert(!JSON.stringify(session).includes("schedule"));
  const front = session.questions.find(
      (question) => question.cardId === cards[0].id,
    ),
    m = manifest(front, session);
  const notIssued = await request(f, `/v1/attempts/${m.id}/manifest`, {
    method: "POST",
    token: second.token,
    body: m,
  });
  assert.equal(notIssued.status, 403);
  const receipt = await submit(f, first, m);
  assert.equal(receipt.state, "received");
  assert.equal(
    f.paper.pages(m.id)[0].bytes.toString("hex"),
    PNG.toString("hex"),
  );
  const repeated = await request(f, `/v1/attempts/${m.id}/commit`, {
    method: "POST",
    token: first.token,
  });
  assert.deepEqual(repeated.value, receipt);
  assert.deepEqual(f.received, [m.id]);
  assert.equal(
    f.store.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
    1,
  );
  const other = await request(f, `/v1/attempts/${m.id}`, {
    token: second.token,
  });
  assert(!other.value.receivedAt);
  assert(!JSON.stringify(other.value).includes("feedback"));
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before,
  );
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM reviews").get().n, 0);
  const conflict = await request(f, `/v1/attempts/${m.id}/manifest`, {
    method: "POST",
    token: first.token,
    body: { ...m, revision: 2 },
  });
  assert.equal(conflict.status, 409);
});

test("device revocation immediately ends its socket and rejects credential reuse", async (t) => {
  const f = await setup(t),
    device = await pair(f),
    socket = await openSocket(f, device.token);
  t.after(() => socket.terminate());
  const closed = new Promise((resolve) => socket.once("close", resolve));
  f.bridge.revoke(device.deviceId);
  await closed;
  assert.equal(
    (await request(f, "/v1/session", { token: device.token })).status,
    401,
  );
  assert(
    !f.bridge.identity.data.devices.some(
      (entry) => entry.id === device.deviceId,
    ),
  );
});

test("two staged documents cannot acquire the same document identity across devices", async (t) => {
  const f = await setup(t),
    first = await pair(f),
    second = await pair(f);
  await f.bridge.startStudy({ cardId: cards[0].id });
  const session = (await request(f, "/v1/session", { token: first.token }))
    .value;
  await request(f, "/v1/session", { token: second.token });
  const a = manifest(session.questions[0], session),
    b = manifest(session.questions[0], session, { documentId: a.documentId });
  for (const [device, m] of [
    [first, a],
    [second, b],
  ]) {
    assert.equal(
      (
        await request(f, `/v1/attempts/${m.id}/manifest`, {
          method: "POST",
          token: device.token,
          body: m,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(f, `/v1/attempts/${m.id}/assets/${m.pages[0].hash}`, {
          method: "PUT",
          token: device.token,
          body: PNG,
        })
      ).status,
      200,
    );
  }
  assert.equal(
    (
      await request(f, `/v1/attempts/${a.id}/commit`, {
        method: "POST",
        token: first.token,
      })
    ).status,
    200,
  );
  const rejected = await request(f, `/v1/attempts/${b.id}/commit`, {
    method: "POST",
    token: second.token,
  });
  assert(rejected.status >= 400);
  assert.equal(
    f.store.db
      .prepare("SELECT count(*) n FROM paper_attempts WHERE document_id=?")
      .get(a.documentId).n,
    1,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT device_id FROM paper_documents WHERE id=?")
      .get(a.documentId).device_id,
    first.deviceId,
  );
});

test("duplicate pending pairings cannot create duplicate device identities", async (t) => {
  const f = await setup(t),
    deviceId = crypto.randomUUID(),
    first = await pendingPair(f, deviceId),
    secondCode = await f.bridge.pairing();
  const second = await request(f, "/v1/pair/request", {
    method: "POST",
    body: {
      version: 1,
      deviceId,
      deviceName: "Duplicate synthetic iPad",
      bootstrapSecret: secondCode.payload.bootstrapSecret,
    },
  });
  f.bridge.confirm({ id: first.id, allow: true });
  if (second.status === 202)
    assert.throws(
      () => f.bridge.confirm({ id: second.value.requestId, allow: true }),
      /already paired|already registered|different pairing|device/i,
    );
  else assert(second.status >= 400);
  assert.equal(
    f.bridge.identity.data.devices.filter((entry) => entry.id === deviceId)
      .length,
    1,
  );
});

test("receipt events stay with their owner, and internal failures do not expose private paths", async (t) => {
  const f = await setup(t),
    owner = await pair(f),
    other = await pair(f);
  await f.bridge.startStudy({ cardId: cards[0].id });
  const session = (await request(f, "/v1/session", { token: owner.token }))
      .value,
    m = manifest(session.questions[0], session),
    ownerSocket = await openSocket(f, owner.token),
    otherSocket = await openSocket(f, other.token),
    ownerEvents = [],
    otherEvents = [];
  t.after(() => {
    ownerSocket.terminate();
    otherSocket.terminate();
  });
  ownerSocket.on("message", (bytes) => ownerEvents.push(JSON.parse(bytes)));
  otherSocket.on("message", (bytes) => otherEvents.push(JSON.parse(bytes)));
  await submit(f, owner, m);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert(
    ownerEvents.some(
      (event) => event.type === "receipt" && event.receipt.id === m.id,
    ),
  );
  assert(
    !otherEvents.some(
      (event) => event.type === "receipt" && event.receipt.id === m.id,
    ),
  );
  const original = f.paper.receipt;
  f.paper.receipt = () => {
    throw Error(
      "EACCES: private path /synthetic/private-profile/openai.key secret-value",
    );
  };
  try {
    const failed = await request(f, `/v1/attempts/${m.id}`, {
      token: owner.token,
    });
    assert(failed.status >= 400);
    assert(!JSON.stringify(failed.value).includes("private-profile"));
    assert(!JSON.stringify(failed.value).includes("secret-value"));
  } finally {
    f.paper.receipt = original;
  }
});

test("Tutor Pad saves generic page receipts and permanently rejects old arm requests", async (t) => {
  const f = await setup(t),
    device = await pair(f);
  const started = await request(f, "/v1/tutor/start", {
    method: "POST",
    token: device.token,
    body: { target: "clipboard" },
  });
  assert.equal(started.status, 200);
  assert.equal(started.value.target, "clipboard");
  const before = f.helperCalls.length;
  for (const pasteEnabled of [false, true]) {
    f.store.set("pad:pasteEnabled", pasteEnabled);
    assert.equal(
      (
        await request(f, "/v1/tutor/arm", {
          method: "POST",
          token: device.token,
        })
      ).status,
      410,
    );
  }
  assert.equal(f.helperCalls.length, before);
  const m = manifest(null, started.value, {
    mode: "tutor",
    questionId: null,
    evaluate: false,
    target: "clipboard",
  });
  await submit(f, device, m);
  assert.equal(f.paper.attempt(m.id).status, "received");
  await request(f, `/v1/attempts/${m.id}/commit`, {
    method: "POST",
    token: device.token,
  });
  assert.deepEqual(f.received, [m.id]);
  assert.equal(f.helperCalls.length, before);
  const ended = await request(f, "/v1/tutor/end", {
    method: "POST",
    token: device.token,
  });
  assert.equal(ended.value.ended, true);
  assert.equal(f.bridge.session.mode, "idle");
});

test("study and generic tutor sessions stay independent and issue separate grants", async (t) => {
  const f = await setup(t),
    device = await pair(f);
  await f.bridge.startStudy({
    cardId: cards[0].id,
    sessionId: "synthetic-study",
  });
  const beforeStudy = structuredClone(f.bridge.session);
  const started = await request(f, "/v1/tutor/start", {
    method: "POST",
    token: device.token,
    body: { target: "codex" },
  });
  assert.equal(started.status, 200);
  assert.equal(started.value.target, "clipboard");
  assert.equal(started.value.questions.length, 0);
  assert.deepEqual(f.bridge.session, beforeStudy);
  const repeated = await request(f, "/v1/tutor/start", {
    method: "POST",
    token: device.token,
    body: { target: "codex" },
  });
  assert.equal(repeated.value.handoffId, started.value.handoffId);
  const study = await request(f, "/v1/session/study", { token: device.token });
  const tutor = await request(f, "/v1/session/tutor", { token: device.token });
  assert.equal(study.value.mode, "study");
  assert.deepEqual(tutor.value, started.value);
  assert.equal(
    f.bridge.grant(device.deviceId, study.value.handoffId).mode,
    "study",
  );
  assert.equal(
    f.bridge.grant(device.deviceId, tutor.value.handoffId).mode,
    "tutor",
  );
  const disarms = f.helperCalls.filter(([name]) => name === "disarm").length;
  await f.bridge.followStudy({
    cardId: cards[1].id,
    sessionId: "synthetic-study",
  });
  assert.equal(
    f.helperCalls.filter(([name]) => name === "disarm").length,
    disarms,
  );
  assert.deepEqual(f.bridge.tutorSession, started.value);
  const movedStudy = structuredClone(f.bridge.session);
  await request(f, "/v1/tutor/end", { method: "POST", token: device.token });
  assert.deepEqual(f.bridge.session, movedStudy);
  assert.equal(f.bridge.tutorSession.mode, "idle");
  assert.equal(
    f.bridge.grant(device.deviceId, started.value.handoffId).offline,
    true,
  );
});

test("the pending study queue advances without recycling completed fronts and keeps earlier offline submissions valid", async (t) => {
  const f = await setup(t),
    device = await pair(f),
    added = Array.from({ length: 4 }, (_, index) => ({
      ...structuredClone(cards[0]),
      id: "synthetic:desk:" + index,
      conceptId: "synthetic:desk:" + index,
      title: "Synthetic desk question " + index,
    }));
  f.store.import(added);
  const ordered = [cards[0], cards[2], cards[1], ...added],
    ids = ordered.map((card) => card.id);
  f.bridge.startStudy({
    cardId: ids[0],
    sessionId: "synthetic-desk",
    cardIds: ids,
  });
  const initial = (
      await request(f, "/v1/session/study", { token: device.token })
    ).value,
    byId = new Map(
      initial.questions.map((question) => [question.id, question]),
    ),
    pendingCards = (session) =>
      session.pendingQuestionIds.map((id) => byId.get(id).cardId);
  assert.deepEqual(
    pendingCards(initial),
    ordered.filter((card) => card.kind !== "code").map((card) => card.id),
  );
  assert.equal(initial.pendingQuestionIds[0], initial.currentQuestionId);
  const earlyAttempt = manifest(initial.questions[0], initial);
  const before = f.store.db.prepare("SELECT * FROM cards ORDER BY id").all();

  f.bridge.followStudy({
    cardId: ids[1],
    sessionId: "synthetic-desk",
    cardIds: ids.slice(1),
  });
  const duringCode = (
    await request(f, "/v1/session/study", {
      token: device.token,
    })
  ).value;
  assert.equal(duringCode.currentQuestionId, null);
  assert.deepEqual(pendingCards(duringCode), [
    cards[1].id,
    ...added.map((c) => c.id),
  ]);
  assert(!duringCode.pendingQuestionIds.includes(initial.currentQuestionId));
  assert(duringCode.questions.some((q) => q.id === initial.currentQuestionId));

  for (let index = 2; index < ids.length; index++) {
    f.bridge.followStudy({
      cardId: ids[index],
      sessionId: "synthetic-desk",
      cardIds: ids.slice(index),
    });
    const moved = (
      await request(f, "/v1/session/study", {
        token: device.token,
      })
    ).value;
    assert.deepEqual(pendingCards(moved), ids.slice(index));
    assert.equal(moved.pendingQuestionIds[0], moved.currentQuestionId);
  }
  assert.equal(f.bridge.session.pendingQuestionIds.length, 1);
  assert.equal(f.bridge.session.questions.length, initial.questions.length);

  f.bridge.followStudy({
    cardId: null,
    sessionId: "synthetic-desk",
    cardIds: [],
  });
  const ended = (await request(f, "/v1/session/study", { token: device.token }))
    .value;
  assert.equal(ended.mode, "idle");
  assert.deepEqual(ended.questions, []);
  assert(
    f.bridge
      .grant(device.deviceId, initial.handoffId)
      .questions.includes(initial.currentQuestionId),
  );
  assert.equal((await submit(f, device, earlyAttempt)).state, "received");
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before,
  );
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM reviews").get().n, 0);
});

test("following a new Mac session that starts with coding replaces the old desk without issuing a coding front", async (t) => {
  const f = await setup(t),
    device = await pair(f);
  f.bridge.startStudy({ cardId: cards[0].id, sessionId: "first-study" });
  const first = (await request(f, "/v1/session/study", { token: device.token }))
    .value;
  const earlyAttempt = manifest(first.questions[0], first);
  f.bridge.followStudy({
    cardId: cards[2].id,
    sessionId: "second-study",
    cardIds: [cards[2].id, cards[1].id],
  });
  const second = (
    await request(f, "/v1/session/study", { token: device.token })
  ).value;
  assert.notEqual(second.handoffId, first.handoffId);
  assert.equal(second.currentQuestionId, null);
  assert.deepEqual(
    second.questions.map((q) => q.cardId),
    [cards[1].id],
  );
  assert.deepEqual(
    second.pendingQuestionIds,
    second.questions.map((q) => q.id),
  );
  assert.equal((await submit(f, device, earlyAttempt)).state, "received");
  assert.throws(
    () => f.bridge.startStudy({ cardId: cards[2].id }),
    /concept and math/,
  );
});

test("immutable tutor targets are validated and legacy submission hashes remain unchanged", async (t) => {
  const f = await setup(t),
    device = await pair(f);
  const session = await f.bridge.startTutor("codex");
  f.bridge.forDevice(f.bridge.identity.data.devices[0], session);
  const legacy = manifest(null, session, {
    mode: "tutor",
    questionId: null,
    evaluate: false,
  });
  assert.equal(Object.hasOwn(contract.manifest(legacy), "target"), false);
  const priorHash = contract.digest(JSON.stringify(contract.manifest(legacy)));
  await submit(f, device, legacy);
  assert.equal(f.paper.attempt(legacy.id).manifest.target, undefined);
  assert.equal(
    f.paper.db
      .prepare("SELECT manifest_hash FROM paper_attempts WHERE id=?")
      .get(legacy.id).manifest_hash,
    priorHash,
  );
  assert.equal(
    (
      await request(f, `/v1/attempts/${legacy.id}/manifest`, {
        method: "POST",
        token: device.token,
        body: legacy,
      })
    ).status,
    200,
  );
  const m = manifest(null, session, {
    mode: "tutor",
    questionId: null,
    evaluate: false,
    target: "codex",
  });
  await submit(f, device, m);
  assert.equal(f.paper.attempt(m.id).destination, "codex");
  assert.equal(
    (
      await request(f, `/v1/attempts/${m.id}/manifest`, {
        method: "POST",
        token: device.token,
        body: { ...m, target: "chatgpt" },
      })
    ).status,
    409,
  );
  assert.throws(
    () => contract.manifest({ ...m, target: "terminal" }),
    /Invalid Tutor Pad/,
  );
  assert.throws(
    () =>
      contract.manifest({
        ...m,
        mode: "study",
        questionId: crypto.randomUUID(),
      }),
    /Invalid Tutor Pad/,
  );
  assert.throws(
    () => contract.manifest({ ...m, target: null }),
    /Invalid Tutor Pad/,
  );
});

test("legacy clients may start the generic receiver but cannot restore draft controls", async (t) => {
  const f = await setup(t),
    device = await pair(f);
  f.store.set("pad:pasteEnabled", true);
  const helperCalls = f.helperCalls.length;
  let handoffId;
  for (const target of ["clipboard", "codex", "chatgpt"]) {
    const started = await request(f, "/v1/tutor/start", {
      method: "POST",
      token: device.token,
      body: { target },
    });
    assert.equal(started.status, 200);
    assert.equal(started.value.target, "clipboard");
    if (handoffId) assert.equal(started.value.handoffId, handoffId);
    handoffId = started.value.handoffId;
    const m = manifest(null, started.value, {
      mode: "tutor",
      target,
      questionId: null,
    });
    await submit(f, device, m);
    assert.equal(f.paper.attempt(m.id).manifest.target, target);
    const arm = await request(f, "/v1/tutor/arm", {
      method: "POST",
      token: device.token,
      body: { target },
    });
    assert.equal(arm.status, 410);
  }
  const invalid = await request(f, "/v1/tutor/start", {
    method: "POST",
    token: device.token,
    body: { target: "terminal" },
  });
  assert.equal(invalid.status, 400);
  assert.equal(f.helperCalls.length, helperCalls);
});

test("offline clipboard submissions using a legacy tutor grant preserve hashes without changing the live session", async (t) => {
  const f = await setup(t),
    device = await pair(f);
  const legacySession = {
    version: 1,
    installationId: f.bridge.identity.data.installationId,
    mode: "tutor",
    handoffId: crypto.randomUUID(),
    currentQuestionId: null,
    questions: [],
    target: "codex",
  };
  f.bridge.tutorSession = legacySession;
  f.bridge.forDevice(f.bridge.identity.data.devices[0], legacySession);
  f.bridge.invalidateTutor(device.deviceId);
  const m = manifest(null, legacySession, {
    mode: "tutor",
    target: "clipboard",
    questionId: null,
  });
  const expectedHash = contract.digest(JSON.stringify(contract.manifest(m)));
  const beforeCalls = f.helperCalls.length;
  await submit(f, device, m);
  assert.equal(f.paper.attempt(m.id).status, "received");
  assert.equal(
    f.paper.db
      .prepare("SELECT manifest_hash FROM paper_attempts WHERE id=?")
      .get(m.id).manifest_hash,
    expectedHash,
  );
  assert.deepEqual(f.bridge.tutorSession, legacySession);
  assert.equal(f.helperCalls.length, beforeCalls);
  await request(f, `/v1/attempts/${m.id}/manifest`, {
    method: "POST",
    token: device.token,
    body: m,
  });
  assert.equal(
    f.paper.db
      .prepare("SELECT manifest_hash FROM paper_attempts WHERE id=?")
      .get(m.id).manifest_hash,
    expectedHash,
  );
});

test("assistant LAN fronts grant only issued prompts and return late work to its original bound session", async (t) => {
  const f = await setup(t),
    device = await pair(f),
    otherDevice = await pair(f),
    sessions = new PaperSessions({
      store: f.store,
      paper: f.paper,
      onChange: (s) => f.bridge.setAssistantSession(s),
    });
  t.after(() => sessions.close());
  f.bridge.assistantSession = () => sessions.activeSession();
  const bound = await sessions.call("start", {
      title: "Linear algebra with Codex",
    }),
    auth = { sessionId: bound.sessionId, capability: bound.capability },
    first = await sessions.call("publish", {
      ...auth,
      title: "Column space",
      prompt: "Write down a vector in the column space of $A$.",
      kind: "problem",
    }),
    m = manifest(first.problem, first.session, {
      version: 2,
      mode: "tutor",
      target: "assistant",
    });
  const unissued = await request(f, `/v1/attempts/${m.id}/manifest`, {
    method: "POST",
    token: otherDevice.token,
    body: m,
  });
  assert.equal(unissued.status, 403);
  assert.equal(f.bridge.grant(otherDevice.deviceId, bound.sessionId), null);
  const front = await request(f, "/v1/session/tutor", { token: device.token });
  assert.equal(front.value.target, "assistant");
  assert.equal(front.value.currentProblemId, first.problem.id);
  assert.deepEqual(front.value.questions, []);
  assert.equal(JSON.stringify(front.value).includes(bound.capability), false);
  assert.equal(
    JSON.stringify(front.value).includes("DO-NOT-EXPORT-DEVICE-SECRET"),
    false,
  );
  const generic = await request(f, "/v1/tutor/start", {
    method: "POST",
    token: device.token,
    body: { target: "clipboard" },
  });
  assert.equal(generic.value.handoffId, bound.sessionId);
  assert.equal(generic.value.target, "assistant");
  const originalStudy = structuredClone(f.bridge.session);
  await sessions.call("publish", {
    ...auth,
    title: "Notes",
    prompt: "Take notes about rank.",
    kind: "note",
  });
  await sessions.call("end", auth);
  await f.bridge.startTutor();
  const accepted = await submit(f, device, m);
  assert.equal(accepted.state, "received");
  assert.equal(
    f.paper.db
      .prepare(
        "SELECT session_id,problem_id FROM paper_tutor_attempt_bindings WHERE attempt_id=?",
      )
      .get(m.id).problem_id,
    first.problem.id,
  );
  assert.deepEqual(f.bridge.session, originalStudy);
  assert.equal(
    (await sessions.call("read", { ...auth, submissionId: m.id })).problem.id,
    first.problem.id,
  );
  assert.equal(
    (await request(f, `/v1/attempts/${m.id}`, { token: device.token })).value
      .state,
    "available_to_tutor",
  );
});
