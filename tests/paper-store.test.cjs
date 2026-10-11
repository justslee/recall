const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Store } = require("../electron/store.cjs");
const { PaperStore } = require("../electron/paper-store.cjs");
const contract = require("../shared/handwriting-contract.cjs");
const backups = require("../electron/backup.cjs");
const cards = require("../examples/demo.json").cards;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
  "base64",
);
function setup(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-paper-store-test-"),
  );
  const folder = path.join(root, "profile");
  const store = new Store(folder);
  store.import(cards);
  const paper = new PaperStore(store);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, folder, store, paper };
}
function submission(
  paper,
  { cardId = cards[0].id, drawing = null, mode = "study" } = {},
) {
  const handoffId = crypto.randomUUID();
  const question =
    mode === "study" ? paper.questions(handoffId, [cardId])[0] : null;
  const manifest = {
    version: 1,
    id: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    mode,
    questionId: question?.id ?? null,
    handoffId,
    createdAt: new Date().toISOString(),
    pages: [
      {
        index: 0,
        hash: contract.digest(PNG),
        mime: "image/png",
        name: "Reasoning.png",
        width: 1,
        height: 1,
      },
    ],
    drawing: drawing
      ? { hash: contract.digest(drawing), bytes: drawing.length }
      : null,
    evaluate: false,
  };
  return { manifest, question };
}
function commit(paper, manifest, device = "ipad-test", drawing) {
  paper.prepare(device, manifest);
  paper.stage(device, manifest.id, contract.digest(PNG), PNG);
  if (drawing)
    paper.stage(device, manifest.id, contract.digest(drawing), drawing);
  return paper.commit(device, manifest.id);
}

test("device receipts distinguish chat delivery outcomes without leaking references or feedback", (t) => {
  const { paper } = setup(t);
  const { manifest } = submission(paper);
  const accepted = commit(paper, manifest);
  for (const state of [
    "received",
    "needs_resume",
    "pasting",
    "pasted_unverified",
    "copied",
    "manual_page_tray",
    "queued",
    "evaluating",
    "feedback_ready",
    "staged_in_chat",
  ]) {
    paper.state(manifest.id, state);
    assert.deepEqual(paper.receipt("ipad-test", manifest.id), {
      id: manifest.id,
      state,
      receivedAt: accepted.receivedAt,
    });
    assert.deepEqual(paper.receipt("other-device", manifest.id), {
      id: manifest.id,
      state: "staging",
    });
  }
  paper.state(manifest.id, "failed");
  assert.equal(
    paper.receipt("ipad-test", manifest.id).state,
    "needs_attention",
  );
});

test("new generic Tutor work is received while historical manifests, hashes and receipts survive restart unchanged", (t) => {
  const { paper, store, folder } = setup(t);
  const records = [];
  for (const target of ["clipboard", "codex", "chatgpt", undefined]) {
    const m = submission(paper, { mode: "tutor" }).manifest;
    if (target !== undefined) m.target = target;
    commit(paper, m);
    assert.equal(paper.attempt(m.id).status, "received");
    if (target !== "clipboard") paper.state(m.id, "needs_resume");
    records.push({
      manifest: m,
      row: paper.db
        .prepare("SELECT * FROM paper_attempts WHERE id=?")
        .get(m.id),
      receipt: paper.receipt("ipad-test", m.id),
    });
  }
  store.close();
  Object.assign(store, new Store(folder));
  const restored = new PaperStore(store);
  for (const record of records) {
    assert.deepEqual(
      restored.db
        .prepare("SELECT * FROM paper_attempts WHERE id=?")
        .get(record.manifest.id),
      record.row,
    );
    assert.deepEqual(
      restored.receipt("ipad-test", record.manifest.id),
      record.receipt,
    );
    assert.equal(
      restored.prepare("ipad-test", record.manifest).state,
      "received",
    );
    assert.deepEqual(
      restored.db
        .prepare("SELECT * FROM paper_attempts WHERE id=?")
        .get(record.manifest.id),
      record.row,
    );
    assert.equal(restored.pages(record.manifest.id).length, 1);
  }
});

test("Tutor history filters before its limit while ordinary and card Study history stay bounded", (t) => {
  const { paper } = setup(t);
  const tutor = submission(paper, { mode: "tutor" }).manifest;
  commit(paper, tutor);
  paper.db
    .prepare("UPDATE paper_attempts SET received_at=? WHERE id=?")
    .run("2026-01-01T00:00:00.000Z", tutor.id);
  for (let index = 0; index < 55; index++) {
    const study = submission(paper).manifest;
    commit(paper, study);
  }
  const ordinary = paper.attempts(null);
  assert.equal(ordinary.length, 50);
  assert.equal(
    ordinary.some((attempt) => attempt.id === tutor.id),
    false,
  );
  const tutorHistory = paper.attempts(null, "tutor");
  assert.equal(tutorHistory.length, 1);
  assert.equal(tutorHistory[0].id, tutor.id);
  assert.equal(tutorHistory[0].mode, "tutor");
  assert.equal(Object.hasOwn(tutorHistory[0], "manifest"), false);
  assert.equal(Object.hasOwn(tutorHistory[0], "deviceId"), false);
  assert.equal(paper.attempts(cards[0].id).length, 50);
  assert.equal(paper.attempts(cards[0].id, "study").length, 50);
  assert.deepEqual(paper.attempts(cards[0].id, "tutor"), []);
  assert.throws(() => paper.attempts(null, "coding"), /Study or Tutor/);
  assert.throws(() => paper.attempts(null, "tutor' OR 1=1"), /Study or Tutor/);
});

test("paper submission acknowledges only complete work, survives restart and deduplicates identical retries", (t) => {
  const { store, paper } = setup(t);
  const drawing = Buffer.from("synthetic opaque PencilKit drawing bytes");
  const { manifest } = submission(paper, { drawing });
  const initial = paper.prepare("ipad-test", manifest);
  assert.equal(initial.state, "staging");
  assert.equal(initial.missing.length, 2);
  paper.stage("ipad-test", manifest.id, manifest.pages[0].hash, PNG);
  assert.throws(() => paper.commit("ipad-test", manifest.id), /missing pages/);
  assert.equal(paper.receipt("ipad-test", manifest.id).state, "staging");
  const resumed = new PaperStore(store);
  assert.deepEqual(resumed.prepare("ipad-test", manifest).missing, [
    manifest.drawing.hash,
  ]);
  resumed.stage("ipad-test", manifest.id, manifest.drawing.hash, drawing);
  const receipt = resumed.commit("ipad-test", manifest.id);
  assert.equal(receipt.state, "received");
  assert.deepEqual(resumed.commit("ipad-test", manifest.id), receipt);
  assert.equal(resumed.prepare("ipad-test", manifest).state, "received");
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
    1,
  );
  assert.deepEqual(
    Buffer.from(
      store.db
        .prepare(
          "SELECT bytes FROM paper_assets WHERE mime='application/x-pencilkit'",
        )
        .get().bytes,
    ),
    drawing,
  );
  assert.deepEqual(resumed.pages(manifest.id)[0].bytes, PNG);
  assert.equal(fs.existsSync(path.join(paper.stageFolder, manifest.id)), false);
});

test("submission identity conflicts, device ownership and question/document scope are enforced", (t) => {
  const { paper } = setup(t);
  const { manifest } = submission(paper);
  paper.prepare("first-device", manifest);
  assert.throws(
    () =>
      paper.stage("second-device", manifest.id, manifest.pages[0].hash, PNG),
    /manifest before/,
  );
  assert.throws(() => paper.prepare("second-device", manifest), /conflicts/);
  assert.throws(
    () => paper.prepare("first-device", { ...manifest, revision: 2 }),
    /conflicts/,
  );
  commit(paper, manifest, "first-device");
  assert.deepEqual(paper.receipt("second-device", manifest.id), {
    id: manifest.id,
    state: "staging",
  });
  assert.throws(
    () => paper.commit("second-device", manifest.id),
    /another device/,
  );
  assert.throws(
    () =>
      paper.prepare("first-device", {
        ...manifest,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    /conflicts/,
  );
  const newer = { ...manifest, id: crypto.randomUUID(), revision: 2 };
  assert.throws(
    () => paper.prepare("second-device", newer),
    /different question or device/,
  );
  const other = submission(paper, {
    cardId: cards.find((card) => card.kind === "math").id,
  }).manifest;
  assert.throws(
    () =>
      paper.prepare("first-device", {
        ...other,
        documentId: manifest.documentId,
      }),
    /different question or device/,
  );
  assert.throws(
    () =>
      paper.prepare("first-device", {
        ...other,
        handoffId: crypto.randomUUID(),
      }),
    /does not belong/,
  );
});

test("reference snapshots preserve the original question after card edits and expose only front content", (t) => {
  const { store, paper } = setup(t);
  const handoffId = crypto.randomUUID();
  store.set("synthetic-private-key", "DO-NOT-EXPORT-THIS-DEVICE-KEY");
  const front = paper.questions(handoffId, [cards[0].id])[0];
  const original = paper.reference(front.id);
  assert(!JSON.stringify(front).includes("answer"));
  assert(!JSON.stringify(front).includes("schedule"));
  assert(!JSON.stringify(front).includes("DO-NOT-EXPORT"));
  assert.equal(front.prompt, cards[0].prompt);
  store.saveCard({
    ...cards[0],
    prompt: "A revised question",
    answer: "A revised reference",
    status: "ready",
  });
  assert.deepEqual(paper.reference(front.id), original);
  const revised = paper.questions(handoffId, [cards[0].id])[0];
  assert.notEqual(revised.id, front.id);
  assert.notEqual(revised.referenceHash, front.referenceHash);
  assert.equal(paper.reference(revised.id).value.answer, "A revised reference");
  assert.equal(
    paper.questions(handoffId, [cards.find((card) => card.kind === "code").id])
      .length,
    0,
  );
  assert(
    !JSON.stringify(paper.reference(revised.id)).includes("DO-NOT-EXPORT"),
  );
});

test("staged assets reject digests, image declarations and unsafe paths before committing", (t) => {
  const { paper, store } = setup(t);
  const { manifest } = submission(paper);
  paper.prepare("ipad-test", manifest);
  assert.throws(
    () =>
      paper.stage(
        "ipad-test",
        manifest.id,
        manifest.pages[0].hash,
        Buffer.from("not the image"),
      ),
    /digest/,
  );
  assert.throws(
    () => paper.stage("ipad-test", manifest.id, "f".repeat(64), PNG),
    /not declared/,
  );
  assert.throws(
    () =>
      paper.stage("ipad-test", "../../private", manifest.pages[0].hash, PNG),
    /identifier/,
  );
  const changed = {
    ...manifest,
    id: crypto.randomUUID(),
    pages: [{ ...manifest.pages[0], width: 2 }],
  };
  paper.prepare("ipad-test", changed);
  assert.throws(
    () => paper.stage("ipad-test", changed.id, changed.pages[0].hash, PNG),
    /dimensions differ/,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
    0,
  );
});

test("manifest and image limits reject unsupported pages, drawing size and corrupt formats", () => {
  assert.deepEqual(contract.imageInfo(PNG, "image/png"), {
    width: 1,
    height: 1,
    mime: "image/png",
    bytes: PNG.length,
  });
  assert.throws(() => contract.imageInfo(PNG, "image/jpeg"), /format/);
  assert.throws(
    () => contract.imageInfo(PNG.subarray(0, 50), "image/png"),
    /Truncated|Incomplete/,
  );
  assert.throws(
    () =>
      contract.imageInfo(
        Buffer.alloc(contract.LIMITS.imageBytes + 1),
        "image/png",
      ),
    /12 MB/,
  );
  assert.throws(
    () => contract.imageInfo(PNG, "image/png", () => ({ width: 2, height: 2 })),
    /decoded safely/,
  );
  const oversized = Buffer.from(PNG);
  oversized.writeUInt32BE(20000, 16);
  assert.throws(() => contract.imageInfo(oversized, "image/png"), /dimensions/);
  const m = {
    version: 1,
    id: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    handoffId: crypto.randomUUID(),
    questionId: null,
    revision: 1,
    mode: "tutor",
    createdAt: new Date().toISOString(),
    evaluate: false,
    drawing: null,
    pages: [
      {
        index: 0,
        hash: contract.digest(PNG),
        mime: "image/png",
        name: "Page",
        width: 1,
        height: 1,
      },
    ],
  };
  assert.throws(
    () => contract.manifest({ ...m, pages: Array(21).fill(m.pages[0]) }),
    /1–20/,
  );
  assert.throws(
    () =>
      contract.manifest({
        ...m,
        drawing: {
          hash: "a".repeat(64),
          bytes: contract.LIMITS.drawingBytes + 1,
        },
      }),
    /editable drawing/,
  );
  assert.throws(
    () => contract.manifest({ ...m, pages: [{ ...m.pages[0], index: 1 }] }),
    /page order/,
  );
  assert.throws(
    () => contract.manifest({ ...m, evaluate: true }),
    /evaluation request/,
  );
  assert.throws(
    () =>
      contract.manifest({
        ...m,
        pages: [{ ...m.pages[0], name: "a".repeat(161) }],
      }),
    /page name/,
  );
});

test("paper imports preserve cards and schedules, legacy images remain separate and interrupted work needs retry", (t) => {
  const { store, paper } = setup(t);
  const before = store.db.prepare("SELECT * FROM cards ORDER BY id").all();
  const history = store.db.prepare("SELECT * FROM reviews ORDER BY id").all();
  const item = paper.import(cards[0].id, [
    { name: "Page.png", mime: "image/png", bytes: PNG },
  ]);
  assert.equal(item.mode, "study");
  assert.equal(item.status, "received");
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM attachments").get().n,
    0,
  );
  assert.deepEqual(
    store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before,
  );
  assert.deepEqual(
    store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
    history,
  );
  paper.state(item.id, "evaluating");
  const resumed = new PaperStore(store);
  assert.equal(resumed.attempt(item.id).status, "interrupted");
  resumed.state(item.id, "queued");
  const recoveredQueue = new PaperStore(store);
  assert.equal(recoveredQueue.attempt(item.id).status, "interrupted");
  assert.equal(
    recoveredQueue.receipt(item.deviceId, item.id).state,
    "needs_attention",
  );
  assert.equal(resumed.page(item.id, 0).index, 0);
  assert.throws(() => resumed.page(item.id, -1), /page number/);
  assert.throws(() => resumed.page(item.id, 1), /Page not found/);
});

test("profile backups retain drawing/page/feedback blobs and exclude connection credentials; restored work stays idle", (t) => {
  const { root, folder, store, paper } = setup(t);
  const drawing = Buffer.from("synthetic retained strokes");
  const { manifest } = submission(paper, { drawing });
  commit(paper, manifest, "ipad-test", drawing);
  const savedFeedback = {
    verdict: "partial",
    summary: "The method is appropriate. Recheck the addition on page one.",
    strengths: ["The weights match their values."],
    findings: [],
    firstMistake: null,
    followUp: "What is the total weight?",
  };
  const reference = paper.reference(manifest.questionId);
  store.db
    .prepare("INSERT INTO paper_assessments VALUES(?,?,?,?,?,?,?,?)")
    .run(
      crypto.randomUUID(),
      manifest.id,
      reference.reference_hash,
      "synthetic-assessment-model",
      "feedback_ready",
      new Date().toISOString(),
      JSON.stringify(savedFeedback),
      null,
    );
  paper.state(manifest.id, "evaluating");
  store.set("pad:session", { mode: "study", question: manifest.questionId });
  store.set("pad:tutorArmed", true);
  store.db
    .prepare("INSERT INTO paper_device_grants VALUES(?,?,?,?,?)")
    .run(
      "synthetic-device",
      crypto.randomUUID(),
      "study",
      JSON.stringify([manifest.questionId]),
      0,
    );
  const connectionFolder = path.join(folder, "pad-identity");
  fs.mkdirSync(connectionFolder);
  fs.writeFileSync(
    path.join(connectionFolder, "installation.json"),
    JSON.stringify({
      key: "synthetic TLS key",
      devices: [{ token: "synthetic device credential" }],
    }),
  );
  const backup = backups.backup(store, path.join(root, "backup")).backup;
  assert.equal(fs.existsSync(path.join(backup, "pad-identity")), false);
  const target = path.join(root, "restored");
  backups.restore(target, backup);
  const restored = new Store(target);
  const restoredPaper = new PaperStore(restored);
  try {
    assert.equal(restoredPaper.attempt(manifest.id).status, "interrupted");
    assert.deepEqual(
      restoredPaper.attempt(manifest.id).assessments[0].feedback,
      savedFeedback,
    );
    assert.deepEqual(restoredPaper.reference(manifest.questionId), reference);
    assert.deepEqual(restoredPaper.pages(manifest.id)[0].bytes, PNG);
    assert.deepEqual(
      Buffer.from(
        restored.db
          .prepare(
            "SELECT bytes FROM paper_assets WHERE mime='application/x-pencilkit'",
          )
          .get().bytes,
      ),
      drawing,
    );
    assert.equal(restored.get("pad:session"), null);
    assert.equal(restored.get("pad:tutorArmed"), null);
    assert.equal(restored.get("pad:restoreNeedsResubmission"), true);
    assert.equal(
      restored.db.prepare("SELECT count(*) n FROM paper_device_grants").get().n,
      0,
    );
  } finally {
    restored.close();
  }
});

test("a failed commit rolls back every durable row and retains staged work for explicit retry", (t) => {
  const { store, paper } = setup(t);
  const { manifest } = submission(paper);
  paper.prepare("ipad-test", manifest);
  paper.stage("ipad-test", manifest.id, manifest.pages[0].hash, PNG);
  store.db.exec(
    "CREATE TEMP TRIGGER synthetic_disk_full BEFORE INSERT ON paper_assets BEGIN SELECT RAISE(ABORT,'synthetic disk full'); END",
  );
  assert.throws(
    () => paper.commit("ipad-test", manifest.id),
    /synthetic disk full/,
  );
  for (const table of ["paper_documents", "paper_attempts", "paper_assets"])
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM " + table).get().n,
      0,
    );
  assert.equal(paper.receipt("ipad-test", manifest.id).state, "staging");
  assert.equal(
    fs.existsSync(
      path.join(paper.stageFolder, manifest.id, manifest.pages[0].hash),
    ),
    true,
  );
  store.db.exec("DROP TRIGGER synthetic_disk_full");
  assert.equal(paper.commit("ipad-test", manifest.id).state, "received");
});

test("schema two upgrades add paper tables while preserving all legacy content, schedules, drafts and attachments", (t) => {
  const { folder, store } = setup(t);
  store.set("draft:" + cards[0].id, { text: "A retained legacy draft" });
  store.db
    .prepare(
      "INSERT INTO attachments(id,card_id,name,mime,bytes,at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      crypto.randomUUID(),
      cards[0].id,
      "Legacy.png",
      "image/png",
      PNG,
      new Date().toISOString(),
    );
  const beforeCards = store.db.prepare("SELECT * FROM cards ORDER BY id").all();
  const beforeSettings = store.db
    .prepare("SELECT * FROM settings ORDER BY key")
    .all();
  const beforeAttachments = store.db
    .prepare("SELECT * FROM attachments ORDER BY id")
    .all();
  store.db.exec(
    "DROP TABLE paper_assessments; DROP TABLE paper_assets; DROP TABLE paper_attempts; DROP TABLE paper_documents; DROP TABLE paper_staging; DROP TABLE paper_questions; PRAGMA user_version=2",
  );
  store.close();
  store.close = () => {};
  const upgraded = new Store(folder);
  try {
    assert.equal(
      upgraded.db.prepare("PRAGMA user_version").get().user_version,
      3,
    );
    assert.deepEqual(
      upgraded.db.prepare("SELECT * FROM cards ORDER BY id").all(),
      beforeCards,
    );
    assert.deepEqual(
      upgraded.db.prepare("SELECT * FROM settings ORDER BY key").all(),
      beforeSettings,
    );
    assert.deepEqual(
      upgraded.db.prepare("SELECT * FROM attachments ORDER BY id").all(),
      beforeAttachments,
    );
    assert.equal(
      upgraded.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
      0,
    );
  } finally {
    upgraded.close();
  }
});

test("repeated image data keeps both page positions while storing the bytes once", (t) => {
  const { store, paper } = setup(t);
  const { manifest } = submission(paper);
  manifest.pages.push({
    ...manifest.pages[0],
    index: 1,
    name: "Second occurrence.png",
  });
  commit(paper, manifest);
  assert.equal(paper.attempt(manifest.id).pageCount, 2);
  assert.equal(
    store.db
      .prepare("SELECT count(*) n FROM paper_assets WHERE attempt_id=?")
      .get(manifest.id).n,
    1,
  );
  assert.deepEqual(
    paper.pages(manifest.id).map((page) => page.page_index),
    [0, 1],
  );
  assert.equal(paper.page(manifest.id, 1).name, "Second occurrence.png");
  assert.deepEqual(
    paper.pages(manifest.id).map((page) => page.bytes),
    [PNG, PNG],
  );
  assert.throws(
    () =>
      contract.manifest({
        ...manifest,
        pages: [manifest.pages[0], { ...manifest.pages[1], width: 2 }],
      }),
    /consistent dimensions/,
  );
});

test("repeated page hashes cannot bypass the 64 MiB submission limit during staging or commit", (t) => {
  const { store, paper } = setup(t);
  // Only one 4 MiB asset is allocated and staged. Its ancillary chunk makes a
  // bounded structural PNG fixture; this test exercises byte accounting, not
  // native image decoding (which has separate fixtures).
  const size = 4 * 1024 * 1024;
  const chunk = Buffer.alloc(size - PNG.length);
  chunk.writeUInt32BE(chunk.length - 12, 0);
  chunk.write("tEXt", 4, "ascii");
  const bytes = Buffer.concat([PNG.subarray(0, -12), chunk, PNG.subarray(-12)]);
  assert.equal(bytes.length, size);
  const { manifest } = submission(paper);
  const hash = contract.digest(bytes);
  manifest.pages = Array.from({ length: 17 }, (_, index) => ({
    ...manifest.pages[0],
    index,
    hash,
    name: `Repeated page ${index + 1}.png`,
  }));
  const prepared = paper.prepare("ipad-test", manifest);
  assert.deepEqual(prepared.missing, [hash]);
  assert.throws(
    () => paper.stage("ipad-test", manifest.id, hash, bytes),
    /64 MB/,
  );
  // Simulate an upload saved by an older build or interrupted before returning
  // its size error. Commit must independently reject the expanded page bytes.
  const assetPath = path.join(paper.stageFolder, manifest.id, hash);
  if (!fs.existsSync(assetPath)) fs.writeFileSync(assetPath, bytes);
  assert.throws(() => paper.commit("ipad-test", manifest.id), /64 MB/);
  assert.equal(paper.receipt("ipad-test", manifest.id).state, "staging");
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
    0,
  );
  assert.equal(fs.statSync(assetPath).size, size);
});

test("exactly 64 MiB of repeated pages remains allowed with deduplicated storage", (t) => {
  const { store, paper } = setup(t);
  const size = 4 * 1024 * 1024;
  const chunk = Buffer.alloc(size - PNG.length);
  chunk.writeUInt32BE(chunk.length - 12, 0);
  chunk.write("tEXt", 4, "ascii");
  const bytes = Buffer.concat([PNG.subarray(0, -12), chunk, PNG.subarray(-12)]);
  const { manifest } = submission(paper);
  const hash = contract.digest(bytes);
  manifest.pages = Array.from({ length: 16 }, (_, index) => ({
    ...manifest.pages[0],
    index,
    hash,
    name: `Boundary page ${index + 1}.png`,
  }));
  paper.prepare("ipad-test", manifest);
  paper.stage("ipad-test", manifest.id, hash, bytes);
  assert.equal(paper.commit("ipad-test", manifest.id).state, "received");
  const attempt = paper.attempt(manifest.id);
  assert.equal(attempt.pageCount, 16);
  assert.deepEqual(
    attempt.manifest.pages.map((page) => page.index),
    Array.from({ length: 16 }, (_, index) => index),
  );
  const stored = store.db
    .prepare(
      "SELECT count(*) count,sum(length(bytes)) bytes FROM paper_assets WHERE attempt_id=?",
    )
    .get(manifest.id);
  assert.equal(stored.count, 1);
  assert.equal(stored.bytes, size);
});

test("staging races cannot claim another device's document or overwrite an earlier revision", (t) => {
  const { store, paper } = setup(t);
  const { manifest } = submission(paper);
  const otherDevice = { ...manifest, id: crypto.randomUUID() };
  const conflictingRevision = {
    ...manifest,
    id: crypto.randomUUID(),
    pages: [{ ...manifest.pages[0], name: "A changed page declaration.png" }],
  };
  for (const [device, item] of [
    ["first-device", manifest],
    ["second-device", otherDevice],
    ["first-device", conflictingRevision],
  ]) {
    paper.prepare(device, item);
    paper.stage(device, item.id, item.pages[0].hash, PNG);
  }
  paper.commit("first-device", manifest.id);
  assert.throws(
    () => paper.commit("second-device", otherDevice.id),
    /different question or device/,
  );
  assert.throws(
    () => paper.commit("first-device", conflictingRevision.id),
    /revision conflicts/,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
    1,
  );
  assert.equal(
    store.db.prepare("SELECT device_id FROM paper_documents").get().device_id,
    "first-device",
  );
});
