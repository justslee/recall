const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { Store } = require("../electron/store.cjs"),
  { PaperStore } = require("../electron/paper-store.cjs"),
  { saveConfig } = require("../electron/config.cjs"),
  contract = require("../shared/handwriting-contract.cjs"),
  notebooks = require("../electron/notebook-intake.cjs"),
  inbox = require("../electron/inbox.cjs"),
  worker = require("../electron/learning-worker.cjs"),
  backups = require("../electron/backup.cjs");
const cards = require("../examples/demo.json").cards,
  PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
    "base64",
  ),
  INK = Buffer.from("synthetic notebook PencilKit strokes");
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-notebooks-")),
    folder = path.join(root, "profile"),
    store = new Store(folder),
    paper = new PaperStore(store);
  store.import(cards);
  saveConfig(folder, { captureEnabled: true, timeZone: "America/New_York" });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, folder, store, paper };
}
function snapshot({
  documentId = crypto.randomUUID(),
  revision = 1,
  pageId = crypto.randomUUID(),
  ink = INK,
} = {}) {
  const hash = contract.digest(ink);
  return {
    version: 3,
    id: crypto.randomUUID(),
    documentId,
    revision,
    mode: "notebook",
    questionId: null,
    handoffId: null,
    createdAt: "2026-10-11T16:30:00.000Z",
    evaluate: false,
    drawing: null,
    pages: [
      {
        index: 0,
        hash: contract.digest(PNG),
        mime: "image/png",
        name: "Notebook page.png",
        width: 1,
        height: 1,
        sourcePageId: pageId,
        sourceRevision: revision,
        sourceHash: hash,
      },
    ],
    drawings: [{ sourcePageId: pageId, hash, bytes: ink.length }],
    notebook: {
      id: crypto.randomUUID(),
      title: "Synthetic notebook",
      noteId: documentId,
      noteTitle: "A written explanation",
      revision,
      selectedPageIds: [pageId],
      sourcePages: [{ id: pageId, revision, hash }],
      contentHash: contract.digest(documentId + revision + pageId),
    },
  };
}
function accept(paper, m, device = "synthetic-ipad", ink = INK) {
  const prepared = paper.prepare(device, m);
  if (prepared.missing.includes(m.pages[0].hash))
    paper.stage(device, m.id, m.pages[0].hash, PNG);
  if (prepared.missing.includes(m.drawings[0].hash))
    paper.stage(device, m.id, m.drawings[0].hash, ink);
  return paper.commit(device, m.id);
}
function result(folder, m, knowledge = []) {
  const inspected = notebooks.inspect(folder, m.id);
  return {
    reviewedSource: {
      ...inspected.reviewedSource,
      evidence:
        "Inspected the actual selected image and independently checked its objective.",
    },
    captures: [
      {
        title: cards[0].title,
        objective: "Explain the discussed objective in this note",
        context: "The user explicitly submitted a written explanation.",
        at: m.createdAt,
        sourcePageIndices: [0],
        cardIds: [cards[0].id],
      },
    ],
    knowledge,
  };
}
test("notebook snapshots are explicit immutable sources, durable/idempotent and isolated from live sessions", (t) => {
  const { store, paper, folder } = setup(t),
    m = snapshot(),
    baseline = store.cards();
  assert.equal(accept(paper, m).state, "notebook_received");
  assert.equal(inbox.read(folder).items.length, 0);
  assert.equal(paper.receipt("another-device", m.id).state, "staging");
  const recovered = notebooks.recover(store, paper);
  assert.equal(recovered.queued, 1);
  assert.equal(notebooks.recover(store, paper).queued, 0);
  assert.equal(
    paper.receipt("synthetic-ipad", m.id).notebook.status,
    "awaiting_assistant",
  );
  assert.equal(accept(paper, m).state, "notebook_received");
  assert.equal(
    paper.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
    1,
  );
  assert.deepEqual(store.cards(), baseline);
  assert.equal(
    paper.db.prepare("SELECT count(*) n FROM paper_questions").get().n,
    0,
  );
  assert.equal(
    paper.db
      .prepare("SELECT count(*) n FROM paper_tutor_attempt_bindings")
      .get().n,
    0,
  );
  assert.throws(
    () => paper.prepare("other-device", { ...m, id: crypto.randomUUID() }),
    /different question or device/,
  );
  assert.throws(
    () =>
      paper.prepare("synthetic-ipad", {
        ...m,
        notebook: { ...m.notebook, noteTitle: "Conflicting retry" },
      }),
    /conflicts/,
  );
});
test("notebook protocol rejects live authority, wrong page lineage/order and drawing omissions", () => {
  const m = snapshot();
  assert.deepEqual(contract.manifest(m), m);
  for (const patch of [
    { version: 1 },
    { evaluate: true },
    { handoffId: crypto.randomUUID() },
    { questionId: crypto.randomUUID() },
    { target: "assistant" },
    { drawings: [] },
  ])
    assert.throws(() => contract.manifest({ ...m, ...patch }));
  assert.throws(
    () =>
      contract.manifest({
        ...m,
        notebook: { ...m.notebook, noteId: crypto.randomUUID() },
      }),
    /identity/,
  );
  assert.throws(
    () =>
      contract.manifest({
        ...m,
        pages: [{ ...m.pages[0], sourceRevision: 2 }],
      }),
    /authored revisions/,
  );
  assert.throws(
    () =>
      contract.manifest({
        ...m,
        notebook: {
          ...m.notebook,
          selectedPageIds: [m.pages[0].sourcePageId, m.pages[0].sourcePageId],
        },
      }),
    /identity/,
  );
  const duplicate = structuredClone(m),
    second = crypto.randomUUID();
  duplicate.notebook.selectedPageIds.push(second);
  duplicate.notebook.sourcePages.push({
    ...m.notebook.sourcePages[0],
    id: second,
  });
  duplicate.pages.push({ ...m.pages[0], index: 1, sourcePageId: second });
  duplicate.drawings.push({ ...m.drawings[0], sourcePageId: second, bytes: 1 });
  assert.throws(() => contract.manifest(duplicate), /consistent byte size/);
});
test("authored-page selections and long-page pagination preserve lineage and reject conflicting ink revisions", (t) => {
  const { paper } = setup(t),
    first = snapshot();
  first.pages.push({
    ...first.pages[0],
    index: 1,
    name: "Same authored page continued.png",
  });
  accept(paper, first);
  assert.equal(paper.pages(first.id).length, 2);
  const second = snapshot({ documentId: first.documentId });
  second.notebook.id = first.notebook.id;
  accept(paper, second);
  assert.equal(paper.attempts(null, "notebook").length, 2);
  const wrongInk = Buffer.from("different ink under the same source revision"),
    conflict = snapshot({
      documentId: first.documentId,
      pageId: first.pages[0].sourcePageId,
      ink: wrongInk,
    });
  conflict.notebook.id = first.notebook.id;
  assert.throws(
    () => accept(paper, conflict, "synthetic-ipad", wrongInk),
    /revision conflicts/,
  );
  assert.equal(
    paper.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
    2,
  );
  assert.equal(
    paper.db.prepare("SELECT count(*) n FROM paper_staging").get().n,
    1,
  );
});
test("receipt becomes added only after exact page proof and validated card application; revisions retain earlier success", (t) => {
  const { store, paper, folder } = setup(t),
    m = snapshot(),
    before = store.card(cards[0].id);
  accept(paper, m);
  notebooks.recover(store, paper);
  const itemId = notebooks.sourceId(m.id);
  const bad = result(folder, m);
  bad.reviewedSource.manifestHash = "0".repeat(64);
  inbox.submit(folder, itemId, bad);
  assert.equal(inbox.applyPending(store).applied, 0);
  assert.equal(
    paper.receipt("synthetic-ipad", m.id).state,
    "notebook_needs_attention",
  );
  inbox.retry(folder, itemId);
  inbox.update(folder, itemId, { status: "pending", result: null });
  inbox.submit(folder, itemId, result(folder, m));
  assert.equal(
    paper.receipt("synthetic-ipad", m.id).notebook.status,
    "processing",
  );
  assert.equal(inbox.applyPending(store).applied, 1);
  const receipt = paper.receipt("synthetic-ipad", m.id);
  assert.equal(receipt.state, "notebook_added");
  assert.ok(receipt.notebook.processedAt);
  assert.deepEqual(receipt.notebook.cardIds, [cards[0].id]);
  assert.deepEqual(store.card(cards[0].id), before);
  const newer = snapshot({
    documentId: m.documentId,
    pageId: m.pages[0].sourcePageId,
    revision: 2,
  });
  accept(paper, newer);
  notebooks.recover(store, paper);
  assert.equal(
    paper.receipt("synthetic-ipad", newer.id).notebook.status,
    "awaiting_assistant",
  );
  assert.deepEqual(paper.receipt("synthetic-ipad", m.id), receipt);
});
test("KB completion requires actual scoped revisions and authoring permissions; card success can retain a KB gap", (t) => {
  const { root, folder, store, paper } = setup(t),
    kbRoot = path.join(root, "KB");
  fs.mkdirSync(kbRoot);
  fs.writeFileSync(
    path.join(kbRoot, "Concept.md"),
    "# Concept\n\nA synthetic definition.\n",
  );
  saveConfig(folder, {
    sources: [{ id: "local-kb", type: "markdown", root: kbRoot, write: true }],
  });
  const record = require("../adapters/knowledge.cjs").scan(folder, "local-kb")
      .documents[0],
    m = snapshot();
  accept(paper, m);
  notebooks.recover(store, paper);
  const valid = result(folder, m, [
    {
      sourceId: "local-kb",
      status: "verified",
      records: [
        { id: record.id, revision: record.revision, operation: "reused" },
      ],
    },
  ]);
  valid.knowledge[0].records[0].revision = "invented";
  inbox.submit(folder, notebooks.sourceId(m.id), valid);
  assert.equal(inbox.applyPending(store).applied, 0);
  assert.equal(
    paper.receipt("synthetic-ipad", m.id).state,
    "notebook_needs_attention",
  );
  inbox.update(folder, notebooks.sourceId(m.id), {
    status: "pending",
    result: null,
  });
  inbox.submit(
    folder,
    notebooks.sourceId(m.id),
    result(folder, m, [
      {
        sourceId: "local-kb",
        status: "blocked",
        reason:
          "The configured KB needs a user-reviewed factual correction before updating.",
      },
    ]),
  );
  assert.equal(inbox.applyPending(store).applied, 1);
  const receipt = paper.receipt("synthetic-ipad", m.id);
  assert.equal(receipt.state, "notebook_needs_attention");
  assert.deepEqual(receipt.notebook.cardIds, [cards[0].id]);
  assert.equal(receipt.notebook.knowledge[0].status, "blocked");
  assert.ok(receipt.notebook.processedAt);
  const priorCard = store.card(cards[0].id);
  inbox.retry(folder, notebooks.sourceId(m.id));
  assert.deepEqual(notebooks.list(folder)[0].cardIds, [cards[0].id]);
  inbox.submit(
    folder,
    notebooks.sourceId(m.id),
    result(folder, m, [
      {
        sourceId: "local-kb",
        status: "verified",
        records: [
          { id: record.id, revision: record.revision, operation: "reused" },
        ],
      },
    ]),
  );
  assert.equal(inbox.applyPending(store).applied, 1);
  assert.equal(paper.receipt("synthetic-ipad", m.id).state, "notebook_added");
  assert.deepEqual(store.card(cards[0].id), priorCard);
  assert.equal(
    require("../electron/self-test.cjs").read(folder).entries.length,
    1,
  );
});
test("pause and restore preserve source bytes without starting preparation or treating restored work as authorization", (t) => {
  const { folder, store, paper } = setup(t),
    m = snapshot();
  accept(paper, m);
  saveConfig(folder, { captureEnabled: false });
  assert.deepEqual(notebooks.recover(store, paper), {
    queued: 0,
    paused: true,
  });
  assert.equal(inbox.read(folder).items.length, 0);
  assert.equal(paper.receipt("synthetic-ipad", m.id).notebook.status, "paused");
  saveConfig(folder, { captureEnabled: true });
  store.set("pad:restoreNeedsResubmission", true);
  store.set("pad:restoredAt", new Date(Date.now() + 60000).toISOString());
  assert.equal(notebooks.recover(store, paper).queued, 0);
  assert.equal(worker.preview(folder, store.cards()), null);
  assert.deepEqual(Buffer.from(paper.pages(m.id)[0].bytes), PNG);
});
test("KB-only and supplement retries retain all already-applied notebook objectives and card links", (t) => {
  const { root, folder, store, paper } = setup(t),
    kbRoot = path.join(root, "KB");
  fs.mkdirSync(kbRoot);
  fs.writeFileSync(
    path.join(kbRoot, "Concept.md"),
    "# Concept\n\nA synthetic definition.\n",
  );
  saveConfig(folder, {
    sources: [{ id: "local-kb", type: "markdown", root: kbRoot, write: true }],
  });
  const record = require("../adapters/knowledge.cjs").scan(folder, "local-kb")
      .documents[0],
    m = snapshot(),
    baseline = store.cards(),
    blocked = [
      {
        sourceId: "local-kb",
        status: "blocked",
        reason: "A selected mirror is unavailable.",
      },
    ];
  accept(paper, m);
  notebooks.recover(store, paper);
  const itemId = notebooks.sourceId(m.id),
    first = result(folder, m, blocked);
  first.captures.push({
    ...first.captures[0],
    objective: "A second objective actually on this selected page",
    cardIds: [cards[2].id],
  });
  inbox.submit(folder, itemId, first);
  assert.equal(inbox.applyPending(store).applied, 1);
  assert.equal(inbox.read(folder).items[0].receipt.captures, 2);

  // The next assistant handles just a missing supplement. Omitted, already
  // applied objectives and their concept links still belong to this snapshot.
  const supplement = result(folder, m, blocked);
  supplement.captures[0].cardIds = [cards[1].id];
  inbox.submit(folder, itemId, supplement);
  assert.equal(inbox.applyPending(store).applied, 1);
  const afterSupplement = paper.receipt("synthetic-ipad", m.id);
  assert.deepEqual(
    new Set(afterSupplement.notebook.cardIds),
    new Set(cards.map((c) => c.id)),
  );
  assert.equal(inbox.read(folder).items[0].receipt.captures, 2);
  const applied = require("../electron/self-test.cjs").read(folder).entries;
  assert.equal(applied.length, 2);
  assert.deepEqual(
    new Set(
      applied.find((entry) => entry.objective === first.captures[0].objective)
        .cardIds,
    ),
    new Set([cards[0].id, cards[1].id]),
  );

  // A KB-only retry resolves its remaining destination without repeating any
  // authoring or recapturing previously applied learning.
  const kbOnly = result(folder, m, [
    {
      sourceId: "local-kb",
      status: "verified",
      records: [
        { id: record.id, revision: record.revision, operation: "reused" },
      ],
    },
  ]);
  kbOnly.captures = [];
  kbOnly.reason =
    "Finished the remaining KB receipt; earlier objectives and cards are already applied.";
  inbox.submit(folder, itemId, kbOnly);
  assert.equal(inbox.applyPending(store).applied, 1);
  const completed = paper.receipt("synthetic-ipad", m.id);
  assert.equal(completed.state, "notebook_added");
  assert.deepEqual(
    new Set(completed.notebook.cardIds),
    new Set(cards.map((c) => c.id)),
  );
  assert.equal(inbox.read(folder).items[0].receipt.captures, 2);
  assert.deepEqual(
    require("../electron/self-test.cjs").read(folder).entries,
    applied,
  );
  assert.deepEqual(store.cards(), baseline);
});
test("restored submitted notebook results remain blocked until an explicit new snapshot is sent", (t) => {
  const { root, folder, store, paper } = setup(t),
    m = snapshot();
  accept(paper, m);
  notebooks.recover(store, paper);
  inbox.submit(folder, notebooks.sourceId(m.id), result(folder, m));
  const directory = backups.backup(
    store,
    path.join(root, "pending-backup"),
  ).backup;
  store.close();
  backups.restore(folder, directory);
  Object.assign(store, new Store(folder));
  const restoredPaper = new PaperStore(store);
  assert.equal(inbox.applyPending(store).applied, 0);
  assert.equal(
    restoredPaper.db.prepare("SELECT count(*) n FROM cards").get().n,
    cards.length,
  );
  assert.match(inbox.read(folder).items[0].error, /explicit new submission/);
  assert.deepEqual(Buffer.from(restoredPaper.pages(m.id)[0].bytes), PNG);
});
test("Notion authored outcomes require a matched verified write/read-back receipt and never accept a proposed snapshot", (t) => {
  const { folder, store, paper } = setup(t),
    kb = require("../adapters/knowledge.cjs"),
    scopeId = crypto.randomUUID(),
    record = {
      id: "synthetic:notion-concept",
      title: "Synthetic concept",
      body: "A real synthetic note body.",
    };
  saveConfig(folder, {
    sources: [{ id: "notion-kb", type: "notion", scopeId, write: true }],
  });
  const proposed = kb.save(folder, "notion-kb", record, { apply: true }),
    fetched = {
      id: crypto.randomUUID(),
      canonicalId: record.id,
      title: record.title,
      body: record.body,
      revision: "fetched-revision-1",
      scopeId,
    };
  kb.ingestNotion(folder, "notion-kb", [fetched]);
  const m = snapshot();
  accept(paper, m);
  notebooks.recover(store, paper);
  const completed = result(folder, m, [
    {
      sourceId: "notion-kb",
      status: "verified",
      records: [
        {
          id: record.id,
          revision: fetched.revision,
          operation: "created",
          requestId: proposed.id,
        },
      ],
    },
  ]);
  inbox.submit(folder, notebooks.sourceId(m.id), completed);
  assert.equal(inbox.applyPending(store).applied, 0);
  assert.equal(
    paper.receipt("synthetic-ipad", m.id).state,
    "notebook_needs_attention",
  );
  kb.acknowledge(folder, proposed.id, fetched);
  inbox.update(folder, notebooks.sourceId(m.id), {
    status: "pending",
    result: null,
  });
  inbox.submit(folder, notebooks.sourceId(m.id), completed);
  assert.equal(inbox.applyPending(store).applied, 1);
  assert.equal(paper.receipt("synthetic-ipad", m.id).state, "notebook_added");
  assert.match(
    paper.receipt("synthetic-ipad", m.id).notebook.knowledge[0].verification,
    /assistant-attested/,
  );
});
test("restricted preparation never consumes handwritten notebook sources; assistant page exports are read-only and never overwrite", (t) => {
  const { root, folder, store, paper } = setup(t),
    m = snapshot();
  accept(paper, m);
  notebooks.recover(store, paper);
  assert.equal(worker.preview(folder, store.cards()), null);
  const inspected = notebooks.inspect(folder, m.id);
  assert.equal(
    inspected.reviewedSource.manifestHash,
    contract.digest(JSON.stringify(contract.manifest(m))),
  );
  const target = path.join(root, "selected.png"),
    out = notebooks.exportPage(folder, m.id, 0, target);
  assert.equal(out.hash, m.pages[0].hash);
  assert.deepEqual(fs.readFileSync(target), PNG);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.throws(() => notebooks.exportPage(folder, m.id, 0, target), /EEXIST/);
  assert.throws(
    () => notebooks.exportPage(folder, m.id, 0, "relative.png"),
    /absolute/,
  );
  assert.throws(() => notebooks.page(folder, m.id, 1), /not found/);
  const linked = path.join(root, "linked");
  fs.symlinkSync(root, linked);
  assert.throws(
    () => notebooks.exportPage(folder, m.id, 0, path.join(linked, "bad.png")),
    /linked/,
  );
});
test("damaged notebook sources do not hide healthy intake and recovery preserves their specific gap", (t) => {
  const { folder, store, paper } = setup(t),
    bad = snapshot(),
    good = snapshot();
  accept(paper, bad);
  accept(paper, good);
  paper.db
    .prepare("UPDATE paper_attempts SET manifest=? WHERE id=?")
    .run("{invalid source", bad.id);
  const rows = notebooks.list(folder);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.id === bad.id).unreadable, true);
  assert.equal(rows.find((row) => row.id === good.id).pageCount, 1);
  const recovered = notebooks.recover(store, paper);
  assert.equal(recovered.queued, 1);
  assert.equal(recovered.issues.length, 1);
  assert.equal(recovered.issues[0].attemptId, bad.id);
  assert.equal(inbox.read(folder).items.length, 1);
  assert.equal(
    paper.db.prepare("SELECT count(*) n FROM paper_assets").get().n,
    4,
  );
  assert.throws(() => notebooks.inspect(folder, bad.id));
});
test("backup restores two selected source pages and their distinct drawings while pending work stays idle and credentials stay excluded", (t) => {
  const { root, folder, store, paper } = setup(t),
    m = snapshot(),
    secondPageId = crypto.randomUUID(),
    secondInk = Buffer.from("distinct synthetic second-page PencilKit strokes"),
    secondPNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    secondDrawingHash = contract.digest(secondInk),
    baselineCards = store.cards();
  m.pages.push({
    ...m.pages[0],
    index: 1,
    hash: contract.digest(secondPNG),
    name: "Second notebook page.png",
    sourcePageId: secondPageId,
    sourceHash: secondDrawingHash,
  });
  m.drawings.push({
    sourcePageId: secondPageId,
    hash: secondDrawingHash,
    bytes: secondInk.length,
  });
  m.notebook.selectedPageIds.push(secondPageId);
  m.notebook.sourcePages.push({
    id: secondPageId,
    revision: m.revision,
    hash: secondDrawingHash,
  });
  m.notebook.contentHash = contract.digest(
    JSON.stringify(m.notebook.sourcePages),
  );
  const assets = new Map([
      [m.pages[0].hash, PNG],
      [m.pages[1].hash, secondPNG],
      [m.drawings[0].hash, INK],
      [m.drawings[1].hash, secondInk],
    ]),
    prepared = paper.prepare("synthetic-ipad", m);
  assert.equal(assets.size, 4);
  for (const hash of prepared.missing)
    paper.stage("synthetic-ipad", m.id, hash, assets.get(hash));
  paper.commit("synthetic-ipad", m.id);
  notebooks.recover(store, paper);
  const pending = result(folder, m);
  pending.captures[0].sourcePageIndices = [0, 1];
  inbox.submit(folder, notebooks.sourceId(m.id), pending);
  const directory = backups.backup(store, path.join(root, "backup")).backup;
  const { DatabaseSync } = require("node:sqlite"),
    db = new DatabaseSync(path.join(directory, "recall.sqlite"), {
      readOnly: true,
    });
  try {
    const row = db
      .prepare("SELECT manifest FROM paper_attempts WHERE id=?")
      .get(m.id);
    assert.deepEqual(JSON.parse(row.manifest), m);
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM paper_assets WHERE attempt_id=?")
        .get(m.id).n,
      4,
    );
    for (const [hash, bytes] of assets)
      assert.deepEqual(
        Buffer.from(
          db
            .prepare(
              "SELECT bytes FROM paper_assets WHERE attempt_id=? AND hash=?",
            )
            .get(m.id, hash).bytes,
        ),
        bytes,
      );
  } finally {
    db.close();
  }
  assert.ok(fs.existsSync(path.join(directory, "learning-inbox", "items")));
  assert.equal(fs.existsSync(path.join(directory, "pad-identity")), false);
  assert.equal(inbox.read(folder).items.length, 1);
  const restoredFolder = path.join(root, "restored-profile");
  backups.restore(restoredFolder, directory);
  const restored = new Store(restoredFolder),
    restoredPaper = new PaperStore(restored);
  try {
    assert.deepEqual(restoredPaper.attempt(m.id).manifest, m);
    const pages = restoredPaper.pages(m.id);
    assert.equal(pages.length, 2);
    assert.deepEqual(
      notebooks
        .inspect(restoredFolder, m.id)
        .pages.map((page) => page.sourcePageId),
      m.notebook.selectedPageIds,
    );
    assert.deepEqual(Buffer.from(pages[0].bytes), PNG);
    assert.deepEqual(Buffer.from(pages[1].bytes), secondPNG);
    for (const [hash, bytes] of assets)
      assert.deepEqual(
        Buffer.from(
          restored.db
            .prepare(
              "SELECT bytes FROM paper_assets WHERE attempt_id=? AND hash=?",
            )
            .get(m.id, hash).bytes,
        ),
        bytes,
      );
    assert.equal(restored.get("pad:restoreNeedsResubmission"), true);
    assert.equal(notebooks.recover(restored, restoredPaper).queued, 0);
    assert.equal(inbox.applyPending(restored).applied, 0);
    assert.match(
      inbox.read(restoredFolder).items[0].error,
      /explicit new submission/,
    );
    assert.deepEqual(restored.cards(), baselineCards);
    assert.equal(
      restored.db.prepare("SELECT count(*) n FROM paper_assessments").get().n,
      0,
    );
  } finally {
    restored.close();
  }
});
