// Derived review evidence. Never rates cards or changes their FSRS schedules.
const { createHash } = require("node:crypto");
const { createEmptyCard, Rating } = require("ts-fsrs");
const { createScheduler } = require("./scheduler.cjs");
const scheduler = createScheduler();
const MODEL_VERSION = 1,
  SCORE_PRECISION_VERSION = 2,
  DAY = 86400000;
const FORMATS = ["concept", "math", "code", "all"];
const parse = (s, fallback = {}) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, Number(x) || 0));
const time = (value) => {
  const n = new Date(value ?? Date.now()).getTime();
  if (!Number.isFinite(n)) throw Error("Invalid expertise time");
  return n;
};
const plain = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const hash = (s) => createHash("sha256").update(s).digest("hex");
function objectiveHash(card) {
  const answer = String(card.answer || "")
    .replace(/```widget[^\n]*\n[\s\S]*?```/g, "")
    .trim();
  return hash(
    JSON.stringify([
      card.kind,
      card.title,
      card.prompt,
      answer,
      card.numeric,
      card.code,
    ]),
  );
}
function meta(db, key, fallback = null) {
  const row = db
    .prepare("SELECT value FROM expertise_meta WHERE key=?")
    .get(key);
  return row ? parse(row.value, fallback) : fallback;
}
function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO expertise_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(value));
}

// Match objectiveHash's widget removal inside SQLite, so ordinary writers do
// not need an application-defined SQL function. Plain prose takes one pass;
// recursion occurs only for complete widget fences and always consumes input.
function answerSql(content) {
  const start = "instr(rest,'```widget')";
  const newline = `instr(substr(rest,${start}+9),char(10))`;
  const newlineAt = `(${start}+8+${newline})`;
  const closing = `instr(substr(rest,${newlineAt}+1),'\x60\x60\x60')`;
  const closingAt = `(${newlineAt}+${closing})`;
  const complete = `CASE WHEN ${start}=0 THEN 0 WHEN ${newline}=0 THEN 0 ELSE ${closing}>0 END`;
  // ECMAScript String.trim whitespace, including non-ASCII spacing characters.
  const trim =
    "char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
  return `(WITH RECURSIVE stripped(rest,clean) AS (
    SELECT COALESCE(json_extract(${content},'$.answer'),''),''
    UNION ALL
    SELECT substr(rest,${closingAt}+3),clean||substr(rest,1,${start}-1)
      FROM stripped WHERE ${complete}
  ) SELECT trim(clean||rest,${trim}) FROM stripped WHERE NOT (${complete}) LIMIT 1)`;
}

function semanticChangeSql() {
  const fields = ["kind", "title", "prompt", "numeric", "code"];
  return `CASE
    WHEN ${fields.map((key) => `json_extract(OLD.content,'$.${key}') IS NOT json_extract(NEW.content,'$.${key}')`).join(" OR ")} THEN 1
    WHEN json_extract(OLD.content,'$.answer') IS json_extract(NEW.content,'$.answer') THEN 0
    ELSE ${answerSql("OLD.content")} IS NOT ${answerSql("NEW.content")}
  END`;
}

function drainLegacyContentChanges(db) {
  const next = db.prepare(
    "SELECT * FROM expertise_content_changes ORDER BY id LIMIT 1",
  );
  const epoch = db.prepare(
    "INSERT INTO expertise_epochs(card_id,cutoff) VALUES(?,?) ON CONFLICT(card_id) DO UPDATE SET cutoff=MAX(cutoff,excluded.cutoff)",
  );
  const dirty = db.prepare(
    "INSERT INTO expertise_dirty(card_id,seq,replay) VALUES(?,(SELECT seq FROM expertise_clock WHERE id=1),1) ON CONFLICT(card_id) DO UPDATE SET replay=1",
  );
  const remove = db.prepare("DELETE FROM expertise_content_changes WHERE id=?");
  // One legacy row in memory at a time; keep interrupted migration resumable.
  for (let row; (row = next.get());) {
    if (
      objectiveHash(parse(row.old_content)) !==
      objectiveHash(parse(row.new_content))
    ) {
      epoch.run(row.card_id, row.cutoff);
      dirty.run(row.card_id);
    }
    remove.run(row.id);
  }
}

function install(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS expertise_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expertise_clock(id INTEGER PRIMARY KEY CHECK(id=1),seq INTEGER NOT NULL);
    INSERT OR IGNORE INTO expertise_clock VALUES(1,0);
    CREATE TABLE IF NOT EXISTS expertise_dirty(card_id TEXT PRIMARY KEY,seq INTEGER NOT NULL,replay INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS expertise_epochs(card_id TEXT PRIMARY KEY,cutoff INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS expertise_content_changes(id INTEGER PRIMARY KEY,card_id TEXT NOT NULL,old_content TEXT NOT NULL,new_content TEXT NOT NULL,cutoff INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS expertise_changes_card ON expertise_content_changes(card_id,id);
    CREATE TABLE IF NOT EXISTS expertise_cards(card_id TEXT PRIMARY KEY,concept_id TEXT NOT NULL,kind TEXT NOT NULL,objective_key TEXT NOT NULL,content_hash TEXT NOT NULL,data TEXT NOT NULL,next_refresh INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS expertise_cards_concept ON expertise_cards(concept_id);
    CREATE INDEX IF NOT EXISTS expertise_cards_refresh ON expertise_cards(next_refresh);
    CREATE TABLE IF NOT EXISTS expertise_concepts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expertise_nodes(id TEXT PRIMARY KEY,parent_id TEXT,label TEXT NOT NULL,weight REAL NOT NULL,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS expertise_nodes_parent ON expertise_nodes(parent_id,label,id);
    CREATE TABLE IF NOT EXISTS expertise_members(concept_id TEXT PRIMARY KEY,node_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS expertise_members_node ON expertise_members(node_id,concept_id);
    CREATE TABLE IF NOT EXISTS expertise_direct(node_id TEXT NOT NULL,format TEXT NOT NULL,acc TEXT NOT NULL,PRIMARY KEY(node_id,format));
    CREATE TABLE IF NOT EXISTS expertise_parts(node_id TEXT NOT NULL,slot TEXT NOT NULL,format TEXT NOT NULL,weight REAL NOT NULL,data TEXT NOT NULL,PRIMARY KEY(node_id,slot,format));
    CREATE TABLE IF NOT EXISTS expertise_topics(node_id TEXT NOT NULL,format TEXT NOT NULL,acc TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(node_id,format));
    CREATE INDEX IF NOT EXISTS reviews_expertise_card ON reviews(card_id,id,at);
    CREATE TRIGGER IF NOT EXISTS expertise_card_insert AFTER INSERT ON cards BEGIN
      UPDATE expertise_clock SET seq=seq+1 WHERE id=1;
      INSERT INTO expertise_dirty VALUES(NEW.id,(SELECT seq FROM expertise_clock WHERE id=1),1) ON CONFLICT(card_id) DO UPDATE SET seq=excluded.seq,replay=1;
    END;
    CREATE TRIGGER IF NOT EXISTS expertise_card_update AFTER UPDATE ON cards BEGIN
      UPDATE expertise_clock SET seq=seq+1 WHERE id=1;
      INSERT INTO expertise_dirty VALUES(NEW.id,(SELECT seq FROM expertise_clock WHERE id=1),0) ON CONFLICT(card_id) DO UPDATE SET seq=excluded.seq;
    END;
    DROP TRIGGER IF EXISTS expertise_content_update;
    CREATE TRIGGER expertise_content_update AFTER UPDATE OF content ON cards WHEN NEW.content<>OLD.content AND (${semanticChangeSql()}) BEGIN
      INSERT INTO expertise_epochs(card_id,cutoff)
        VALUES(NEW.id,COALESCE((SELECT MAX(id) FROM reviews WHERE card_id=NEW.id),0))
        ON CONFLICT(card_id) DO UPDATE SET cutoff=MAX(cutoff,excluded.cutoff);
    END;
    CREATE TRIGGER IF NOT EXISTS expertise_card_delete AFTER DELETE ON cards BEGIN
      UPDATE expertise_clock SET seq=seq+1 WHERE id=1;
      INSERT INTO expertise_dirty VALUES(OLD.id,(SELECT seq FROM expertise_clock WHERE id=1),1) ON CONFLICT(card_id) DO UPDATE SET seq=excluded.seq,replay=1;
    END;
    CREATE TRIGGER IF NOT EXISTS expertise_review_insert AFTER INSERT ON reviews BEGIN
      UPDATE expertise_clock SET seq=seq+1 WHERE id=1;
      INSERT INTO expertise_dirty VALUES(NEW.card_id,(SELECT seq FROM expertise_clock WHERE id=1),0) ON CONFLICT(card_id) DO UPDATE SET seq=excluded.seq;
    END;
    CREATE TRIGGER IF NOT EXISTS expertise_review_update AFTER UPDATE ON reviews BEGIN
      UPDATE expertise_clock SET seq=seq+1 WHERE id=1;
      INSERT INTO expertise_dirty VALUES(OLD.card_id,(SELECT seq FROM expertise_clock WHERE id=1),1) ON CONFLICT(card_id) DO UPDATE SET seq=excluded.seq,replay=1;
      INSERT INTO expertise_dirty VALUES(NEW.card_id,(SELECT seq FROM expertise_clock WHERE id=1),1) ON CONFLICT(card_id) DO UPDATE SET seq=excluded.seq,replay=1;
    END;
    CREATE TRIGGER IF NOT EXISTS expertise_review_delete AFTER DELETE ON reviews BEGIN
      UPDATE expertise_clock SET seq=seq+1 WHERE id=1;
      INSERT INTO expertise_dirty VALUES(OLD.card_id,(SELECT seq FROM expertise_clock WHERE id=1),1) ON CONFLICT(card_id) DO UPDATE SET seq=excluded.seq,replay=1;
    END;
  `);
  drainLegacyContentChanges(db);
  if (meta(db, "installed") !== MODEL_VERSION) {
    db.exec(
      "INSERT OR REPLACE INTO expertise_dirty SELECT id,(SELECT seq FROM expertise_clock WHERE id=1),1 FROM cards",
    );
    setMeta(db, "installed", MODEL_VERSION);
    setMeta(db, "topology", null);
  }
  if (meta(db, "scorePrecision") !== SCORE_PRECISION_VERSION) {
    // Older projections rounded each intermediate rollup, so broad/deep paths
    // could discard positive evidence. Recompute from compact card checkpoints
    // in normal bounded batches; do not replay history merely to fix precision.
    // A pre-existing content/review correction still requires its replay.
    db.exec("SAVEPOINT expertise_precision_upgrade");
    try {
      db.exec(`INSERT INTO expertise_dirty(card_id,seq,replay)
        SELECT id,(SELECT seq FROM expertise_clock WHERE id=1),0 FROM cards WHERE 1
        ON CONFLICT(card_id) DO UPDATE SET
          seq=MAX(expertise_dirty.seq,excluded.seq),
          replay=MAX(expertise_dirty.replay,excluded.replay)`);
      setMeta(db, "scorePrecision", SCORE_PRECISION_VERSION);
      setMeta(db, "topology", null);
      db.exec("RELEASE expertise_precision_upgrade");
    } catch (error) {
      db.exec("ROLLBACK TO expertise_precision_upgrade");
      db.exec("RELEASE expertise_precision_upgrade");
      throw error;
    }
  }
}
function empty(now) {
  return {
    score: null,
    coverage: 0,
    confidence: 0,
    assessed: 0,
    total: 0,
    needsPractice: 0,
    reviewCount: 0,
    lastReviewAt: null,
    asOf: new Date(now).toISOString(),
    modelVersion: MODEL_VERSION,
    evidence: "Scored reviews",
  };
}
function blankStats() {
  return {
    count: 0,
    effective: 0,
    successes: 0,
    creditedAt: null,
    lastAt: null,
    lastId: 0,
    maxId: 0,
    lastRating: null,
    spacedSuccesses: 0,
    memory: null,
  };
}
function addEvent(stats, event) {
  const at = Date.parse(event.at),
    value = { Again: 0, Hard: 0.35, Good: 1, Easy: 1 }[event.rating];
  stats.count++;
  if (stats.creditedAt === null || at - stats.creditedAt >= DAY) {
    stats.effective++;
    stats.successes += value;
    if (stats.creditedAt !== null && value === 1) stats.spacedSuccesses++;
    stats.creditedAt = at;
  }
  // The evidence memory follows eligible events only. A retained study schedule
  // may contain undone, corrected or pre-epoch outcomes and cannot certify them.
  const memory = stats.memory
    ? {
        ...stats.memory,
        due: new Date(stats.memory.due),
        last_review: new Date(stats.memory.last_review),
      }
    : createEmptyCard(new Date(at));
  stats.memory = scheduler.repeat(memory, new Date(at))[
    Rating[event.rating]
  ].card;
  stats.lastAt = at;
  stats.lastId = event.id;
  stats.lastRating = event.rating;
}
function scoreCard(card, stats, now) {
  const result = {
    ...empty(now),
    total: 1,
    reviewCount: stats.count,
    lastReviewAt:
      stats.lastAt === null ? null : new Date(stats.lastAt).toISOString(),
  };
  if (!stats.count) return result;
  const confidence = stats.effective / (stats.effective + 6);
  const durability = clamp(
    Math.log1p(stats.memory?.stability || 0) / Math.log1p(365),
  );
  let readiness = 0;
  try {
    readiness = clamp(
      scheduler.retrievability(
        {
          ...stats.memory,
          due: new Date(stats.memory.due),
          last_review: new Date(stats.memory.last_review),
        },
        new Date(now),
      ),
    );
  } catch {
    readiness = 0;
  }
  // Conservative v1 product policy; not a validated psychometric scale.
  const depth =
    { Foundation: 0.65, Application: 0.85, Advanced: 1 }[card.difficulty] ||
    0.65;
  const quality = clamp(stats.successes / Math.max(1, stats.effective));
  const recent =
    stats.lastRating === "Again" ? 0.35 : stats.lastRating === "Hard" ? 0.7 : 1;
  const credit =
    100 * confidence * durability * readiness * depth * quality * recent;
  return {
    ...result,
    // Presentation owns decimal formatting. Retain small positive contributions
    // throughout card, objective and ancestor projections.
    score: Math.min(99.9, Math.max(0, credit)),
    confidence,
    coverage: 1,
    assessed: 1,
    needsPractice: ["Again", "Hard"].includes(stats.lastRating) ? 1 : 0,
    readiness,
    durability,
    spacedSuccesses: stats.spacedSuccesses,
  };
}
function accumulator() {
  return {
    weight: 0,
    score: 0,
    scoreCorrection: 0,
    positive: 0,
    coverage: 0,
    confidence: 0,
    total: 0,
    assessed: 0,
    needsPractice: 0,
    reviewCount: 0,
  };
}
function adjust(acc, summary, weight, sign) {
  if (!summary) return acc;
  acc.weight += weight * sign;
  // Compensated addition retains small evidence when a large contribution is
  // added and later removed. Count positive contributors so cancellation noise
  // can never turn a truly zero score into apparent evidence.
  const contribution = (summary.score || 0) * weight * sign;
  const nextScore = acc.score + contribution;
  acc.scoreCorrection +=
    Math.abs(acc.score) >= Math.abs(contribution)
      ? acc.score - nextScore + contribution
      : contribution - nextScore + acc.score;
  acc.score = nextScore;
  acc.positive += (summary.score > 0 ? 1 : 0) * sign;
  if (acc.positive === 0) acc.score = acc.scoreCorrection = 0;
  for (const k of ["coverage", "confidence"])
    acc[k] += (summary[k] || 0) * weight * sign;
  for (const k of ["total", "assessed", "needsPractice", "reviewCount"])
    acc[k] += (summary[k] || 0) * sign;
  return acc;
}
function fromAcc(acc, now, lastReviewAt = null) {
  return {
    ...empty(now),
    score:
      acc.assessed > 0
        ? Math.max(
            0,
            Math.min(
              99.9,
              Math.max(0, acc.score + acc.scoreCorrection) /
                Math.max(1e-12, acc.weight),
            ),
          )
        : null,
    coverage: clamp(acc.coverage / Math.max(1e-12, acc.weight)),
    confidence: clamp(acc.confidence / Math.max(1e-12, acc.weight)),
    ...Object.fromEntries(
      ["total", "assessed", "needsPractice", "reviewCount"].map((k) => [
        k,
        Math.max(0, Math.round(acc[k])),
      ]),
    ),
    lastReviewAt,
  };
}
function combine(items, now) {
  const acc = accumulator();
  for (const x of items) adjust(acc, x, 1, 1);
  return fromAcc(
    acc,
    now,
    items
      .map((x) => x.lastReviewAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null,
  );
}
function conceptSummary(db, id, now) {
  const records = db
    .prepare("SELECT data FROM expertise_cards WHERE concept_id=?")
    .all(id)
    .map((r) => parse(r.data))
    .filter((r) => r.eligible);
  if (!records.length) {
    db.prepare("DELETE FROM expertise_concepts WHERE id=?").run(id);
    return null;
  }
  const groups = new Map();
  for (const row of records) {
    const key = row.kind + ":" + row.objectiveKey,
      prev = groups.get(key);
    if (
      !prev ||
      (row.stats.lastAt || 0) > (prev.stats.lastAt || 0) ||
      ((row.stats.lastAt || 0) === (prev.stats.lastAt || 0) &&
        row.stats.lastId > prev.stats.lastId)
    )
      groups.set(key, row);
  }
  const unique = [...groups.values()],
    formats = {};
  for (const kind of FORMATS)
    formats[kind] = combine(
      unique
        .filter((x) => kind === "all" || x.kind === kind)
        .map((x) => x.summary),
      now,
    );
  const primary = records.find((x) => x.kind === "concept") || records[0];
  const result = {
    id,
    title: primary.title,
    topic: primary.topic,
    cardIds: records.map((x) => x.id).sort(),
    summary: formats.all,
    formats,
    objectives: unique.map((x) => ({
      kind: x.kind,
      id: x.objectiveKey,
      summary: x.summary,
    })),
    requiresReassessment: records.some((x) => x.cutoff > 0 && !x.stats.count),
  };
  db.prepare(
    "INSERT INTO expertise_concepts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
  ).run(id, JSON.stringify(result));
  return result;
}
function taxonomy(store) {
  return require("./taxonomy.cjs").read(store);
}
function fallbackId(topic) {
  return "topic:" + hash(String(topic)).slice(0, 24);
}
function conceptNodeId(id) {
  return "concept:" + hash(id).slice(0, 32);
}
function topicSummary(db, id, format = "all", now = Date.now()) {
  const row = db
    .prepare("SELECT data FROM expertise_topics WHERE node_id=? AND format=?")
    .get(id, format);
  return row ? parse(row.data) : empty(now);
}
function setPart(db, nodeId, slot, format, next, weight, now, depth = 0) {
  if (depth > 64) throw Error("Expertise hierarchy exceeds supported depth");
  const previous = db
    .prepare(
      "SELECT weight,data FROM expertise_parts WHERE node_id=? AND slot=? AND format=?",
    )
    .get(nodeId, slot, format);
  const row = db
    .prepare("SELECT acc FROM expertise_topics WHERE node_id=? AND format=?")
    .get(nodeId, format);
  const acc = row ? parse(row.acc) : accumulator();
  if (previous) adjust(acc, parse(previous.data), previous.weight, -1);
  if (next) {
    adjust(acc, next, weight, 1);
    db.prepare(
      "INSERT INTO expertise_parts VALUES(?,?,?,?,?) ON CONFLICT(node_id,slot,format) DO UPDATE SET weight=excluded.weight,data=excluded.data",
    ).run(nodeId, slot, format, weight, JSON.stringify(next));
  } else
    db.prepare(
      "DELETE FROM expertise_parts WHERE node_id=? AND slot=? AND format=?",
    ).run(nodeId, slot, format);
  const summary = fromAcc(acc, now);
  db.prepare(
    "INSERT INTO expertise_topics VALUES(?,?,?,?) ON CONFLICT(node_id,format) DO UPDATE SET acc=excluded.acc,data=excluded.data",
  ).run(nodeId, format, JSON.stringify(acc), JSON.stringify(summary));
  const node = db
    .prepare("SELECT parent_id,weight FROM expertise_nodes WHERE id=?")
    .get(nodeId);
  if (node?.parent_id)
    setPart(
      db,
      node.parent_id,
      nodeId,
      format,
      summary.total || format === "all" ? summary : null,
      node.weight,
      now,
      depth + 1,
    );
}
function changeDirect(db, nodeId, before, after, now) {
  if (!nodeId) return;
  for (const format of FORMATS) {
    const row = db
      .prepare("SELECT acc FROM expertise_direct WHERE node_id=? AND format=?")
      .get(nodeId, format);
    const acc = row ? parse(row.acc) : accumulator();
    if (before?.formats[format]?.total)
      adjust(acc, before.formats[format], 1, -1);
    if (after?.formats[format]?.total) adjust(acc, after.formats[format], 1, 1);
    db.prepare(
      "INSERT INTO expertise_direct VALUES(?,?,?) ON CONFLICT(node_id,format) DO UPDATE SET acc=excluded.acc",
    ).run(nodeId, format, JSON.stringify(acc));
    setPart(
      db,
      nodeId,
      "@direct",
      format,
      acc.weight > 1e-9 ? fromAcc(acc, now) : null,
      1,
      now,
    );
  }
}
function rebuildTopology(store, now) {
  const db = store.db,
    tax = taxonomy(store),
    concepts = db
      .prepare("SELECT data FROM expertise_concepts")
      .all()
      .map((r) => parse(r.data));
  const generation = (meta(db, "topology")?.generation || 0) + 1;
  db.exec(
    "DELETE FROM expertise_nodes; DELETE FROM expertise_members; DELETE FROM expertise_direct; DELETE FROM expertise_parts; DELETE FROM expertise_topics;",
  );
  const all = new Map([
    [
      "root",
      {
        id: "root",
        label: "All knowledge",
        parentId: null,
        weight: 1,
        kind: "topic",
      },
    ],
  ]);
  for (const n of tax.nodes || [])
    all.set(n.id, { ...n, parentId: n.parentId || "root", kind: "topic" });
  const mappings = new Map(
    (tax.mappings || [])
      .filter((m) => m.kind === "concept")
      .map((m) => [m.id, m.nodeId]),
  );
  const cardMappings = new Map(
    (tax.mappings || [])
      .filter((m) => m.kind === "card")
      .map((m) => [m.id, m.nodeId]),
  );
  const members = new Map();
  const locked = tax.rootPolicy?.mode === "locked";
  const holdingId = require("./taxonomy.cjs").HOLDING_ID;
  const fallbackNames = new Map();
  const normalizeTopic = (value) =>
    String(value).normalize("NFKC").toLocaleLowerCase().trim();
  // Reuse an unambiguous curated identity at any depth once domains are locked.
  // Generated fallback groups never become classification authorities.
  for (const n of tax.nodes || [])
    if (locked || n.parentId === null)
      for (const label of [n.label, ...(n.aliases || [])]) {
        const name = normalizeTopic(label);
        if (!fallbackNames.has(name)) fallbackNames.set(name, new Set());
        fallbackNames.get(name).add(n.id);
      }
  for (const c of concepts) {
    const cardTargets = [
      ...new Set(c.cardIds.map((id) => cardMappings.get(id)).filter(Boolean)),
    ];
    let nodeId =
      mappings.get(c.id) || (cardTargets.length === 1 ? cardTargets[0] : null);
    if (!nodeId) {
      const topic =
        cardTargets.length > 1
          ? "Needs classification"
          : c.topic || "Unclassified";
      const exact = fallbackNames.get(normalizeTopic(topic));
      nodeId =
        exact?.size === 1 && cardTargets.length <= 1
          ? [...exact][0]
          : locked
            ? holdingId
            : fallbackId(topic);
      if (!all.has(nodeId))
        all.set(nodeId, {
          id: nodeId,
          label: nodeId === holdingId ? "Unclassified" : topic,
          parentId: nodeId === holdingId ? null : "root",
          weight: 1,
          kind: nodeId === holdingId ? "holding" : "topic",
          inferred: true,
        });
    }
    members.set(c.id, nodeId);
  }
  for (const n of all.values())
    db.prepare("INSERT INTO expertise_nodes VALUES(?,?,?,?,?)").run(
      n.id,
      n.parentId,
      n.label,
      n.weight || 1,
      JSON.stringify(n),
    );
  for (const [id, nodeId] of members)
    db.prepare("INSERT INTO expertise_members VALUES(?,?)").run(id, nodeId);
  for (const n of all.values())
    if (n.parentId)
      setPart(db, n.parentId, n.id, "all", empty(now), n.weight || 1, now);
  for (const c of concepts) changeDirect(db, members.get(c.id), null, c, now);
  setMeta(db, "topology", {
    revision: tax.revision,
    model: MODEL_VERSION,
    scorePrecision: SCORE_PRECISION_VERSION,
    generation,
  });
}
function processCard(store, id, replay, now) {
  const db = store.db,
    raw = db.prepare("SELECT content,suspended FROM cards WHERE id=?").get(id);
  const cachedRow = db
      .prepare("SELECT data FROM expertise_cards WHERE card_id=?")
      .get(id),
    previous = cachedRow ? parse(cachedRow.data) : null,
    oldConcept = previous?.conceptId;
  if (!raw) {
    db.prepare("DELETE FROM expertise_cards WHERE card_id=?").run(id);
    db.prepare("DELETE FROM expertise_content_changes WHERE card_id=?").run(id);
    return { oldConcept, newConcept: null };
  }
  const card = parse(raw.content),
    contentHash = objectiveHash(card);
  let cutoff =
    db.prepare("SELECT cutoff FROM expertise_epochs WHERE card_id=?").get(id)
      ?.cutoff || 0;
  for (const change of db
    .prepare(
      "SELECT * FROM expertise_content_changes WHERE card_id=? ORDER BY id",
    )
    .all(id))
    if (
      objectiveHash(parse(change.old_content)) !==
      objectiveHash(parse(change.new_content))
    )
      cutoff = Math.max(cutoff, change.cutoff);
  db.prepare(
    "INSERT INTO expertise_epochs VALUES(?,?) ON CONFLICT(card_id) DO UPDATE SET cutoff=excluded.cutoff",
  ).run(id, cutoff);
  db.prepare("DELETE FROM expertise_content_changes WHERE card_id=?").run(id);
  const rebuild =
    replay ||
    !previous ||
    previous.contentHash !== contentHash ||
    previous.cutoff !== cutoff ||
    (previous.futureAt && previous.futureAt <= now) ||
    previous.asOf > now;
  let stats = rebuild ? blankStats() : structuredClone(previous.stats);
  let events = db
    .prepare("SELECT * FROM reviews WHERE card_id=? AND id>? ORDER BY at,id")
    .all(id, rebuild ? cutoff : Math.max(cutoff, stats.maxId));
  if (
    !rebuild &&
    events.some(
      (e) =>
        !e.undone &&
        !e.practice &&
        ["Again", "Hard", "Good", "Easy"].includes(e.rating) &&
        Date.parse(e.at) < stats.lastAt,
    )
  ) {
    stats = blankStats();
    events = db
      .prepare("SELECT * FROM reviews WHERE card_id=? AND id>? ORDER BY at,id")
      .all(id, cutoff);
  }
  for (const event of events) {
    stats.maxId = Math.max(stats.maxId, event.id);
    if (
      event.undone ||
      event.practice ||
      !["Again", "Hard", "Good", "Easy"].includes(event.rating) ||
      !Number.isFinite(Date.parse(event.at)) ||
      Date.parse(event.at) > now
    )
      continue;
    addEvent(stats, event);
  }
  const futureTimes = events
    .filter(
      (e) =>
        !e.undone &&
        !e.practice &&
        ["Again", "Hard", "Good", "Easy"].includes(e.rating) &&
        Date.parse(e.at) > now,
    )
    .map((e) => Date.parse(e.at));
  if (!rebuild && previous?.futureAt > now) futureTimes.push(previous.futureAt);
  const futureAt = futureTimes.length ? Math.min(...futureTimes) : null;
  const nextRefresh = Math.min(now + DAY, futureAt || Infinity);
  const conceptId = card.conceptId || id,
    kind = ["concept", "math", "code"].includes(card.kind)
      ? card.kind
      : "concept";
  const data = {
    id,
    conceptId,
    kind,
    objectiveKey: card.objectiveId || "canonical",
    contentHash,
    cutoff,
    title: plain(card.title),
    topic: card.topic || "Unclassified",
    eligible: card.status === "ready",
    suspended: !!raw.suspended,
    stats,
    summary: scoreCard(card, stats, now),
    asOf: now,
    futureAt,
  };
  db.prepare(
    "INSERT INTO expertise_cards VALUES(?,?,?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET concept_id=excluded.concept_id,kind=excluded.kind,objective_key=excluded.objective_key,content_hash=excluded.content_hash,data=excluded.data,next_refresh=excluded.next_refresh",
  ).run(
    id,
    conceptId,
    kind,
    data.objectiveKey,
    contentHash,
    JSON.stringify(data),
    nextRefresh,
  );
  return { oldConcept, newConcept: conceptId };
}
function refresh(store, { now = Date.now(), budget = 250 } = {}) {
  const clock = time(now),
    db = store.db,
    limit = Math.max(1, Math.min(10000, Math.floor(Number(budget) || 250)));
  return store.transaction(() => {
    const previousCheckpoint = meta(db, "checkpoint");
    if (previousCheckpoint && Date.parse(previousCheckpoint.asOf) > clock) {
      db.exec(
        "INSERT OR REPLACE INTO expertise_dirty SELECT id,(SELECT seq FROM expertise_clock WHERE id=1),1 FROM cards",
      );
      setMeta(db, "clockReset", true);
    }
    const topology = meta(db, "topology"),
      tax = taxonomy(store);
    let rebuild =
      !topology ||
      topology.model !== MODEL_VERSION ||
      topology.scorePrecision !== SCORE_PRECISION_VERSION ||
      topology.revision !== tax.revision;
    const dirty = db
        .prepare("SELECT * FROM expertise_dirty ORDER BY seq,card_id LIMIT ?")
        .all(limit),
      seen = new Set(dirty.map((r) => r.card_id));
    if (dirty.length < limit)
      for (const r of db
        .prepare(
          "SELECT card_id FROM expertise_cards WHERE next_refresh<=? ORDER BY next_refresh,card_id LIMIT ?",
        )
        .all(clock, limit - dirty.length))
        if (!seen.has(r.card_id))
          dirty.push({ card_id: r.card_id, replay: 0, seq: 0 });
    const old = new Map(),
      affected = new Set();
    for (const r of dirty) {
      const previous = db
        .prepare("SELECT concept_id FROM expertise_cards WHERE card_id=?")
        .get(r.card_id)?.concept_id;
      const raw = db
          .prepare("SELECT content FROM cards WHERE id=?")
          .get(r.card_id),
        next = raw && (parse(raw.content).conceptId || r.card_id);
      for (const id of [previous, next].filter(Boolean))
        if (!old.has(id)) {
          const x = db
            .prepare("SELECT data FROM expertise_concepts WHERE id=?")
            .get(id);
          old.set(id, x ? parse(x.data) : null);
        }
      const change = processCard(store, r.card_id, !!r.replay, clock);
      for (const id of [change.oldConcept, change.newConcept].filter(Boolean))
        affected.add(id);
      db.prepare("DELETE FROM expertise_dirty WHERE card_id=?").run(r.card_id);
    }
    for (const id of affected) {
      const next = conceptSummary(db, id, clock),
        previous = old.get(id);
      if (
        !previous ||
        !next ||
        previous.topic !== next.topic ||
        previous.title !== next.title ||
        FORMATS.some(
          (format) =>
            previous.formats[format].total !== next.formats[format].total,
        ) ||
        JSON.stringify(previous.cardIds) !== JSON.stringify(next.cardIds)
      )
        rebuild = true;
      if (!rebuild)
        changeDirect(
          db,
          db
            .prepare("SELECT node_id FROM expertise_members WHERE concept_id=?")
            .get(id)?.node_id,
          previous,
          next,
          clock,
        );
    }
    if (rebuild) rebuildTopology(store, clock);
    const pending =
      db.prepare("SELECT COUNT(*) AS n FROM expertise_dirty").get().n +
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM expertise_cards WHERE next_refresh<=?",
        )
        .get(clock).n;
    const seq = db
      .prepare("SELECT seq FROM expertise_clock WHERE id=1")
      .get().seq;
    const earliestPending = db
      .prepare("SELECT MIN(seq) AS seq FROM expertise_dirty")
      .get().seq;
    const clockReset = !!meta(db, "clockReset") && pending > 0;
    if (!clockReset) setMeta(db, "clockReset", false);
    const checkpoint = {
      modelVersion: MODEL_VERSION,
      scorePrecision: SCORE_PRECISION_VERSION,
      taxonomyRevision: tax.revision,
      topologyGeneration: meta(db, "topology")?.generation || 0,
      processed: dirty.length,
      pending,
      rebuilt: rebuild,
      changeSequence: seq,
      processedSequence: earliestPending === null ? seq : null,
      clockReset,
      asOf: new Date(clock).toISOString(),
      evidence: "Scored reviews",
      provisional: true,
    };
    setMeta(db, "checkpoint", checkpoint);
    return checkpoint;
  });
}
function snapshot(store, options = {}) {
  const checkpoint = refresh(store, options);
  const concepts = store.db
    .prepare("SELECT data FROM expertise_concepts ORDER BY id")
    .all()
    .map((r) => parse(r.data));
  if (checkpoint.clockReset)
    for (const c of concepts) {
      c.formats = Object.fromEntries(
        Object.entries(c.formats).map(([k, s]) => [
          k,
          { ...empty(checkpoint.asOf), total: s.total },
        ]),
      );
      c.summary = c.formats.all;
      c.objectives = c.objectives.map((o) => ({
        ...o,
        summary: { ...empty(checkpoint.asOf), total: o.summary.total },
      }));
    }
  return { concepts, checkpoint };
}
module.exports = {
  MODEL_VERSION,
  FORMATS,
  install,
  refresh,
  snapshot,
  topicSummary,
  conceptNodeId,
  fallbackId,
  objectiveHash,
  empty,
  plain,
  rebuildTopology,
};
