const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Store } = require("../electron/store.cjs");
const taxonomy = require("../electron/taxonomy.cjs");
const queue = require("../electron/taxonomy-queue.cjs");
const { saveConfig } = require("../electron/config.cjs");
const demo = require("../examples/demo.json");

function setup(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-taxonomy-"));
  const store = new Store(folder);
  store.import(demo.cards);
  t.after(() => {
    try {
      store.close();
    } catch {}
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { folder, store };
}
const node = (id, parentId = null, label = id) => ({ id, label, parentId });
const plan = (revision = 0) => ({
  expectedRevision: revision,
  nodes: [
    node("data", null, "Data Engineering"),
    node("storage", "data", "Storage"),
    node("columnar", "storage", "Columnar storage"),
  ],
  mappings: [
    { kind: "concept", id: demo.cards[0].conceptId, nodeId: "columnar" },
  ],
});

test("locked domain policy persists, rejects implicit root changes, and allows explicit policy revisions", (t) => {
  const { store } = setup(t);
  const rootIds = ["computing", "mathematics-statistics", "economics-finance"];
  const request = {
    expectedRevision: 0,
    nodes: rootIds.map((id) => node(id)),
    rootPolicy: { mode: "locked", rootIds },
  };
  const before = store.db.prepare("SELECT * FROM cards ORDER BY id").all();
  const preview = taxonomy.preview(store, request);
  assert.equal(preview.rootPolicyChange.after.mode, "locked");
  assert.equal(taxonomy.read(store).rootPolicy, undefined);
  const result = taxonomy.apply(store, request);
  assert.deepEqual(result.rootPolicy.rootIds, [...rootIds].sort());
  assert.equal(taxonomy.apply(store, request).alreadyApplied, true);
  taxonomy.apply(store, {
    expectedRevision: 1,
    nodes: [node("databases", "computing")],
  });
  const locked = taxonomy.read(store);
  assert.equal(locked.rootPolicy.mode, "locked");
  for (const change of [
    { nodes: [node("imported-topic")] },
    { nodes: [node("economics-finance", "computing")] },
    { remove: { nodeIds: ["mathematics-statistics"] } },
  ]) {
    assert.throws(
      () => taxonomy.apply(store, { expectedRevision: 2, ...change }),
      /Locked root policy/,
    );
    assert.deepEqual(taxonomy.read(store), locked);
  }
  assert.throws(
    () =>
      taxonomy.preview(store, {
        expectedRevision: 2,
        rootPolicy: { mode: "locked", rootIds: ["computing"] },
      }),
    /Locked root policy/,
  );
  taxonomy.apply(store, {
    expectedRevision: 2,
    nodes: [node("physics")],
    rootPolicy: { mode: "locked", rootIds: [...rootIds, "physics"] },
  });
  taxonomy.apply(store, { expectedRevision: 3, rootPolicy: { mode: "open" } });
  taxonomy.apply(store, { expectedRevision: 4, nodes: [node("biology")] });
  assert.equal(taxonomy.read(store).rootPolicy.mode, "open");
  assert.deepEqual(
    store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before,
  );
});

test("root policy validation rejects malformed or reserved identities without changing legacy plans", (t) => {
  const { store } = setup(t);
  for (const rootPolicy of [
    { mode: "locked", rootIds: [] },
    { mode: "locked", rootIds: ["data", "data"] },
    { mode: "locked", rootIds: ["holding:unclassified"] },
    { mode: "open", rootIds: ["data"] },
    { mode: "typo" },
  ])
    assert.throws(() => taxonomy.preview(store, { ...plan(), rootPolicy }));
  taxonomy.apply(store, plan());
  taxonomy.apply(store, { expectedRevision: 1, nodes: [node("new-domain")] });
  assert.equal(taxonomy.read(store).rootPolicy, undefined);
});

test("taxonomy preview is read-only; updates preserve content, identities and learning state", (t) => {
  const { store } = setup(t);
  const before = store.db.prepare("SELECT * FROM cards ORDER BY id").all();
  const history = store.db.prepare("SELECT * FROM reviews ORDER BY id").all();
  const initial = taxonomy.read(store);
  assert.equal(initial.revision, 0);
  const p = taxonomy.preview(store, plan());
  assert.equal(p.changes.nodes.added.length, 3);
  assert.equal(taxonomy.read(store).revision, 0);
  const result = taxonomy.apply(store, plan());
  assert.equal(result.revision, 1);
  assert.equal(result.changed, true);
  assert.deepEqual(taxonomy.apply(store, plan()), {
    ...result,
    alreadyApplied: true,
  });
  assert.equal(taxonomy.read(store).mappings[0].id, demo.cards[0].conceptId);
  assert.deepEqual(
    store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before,
  );
  assert.deepEqual(
    store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
    history,
  );
  assert.equal(fs.existsSync(path.join(store.folder, "backups")), false);
});

test("primary paths reject cycles, ambiguous names, missing refs and stale revisions atomically", (t) => {
  const { store } = setup(t);
  taxonomy.apply(store, plan());
  const before = taxonomy.read(store);
  for (const [request, pattern] of [
    [
      {
        expectedRevision: 1,
        nodes: [node("data", "columnar", "Data Engineering")],
      },
      /cycle/,
    ],
    [
      { expectedRevision: 1, nodes: [node("bad", "missing")] },
      /Missing parent/,
    ],
    [
      { expectedRevision: 1, nodes: [node("twin", "data", "Storage")] },
      /Ambiguous/,
    ],
    [
      {
        expectedRevision: 1,
        nodes: [{ ...node("twin", "data"), aliases: ["STORAGE"] }],
      },
      /Ambiguous/,
    ],
    [{ expectedRevision: 1, nodes: [{ ...node("bad"), weight: 0 }] }, /weight/],
    [{ expectedRevision: 1, nodes: [node("root")] }, /reserved/],
    [
      {
        expectedRevision: 1,
        mappings: [{ kind: "card", id: "absent", nodeId: "columnar" }],
      },
      /does not exist/,
    ],
    [
      {
        expectedRevision: 1,
        mappings: [
          { kind: "concept", id: demo.cards[0].conceptId, nodeId: "missing" },
        ],
      },
      /missing node/,
    ],
    [
      {
        expectedRevision: 1,
        mappings: [
          { kind: "card", id: demo.cards[0].id, nodeId: "columnar" },
          { kind: "card", id: demo.cards[0].id, nodeId: "storage" },
        ],
      },
      /ambiguous/,
    ],
    [{ expectedRevision: 0, nodes: [node("other")] }, /revision conflict/],
    [{ expectedRevision: 1, expertise: 99 }, /Unsupported/],
  ]) {
    assert.throws(() => taxonomy.apply(store, request), pattern);
    assert.deepEqual(taxonomy.read(store), before);
  }
});

test("renames and moves retain identities; cross-links preserve provenance without parentage", (t) => {
  const { store } = setup(t);
  taxonomy.apply(store, plan());
  const request = {
    expectedRevision: 1,
    nodes: [
      node("memory", "data", "Columnar memory"),
      {
        ...node("columnar", "data", "Columnar files"),
        aliases: ["Columnar storage"],
        weight: 2,
      },
    ],
    relations: [
      {
        from: "columnar",
        to: "memory",
        type: "related",
        status: "suggested",
        source: "Different representations of columns",
      },
    ],
  };
  taxonomy.apply(store, request);
  const read = taxonomy.read(store),
    moved = read.nodes.find((n) => n.id === "columnar");
  assert.equal(moved.parentId, "data");
  assert.equal(read.mappings[0].nodeId, "columnar");
  assert.equal(read.relations[0].status, "suggested");
  assert.throws(
    () =>
      taxonomy.preview(store, {
        expectedRevision: 2,
        relations: [
          { from: "columnar", to: "memory", type: "uses", status: "explicit" },
        ],
      }),
    /supporting source/,
  );
  assert.throws(
    () =>
      taxonomy.apply(store, {
        expectedRevision: 2,
        remove: { nodeIds: ["columnar"] },
      }),
    /missing node/,
  );
  taxonomy.apply(store, {
    expectedRevision: 2,
    remove: {
      nodeIds: ["columnar"],
      mappings: [{ kind: "concept", id: demo.cards[0].conceptId }],
      relations: [{ from: "columnar", to: "memory", type: "related" }],
    },
  });
  assert.equal(taxonomy.read(store).mappings.length, 0);
  assert.equal(store.cards().length, demo.cards.length);
});

test("note mappings use scoped indexed identities and reject duplicates and removed sources", async (t) => {
  const { store, folder } = setup(t);
  const notes = path.join(folder, "notes");
  fs.mkdirSync(notes);
  saveConfig(folder, {
    sources: [{ id: "local", type: "markdown", root: notes, write: true }],
  });
  const raw =
    "---\nrecall:\n  id: stable-note\n---\n# Columnar memory\nTyped buffers.\n";
  fs.writeFileSync(path.join(notes, "Arrow.md"), raw);
  const { KnowledgeIndex } = require("../electron/knowledge-index.cjs");
  const index = new KnowledgeIndex(folder);
  t.after(() => index.close());
  await index.refresh();
  const request = {
    ...plan(),
    mappings: [
      {
        kind: "note",
        sourceId: "local",
        id: "stable-note",
        nodeId: "columnar",
      },
    ],
  };
  taxonomy.apply(store, request);
  assert.equal(fs.readFileSync(path.join(notes, "Arrow.md"), "utf8"), raw);
  fs.copyFileSync(
    path.join(notes, "Arrow.md"),
    path.join(notes, "Duplicate.md"),
  );
  await index.refresh();
  assert.throws(
    () =>
      taxonomy.preview(store, {
        expectedRevision: 1,
        mappings: request.mappings,
      }),
    /Ambiguous note/,
  );
  fs.unlinkSync(path.join(notes, "Duplicate.md"));
  await index.refresh();
  saveConfig(folder, { sources: [] });
  assert.throws(
    () =>
      taxonomy.preview(store, {
        expectedRevision: 1,
        mappings: request.mappings,
      }),
    /not configured/,
  );
});

test("CLI queues under the open writer and survives post-commit receipt interruption", (t) => {
  const { store, folder } = setup(t);
  const file = path.join(folder, "plan.json");
  fs.writeFileSync(file, JSON.stringify(plan()));
  const cli = (...args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, "../cli/recall.cjs"),
          "--data",
          folder,
          "taxonomy",
          ...args,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ),
    );
  assert.equal(cli("list").revision, 0);
  assert.equal(cli("preview", file).mode, "preview");
  assert.equal(cli("apply", file).mode, "preview");
  const queued = cli("apply", file, "--apply");
  assert.equal(queued.mode, "queued");
  assert.equal(cli("apply", file, "--apply").requestId, queued.requestId);
  // The DB commit survives a crash before its private queue receipt is replaced.
  taxonomy.apply(store, plan());
  assert.deepEqual(queue.applyPending(store), { applied: 1, changed: 0 });
  assert.equal(cli("status", queued.requestId).receipt.alreadyApplied, true);
  assert.equal(taxonomy.read(store).revision, 1);
  assert.deepEqual(queue.applyPending(store), { applied: 0, changed: 0 });
});

test("tampered, stale and symlink requests cannot mutate taxonomy or outside files", (t) => {
  const { store, folder } = setup(t);
  const request = queue.enqueue(folder, plan());
  const file = path.join(
    folder,
    "taxonomy-requests",
    request.requestId + ".json",
  );
  const raw = JSON.parse(fs.readFileSync(file));
  raw.plan.nodes[0].label = "Tampered";
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.deepEqual(queue.applyPending(store), { applied: 0, changed: 0 });
  assert.equal(queue.status(folder, request.requestId).mode, "blocked");
  assert.equal(taxonomy.read(store).revision, 0);
  const outside = path.join(folder, "outside.json");
  fs.writeFileSync(outside, "preserve");
  fs.symlinkSync(
    outside,
    path.join(folder, "taxonomy-requests", "a".repeat(64) + ".json"),
  );
  queue.applyPending(store);
  assert.equal(fs.readFileSync(outside, "utf8"), "preserve");
  assert.throws(() => queue.status(folder, "../outside"), /Invalid/);
  taxonomy.apply(store, { expectedRevision: 0, nodes: [node("different")] });
  const stale = queue.enqueue(folder, { ...plan(), nodes: [node("stale")] });
  queue.applyPending(store);
  assert.equal(queue.status(folder, stale.requestId).mode, "blocked");
  assert.equal(taxonomy.read(store).nodes[0].id, "different");
});

test("restored pending classifications require explicit resubmission", (t) => {
  const { store, folder } = setup(t);
  const request = queue.enqueue(folder, plan());
  const backup = require("../electron/backup.cjs");
  const destination = path.join(folder, "manual-export");
  backup.backup(store, destination);
  store.close();
  backup.restore(folder, destination);
  const restored = new Store(folder);
  try {
    assert.equal(
      queue.status(folder, request.requestId).mode,
      "needs_resubmission",
    );
    assert.deepEqual(queue.applyPending(restored), { applied: 0, changed: 0 });
    assert.equal(taxonomy.read(restored).revision, 0);
    assert.equal(queue.enqueue(folder, plan()).mode, "queued");
    assert.deepEqual(queue.applyPending(restored), { applied: 1, changed: 1 });
    assert.equal(taxonomy.read(restored).revision, 1);
  } finally {
    restored.close();
  }
});

test("optional objective identity is retained and rejects whitespace", () => {
  const { validateCards } = require("../electron/bundles.cjs");
  const card = {
    ...structuredClone(demo.cards[0]),
    objectiveId: "stable-capability",
  };
  assert.equal(validateCards([card])[0].objectiveId, "stable-capability");
  assert.throws(
    () => validateCards([{ ...card, objectiveId: " " }]),
    /objectiveId/,
  );
});
