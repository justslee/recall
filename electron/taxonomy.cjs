// Canonical organization is separate from notes, card identities and review state.
// A primary tree controls rollups; cross-connections never add scoring votes.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { stable } = require("./catalog.cjs");

const VERSION = 1;
const MAX_BYTES = 4_000_000;
const HOLDING_ID = "holding:unclassified";
const LIBRARY_ID = "library:guides";
const kinds = new Set(["card", "concept", "note"]);
const relationTypes = new Set([
  "related",
  "uses",
  "prerequisite",
  "applies-to",
  "contrasts-with",
]);
const empty = () => ({
  version: VERSION,
  revision: 0,
  nodes: [],
  mappings: [],
  relations: [],
});
const digest = (value) =>
  crypto.createHash("sha256").update(stable(value)).digest("hex");
const fold = (value) => value.normalize("NFKC").trim().toLocaleLowerCase();
const mappingKey = (m) => JSON.stringify([m.kind, m.sourceId || "", m.id]);
const relationKey = (r) => JSON.stringify([r.from, r.to, r.type]);

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS taxonomy_state (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL,
    revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS taxonomy_receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.prepare("INSERT OR IGNORE INTO taxonomy_state VALUES(1,?,?,?)").run(
    VERSION,
    0,
    JSON.stringify(empty()),
  );
}
function exists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}
function read({ db }) {
  if (!exists(db, "taxonomy_state")) return empty();
  const row = db.prepare("SELECT * FROM taxonomy_state WHERE id=1").get();
  if (!row) return empty();
  if (row.version !== VERSION)
    throw Error("This taxonomy needs a newer Recall version.");
  return { ...JSON.parse(row.data), version: VERSION, revision: row.revision };
}
function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(name + " must be an object");
  return value;
}
function fields(value, allowed, name) {
  object(value, name);
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw Error("Unsupported " + name + " field: " + key);
}
function text(value, name, maximum = 300) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f]/.test(value)
  )
    throw Error("Invalid " + name);
  return value.trim();
}
function nodeId(value) {
  const id = text(value, "node ID", 160);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id) ||
    id === "root" ||
    id === HOLDING_ID ||
    id === LIBRARY_ID
  )
    throw Error("Invalid or reserved node ID");
  return id;
}
function array(value, name, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max)
    throw Error("Invalid or oversized " + name);
  return value;
}
function normalizeNode(raw) {
  fields(raw, ["id", "label", "parentId", "type", "weight", "aliases"], "node");
  if (!["topic", "concept"].includes(raw.type || "topic"))
    throw Error("Invalid node type");
  const weight = raw.weight === undefined ? 1 : raw.weight;
  if (!Number.isFinite(weight) || weight <= 0 || weight > 1000)
    throw Error("Node weight must be positive and at most 1000");
  if (raw.parentId !== null && raw.parentId === undefined)
    throw Error("Node parentId is required; use null for a top-level topic");
  return {
    id: nodeId(raw.id),
    label: text(raw.label, "node label", 200),
    parentId: raw.parentId === null ? null : nodeId(raw.parentId),
    type: raw.type || "topic",
    weight,
    aliases: [
      ...new Set(
        array(raw.aliases, "aliases", 50).map((a) => text(a, "alias", 200)),
      ),
    ],
  };
}
function normalizeMapping(raw, removal = false) {
  fields(
    raw,
    removal ? ["kind", "id", "sourceId"] : ["kind", "id", "sourceId", "nodeId"],
    "mapping",
  );
  if (!kinds.has(raw.kind)) throw Error("Invalid mapping kind");
  const result = { kind: raw.kind, id: text(raw.id, "mapped identity", 1024) };
  if (raw.kind === "note")
    result.sourceId = text(raw.sourceId, "note source ID", 300);
  else if (raw.sourceId !== undefined)
    throw Error("Only note mappings have sourceId");
  if (!removal)
    result.nodeId =
      raw.kind === "note" && raw.nodeId === LIBRARY_ID
        ? LIBRARY_ID
        : nodeId(raw.nodeId);
  return result;
}
function normalizeRelation(raw, removal = false) {
  fields(
    raw,
    removal
      ? ["from", "to", "type"]
      : ["from", "to", "type", "status", "source"],
    "relation",
  );
  const result = { from: nodeId(raw.from), to: nodeId(raw.to), type: raw.type };
  if (!relationTypes.has(raw.type)) throw Error("Invalid relation type");
  if (result.from === result.to)
    throw Error("A connection must join distinct nodes");
  if (!removal) {
    if (!["explicit", "suggested"].includes(raw.status))
      throw Error("Connection status must be explicit or suggested");
    result.status = raw.status;
    if (raw.source !== undefined)
      result.source = text(raw.source, "connection source", 2000);
    if (raw.status === "explicit" && !result.source)
      throw Error("An explicit connection requires its supporting source");
  }
  return result;
}
function unique(items, key, name) {
  const found = new Map();
  for (const item of items) {
    const id = key(item);
    if (found.has(id))
      throw Error("Duplicate or ambiguous " + name + ": " + id);
    found.set(id, item);
  }
  return found;
}
function normalizeRootPolicy(raw) {
  fields(raw, ["mode", "rootIds"], "root policy");
  if (raw.mode === "open") {
    if (raw.rootIds !== undefined)
      throw Error("An open root policy must not specify rootIds");
    return { mode: "open" };
  }
  if (raw.mode !== "locked") throw Error("Invalid root policy mode");
  const rootIds = array(raw.rootIds, "root policy IDs", 10000)
    .map(nodeId)
    .sort();
  if (!rootIds.length)
    throw Error("A locked root policy needs at least one root");
  unique(rootIds, String, "root policy ID");
  return { mode: "locked", rootIds };
}
function normalizePlan(raw) {
  fields(
    raw,
    [
      "expectedRevision",
      "nodes",
      "mappings",
      "relations",
      "remove",
      "rootPolicy",
    ],
    "taxonomy plan",
  );
  if (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0)
    throw Error("expectedRevision must be the revision from taxonomy list");
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BYTES)
    throw Error("Taxonomy plan exceeds 4 MB; split it into reviewed batches");
  const remove = raw.remove || {};
  fields(remove, ["nodeIds", "mappings", "relations"], "removal");
  const plan = {
    expectedRevision: raw.expectedRevision,
    ...(raw.rootPolicy === undefined
      ? {}
      : { rootPolicy: normalizeRootPolicy(raw.rootPolicy) }),
    nodes: array(raw.nodes, "nodes", 10000).map(normalizeNode),
    mappings: array(raw.mappings, "mappings", 40000).map((m) =>
      normalizeMapping(m),
    ),
    relations: array(raw.relations, "relations", 20000).map((r) =>
      normalizeRelation(r),
    ),
    remove: {
      nodeIds: array(remove.nodeIds, "removed nodes", 10000).map(nodeId),
      mappings: array(remove.mappings, "removed mappings", 40000).map((m) =>
        normalizeMapping(m, true),
      ),
      relations: array(remove.relations, "removed connections", 20000).map(
        (r) => normalizeRelation(r, true),
      ),
    },
  };
  unique(plan.nodes, (n) => n.id, "node ID");
  unique(plan.mappings, mappingKey, "mapping");
  unique(plan.relations, relationKey, "connection");
  const removed = unique(plan.remove.nodeIds, String, "removed node ID");
  const removedMappings = unique(
    plan.remove.mappings,
    mappingKey,
    "removed mapping",
  );
  const removedRelations = unique(
    plan.remove.relations,
    relationKey,
    "removed connection",
  );
  if (
    plan.nodes.some((n) => removed.has(n.id)) ||
    plan.mappings.some((m) => removedMappings.has(mappingKey(m))) ||
    plan.relations.some((r) => removedRelations.has(relationKey(r)))
  )
    throw Error("A plan cannot remove and update the same identity");
  return plan;
}
function validateTree(next) {
  const nodes = new Map(next.nodes.map((n) => [n.id, n]));
  const names = new Map();
  for (const node of next.nodes) {
    if (node.parentId !== null && !nodes.has(node.parentId))
      throw Error("Missing parent for " + node.id);
    const visited = new Set([node.id]);
    let ancestor = node.parentId;
    while (ancestor !== null) {
      if (visited.has(ancestor))
        throw Error("Hierarchy cycle involving " + node.id);
      visited.add(ancestor);
      if (visited.size > 64) throw Error("Hierarchy exceeds 64 levels");
      ancestor = nodes.get(ancestor)?.parentId ?? null;
    }
    for (const label of new Set([node.label, ...node.aliases].map(fold))) {
      const key = JSON.stringify([node.parentId, label]);
      if (names.has(key) && names.get(key) !== node.id)
        throw Error("Ambiguous sibling label or alias: " + label);
      names.set(key, node.id);
    }
  }
  for (const mapping of next.mappings)
    if (
      !nodes.has(mapping.nodeId) &&
      !(mapping.kind === "note" && mapping.nodeId === LIBRARY_ID)
    )
      throw Error("Mapping refers to a missing node: " + mapping.nodeId);
  for (const relation of next.relations)
    if (!nodes.has(relation.from) || !nodes.has(relation.to))
      throw Error("Connection refers to a missing node");
  if (next.rootPolicy?.mode === "locked") {
    const roots = next.nodes
      .filter((n) => n.parentId === null)
      .map((n) => n.id)
      .sort();
    if (stable(roots) !== stable(next.rootPolicy.rootIds))
      throw Error(
        "Locked root policy requires exactly its approved top-level nodes; explicitly change rootPolicy to change domains",
      );
  }
}
function validateReferences(store, mappings) {
  const cardRows = mappings.some((m) => m.kind !== "note")
    ? store.db.prepare("SELECT id,content FROM cards").all()
    : [];
  const cardIds = new Set(cardRows.map((r) => r.id));
  const concepts = new Set(
    cardRows.map((r) => {
      const c = JSON.parse(r.content);
      return c.conceptId || c.id;
    }),
  );
  for (const m of mappings) {
    if (m.kind === "card" && !cardIds.has(m.id))
      throw Error("Mapped card does not exist: " + m.id);
    if (m.kind === "concept" && !concepts.has(m.id))
      throw Error("Mapped concept does not exist in the card library: " + m.id);
  }
  const notes = mappings.filter((m) => m.kind === "note");
  if (!notes.length) return;
  if (!store.folder)
    throw Error("A profile is required to validate note mappings");
  const sourceIds = new Set(
    require("./config.cjs")
      .config(store.folder)
      .sources.map((s) => s.id),
  );
  const cache = path.join(
    store.folder,
    "cache",
    "knowledge",
    "search-v1.sqlite",
  );
  if (!fs.existsSync(cache) || fs.lstatSync(cache).isSymbolicLink())
    throw Error("Index the configured Knowledge source before mapping notes");
  const db = new DatabaseSync(cache, { readOnly: true });
  try {
    const query = db.prepare(
      "SELECT path FROM notes WHERE source=? AND id=? LIMIT 2",
    );
    for (const m of notes) {
      if (!sourceIds.has(m.sourceId))
        throw Error("Note source is not configured: " + m.sourceId);
      const matches = query.all(m.sourceId, m.id);
      if (matches.length !== 1)
        throw Error(
          matches.length
            ? "Ambiguous note identity; reconcile duplicate IDs first"
            : "Note is not in the selected Knowledge index; refresh it before mapping",
        );
    }
  } finally {
    db.close();
  }
}
function applyList(current, additions, removals, key) {
  const map = new Map(current.map((v) => [key(v), v]));
  for (const value of removals) map.delete(key(value));
  for (const value of additions) map.set(key(value), value);
  return [...map.values()].sort((a, b) => key(a).localeCompare(key(b)));
}
function differences(before, after, key) {
  const a = new Map(before.map((v) => [key(v), v])),
    b = new Map(after.map((v) => [key(v), v]));
  return {
    added: after.filter((v) => !a.has(key(v))),
    updated: after.filter(
      (v) => a.has(key(v)) && stable(a.get(key(v))) !== stable(v),
    ),
    removed: before.filter((v) => !b.has(key(v))),
  };
}
function receipt(store, id) {
  if (!exists(store.db, "taxonomy_receipts")) return null;
  const row = store.db
    .prepare("SELECT value FROM taxonomy_receipts WHERE id=?")
    .get(id);
  return row ? JSON.parse(row.value) : null;
}
function prepare(store, raw) {
  const plan = normalizePlan(raw),
    requestId = digest(plan),
    before = read(store);
  const applied = receipt(store, requestId);
  if (applied) return { applied, plan, requestId, before };
  if (plan.expectedRevision !== before.revision)
    throw Error(
      "Taxonomy revision conflict; read taxonomy list and reconcile the plan",
    );
  const next = {
    version: VERSION,
    revision: before.revision,
    ...(plan.rootPolicy || before.rootPolicy
      ? { rootPolicy: plan.rootPolicy || before.rootPolicy }
      : {}),
    nodes: applyList(
      before.nodes,
      plan.nodes,
      plan.remove.nodeIds.map((id) => ({ id })),
      (n) => n.id,
    ),
    mappings: applyList(
      before.mappings,
      plan.mappings,
      plan.remove.mappings,
      mappingKey,
    ),
    relations: applyList(
      before.relations,
      plan.relations,
      plan.remove.relations,
      relationKey,
    ),
  };
  if (
    next.nodes.length > 10000 ||
    next.mappings.length > 40000 ||
    next.relations.length > 20000 ||
    Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES
  )
    throw Error("Taxonomy exceeds supported size");
  validateTree(next);
  validateReferences(store, plan.mappings);
  const changes = {
    nodes: differences(before.nodes, next.nodes, (n) => n.id),
    mappings: differences(before.mappings, next.mappings, mappingKey),
    relations: differences(before.relations, next.relations, relationKey),
  };
  const rootPolicyChanged =
    stable(before.rootPolicy || { mode: "open" }) !==
    stable(next.rootPolicy || { mode: "open" });
  const changed =
    rootPolicyChanged ||
    Object.values(changes).some(
      (c) => c.added.length || c.updated.length || c.removed.length,
    );
  if (changed) next.revision++;
  return { plan, before, next, requestId, changes, changed, rootPolicyChanged };
}
function preview(store, raw) {
  const p = prepare(store, raw);
  if (p.applied) return { ...p.applied, mode: "preview", alreadyApplied: true };
  return {
    mode: "preview",
    requestId: p.requestId,
    revision: p.before.revision,
    nextRevision: p.next.revision,
    changed: p.changed,
    changes: p.changes,
    ...(p.rootPolicyChanged
      ? {
          rootPolicyChange: {
            before: p.before.rootPolicy || { mode: "open" },
            after: p.next.rootPolicy,
          },
        }
      : {}),
  };
}
function apply(store, raw, { inTransaction = false } = {}) {
  ensure(store.db);
  const run = () => {
    const p = prepare(store, raw);
    if (p.applied) return { ...p.applied, alreadyApplied: true };
    if (p.changed)
      store.db
        .prepare(
          "UPDATE taxonomy_state SET version=?,revision=?,data=? WHERE id=1",
        )
        .run(VERSION, p.next.revision, JSON.stringify(p.next));
    const result = {
      mode: "applied",
      requestId: p.requestId,
      revision: p.next.revision,
      changed: p.changed,
      ...(p.next.rootPolicy ? { rootPolicy: p.next.rootPolicy } : {}),
      counts: {
        nodes: p.next.nodes.length,
        mappings: p.next.mappings.length,
        relations: p.next.relations.length,
      },
    };
    store.db
      .prepare("INSERT INTO taxonomy_receipts(id,value) VALUES(?,?)")
      .run(p.requestId, JSON.stringify(result));
    return result;
  };
  if (inTransaction) return run();
  if (typeof store.transaction === "function") return store.transaction(run);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    store.db.exec("COMMIT");
    return result;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  VERSION,
  MAX_BYTES,
  HOLDING_ID,
  LIBRARY_ID,
  ensure,
  read,
  preview,
  apply,
  normalizePlan,
  digest,
  mappingKey,
  relationKey,
};
