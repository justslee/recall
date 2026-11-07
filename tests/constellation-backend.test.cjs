const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Store } = require("../electron/store.cjs");
const expertise = require("../electron/expertise.cjs");
const graph = require("../electron/constellation.cjs");
const taxonomy = require("../electron/taxonomy.cjs");
const { saveConfig } = require("../electron/config.cjs");
const { KnowledgeIndex } = require("../electron/knowledge-index.cjs");
const NOW = new Date("2026-11-06T12:00:00Z");
const card = (id, patch = {}) => ({
  id,
  conceptId: id,
  kind: "concept",
  title: id,
  prompt: "Explain this concept",
  answer: "A complete explanation",
  topic: "Systems",
  source: "Synthetic fixture",
  decks: ["Examples"],
  tags: [],
  difficulty: "Foundation",
  status: "ready",
  ...patch,
});
function fixture(t, cards = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-constellation-"));
  const folder = path.join(root, "profile"),
    notes = path.join(root, "notes");
  fs.mkdirSync(notes);
  saveConfig(folder, {
    captureEnabled: false,
    sources: [{ id: "local", type: "markdown", root: notes, write: true }],
  });
  const store = new Store(folder);
  expertise.install(store.db);
  if (cards.length) store.import(cards);
  const index = new KnowledgeIndex(folder);
  t.after(() => {
    index.close();
    store.close();
    graph.invalidateNotes(folder);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, folder, notes, store, index };
}
function writeNote(
  f,
  name,
  id,
  {
    topic,
    body = "A synthetic explanation.",
    conceptIds,
    cardIds,
    sources,
    title = name,
  } = {},
) {
  const yaml = require("yaml");
  const meta = {
    recall: {
      id,
      ...(topic ? { topics: [topic] } : {}),
      ...(conceptIds ? { conceptIds } : {}),
      ...(cardIds ? { cardIds } : {}),
      ...(sources ? { sources } : {}),
    },
  };
  fs.writeFileSync(
    path.join(f.notes, name + ".md"),
    "---\n" + yaml.stringify(meta) + "---\n# " + title + "\n\n" + body + "\n",
  );
}
const snap = (store, options = {}) =>
  graph.snapshot(store, { now: NOW, ...options });

test("all indexed notes remain reachable through bounded pages and unclassified fallback", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++)
    writeNote(f, "Note " + i, "note:" + i, {
      topic: i % 3 ? "Domain " + (i % 8) : undefined,
    });
  await f.index.refresh();
  const visited = new Set(),
    refs = new Set();
  function walk(id) {
    if (visited.has(id)) return;
    visited.add(id);
    let offset = 0,
      page;
    do {
      page = snap(f.store, { nodeId: id, offset, limit: 3 });
      assert(page.nodes.length <= 6);
      for (const n of [page.focus, ...page.nodes])
        for (const note of n.noteRefs)
          refs.add(note.sourceId + "/" + note.path);
      for (const child of page.nodes.filter((n) => n.parentId === id))
        walk(child.id);
      offset += 3;
    } while (page.hasMore);
  }
  walk("root");
  assert.equal(refs.size, 25);
  const root = snap(f.store, { limit: 24 });
  assert.equal(root.knowledge.noteCount, 25);
  assert(root.nodes.some((n) => n.label === "Unclassified"));
  assert(root.nodes.every((n) => n.summary.score === null));
  assert.equal(root.focus.summary.total, 0);
});

test("only exact canonical identities combine notes with practice; title similarity does not", async (t) => {
  const id = "123456781234123412341234567890ab";
  const f = fixture(t, [
    card("linked", { conceptId: "kb-" + id, title: "Shared title" }),
    card("other", { title: "Unrelated title" }),
  ]);
  writeNote(f, "Identity", "notion:" + id, { title: "Source title" });
  writeNote(f, "Same title", "independent-note", { title: "Shared title" });
  await f.index.refresh();
  const linked = snap(f.store, {
    nodeId: expertise.conceptNodeId("kb-" + id),
  }).focus;
  assert.equal(linked.noteRefs.length, 1);
  assert.equal(linked.noteRefs[0].id, "notion:" + id);
  assert.deepEqual(linked.cardIds, ["linked"]);
  assert.equal(linked.summary.score, null);
  const plain = snap(f.store, {
    nodeId: graph.noteNodeId({ sourceId: "local", id: "independent-note" }),
  }).focus;
  assert.equal(plain.noteOnly, true);
  assert.deepEqual(plain.cardIds, []);
  assert.equal(plain.noteRefs[0].path, "Same title.md");
});

test("source relationships stay visible across hierarchy depth; external citations do not become nodes", async (t) => {
  const f = fixture(t);
  writeNote(f, "A", "source:a", {
    body: "See [[source:b]] and [external](https://example.com/reference).",
  });
  writeNote(f, "B", "source:b");
  writeNote(f, "Citation", "source:citation", {
    sources: ["https://example.com/reference"],
  });
  await f.index.refresh();
  taxonomy.apply(f.store, {
    expectedRevision: 0,
    nodes: [
      { id: "data", label: "Data Engineering", parentId: null },
      { id: "storage", label: "Storage", parentId: "data" },
      { id: "math", label: "Mathematics", parentId: null },
      { id: "probability", label: "Probability", parentId: "math" },
    ],
    mappings: [
      { kind: "note", sourceId: "local", id: "source:a", nodeId: "storage" },
      {
        kind: "note",
        sourceId: "local",
        id: "source:b",
        nodeId: "probability",
      },
    ],
  });
  const root = snap(f.store);
  assert(
    root.edges.some(
      (e) =>
        [e.from, e.to].includes("data") &&
        [e.from, e.to].includes("math") &&
        e.status === "explicit",
    ),
  );
  const storage = snap(f.store, { nodeId: "storage" });
  assert(
    storage.nodes.some(
      (n) => n.id === "probability" && n.parentId !== "storage",
    ),
  );
  const leaf = snap(f.store, {
    nodeId: graph.noteNodeId({ sourceId: "local", id: "source:a" }),
  });
  assert(leaf.nodes.some((n) => n.noteRefs.some((r) => r.id === "source:b")));
  assert(
    leaf.nodes.every((n) =>
      n.noteRefs.every((r) => r.id !== "source:citation"),
    ),
  );
  assert(leaf.edges.every((e) => !JSON.stringify(e).includes("example.com")));
  assert.equal(root.knowledge.noteCount, 3);
});

test("taxonomy suggestions keep their status and note fallback reuses unique root labels", async (t) => {
  const f = fixture(t, [card("first", { topic: "Data Engineering" })]);
  writeNote(f, "Columns", "columns", { topic: "Data Engineering" });
  await f.index.refresh();
  taxonomy.apply(f.store, {
    expectedRevision: 0,
    nodes: [
      { id: "data", label: "Data Engineering", parentId: null },
      { id: "infra", label: "Infrastructure", parentId: null },
    ],
    relations: [
      { from: "data", to: "infra", type: "uses", status: "suggested" },
    ],
  });
  const root = snap(f.store);
  assert.equal(
    root.nodes.filter((n) => n.label === "Data Engineering").length,
    1,
  );
  assert(
    root.edges.some(
      (e) => e.from === "data" && e.to === "infra" && e.status === "suggested",
    ),
  );
  const data = snap(f.store, { nodeId: "data" });
  assert(data.nodes.some((n) => n.noteRefs.some((r) => r.id === "columns")));
  assert(data.nodes.some((n) => n.cardIds.includes("first")));
});

test("a declared Notion page URL resolves only to its exact indexed canonical identity", async (t) => {
  const f = fixture(t);
  const id = "123456781234123412341234567890ab";
  const url = "https://www.notion.so/A-page-" + id;
  writeNote(f, "From", "from", { body: "See [a saved note](" + url + ")." });
  writeNote(f, "Exact page", "notion:" + id, { sources: [url] });
  writeNote(f, "Cites same page", "independent-citation", { sources: [url] });
  await f.index.refresh();
  const result = snap(f.store, {
    nodeId: graph.noteNodeId({ sourceId: "local", id: "from" }),
  });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].noteRefs[0].id, "notion:" + id);
  assert.equal(result.edges[0].status, "explicit");
});

test("warm drill-down uses cached identities and targeted summaries, never full review history", async (t) => {
  const f = fixture(t, [card("practice")]);
  writeNote(f, "Practice", "practice");
  await f.index.refresh();
  const first = snap(f.store);
  const before = {
    cards: f.store.db.prepare("SELECT * FROM cards").all(),
    reviews: f.store.db.prepare("SELECT * FROM reviews").all(),
  };
  const prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function (sql, ...args) {
    if (
      /SELECT\s+(?:source,path,id,title,metadata|id,data)\s+FROM\s+(?:notes|expertise_concepts)/i.test(
        sql,
      ) &&
      !/WHERE/i.test(sql)
    )
      throw Error("Repeated full identity scan");
    if (/FROM\s+reviews\b/i.test(sql) && !/WHERE\s+card_id=/i.test(sql))
      throw Error("Full review history read");
    return prepare.call(this, sql, ...args);
  };
  try {
    const child = snap(f.store, { nodeId: first.nodes[0].id });
    assert(child.nodes.some((n) => n.cardIds.includes("practice")));
    assert.equal(
      snap(f.store, { nodeId: expertise.conceptNodeId("practice") }).focus
        .noteRefs.length,
      1,
    );
  } finally {
    DatabaseSync.prototype.prepare = prepare;
  }
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM cards").all(),
    before.cards,
  );
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM reviews").all(),
    before.reviews,
  );
});

test("index invalidation, renamed notes and removed sources update the graph without stale exposure", async (t) => {
  const f = fixture(t);
  writeNote(f, "Original", "stable", { topic: "Systems" });
  await f.index.refresh();
  const id = graph.noteNodeId({ sourceId: "local", id: "stable" });
  assert.equal(
    snap(f.store, { nodeId: id }).focus.noteRefs[0].path,
    "Original.md",
  );
  fs.renameSync(
    path.join(f.notes, "Original.md"),
    path.join(f.notes, "Renamed.md"),
  );
  await f.index.refresh();
  graph.invalidateNotes(f.folder);
  assert.equal(
    snap(f.store, { nodeId: id }).focus.noteRefs[0].path,
    "Renamed.md",
  );
  saveConfig(f.folder, { sources: [] });
  const after = snap(f.store, { nodeId: id });
  assert.equal(after.focus.id, "root");
  assert.equal(after.knowledge.noteCount, 0);
  assert.equal(after.nodes.length, 0);
});

test("duplicate note identities remain individually reachable and never alias a practice concept", async (t) => {
  const f = fixture(t, [card("same")]);
  writeNote(f, "One", "same");
  writeNote(f, "Two", "same");
  await f.index.refresh();
  const parent = snap(f.store, {
    nodeId: expertise.fallbackId("Unclassified"),
  });
  assert.equal(parent.nodes.filter((n) => n.duplicateIdentity).length, 2);
  assert.deepEqual(
    new Set(parent.nodes.flatMap((n) => n.noteRefs.map((r) => r.path))),
    new Set(["One.md", "Two.md"]),
  );
  assert.equal(
    snap(f.store, { nodeId: expertise.conceptNodeId("same") }).focus.noteRefs
      .length,
    0,
  );
});

test("format filtering isolates card evidence while note-only scope remains unassessed", async (t) => {
  const f = fixture(t, [
    card("concept"),
    card("code", {
      kind: "code",
      code: { python: { stub: "pass", solution: "pass", harness: "pass" } },
    }),
  ]);
  writeNote(f, "Unmapped", "unmapped", { topic: "Systems" });
  await f.index.refresh();
  const parent = snap(f.store, {
    nodeId: expertise.fallbackId("Systems"),
    format: "code",
  });
  assert(!parent.nodes.some((n) => n.cardIds.includes("concept")));
  assert(parent.nodes.some((n) => n.cardIds.includes("code")));
  const note = parent.nodes.find((n) => n.noteOnly);
  assert(note);
  assert.equal(note.summary.score, null);
  assert.equal(note.summary.total, 0);
});

test("graph hides future evidence during a bounded backward-clock repair", (t) => {
  const cards = Array.from({ length: 251 }, (_, i) =>
    card("clock-" + String(i).padStart(3, "0")),
  );
  const f = fixture(t, cards);
  for (const c of cards) {
    const sessionId = "graph-review-" + c.id;
    f.store.set("session", {
      id: sessionId,
      ids: [c.id],
      index: 0,
      revealed: true,
      rated: 0,
      skipped: 0,
      selection: { practice: false },
    });
    f.store.rate({ id: c.id, rating: "Good", sessionId }, NOW);
  }
  expertise.refresh(f.store, { now: NOW, budget: 1000 });
  const before = snap(f.store, {
    nodeId: expertise.conceptNodeId("clock-250"),
  });
  assert(before.focus.summary.score > 0);
  const earlier = new Date(NOW.getTime() - 86400000);
  const result = snap(f.store, {
    nodeId: before.focus.id,
    now: earlier,
  });
  assert.equal(result.checkpoint.clockReset, true);
  assert.equal(result.checkpoint.pending, 1);
  assert.equal(result.focus.summary.total, 1);
  for (const n of [result.focus, ...result.nodes]) {
    assert.equal(n.summary.score, null);
    assert.equal(n.summary.assessed, 0);
    assert.equal(n.summary.coverage, 0);
    assert.equal(n.summary.lastReviewAt, null);
  }
});

const domains = ["computing", "mathematics-statistics", "economics-finance"];
function lockDomains(store, extra = {}) {
  return taxonomy.apply(store, {
    expectedRevision: taxonomy.read(store).revision,
    ...extra,
    nodes: [
      ...domains.map((id) => ({ id, label: id, parentId: null })),
      ...(extra.nodes || []),
    ],
    rootPolicy: { mode: "locked", rootIds: domains },
  });
}

test("continuous canvas enumerates every opened branch and every cross-edge through bounded stable pages", (t) => {
  const f = fixture(t);
  const branches = Array.from({ length: 220 }, (_, i) => ({
    id: "branch-" + i,
    label: "Branch " + i,
    parentId: "computing",
  }));
  const relations = branches.flatMap((n, i) =>
    Array.from({ length: 6 }, (_, j) => ({
      from: n.id,
      to: branches[(i + j + 1) % branches.length].id,
      type: "uses",
      status: "suggested",
    })),
  );
  lockDomains(f.store, {
    nodes: [
      ...branches,
      {
        id: "math-child",
        label: "Mathematics child",
        parentId: "mathematics-statistics",
      },
      {
        id: "finance-child",
        label: "Finance child",
        parentId: "economics-finance",
      },
    ],
    relations,
  });
  const initial = snap(f.store, { continuous: true });
  assert.deepEqual(new Set(initial.nodes.map((n) => n.id)), new Set(domains));
  assert.equal(initial.nodes.find((n) => n.id === "computing").childCount, 220);
  const nodes = new Map(),
    edges = new Map();
  let offset = 0,
    edgeOffset = 0,
    revision,
    pages = 0,
    page;
  do {
    page = snap(f.store, {
      continuous: true,
      expandedIds: domains,
      selectedId: "computing",
      offset,
      edgeOffset,
      limit: 37,
      edgeLimit: 53,
    });
    assert(page.nodes.length <= 37);
    assert(page.edges.length <= 53);
    if (revision) assert.equal(page.graphRevision, revision);
    revision = page.graphRevision;
    for (const n of page.nodes) {
      assert(!nodes.has(n.id), "node pagination must not repeat prior pages");
      nodes.set(n.id, n);
    }
    for (const e of page.edges) {
      const key = JSON.stringify([e.from, e.to, e.type]);
      assert(!edges.has(key), "edge pagination must not repeat prior pages");
      edges.set(key, e);
    }
    offset += page.nodes.length;
    edgeOffset += page.edges.length;
    assert(++pages < 100);
  } while (page.hasMore || page.hasMoreEdges);
  assert.equal(nodes.size, 225);
  assert.equal(edges.size, 1320 + 222);
  assert.equal(page.total, nodes.size);
  assert.equal(page.edgeTotal, edges.size);
  assert(!nodes.has("root"));
  for (const e of edges.values()) assert(nodes.has(e.from) && nodes.has(e.to));
  for (const id of domains)
    assert(nodes.has(id), "root siblings remain in the same canvas");
  const closed = snap(f.store, {
    continuous: true,
    expandedIds: ["mathematics-statistics"],
    selectedId: "computing",
  });
  assert.deepEqual(
    new Set(closed.nodes.map((n) => n.id)),
    new Set([...domains, "math-child"]),
  );
  const leaf = snap(f.store, {
    continuous: true,
    expandedIds: ["branch-219"],
    selectedId: "branch-219",
  });
  assert.equal(leaf.focus.id, "branch-219");
  assert(leaf.nodes.some((n) => n.id === "computing"));
  assert(
    leaf.edges.some((e) => e.from === "computing" && e.to === "branch-219"),
  );
  assert.notEqual(closed.graphRevision, revision);
});

test("locked domains route unfamiliar imports to reachable unclassified and keep library guides outside domains", async (t) => {
  const f = fixture(t, [
    card("unmapped-card", { topic: "Imported odd topic" }),
    card("known", { topic: "computing" }),
  ]);
  writeNote(f, "Unmatched note", "unmatched-note", {
    topic: "Not a fourth root",
  });
  writeNote(f, "Knowledge Base Map", "navigation-note", { topic: "Library" });
  await f.index.refresh();
  lockDomains(f.store, {
    mappings: [
      {
        kind: "note",
        sourceId: "local",
        id: "navigation-note",
        nodeId: "library:guides",
      },
    ],
  });
  const root = snap(f.store, { continuous: true });
  assert.deepEqual(new Set(root.nodes.map((n) => n.id)), new Set(domains));
  assert.deepEqual(
    new Set(root.holdingAreas.map((n) => n.id)),
    new Set(["holding:unclassified", "library:guides"]),
  );
  assert.equal(
    root.holdingAreas.find((n) => n.id === "holding:unclassified").childCount,
    2,
  );
  const holding = snap(f.store, {
    continuous: true,
    expandedIds: ["holding:unclassified"],
    selectedId: "holding:unclassified",
  });
  assert.equal(holding.focus.kind, "holding");
  assert(holding.nodes.some((n) => n.cardIds.includes("unmapped-card")));
  assert(
    holding.nodes.some((n) =>
      n.noteRefs.some((r) => r.id === "unmatched-note"),
    ),
  );
  const guide = snap(f.store, {
    continuous: true,
    expandedIds: ["library:guides"],
    selectedId: "library:guides",
  });
  assert.equal(guide.focus.kind, "navigation");
  assert.equal(guide.focus.summary.score, null);
  assert(
    guide.nodes.some((n) => n.noteRefs.some((r) => r.id === "navigation-note")),
  );
  assert.equal(
    root.focus.summary.total,
    1,
    "unclassified does not pretend to be a fourth scored domain",
  );
  assert.throws(
    () =>
      taxonomy.preview(f.store, {
        expectedRevision: 1,
        mappings: [{ kind: "card", id: "known", nodeId: "library:guides" }],
      }),
    /reserved/,
  );
  assert.throws(
    () =>
      taxonomy.preview(f.store, {
        expectedRevision: 1,
        mappings: [
          {
            kind: "note",
            sourceId: "local",
            id: "absent",
            nodeId: "library:guides",
          },
        ],
      }),
    /not in the selected/,
  );
  f.store.import([
    card("new-card", { topic: "Yet another unexpected domain" }),
  ]);
  writeNote(f, "Later import", "later-note", { topic: "Unexpected" });
  await f.index.refresh();
  const later = snap(f.store, { continuous: true });
  assert.deepEqual(new Set(later.nodes.map((n) => n.id)), new Set(domains));
  assert.equal(
    later.holdingAreas.find((n) => n.kind === "holding").childCount,
    4,
  );
  assert.notEqual(root.graphRevision, later.graphRevision);
  taxonomy.apply(f.store, {
    expectedRevision: 1,
    mappings: [
      { kind: "concept", id: "unmapped-card", nodeId: "computing" },
      {
        kind: "note",
        sourceId: "local",
        id: "unmatched-note",
        nodeId: "computing",
      },
    ],
  });
  const moved = snap(f.store, { continuous: true, expandedIds: ["computing"] });
  assert(moved.nodes.some((n) => n.cardIds.includes("unmapped-card")));
  assert.equal(
    moved.holdingAreas.find((n) => n.kind === "holding").childCount,
    2,
  );
});

test("continuous connections project a hidden endpoint onto its closest visible ancestor without inventing its predicate", async (t) => {
  const f = fixture(t);
  writeNote(f, "Yen", "yen-note", { body: "Connected to [[liquidity-note]]." });
  writeNote(f, "Liquidity", "liquidity-note");
  await f.index.refresh();
  lockDomains(f.store, {
    nodes: [
      { id: "fx", label: "Foreign exchange", parentId: "economics-finance" },
      { id: "liquidity", label: "Liquidity", parentId: "economics-finance" },
    ],
    mappings: [
      { kind: "note", sourceId: "local", id: "yen-note", nodeId: "fx" },
      {
        kind: "note",
        sourceId: "local",
        id: "liquidity-note",
        nodeId: "liquidity",
      },
    ],
  });
  const yen = graph.noteNodeId({ sourceId: "local", id: "yen-note" });
  const liquidity = graph.noteNodeId({
    sourceId: "local",
    id: "liquidity-note",
  });
  const partial = snap(f.store, {
    continuous: true,
    selectedId: yen,
    expandedIds: ["economics-finance", "fx"],
  });
  assert(!partial.nodes.some((n) => n.id === liquidity));
  const projected = partial.edges.find(
    (e) =>
      new Set([e.from, e.to]).has(yen) &&
      new Set([e.from, e.to]).has("liquidity"),
  );
  assert(projected);
  assert.equal(projected.aggregated, true);
  assert.equal(projected.type, "linked-notes");
  assert.equal(projected.status, "explicit");
  assert.equal(projected.source, "local:Yen.md");
  const full = snap(f.store, {
    continuous: true,
    selectedId: yen,
    expandedIds: ["economics-finance", "fx", "liquidity"],
  });
  assert(
    full.edges.some(
      (e) =>
        e.type === "linked-notes" &&
        !e.aggregated &&
        [e.from, e.to].includes(yen) &&
        [e.from, e.to].includes(liquidity),
    ),
  );
  assert(!full.edges.some((e) => e.from === e.to));
});

test("locked fallback reuses only unique exact canonical labels or aliases at any depth", async (t) => {
  const f = fixture(t, [
    card("known", { topic: "Data Engineering" }),
    card("alias", { topic: "ＤＡＴＡ infrastructure" }),
    card("ambiguous", { topic: "Risk" }),
    card("fuzzy", { topic: "Data engineer" }),
    card("explicit", { topic: "Data Engineering" }),
    card("card-explicit", { topic: "Data Engineering" }),
    card("conflict-a", { conceptId: "conflict", topic: "Data Engineering" }),
    card("conflict-b", { conceptId: "conflict", topic: "Data Engineering" }),
  ]);
  for (const [id, topic] of [
    ["known-note", "Data Engineering"],
    ["alias-note", " data infrastructure "],
    ["ambiguous-note", "Risk"],
    ["fuzzy-note", "Data engineer"],
    ["explicit-note", "Data Engineering"],
  ])
    writeNote(f, id, id, { topic });
  await f.index.refresh();
  const beforeCards = f.store.db
    .prepare("SELECT * FROM cards ORDER BY id")
    .all();
  lockDomains(f.store, {
    nodes: [
      {
        id: "data-engineering",
        label: "Data Engineering",
        aliases: ["Data infrastructure"],
        parentId: "computing",
      },
      { id: "math-risk", label: "Risk", parentId: "mathematics-statistics" },
      { id: "finance-risk", label: "Risk", parentId: "economics-finance" },
    ],
    mappings: [
      { kind: "concept", id: "explicit", nodeId: "economics-finance" },
      { kind: "card", id: "card-explicit", nodeId: "mathematics-statistics" },
      { kind: "card", id: "conflict-a", nodeId: "computing" },
      { kind: "card", id: "conflict-b", nodeId: "economics-finance" },
      {
        kind: "note",
        sourceId: "local",
        id: "explicit-note",
        nodeId: "economics-finance",
      },
    ],
  });
  const root = snap(f.store, { continuous: true });
  assert.deepEqual(new Set(root.nodes.map((n) => n.id)), new Set(domains));
  const parentOf = (id) => snap(f.store, { selectedId: id }).focus.parentId;
  for (const id of ["known", "alias"])
    assert.equal(parentOf(expertise.conceptNodeId(id)), "data-engineering");
  for (const id of ["known-note", "alias-note"])
    assert.equal(
      parentOf(graph.noteNodeId({ sourceId: "local", id })),
      "data-engineering",
    );
  for (const id of ["ambiguous", "fuzzy", "conflict"])
    assert.equal(parentOf(expertise.conceptNodeId(id)), "holding:unclassified");
  for (const id of ["ambiguous-note", "fuzzy-note"])
    assert.equal(
      parentOf(graph.noteNodeId({ sourceId: "local", id })),
      "holding:unclassified",
    );
  assert.equal(
    parentOf(expertise.conceptNodeId("explicit")),
    "economics-finance",
  );
  assert.equal(
    parentOf(expertise.conceptNodeId("card-explicit")),
    "mathematics-statistics",
  );
  assert.equal(
    parentOf(graph.noteNodeId({ sourceId: "local", id: "explicit-note" })),
    "economics-finance",
  );
  assert.deepEqual(
    f.store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    beforeCards,
  );
  // Adding the same canonical name elsewhere changes fallback classification
  // without modifying the source topic. Explicit mapping still wins.
  taxonomy.apply(f.store, {
    expectedRevision: 1,
    nodes: [
      {
        id: "other-data",
        label: "Data Engineering",
        parentId: "economics-finance",
      },
    ],
  });
  assert.equal(
    parentOf(expertise.conceptNodeId("known")),
    "holding:unclassified",
  );
  assert.equal(
    parentOf(graph.noteNodeId({ sourceId: "local", id: "known-note" })),
    "holding:unclassified",
  );
  assert.equal(
    parentOf(expertise.conceptNodeId("explicit")),
    "economics-finance",
  );
});

test("open legacy taxonomy keeps its original root-only fallback behavior", async (t) => {
  const f = fixture(t, [card("known", { topic: "Data Engineering" })]);
  writeNote(f, "Known note", "known-note", { topic: "Data Engineering" });
  await f.index.refresh();
  taxonomy.apply(f.store, {
    expectedRevision: 0,
    nodes: [
      { id: "computing", label: "Computing", parentId: null },
      {
        id: "data-engineering",
        label: "Data Engineering",
        parentId: "computing",
      },
    ],
  });
  const parent = expertise.fallbackId("Data Engineering");
  assert.equal(
    snap(f.store, { nodeId: expertise.conceptNodeId("known") }).focus.parentId,
    parent,
  );
  assert.equal(
    snap(f.store, {
      nodeId: graph.noteNodeId({ sourceId: "local", id: "known-note" }),
    }).focus.parentId,
    parent,
  );
});
