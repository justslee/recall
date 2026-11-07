// Bounded graph snapshots over canonical organization and the derived expertise
// projection. Source bodies and complete review history never enter the renderer.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { config } = require("./config.cjs");
const taxonomy = require("./taxonomy.cjs");
const expertise = require("./expertise.cjs");
const kb = require("../adapters/knowledge.cjs");
const noteCaches = new Map(),
  invalidations = new Map(),
  graphCaches = new WeakMap();
const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fold = (value) =>
  String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase();
const parse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const noteKey = (note) => JSON.stringify([note.sourceId, note.id]);
const noteNodeId = (note) =>
  "note:" + hash([note.sourceId, note.id]).slice(0, 32);
const array = (value) => (Array.isArray(value) ? value : []);

function invalidateNotes(folder) {
  noteCaches.delete(folder);
  invalidations.set(folder, (invalidations.get(folder) || 0) + 1);
}
function stamp(file) {
  try {
    const s = fs.statSync(file, { bigint: true });
    return [s.ino, s.size, s.mtimeNs].join(":");
  } catch (e) {
    if (e.code === "ENOENT") return "missing";
    throw e;
  }
}
function notes(folder) {
  const sources = config(folder).sources.filter((s) =>
    ["markdown", "obsidian"].includes(s.type),
  );
  const file = path.join(folder, "cache", "knowledge", "search-v1.sqlite");
  const signature = hash([
    sources.map((s) => [s.id, s.root, s.type]),
    stamp(file),
    stamp(file + "-wal"),
    invalidations.get(folder) || 0,
  ]);
  const prior = noteCaches.get(folder);
  if (prior?.signature === signature) return prior;
  const result = {
    signature,
    notes: [],
    issues: [],
    indexedSources: 0,
    configuredSources: sources.length,
  };
  if (!sources.length) {
    noteCaches.set(folder, result);
    return result;
  }
  if (!fs.existsSync(file)) {
    result.issues.push(
      "Knowledge indexing is not ready. Connected notes will appear after indexing finishes.",
    );
    return result;
  }
  if (fs.lstatSync(file).isSymbolicLink())
    throw Error("Unsafe Knowledge index");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const scopes = new Map(
      db
        .prepare("SELECT id,fingerprint,issues FROM scopes")
        .all()
        .map((s) => [s.id, s]),
    );
    const ready = sources.filter(
      (s) =>
        scopes.get(s.id)?.fingerprint === kb.digest([s.id, s.root, s.type]),
    );
    result.indexedSources = ready.length;
    if (ready.length !== sources.length)
      result.issues.push(
        "Some Knowledge sources are awaiting their index refresh.",
      );
    for (const s of ready) {
      const problems = parse(scopes.get(s.id).issues) || [];
      if (problems.length)
        result.issues.push(
          (s.name || s.id) + ": some notes could not be indexed",
        );
    }
    if (ready.length) {
      const ids = ready.map((s) => s.id);
      const rows = db
        .prepare(
          `SELECT source,path,id,title,metadata FROM notes WHERE source IN (${ids.map(() => "?").join(",")}) ORDER BY source,path`,
        )
        .all(...ids);
      for (const row of rows) {
        const meta = parse(row.metadata);
        if (
          !meta ||
          meta.sourceId !== row.source ||
          meta.id !== row.id ||
          meta.path !== row.path
        )
          continue;
        result.notes.push({
          sourceId: row.source,
          path: row.path,
          id: row.id,
          title: expertise.plain(row.title),
          topics: array(meta.topics).filter((x) => typeof x === "string"),
          aliases: array(meta.aliases).filter((x) => typeof x === "string"),
          conceptIds: array(meta.conceptIds).filter(
            (x) => typeof x === "string",
          ),
          cardIds: array(meta.cardIds).filter((x) => typeof x === "string"),
          references: array(meta.references).filter(
            (x) => typeof x === "string",
          ),
          links: array(meta.links).filter((x) => typeof x === "string"),
        });
      }
    }
  } catch (error) {
    result.issues.push(
      "Knowledge index is temporarily unavailable; retry after indexing finishes.",
    );
    result.notes = [];
    return result;
  } finally {
    db.close();
  }
  noteCaches.set(folder, result);
  return result;
}

// These are established canonical source identity conventions, not title or
// semantic similarity. Ambiguous exact identities are left as separate nodes.
function canonical(value) {
  const text = String(value || "");
  const match = text.match(
    /^(?:notion:|kb-)([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i,
  );
  return match ? "notion:" + match[1].replaceAll("-", "").toLowerCase() : text;
}
function identifiesNote(note, reference) {
  // `references` also holds citations used while authoring a note. A shared
  // source URL is not the note's identity and cannot create a graph edge.
  try {
    const url = new URL(reference);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !/(^|\.)notion\.(?:so|site)$/i.test(url.hostname)
    )
      return false;
    const match = url.pathname.match(
      /([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i,
    );
    return !!match && canonical(note.id) === canonical("notion:" + match[1]);
  } catch {
    return reference === note.id;
  }
}
function indexSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}
function addEdge(graph, raw) {
  if (
    !graph.nodes.has(raw.from) ||
    !graph.nodes.has(raw.to) ||
    raw.from === raw.to
  )
    return;
  const symmetric = ["related", "linked-notes", "practice"].includes(raw.type);
  const ends = symmetric ? [raw.from, raw.to].sort() : [raw.from, raw.to];
  const key = JSON.stringify([...ends, raw.type]);
  const old = graph.edges.get(key);
  if (old?.status === "explicit" || (old && raw.status !== "explicit")) return;
  const edge = { ...raw, from: ends[0], to: ends[1] };
  graph.edges.set(key, edge);
  for (const id of ends) {
    if (!graph.adj.has(id)) graph.adj.set(id, new Set());
    graph.adj.get(id).add(key);
  }
}
function ancestry(graph, id) {
  const result = [],
    seen = new Set();
  while (id && graph.nodes.has(id) && !seen.has(id) && result.length < 66) {
    seen.add(id);
    result.unshift(id);
    id = graph.nodes.get(id).parentId;
  }
  return result;
}
function liftEdge(graph, edge) {
  addEdge(graph, edge);
  const a = ancestry(graph, edge.from),
    b = ancestry(graph, edge.to);
  for (let depth = 1; depth < Math.max(a.length, b.length); depth++) {
    const from = a[Math.min(depth, a.length - 1)],
      to = b[Math.min(depth, b.length - 1)];
    if (from === to || (from === edge.from && to === edge.to)) continue;
    // A source relationship can connect the containing regions without claiming
    // that its exact semantic predicate applies to each broader domain.
    addEdge(graph, {
      from,
      to,
      type: "linked-notes",
      status: edge.status,
      source: edge.source,
      aggregated: true,
    });
  }
}
function buildStructure(store, checkpoint, knowledge, tax) {
  const db = store.db;
  const graph = {
    nodes: new Map(),
    children: new Map(),
    edges: new Map(),
    adj: new Map(),
    redirects: new Map(),
    concepts: new Map(),
    noteCount: knowledge.notes.length,
    unmappedNoteCount: 0,
  };
  for (const row of db
    .prepare("SELECT id,parent_id,label,data FROM expertise_nodes")
    .all()) {
    const value = parse(row.data) || {};
    graph.nodes.set(row.id, {
      ...value,
      id: row.id,
      parentId: row.parent_id,
      label: expertise.plain(row.label),
      kind: value.kind === "holding" ? "holding" : "topic",
      noteRefs: [],
    });
  }
  if (!graph.nodes.has("root"))
    graph.nodes.set("root", {
      id: "root",
      label: "All knowledge",
      parentId: null,
      kind: "topic",
      noteRefs: [],
    });
  const members = new Map(
    db
      .prepare("SELECT concept_id,node_id FROM expertise_members")
      .all()
      .map((r) => [r.concept_id, r.node_id]),
  );
  const byConcept = new Map(),
    byCard = new Map();
  for (const row of db
    .prepare("SELECT id,data FROM expertise_concepts ORDER BY id")
    .all()) {
    const c = parse(row.data);
    if (!c) continue;
    const id = expertise.conceptNodeId(c.id),
      parentId = members.get(c.id) || "root";
    graph.concepts.set(c.id, c);
    graph.nodes.set(id, {
      id,
      conceptId: c.id,
      label: expertise.plain(c.title),
      parentId,
      kind: "concept",
      noteRefs: [],
      cardIds: c.cardIds || [],
      formats: c.formats,
    });
    indexSet(byConcept, canonical(c.id), id);
    for (const cardId of c.cardIds || []) byCard.set(cardId, id);
  }
  const noteMappings = new Map(
    tax.mappings
      .filter((m) => m.kind === "note")
      .map((m) => [JSON.stringify([m.sourceId, m.id]), m.nodeId]),
  );
  const fallbackNames = new Map();
  const locked = tax.rootPolicy?.mode === "locked";
  for (const n of locked ? tax.nodes : graph.nodes.values())
    if (locked || n.parentId === "root")
      for (const label of [n.label, ...array(n.aliases)])
        indexSet(fallbackNames, fold(label), n.id);
  function fallback(topic) {
    const matches = fallbackNames.get(fold(topic));
    if (matches?.size === 1) return [...matches][0];
    if (locked) {
      const id = taxonomy.HOLDING_ID;
      if (!graph.nodes.has(id))
        graph.nodes.set(id, {
          id,
          label: "Unclassified",
          parentId: null,
          kind: "holding",
          inferred: true,
          noteOnly: true,
          noteRefs: [],
        });
      return id;
    }
    const id = expertise.fallbackId(topic);
    if (!graph.nodes.has(id)) {
      graph.nodes.set(id, {
        id,
        label: topic,
        parentId: "root",
        kind: "topic",
        inferred: true,
        noteOnly: true,
        noteRefs: [],
      });
      indexSet(fallbackNames, fold(topic), id);
    }
    return id;
  }
  const noteCounts = new Map();
  for (const note of knowledge.notes)
    noteCounts.set(noteKey(note), (noteCounts.get(noteKey(note)) || 0) + 1);
  const byScopedAlias = new Map(),
    byReference = new Map(),
    noteNodes = new Map(),
    rawEdges = [];
  for (const note of knowledge.notes) {
    const key = noteKey(note),
      rawId = noteNodeId(note),
      duplicate = noteCounts.get(key) > 1;
    const id = duplicate ? rawId + ":" + hash(note.path).slice(0, 12) : rawId;
    const explicit = !duplicate && noteMappings.get(key);
    if (explicit === taxonomy.LIBRARY_ID && !graph.nodes.has(explicit))
      graph.nodes.set(explicit, {
        id: explicit,
        label: "Library guides",
        parentId: null,
        kind: "navigation",
        noteOnly: true,
        noteRefs: [],
      });
    const linked = new Set();
    for (const ref of [note.id, ...note.conceptIds]) {
      const candidates = byConcept.get(canonical(ref));
      if (candidates?.size === 1) linked.add([...candidates][0]);
    }
    for (const cardId of note.cardIds)
      if (byCard.has(cardId)) linked.add(byCard.get(cardId));
    const target = linked.size === 1 && !duplicate ? [...linked][0] : null;
    const direct =
      target && (!explicit || graph.nodes.get(target).parentId === explicit);
    const reference = {
      sourceId: note.sourceId,
      path: note.path,
      id: note.id,
      title: note.title,
    };
    let graphId;
    if (direct && graph.nodes.get(target).noteRefs.length < 20) {
      graphId = target;
      graph.nodes.get(target).noteRefs.push(reference);
      graph.redirects.set(rawId, target);
    } else {
      const parentId =
        explicit && graph.nodes.has(explicit)
          ? explicit
          : direct
            ? target
            : fallback(note.topics[0] || "Unclassified");
      graphId = id;
      graph.nodes.set(id, {
        id,
        label: note.title,
        parentId,
        kind: "concept",
        noteOnly: true,
        noteRefs: [reference],
        cardIds: [],
        duplicateIdentity: duplicate,
      });
      if (!linked.size) graph.unmappedNoteCount++;
      for (const linkedId of linked)
        rawEdges.push({
          from: id,
          to: linkedId,
          type: "practice",
          status: "explicit",
          source: note.sourceId + ":" + note.path,
        });
    }
    noteNodes.set(JSON.stringify([note.sourceId, note.path]), graphId);
    const values = [
      note.id,
      note.path,
      note.path.replace(/\.(?:md|markdown|html?)$/i, ""),
      path.posix.basename(note.path, path.posix.extname(note.path)),
      note.title,
      ...note.aliases,
    ];
    for (const v of values)
      indexSet(
        byScopedAlias,
        JSON.stringify([note.sourceId, fold(v)]),
        graphId,
      );
    for (const ref of note.references)
      if (identifiesNote(note, ref)) indexSet(byReference, fold(ref), graphId);
  }
  function resolve(note, target) {
    const value = String(target).split("#")[0].trim();
    if (!value) return null;
    const identity = byScopedAlias.get(
      JSON.stringify([note.sourceId, fold(value)]),
    );
    if (identity?.size === 1) return [...identity][0];
    if (identity?.size > 1) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      // An external citation is not a concept edge. Only an exact declared
      // reference to a note already in this source set can resolve here.
      const match = byReference.get(fold(value));
      return match?.size === 1 ? [...match][0] : null;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return null;
    }
    const relative = path.posix.normalize(
      path.posix.join(path.posix.dirname(note.path), decoded),
    );
    const candidates = [decoded];
    if (!relative.startsWith("../") && !path.posix.isAbsolute(relative))
      candidates.unshift(relative);
    for (const candidate of candidates) {
      const matches = byScopedAlias.get(
        JSON.stringify([note.sourceId, fold(candidate)]),
      );
      if (matches?.size === 1) return [...matches][0];
      if (matches?.size > 1) return null;
    }
    return null;
  }
  for (const note of knowledge.notes) {
    const from = noteNodes.get(JSON.stringify([note.sourceId, note.path]));
    for (const link of note.links) {
      const to = resolve(note, link);
      if (to)
        rawEdges.push({
          from,
          to,
          type: "linked-notes",
          status: "explicit",
          source: note.sourceId + ":" + note.path,
        });
    }
  }
  for (const edge of tax.relations) rawEdges.push(edge);
  for (const edge of rawEdges) liftEdge(graph, edge);
  for (const n of graph.nodes.values()) {
    if (n.parentId && !graph.nodes.has(n.parentId)) n.parentId = "root";
    if (!graph.children.has(n.parentId)) graph.children.set(n.parentId, []);
    graph.children.get(n.parentId).push(n.id);
  }
  for (const children of graph.children.values())
    children.sort((a, b) => {
      const x = graph.nodes.get(a),
        y = graph.nodes.get(b);
      return (
        (x.kind === "topic" ? 0 : 1) - (y.kind === "topic" ? 0 : 1) ||
        x.label.localeCompare(y.label) ||
        a.localeCompare(b)
      );
    });
  return graph;
}
function structure(store, checkpoint, knowledge, tax) {
  const generation =
    checkpoint.topologyGeneration ||
    parse(
      store.db
        .prepare("SELECT value FROM expertise_meta WHERE key='topology'")
        .get()?.value,
    )?.generation ||
    0;
  const key = JSON.stringify([generation, tax.revision, knowledge.signature]);
  const prior = graphCaches.get(store.db);
  if (prior?.key === key) return prior.graph;
  const graph = buildStructure(store, checkpoint, knowledge, tax);
  graphCaches.set(store.db, { key, graph });
  return graph;
}
function visibleFor(graph, id, format) {
  const n = graph.nodes.get(id);
  return (
    !!n &&
    (format === "all" ||
      n.kind === "topic" ||
      n.kind === "holding" ||
      n.kind === "navigation" ||
      n.noteOnly ||
      n.noteRefs.length ||
      n.formats?.[format]?.total > 0)
  );
}
function continuousView(graph, format, opened, nodeId) {
  const key = JSON.stringify([format, opened, nodeId]);
  if (!graph.views) graph.views = new Map();
  const prior = graph.views.get(key);
  if (prior) return prior;
  // Page a stable union, not separate replacement scenes. Include ancestors
  // defensively so a restored/deep-linked selection never floats unattached.
  const ids = new Set();
  const includePath = (id) => {
    for (const ancestor of ancestry(graph, id))
      if (ancestor !== "root" && visibleFor(graph, ancestor, format))
        ids.add(ancestor);
  };
  for (const id of graph.children.get("root") || [])
    if (visibleFor(graph, id, format)) ids.add(id);
  includePath(nodeId);
  for (const id of opened) {
    includePath(id);
    for (const child of graph.children.get(id) || [])
      if (visibleFor(graph, child, format)) ids.add(child);
  }
  const ordered = [...ids].sort();
  const connections = new Map();
  for (const id of ordered) {
    const parent = graph.nodes.get(id).parentId;
    if (ids.has(parent))
      connections.set("hierarchy:" + id, {
        from: parent,
        to: id,
        type: "hierarchy",
        status: "explicit",
      });
  }
  const nearest = new Map();
  const visibleAncestor = (id) => {
    if (!nearest.has(id))
      nearest.set(
        id,
        ancestry(graph, id)
          .reverse()
          .find((ancestor) => ids.has(ancestor)) || null,
      );
    return nearest.get(id);
  };
  for (const original of graph.edges.values()) {
    const from = visibleAncestor(original.from),
      to = visibleAncestor(original.to);
    if (!from || !to || from === to) continue;
    const projected = from !== original.from || to !== original.to;
    const type = projected ? "linked-notes" : original.type;
    const ends = ["related", "linked-notes", "practice"].includes(type)
      ? [from, to].sort()
      : [from, to];
    const key = JSON.stringify([...ends, type]);
    const prior = connections.get(key);
    if (
      prior?.status === "explicit" ||
      (prior && original.status !== "explicit")
    )
      continue;
    connections.set(key, {
      ...original,
      from: ends[0],
      to: ends[1],
      type,
      ...(projected ? { aggregated: true } : {}),
    });
  }
  const orderedEdges = [...connections.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, e]) => e);
  const result = { ordered, orderedEdges };
  graph.views.set(key, result);
  // Cache topology-only page manifests; current summaries are still read for
  // the requested page. Four views bound memory while preserving warm paging.
  while (graph.views.size > 4)
    graph.views.delete(graph.views.keys().next().value);
  return result;
}
function snapshot(
  store,
  {
    nodeId = "root",
    format = "all",
    offset = 0,
    limit = 6,
    continuous = false,
    expandedIds = [],
    selectedId,
    edgeOffset = 0,
    edgeLimit = 1000,
    now = Date.now(),
  } = {},
) {
  if (selectedId !== undefined) nodeId = selectedId;
  if (
    typeof nodeId !== "string" ||
    nodeId.length > 512 ||
    !["all", "concept", "math", "code"].includes(format)
  )
    throw Error("Invalid Constellation view");
  offset = Math.max(
    0,
    Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(offset) || 0)),
  );
  limit = Math.max(
    1,
    Math.min(
      continuous ? 200 : 24,
      Math.floor(Number(limit) || (continuous ? 200 : 6)),
    ),
  );
  if (
    typeof continuous !== "boolean" ||
    !Array.isArray(expandedIds) ||
    expandedIds.length > 100000 ||
    expandedIds.some((id) => typeof id !== "string" || id.length > 512)
  )
    throw Error("Invalid expanded Constellation branches");
  edgeOffset = Math.max(
    0,
    Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(edgeOffset) || 0)),
  );
  edgeLimit = Math.max(
    1,
    Math.min(1000, Math.floor(Number(edgeLimit) || 1000)),
  );
  const clock = new Date(now).getTime();
  if (!Number.isFinite(clock)) throw Error("Invalid graph time");
  const checkpoint = expertise.refresh(store, { now: clock, budget: 250 });
  const tax = taxonomy.read(store),
    knowledge = notes(store.folder),
    graph = structure(store, checkpoint, knowledge, tax);
  const requested = nodeId;
  nodeId = graph.redirects.get(nodeId) || nodeId;
  if (!graph.nodes.has(nodeId)) nodeId = "root";
  const ancestors = ancestry(graph, nodeId);
  const allChildren = (graph.children.get(nodeId) || []).filter((id) =>
    visibleFor(graph, id, format),
  );
  if (!continuous && offset >= allChildren.length && offset)
    offset = Math.max(0, Math.floor((allChildren.length - 1) / limit) * limit);
  const childIds = allChildren.slice(offset, offset + limit),
    selected = new Set([nodeId, ...childIds]);
  const neighbors =
    nodeId === "root"
      ? []
      : [...(graph.adj.get(nodeId) || [])]
          .map((key) => graph.edges.get(key))
          .sort(
            (a, b) =>
              (a.status === "explicit" ? 0 : 1) -
              (b.status === "explicit" ? 0 : 1),
          )
          .map((e) => (e.from === nodeId ? e.to : e.from))
          .filter(
            (id, index, ids) =>
              ids.indexOf(id) === index &&
              !selected.has(id) &&
              !ancestors.includes(id) &&
              graph.nodes.get(id)?.parentId !== nodeId &&
              visibleFor(graph, id, format),
          )
          .slice(0, 3);
  for (const id of neighbors) selected.add(id);
  const memo = new Map();
  function present(id) {
    if (memo.has(id)) return memo.get(id);
    const n = graph.nodes.get(id);
    let summary,
      cardIds = n.cardIds || [],
      label = n.label;
    if (n.conceptId) {
      const c = parse(
        store.db
          .prepare("SELECT data FROM expertise_concepts WHERE id=?")
          .get(n.conceptId)?.data,
      );
      summary = c?.formats?.[format] || expertise.empty(clock);
      label = expertise.plain(c?.title || label);
      cardIds = c?.cardIds || cardIds;
      if (c?.requiresReassessment)
        summary = { ...summary, reassessmentRequired: true };
      if (format !== "all") {
        const allowed = new Set(
          store.db
            .prepare(
              "SELECT card_id FROM expertise_cards WHERE concept_id=? AND kind=?",
            )
            .all(n.conceptId, format)
            .map((r) => r.card_id),
        );
        cardIds = cardIds.filter((id) => allowed.has(id));
      }
    } else
      summary = n.noteOnly
        ? expertise.empty(clock)
        : expertise.topicSummary(store.db, id, format, clock);
    if (checkpoint.clockReset)
      summary = { ...expertise.empty(clock), total: summary.total };
    const result = {
      id,
      label,
      parentId: n.parentId,
      kind: n.kind,
      inferred: !!n.inferred,
      childCount: (graph.children.get(id) || []).filter((child) =>
        visibleFor(graph, child, format),
      ).length,
      summary,
      cardIds: cardIds.slice(0, 100),
      noteRefs: n.noteRefs,
      noteOnly: !!n.noteOnly,
      duplicateIdentity: !!n.duplicateIdentity,
    };
    memo.set(id, result);
    return result;
  }
  const holdingAreas = [...graph.nodes.values()]
    .filter((n) => n.kind === "holding" || n.kind === "navigation")
    .map((n) => present(n.id));
  const common = {
    rootId: "root",
    focus: present(nodeId),
    ancestors: ancestors
      .slice(0, -1)
      .map((id) => ({ id, label: graph.nodes.get(id).label })),
    holdingAreas,
    generatedAt: new Date(clock).toISOString(),
    checkpoint,
    knowledge: {
      noteCount: graph.noteCount,
      unmappedNoteCount: graph.unmappedNoteCount,
      indexedSources: knowledge.indexedSources,
      configuredSources: knowledge.configuredSources,
      issues: knowledge.issues,
    },
    ...(requested !== nodeId ? { redirectedFrom: requested } : {}),
  };
  if (continuous) {
    const opened = [
      ...new Set(expandedIds.map((id) => graph.redirects.get(id) || id)),
    ]
      .filter((id) => graph.nodes.has(id))
      .sort();
    const { ordered, orderedEdges } = continuousView(
      graph,
      format,
      opened,
      nodeId,
    );
    // Independent edge pages bound dense graphs as well as large node sets.
    // The revision binds all pages to identical topology and visible membership.
    const graphRevision = hash([
      checkpoint.topologyGeneration,
      tax.revision,
      knowledge.signature,
      format,
      opened,
      nodeId,
    ]);
    return {
      ...common,
      continuous: true,
      expandedIds: opened,
      graphRevision,
      nodes: ordered.slice(offset, offset + limit).map(present),
      edges: orderedEdges.slice(edgeOffset, edgeOffset + edgeLimit),
      total: ordered.length,
      offset,
      hasMore: offset + limit < ordered.length,
      edgeTotal: orderedEdges.length,
      edgeOffset,
      hasMoreEdges: edgeOffset + edgeLimit < orderedEdges.length,
    };
  }
  const visibleEdges = new Map();
  for (const id of selected)
    for (const key of graph.adj.get(id) || []) {
      const e = graph.edges.get(key);
      if (selected.has(e.from) && selected.has(e.to)) visibleEdges.set(key, e);
    }
  for (const id of childIds)
    visibleEdges.set("hierarchy:" + id, {
      from: nodeId,
      to: id,
      type: "hierarchy",
      status: "explicit",
    });
  return {
    ...common,
    nodes: [...childIds, ...neighbors].map(present),
    edges: [...visibleEdges.values()],
    total: allChildren.length,
    offset,
    hasMore: offset + limit < allChildren.length,
  };
}
module.exports = { snapshot, invalidateNotes, noteNodeId, canonical };
