const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Store } = require("../electron/store.cjs");
const {
  install,
  refresh,
  snapshot,
  topicSummary,
  rebuildTopology,
} = require("../electron/expertise.cjs");
const taxonomy = require("../electron/taxonomy.cjs");

const DAY = 86400000;
const NOW = new Date("2026-11-06T17:00:00.000Z");
let sessionNumber = 0;
const card = (id, patch = {}) => ({
  id,
  conceptId: id,
  title: `Explain ${id}`,
  prompt: `Explain the mechanism of ${id}.`,
  answer: `A self-contained explanation of ${id}.`,
  topic: "Systems",
  kind: "concept",
  decks: ["Expertise fixtures"],
  tags: ["fixture"],
  difficulty: "Foundation",
  status: "ready",
  ...patch,
});

function fixture(t, cards = []) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-expertise-"));
  const state = { folder, store: new Store(folder) };
  state.store.import(cards);
  t.after(() => {
    state.store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return state;
}

// Use the real scoring transaction and FSRS schedule for success/failure tests.
function rate(store, id, rating, at, practice = false) {
  const sessionId = `expertise-test-${++sessionNumber}`;
  store.set("session", {
    id: sessionId,
    ids: [id],
    index: 0,
    revealed: true,
    rated: 0,
    skipped: 0,
    selection: { practice },
  });
  store.rate({ id, rating, sessionId }, new Date(at));
}

function spaced(store, id, count = 6, rating = "Good", end = NOW) {
  for (let i = count - 1; i >= 0; i--)
    rate(store, id, rating, end.getTime() - i * 3 * DAY);
}

function concept(store, id, now = NOW) {
  const result = snapshot(store, { now });
  const found = result.concepts.find((c) => c.id === id);
  assert(found, `Missing concept ${id}`);
  return found;
}

function settle(store, now = NOW) {
  let result;
  for (let i = 0; i < 100; i++) {
    result = refresh(store, { now, budget: 1000 });
    if (!result.pending) return result;
  }
  assert.fail("Expertise refresh did not finish its finite fixture queue");
}

function durableRows(store) {
  return {
    cards: store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    reviews: store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
  };
}

function assertSummary(summary) {
  assert(summary, "Missing expertise summary");
  assert(
    summary.score === null ||
      (Number.isFinite(summary.score) &&
        summary.score >= 0 &&
        summary.score < 100),
    "Expertise is unknown or finite in [0, 100), never complete knowledge",
  );
  for (const key of ["coverage", "confidence"])
    assert(
      Number.isFinite(summary[key]) && summary[key] >= 0 && summary[key] <= 1,
      `${key} must be a fraction`,
    );
  assert(summary.assessed <= summary.total);
  assert(summary.needsPractice <= summary.total);
}

test("unreviewed requirements are unknown, including suspended cards", (t) => {
  const { store } = fixture(t, [card("untried")]);
  const before = concept(store, "untried");
  assertSummary(before.summary);
  assert.equal(before.summary.score, null);
  assert.equal(before.summary.coverage, 0);
  assert.equal(before.summary.confidence, 0);
  assert.equal(before.summary.assessed, 0);
  assert(before.summary.total > 0);
  store.suspend("untried", true);
  const after = concept(store, "untried");
  assert.equal(after.summary.total, before.summary.total);
  assert.equal(after.summary.score, null);
  assert.deepEqual(after.cardIds, before.cardIds);
});

test("concept success cannot certify unreviewed math or coding; suspension cannot hide the gap", (t) => {
  const { store } = fixture(t, [
    card("recall", { conceptId: "ownership" }),
    card("math", { conceptId: "ownership", kind: "math" }),
    card("code", { conceptId: "ownership", kind: "code" }),
  ]);
  spaced(store, "recall");
  const row = concept(store, "ownership");
  for (const summary of Object.values(row.formats)) assertSummary(summary);
  assert(row.formats.concept.score > 0);
  assert.equal(row.formats.math.score, null);
  assert.equal(row.formats.code.score, null);
  assert(row.formats.all.coverage < row.formats.concept.coverage);
  assert(row.formats.all.total > row.formats.concept.total);
  store.suspend("code", true);
  const suspended = concept(store, "ownership");
  assert.equal(suspended.formats.all.total, row.formats.all.total);
  assert.equal(suspended.formats.all.coverage, row.formats.all.coverage);
  assert.equal(suspended.formats.all.score, row.formats.all.score);
});

test("duplicate cards for one objective do not multiply score or coverage", (t) => {
  const { store } = fixture(t, [
    card("canonical", { conceptId: "columns", objectiveId: "column-layout" }),
  ]);
  spaced(store, "canonical");
  const original = concept(store, "columns");
  store.import(
    Array.from({ length: 20 }, (_, i) =>
      card(`duplicate-${i}`, {
        conceptId: "columns",
        objectiveId: "column-layout",
      }),
    ),
  );
  for (let i = 0; i < 20; i++) spaced(store, `duplicate-${i}`);
  const duplicated = concept(store, "columns");
  assert.equal(duplicated.summary.total, original.summary.total);
  assert.equal(duplicated.summary.assessed, original.summary.assessed);
  assert.equal(duplicated.summary.coverage, original.summary.coverage);
  assert.equal(duplicated.summary.score, original.summary.score);
  assert.equal(duplicated.summary.confidence, original.summary.confidence);
});

test("different objective IDs expose breadth gaps within the same concept", (t) => {
  const { store } = fixture(t, [
    card("layout", { conceptId: "columns", objectiveId: "layout" }),
    card("compression", { conceptId: "columns", objectiveId: "compression" }),
  ]);
  spaced(store, "layout");
  const row = concept(store, "columns");
  assert.equal(row.summary.total, 2);
  assert.equal(row.summary.assessed, 1);
  assert.equal(row.summary.coverage, 0.5);
  assert(row.summary.score > 0);
  store.suspend("compression", true);
  assert.equal(concept(store, "columns").summary.coverage, 0.5);
});

test("legacy concept and format identity caps duplicates without objective IDs", (t) => {
  const { store } = fixture(t, [
    card("legacy-a", { conceptId: "legacy-concept" }),
    card("legacy-b", { conceptId: "legacy-concept" }),
  ]);
  spaced(store, "legacy-a");
  const first = concept(store, "legacy-concept").summary;
  spaced(store, "legacy-b");
  const both = concept(store, "legacy-concept").summary;
  assert.equal(first.total, 1);
  assert.equal(both.total, first.total);
  assert.equal(both.score, first.score);
  assert.equal(both.confidence, first.confidence);
});

test("same-day cramming is weaker evidence than the same number of spaced successes", (t) => {
  const { store } = fixture(t, [card("crammed"), card("spaced")]);
  for (let i = 11; i >= 0; i--)
    rate(store, "crammed", "Good", NOW.getTime() - i * 60000);
  spaced(store, "spaced", 12);
  const crammed = concept(store, "crammed").summary;
  const delayed = concept(store, "spaced").summary;
  assertSummary(crammed);
  assertSummary(delayed);
  assert(delayed.score > crammed.score);
  assert(delayed.confidence > crammed.confidence);
});

test("a current Again lowers evidence versus an otherwise identical delayed success", (t) => {
  const { store } = fixture(t, [card("success"), card("failed")]);
  const yesterday = new Date(NOW.getTime() - 2 * DAY);
  spaced(store, "success", 5, "Good", yesterday);
  spaced(store, "failed", 5, "Good", yesterday);
  rate(store, "success", "Good", NOW);
  rate(store, "failed", "Again", NOW);
  const success = concept(store, "success").summary;
  const failed = concept(store, "failed").summary;
  assert(success.score > failed.score);
  assert(failed.needsPractice > 0);
  assert.equal(success.needsPractice, 0);
});

test("even extensive successful review never displays complete expertise", (t) => {
  const { store } = fixture(t, [card("durable")]);
  spaced(store, "durable", 120, "Easy");
  const summary = concept(store, "durable").summary;
  assertSummary(summary);
  assert(summary.score > 0);
  assert(summary.score < 100);
});

test("practice, skipped, undone and future reviews do not create assessed expertise", (t) => {
  const { store } = fixture(t, [
    card("practice"),
    card("skip"),
    card("undone"),
    card("future"),
  ]);
  rate(store, "practice", "Easy", NOW, true);
  rate(store, "skip", "Skip", NOW);
  rate(store, "undone", "Good", NOW);
  store.undo();
  rate(store, "future", "Easy", NOW.getTime() + DAY);
  for (const id of ["practice", "skip", "undone", "future"]) {
    const summary = concept(store, id).summary;
    assert.equal(summary.score, null, id);
    assert.equal(summary.assessed, 0, id);
  }
});

test("real Store undo changes the cached score without inserting a new review", (t) => {
  const { store } = fixture(t, [card("undo")]);
  spaced(store, "undo", 5, "Good", new Date(NOW.getTime() - 3 * DAY));
  const previous = concept(store, "undo").summary;
  rate(store, "undo", "Again", NOW);
  const failed = concept(store, "undo").summary;
  assert(failed.score < previous.score);
  const count = store.db.prepare("SELECT count(*) AS n FROM reviews").get().n;
  store.undo();
  const recovered = concept(store, "undo").summary;
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM reviews").get().n,
    count,
  );
  assert.equal(recovered.score, previous.score);
  assert.equal(recovered.needsPractice, previous.needsPractice);
});

test("mutations of old rows invalidate only the affected card, not only new review IDs", (t) => {
  const { store } = fixture(t, [card("changed"), card("unrelated")]);
  spaced(store, "changed", 4);
  spaced(store, "unrelated", 4);
  settle(store);
  const untouched = concept(store, "unrelated").summary;
  const maxId = store.db.prepare("SELECT max(id) AS id FROM reviews").get().id;
  const changedId = store.db
    .prepare("SELECT max(id) AS id FROM reviews WHERE card_id='changed'")
    .get().id;
  store.db
    .prepare("UPDATE reviews SET rating='Again' WHERE id=?")
    .run(changedId);
  const work = refresh(store, { now: NOW, budget: 1 });
  assert.equal(work.processed, 1);
  assert.equal(work.pending, 0);
  assert.equal(work.rebuilt, false);
  assert.equal(
    store.db.prepare("SELECT max(id) AS id FROM reviews").get().id,
    maxId,
  );
  assert(concept(store, "changed").summary.needsPractice > 0);
  assert.deepEqual(concept(store, "unrelated").summary, untouched);
  store.db.prepare("UPDATE reviews SET undone=1 WHERE id=?").run(changedId);
  const undone = refresh(store, { now: NOW, budget: 1 });
  assert.equal(undone.processed, 1);
  assert.equal(concept(store, "changed").summary.needsPractice, 0);
});

test("retroactively undone evidence cannot survive through stored schedules or later appends", (t) => {
  const { store } = fixture(t, [card("corrected"), card("reference")]);
  for (const days of [6, 3, 0])
    rate(store, "corrected", "Good", NOW.getTime() - days * DAY);
  for (const days of [3, 0])
    rate(store, "reference", "Good", NOW.getTime() - days * DAY);
  settle(store);
  store.db
    .prepare(
      "UPDATE reviews SET undone=1 WHERE id=(SELECT min(id) FROM reviews WHERE card_id='corrected')",
    )
    .run();
  const corrected = concept(store, "corrected").summary;
  const reference = concept(store, "reference").summary;
  assert.equal(corrected.reviewCount, reference.reviewCount);
  assert.equal(corrected.confidence, reference.confidence);
  assert.equal(
    corrected.score,
    reference.score,
    "Undone history must not remain embedded in surviving after_schedule values",
  );
  const later = new Date(NOW.getTime() + 3 * DAY);
  rate(store, "corrected", "Good", later);
  rate(store, "reference", "Good", later);
  assert.equal(
    concept(store, "corrected", later).summary.score,
    concept(store, "reference", later).summary.score,
    "A later append must not reintroduce invalidated durability from the actual scheduling state",
  );
});

test("checkpoints resume across restarts without replaying already projected cards", (t) => {
  const state = fixture(t, [card("persisted")]);
  spaced(state.store, "persisted");
  settle(state.store);
  const before = concept(state.store, "persisted").summary;
  const idle = refresh(state.store, { now: NOW, budget: 1 });
  assert.equal(idle.processed, 0);
  assert.equal(idle.pending, 0);
  state.store.close();
  state.store = new Store(state.folder);
  const resumed = refresh(state.store, { now: NOW, budget: 1 });
  assert.equal(resumed.processed, 0);
  assert.equal(resumed.pending, 0);
  assert.equal(resumed.rebuilt, false);
  assert.deepEqual(concept(state.store, "persisted").summary, before);
});

test("cached reads and single-card changes never read the full review history", (t) => {
  const { store } = fixture(t, [card("target"), card("other")]);
  spaced(store, "target");
  spaced(store, "other");
  settle(store);
  const prepare = store.db.prepare.bind(store.db);
  store.db.prepare = (sql) => {
    if (/\bSELECT\b[\s\S]*\bFROM\s+reviews\b/i.test(sql)) {
      assert(
        /\bcard_id\s*=/i.test(sql) || /\b(?:count|max)\s*\(/i.test(sql),
        `Incremental scoring tried to read all review events: ${sql}`,
      );
    }
    return prepare(sql);
  };
  try {
    assert.equal(refresh(store, { now: NOW, budget: 1 }).processed, 0);
    snapshot(store, { now: NOW });
    store.db
      .prepare("UPDATE reviews SET rating='Again' WHERE card_id='target'")
      .run();
    assert.equal(refresh(store, { now: NOW, budget: 1 }).processed, 1);
    assert(concept(store, "target").summary.needsPractice > 0);
  } finally {
    store.db.prepare = prepare;
  }
});

test("appending a review consumes only the new event for an already projected card", (t) => {
  const { store } = fixture(t, [card("append")]);
  spaced(store, "append", 120, "Good", new Date(NOW.getTime() - 3 * DAY));
  settle(store);
  const prepare = store.db.prepare.bind(store.db);
  let rowsRead = 0;
  store.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (!/\bSELECT\b[\s\S]*\bFROM\s+reviews\b/i.test(sql)) return statement;
    return new Proxy(statement, {
      get(target, key) {
        if (key === "all")
          return (...args) => {
            const rows = target.all(...args);
            rowsRead += rows.length;
            return rows;
          };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  try {
    rate(store, "append", "Good", NOW);
    const work = refresh(store, { now: NOW, budget: 1 });
    assert.equal(work.processed, 1);
    assert.equal(work.rebuilt, false);
    assert.equal(
      rowsRead,
      1,
      "An ordinary append must not replay the card's old events",
    );
  } finally {
    store.db.prepare = prepare;
  }
});

test("a bounded refresh leaves pending work visible and eventually catches up", (t) => {
  const { store } = fixture(
    t,
    Array.from({ length: 5 }, (_, i) => card(`bounded-${i}`)),
  );
  const first = refresh(store, { now: NOW, budget: 2 });
  assert(first.processed <= 2);
  assert(first.pending > 0);
  let totalProcessed = first.processed;
  let work = first;
  for (let i = 0; i < 10 && work.pending; i++) {
    work = refresh(store, { now: NOW, budget: 2 });
    assert(work.processed <= 2);
    totalProcessed += work.processed;
  }
  assert.equal(work.pending, 0);
  assert.equal(totalProcessed, 5);
});

test("time-based refresh updates stale readiness without adding reviews", (t) => {
  const { store } = fixture(t, [card("decays")]);
  spaced(store, "decays", 5);
  const before = concept(store, "decays").summary;
  const rows = durableRows(store);
  const later = new Date(NOW.getTime() + 180 * DAY);
  const work = refresh(store, { now: later, budget: 10 });
  assert(
    work.processed > 0,
    "Elapsed time must invalidate freshness, not only review writes",
  );
  const after = concept(store, "decays", later).summary;
  assert(after.score < before.score);
  assert.equal(after.assessed, before.assessed);
  assert.deepEqual(durableRows(store), rows);
});

test("a cached future review becomes eligible when its timestamp arrives", (t) => {
  const { store } = fixture(t, [card("future-eligibility")]);
  const future = new Date(NOW.getTime() + 2 * DAY);
  rate(store, "future-eligibility", "Good", future);
  const before = concept(store, "future-eligibility").summary;
  assert.equal(before.score, null);
  const rows = durableRows(store);
  const work = refresh(store, { now: future, budget: 1 });
  assert.equal(work.processed, 1);
  const after = concept(store, "future-eligibility", future).summary;
  assert(after.score > 0);
  assert.equal(after.assessed, 1);
  assert.deepEqual(durableRows(store), rows);
});

test("a backward clock cannot reuse evidence from reviews that are now in the future", (t) => {
  const { store } = fixture(t, [card("clock")]);
  rate(store, "clock", "Good", NOW);
  assert(concept(store, "clock").summary.score > 0);
  const before = durableRows(store);
  const earlier = new Date(NOW.getTime() - DAY);
  const result = snapshot(store, { now: earlier, budget: 1 });
  assert.equal(result.checkpoint.pending, 0);
  assert.equal(result.concepts[0].summary.score, null);
  assert.equal(result.concepts[0].summary.assessed, 0);
  assert.equal(result.concepts[0].summary.lastReviewAt, null);
  assert.equal(result.concepts[0].summary.asOf, earlier.toISOString());
  assert.deepEqual(durableRows(store), before);
  assert(concept(store, "clock", NOW).summary.score > 0);
});

test("a budgeted backward-clock rebuild quarantines all displayed scores until caught up", (t) => {
  const ids = ["clock-a", "clock-b", "clock-c"];
  const { store } = fixture(
    t,
    ids.map((id) => card(id)),
  );
  for (const id of ids) rate(store, id, "Good", NOW);
  settle(store);
  const earlier = new Date(NOW.getTime() - DAY);
  let result = snapshot(store, { now: earlier, budget: 1 });
  assert(result.checkpoint.pending > 0);
  assert.equal(result.checkpoint.clockReset, true);
  for (let i = 0; i < ids.length; i++) {
    for (const c of result.concepts) {
      assert.equal(c.summary.score, null);
      assert.equal(c.summary.coverage, 0);
      assert.equal(c.summary.assessed, 0);
      for (const s of Object.values(c.formats)) {
        assert.equal(s.score, null);
        assert.equal(s.lastReviewAt, null);
      }
    }
    if (!result.checkpoint.pending) break;
    result = snapshot(store, { now: earlier, budget: 1 });
  }
  assert.equal(result.checkpoint.pending, 0);
  assert.equal(result.checkpoint.clockReset, false);
  assert(result.concepts.every((c) => c.summary.score === null));
  const later = snapshot(store, { now: NOW, budget: 10 });
  assert.equal(later.checkpoint.pending, 0);
  assert(later.concepts.every((c) => c.summary.score > 0));
});

test("meaningful content revisions invalidate old scored evidence without deleting history", (t) => {
  const { store } = fixture(t, [card("revised")]);
  spaced(store, "revised");
  assert(concept(store, "revised").summary.score > 0);
  const reviews = store.db.prepare("SELECT * FROM reviews ORDER BY id").all();
  const content = JSON.parse(store.card("revised").content);
  content.answer = "A different objective and corrected explanation.";
  content.revision = (content.revision || 0) + 1;
  store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(content), content.id);
  const revised = concept(store, "revised").summary;
  assert.equal(revised.score, null);
  assert.equal(revised.assessed, 0);
  assert.deepEqual(
    store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
    reviews,
  );
  rate(store, "revised", "Good", NOW.getTime() + 60000);
  const newSummary = concept(
    store,
    "revised",
    new Date(NOW.getTime() + 60000),
  ).summary;
  assert(newSummary.score > 0);
  assert(newSummary.confidence < 1);
});

test("organization and widget-only edits preserve reviewed objective evidence", (t) => {
  const { store } = fixture(t, [card("organized")]);
  spaced(store, "organized");
  const before = concept(store, "organized").summary;
  const content = JSON.parse(store.card("organized").content);
  Object.assign(content, {
    topic: "Data Engineering",
    tags: ["columnar", "compression"],
    decks: ["Reorganized"],
    widgetsAllowed: true,
    revision: 2,
  });
  store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(content), content.id);
  const after = concept(store, "organized");
  assert.equal(after.topic, "Data Engineering");
  assert.equal(after.summary.score, before.score);
  assert.equal(after.summary.confidence, before.confidence);
  assert.equal(after.summary.assessed, before.assessed);
});

test("replacing an inline interactive widget preserves the scored prose objective", (t) => {
  const c = card("widget");
  c.answer += "\n\n```widget First visual\n<div>old interaction</div>\n```";
  const { store } = fixture(t, [c]);
  spaced(store, c.id);
  const before = concept(store, c.id).summary;
  const content = JSON.parse(store.card(c.id).content);
  content.answer = content.answer.replace(
    "First visual\n<div>old interaction</div>",
    "Improved visual\n<div>new interaction</div>",
  );
  store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(content), c.id);
  const after = concept(store, c.id).summary;
  assert.equal(after.score, before.score);
  assert.equal(after.confidence, before.confidence);
  assert.equal(after.assessed, before.assessed);
});

test("compact epochs retain A-to-B-to-A invalidation without retaining content versions", (t) => {
  const { store } = fixture(t, [card("epoch-roundtrip")]);
  spaced(store, "epoch-roundtrip");
  assert(concept(store, "epoch-roundtrip").summary.score > 0);
  const original = JSON.parse(store.card("epoch-roundtrip").content);
  const changed = { ...original, answer: "A different capability and answer." };
  const write = store.db.prepare("UPDATE cards SET content=? WHERE id=?");
  write.run(JSON.stringify(changed), original.id);
  rate(store, original.id, "Good", NOW.getTime() + 60000);
  write.run(JSON.stringify(original), original.id);
  const current = concept(store, original.id, new Date(NOW.getTime() + 60000));
  assert.equal(current.summary.score, null);
  assert.equal(current.summary.reviewCount, 0);
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM expertise_content_changes")
      .get().n,
    0,
  );
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM expertise_epochs WHERE card_id=?")
      .get(original.id).n,
    1,
  );
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM reviews WHERE card_id=?")
      .get(original.id).n,
    7,
  );
});

test("SQL epoch comparison distinguishes complete widgets from ordinary and unfinished fences", (t) => {
  const cases = [
    {
      id: "multiple",
      old: "Text\n```widget A\none\n```\nMiddle\n```widget B\ntwo\n```\nEnd",
      next: "Text\n```widget New\nchanged\n```\nMiddle\n```widget B\nchanged too\n```\nEnd",
      preserve: true,
    },
    {
      id: "whitespace",
      old: "\u00a0Text\n```widget\none\n```\t",
      next: "\tText\n```widget\ntwo\n```\u00a0",
      preserve: true,
    },
    {
      id: "unfinished",
      old: "Text\n```widget\none",
      next: "Text\n```widget\ntwo",
      preserve: false,
    },
    {
      id: "one-line",
      old: "Text\n```widget one```",
      next: "Text\n```widget two```",
      preserve: false,
    },
    {
      id: "ordinary-code",
      old: "Text\n```html\none\n```",
      next: "Text\n```html\ntwo\n```",
      preserve: false,
    },
  ];
  const { store } = fixture(
    t,
    cases.map((c) => card(c.id, { answer: c.old })),
  );
  for (const c of cases) {
    spaced(store, c.id);
    const before = concept(store, c.id).summary;
    const content = JSON.parse(store.card(c.id).content);
    content.answer = c.next;
    store.db
      .prepare("UPDATE cards SET content=? WHERE id=?")
      .run(JSON.stringify(content), c.id);
    const after = concept(store, c.id).summary;
    assert.equal(after.score, c.preserve ? before.score : null, c.id);
  }
});

test("many large widget and metadata edits keep one dirty marker and no copied card bodies", (t) => {
  const c = card("large-widget", {
    answer:
      "Stable prose.\n```widget Visual\n<div>" +
      "x".repeat(256 * 1024) +
      "</div>\n```",
  });
  const { store } = fixture(t, [c]);
  spaced(store, c.id);
  const before = concept(store, c.id).summary;
  const write = store.db.prepare("UPDATE cards SET content=? WHERE id=?");
  for (let i = 0; i < 24; i++) {
    const content = {
      ...c,
      tags: ["tag-" + i],
      answer: c.answer.replace("<div>", '<div data-state="' + i + '">'),
    };
    write.run(JSON.stringify(content), c.id);
  }
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM expertise_dirty WHERE card_id=?")
      .get(c.id).n,
    1,
  );
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM expertise_content_changes")
      .get().n,
    0,
  );
  assert.equal(
    store.db
      .prepare("SELECT cutoff FROM expertise_epochs WHERE card_id=?")
      .get(c.id).cutoff,
    0,
  );
  assert.equal(concept(store, c.id).summary.score, before.score);
});

test("legacy queued content versions migrate to compact cutoffs without touching learning history", (t) => {
  const { store } = fixture(t, [card("legacy-queue")]);
  spaced(store, "legacy-queue");
  assert(concept(store, "legacy-queue").summary.score > 0);
  const original = JSON.parse(store.card("legacy-queue").content);
  const changed = { ...original, answer: "A different temporary objective." };
  const cutoff = store.db.prepare("SELECT max(id) AS id FROM reviews").get().id;
  const insert = store.db.prepare(
    "INSERT INTO expertise_content_changes(card_id,old_content,new_content,cutoff) VALUES(?,?,?,?)",
  );
  insert.run(
    original.id,
    JSON.stringify(original),
    JSON.stringify(changed),
    cutoff,
  );
  insert.run(
    original.id,
    JSON.stringify(changed),
    JSON.stringify(original),
    cutoff,
  );
  const before = durableRows(store);
  install(store.db);
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM expertise_content_changes")
      .get().n,
    0,
  );
  assert.equal(concept(store, original.id).summary.score, null);
  assert.deepEqual(durableRows(store), before);
});

test("compact semantic triggers work through a plain SQLite connection without registered functions", (t) => {
  const state = fixture(t, [card("plain-sql")]);
  spaced(state.store, "plain-sql");
  assert(concept(state.store, "plain-sql").summary.score > 0);
  const content = JSON.parse(state.store.card("plain-sql").content);
  state.store.close();
  const db = new DatabaseSync(path.join(state.folder, "recall.sqlite"));
  try {
    content.answer = "A new answer through a plain SQLite writer.";
    db.prepare("UPDATE cards SET content=? WHERE id=?").run(
      JSON.stringify(content),
      content.id,
    );
  } finally {
    db.close();
  }
  state.store = new Store(state.folder);
  assert.equal(concept(state.store, "plain-sql").summary.score, null);
});

test("a new content epoch cannot inherit old-objective FSRS durability", (t) => {
  const { store } = fixture(t, [card("seasoned"), card("fresh")]);
  spaced(store, "seasoned", 40, "Easy", new Date(NOW.getTime() - 3 * DAY));
  assert(concept(store, "seasoned").summary.score > 0);
  const content = JSON.parse(store.card("seasoned").content);
  content.prompt = "A completely new objective.";
  content.answer = "The new objective's answer.";
  store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(content), content.id);
  assert.equal(concept(store, "seasoned").summary.score, null);
  rate(store, "seasoned", "Good", NOW);
  rate(store, "fresh", "Good", NOW);
  const revised = concept(store, "seasoned").summary;
  const fresh = concept(store, "fresh").summary;
  assert.equal(revised.confidence, fresh.confidence);
  assert.equal(
    revised.score,
    fresh.score,
    "Only post-edit evidence may establish the new objective's durability",
  );
});

test("an edit before the first score projection cannot inherit the old objective's reviews", (t) => {
  const { store } = fixture(t, [card("early-edit")]);
  spaced(store, "early-edit");
  const content = JSON.parse(store.card("early-edit").content);
  content.prompt = "Test a new capability instead of the original objective.";
  store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(content), content.id);
  const revised = concept(store, "early-edit").summary;
  assert.equal(revised.score, null);
  assert.equal(revised.assessed, 0);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM reviews").get().n,
    6,
  );
});

test("failed writer transactions roll back both evidence mutations and invalidation work", (t) => {
  const { store } = fixture(t, [card("atomic")]);
  spaced(store, "atomic");
  settle(store);
  const before = concept(store, "atomic").summary;
  assert.throws(
    () =>
      store.transaction(() => {
        store.db
          .prepare("UPDATE reviews SET undone=1 WHERE card_id='atomic'")
          .run();
        throw Error("Abort fixture transaction");
      }),
    /Abort fixture/,
  );
  const work = refresh(store, { now: NOW, budget: 1 });
  assert.equal(work.processed, 0);
  assert.equal(work.pending, 0);
  assert.deepEqual(concept(store, "atomic").summary, before);
});

test("projection installation is idempotent and ordinary scoring creates no full backups", (t) => {
  const { store, folder } = fixture(t, [card("local")]);
  install(store.db);
  install(store.db);
  spaced(store, "local");
  const rows = durableRows(store);
  for (let i = 0; i < 5; i++) {
    const result = snapshot(store, { now: NOW });
    assert(result.checkpoint);
    assertSummary(result.concepts[0].summary);
  }
  assert.deepEqual(durableRows(store), rows);
  const backups = path.join(folder, "backups");
  assert(!fs.existsSync(backups) || fs.readdirSync(backups).length === 0);
});

const node = (id, parentId = null, weight = 1) => ({
  id,
  parentId,
  label: id,
  weight,
});
const mapping = (id, nodeId) => ({ kind: "concept", id, nodeId });
function applyTaxonomy(store, additions) {
  return taxonomy.apply(store, {
    expectedRevision: taxonomy.read(store).revision,
    ...additions,
  });
}

test("topic weighting follows branches rather than the number of cards in a populated branch", (t) => {
  const { store } = fixture(t, [card("strong"), card("unassessed")]);
  spaced(store, "strong");
  applyTaxonomy(store, {
    nodes: [node("domain"), node("populated", "domain"), node("gap", "domain")],
    mappings: [mapping("strong", "populated"), mapping("unassessed", "gap")],
  });
  settle(store);
  const before = topicSummary(store.db, "domain", "all", NOW);
  const more = Array.from({ length: 20 }, (_, i) => card(`more-${i}`));
  store.import(more);
  for (const c of more) spaced(store, c.id);
  applyTaxonomy(store, {
    mappings: more.map((c) => mapping(c.id, "populated")),
  });
  settle(store);
  const after = topicSummary(store.db, "domain", "all", NOW);
  assert.equal(after.coverage, before.coverage);
  assert.equal(after.score, before.score);
  assert(
    after.total > before.total,
    "The populated branch really acquired more distinct objectives",
  );
});

test("an empty curated branch contributes an explicit coverage gap", (t) => {
  const { store } = fixture(t, [card("known")]);
  spaced(store, "known");
  applyTaxonomy(store, {
    nodes: [node("domain"), node("known-branch", "domain")],
    mappings: [mapping("known", "known-branch")],
  });
  settle(store);
  const before = topicSummary(store.db, "domain", "all", NOW);
  applyTaxonomy(store, { nodes: [node("unmapped-branch", "domain")] });
  settle(store);
  const after = topicSummary(store.db, "domain", "all", NOW);
  assert(after.coverage < before.coverage);
  assert(after.score < before.score);
  assert.equal(after.assessed, before.assessed);
  assert.equal(
    topicSummary(store.db, "unmapped-branch", "all", NOW).score,
    null,
  );
});

test("topic delta updates agree with a full topology rebuild after review and undo", (t) => {
  const { store } = fixture(t, [card("left-card"), card("right-card")]);
  spaced(store, "left-card", 5, "Good", new Date(NOW.getTime() - 2 * DAY));
  spaced(store, "right-card", 5, "Good", new Date(NOW.getTime() - 2 * DAY));
  applyTaxonomy(store, {
    nodes: [
      node("domain"),
      node("left", "domain", 3),
      node("right", "domain", 1),
    ],
    mappings: [mapping("left-card", "left"), mapping("right-card", "right")],
  });
  settle(store);
  const original = topicSummary(store.db, "domain", "all", NOW);
  rate(store, "left-card", "Again", NOW);
  const changed = refresh(store, { now: NOW, budget: 1 });
  assert.equal(changed.rebuilt, false);
  const delta = topicSummary(store.db, "domain", "all", NOW);
  assert(delta.score < original.score);
  store.transaction(() => rebuildTopology(store, NOW.getTime()));
  assert.deepEqual(topicSummary(store.db, "domain", "all", NOW), delta);
  store.undo();
  const undone = refresh(store, { now: NOW, budget: 1 });
  assert.equal(undone.rebuilt, false);
  const restored = topicSummary(store.db, "domain", "all", NOW);
  assert.deepEqual(restored, original);
  store.transaction(() => rebuildTopology(store, NOW.getTime()));
  assert.deepEqual(topicSummary(store.db, "domain", "all", NOW), restored);
});

test("related graph connections never create additional expertise votes", (t) => {
  const { store } = fixture(t, [card("one"), card("two")]);
  spaced(store, "one");
  applyTaxonomy(store, {
    nodes: [node("domain"), node("left", "domain"), node("right", "domain")],
    mappings: [mapping("one", "left"), mapping("two", "right")],
  });
  settle(store);
  const before = topicSummary(store.db, "domain", "all", NOW);
  applyTaxonomy(store, {
    relations: [
      { from: "left", to: "right", type: "uses", status: "suggested" },
      { from: "right", to: "left", type: "related", status: "suggested" },
    ],
  });
  settle(store);
  assert.deepEqual(topicSummary(store.db, "domain", "all", NOW), before);
});

test("moving a concept removes its contribution from the old ancestor", (t) => {
  const { store } = fixture(t, [card("moved")]);
  spaced(store, "moved");
  applyTaxonomy(store, {
    nodes: [node("domain"), node("old", "domain"), node("new", "domain")],
    mappings: [mapping("moved", "old")],
  });
  settle(store);
  assert(topicSummary(store.db, "old", "all", NOW).score > 0);
  const rootBefore = topicSummary(store.db, "domain", "all", NOW);
  applyTaxonomy(store, { mappings: [mapping("moved", "new")] });
  settle(store);
  assert.equal(topicSummary(store.db, "old", "all", NOW).score, null);
  assert.equal(topicSummary(store.db, "old", "all", NOW).assessed, 0);
  assert(topicSummary(store.db, "new", "all", NOW).score > 0);
  assert.deepEqual(topicSummary(store.db, "domain", "all", NOW), rootBefore);
});

function assertClose(actual, expected, message) {
  assert(
    Math.abs(actual - expected) <= Math.max(1e-14, Math.abs(expected) * 1e-12),
    message || `${actual} differs from ${expected}`,
  );
}

function weakPositive(store, id) {
  // Repeated difficulties followed by one Hard supplies small, nonzero evidence.
  for (let i = 20; i > 0; i--)
    rate(store, id, "Again", NOW.getTime() - (365 + i) * DAY);
  rate(store, id, "Hard", NOW.getTime() - 365 * DAY);
}

test("small positive evidence survives wide and deep primary rollups without rounding", (t) => {
  const cards = Array.from({ length: 20 }, (_, i) => card(`precision-${i}`));
  const { store } = fixture(t, cards);
  weakPositive(store, cards[0].id);
  const nodes = [node("domain")];
  let parent = "domain";
  for (let level = 0; level < 5; level++) {
    const child = `level-${level}`;
    nodes.push(node(child, parent));
    for (let i = 0; i < 9; i++) nodes.push(node(`gap-${level}-${i}`, parent));
    parent = child;
  }
  applyTaxonomy(store, {
    nodes,
    mappings: cards.map((c) => mapping(c.id, parent)),
  });
  settle(store);
  const leaf = concept(store, cards[0].id).summary;
  assert(
    leaf.score > 0 && leaf.score < 0.1,
    "Sub-decimal evidence remains positive",
  );
  const broad = topicSummary(store.db, "domain", "all", NOW);
  assert(broad.score > 0 && broad.score < 0.000001);
  assertClose(broad.score, leaf.score / 20 / 10 ** 5);
  assert.equal(broad.assessed, 1);
  assert.equal(topicSummary(store.db, "gap-0-0", "all", NOW).score, null);
});

test("full precision delta updates retain true zero through corrections and undo", (t) => {
  const { store } = fixture(t, [card("large"), card("small"), card("unknown")]);
  spaced(store, "large", 7, "Good", new Date(NOW.getTime() - 3 * DAY));
  rate(store, "small", "Hard", NOW.getTime() - 365 * DAY);
  applyTaxonomy(store, {
    nodes: [node("domain"), node("left", "domain"), node("right", "domain")],
    mappings: [
      mapping("large", "left"),
      mapping("small", "right"),
      mapping("unknown", "right"),
    ],
  });
  settle(store);
  const before = topicSummary(store.db, "domain", "all", NOW);
  rate(store, "large", "Again", NOW);
  const delta = refresh(store, { now: NOW, budget: 1 });
  assert.equal(delta.rebuilt, false);
  const changed = topicSummary(store.db, "domain", "all", NOW);
  store.transaction(() => rebuildTopology(store, NOW.getTime()));
  assertClose(
    topicSummary(store.db, "domain", "all", NOW).score,
    changed.score,
  );
  store.undo();
  refresh(store, { now: NOW, budget: 1 });
  assertClose(topicSummary(store.db, "domain", "all", NOW).score, before.score);
  // Corrections erase every positive outcome, but retain assessed evidence.
  store.db
    .prepare("UPDATE reviews SET rating='Again' WHERE card_id='large'")
    .run();
  refresh(store, { now: NOW, budget: 1 });
  assert(
    topicSummary(store.db, "domain", "all", NOW).score > 0,
    "The small remaining contributor survives cancellation",
  );
  store.db
    .prepare("UPDATE reviews SET rating='Again' WHERE card_id='small'")
    .run();
  refresh(store, { now: NOW, budget: 1 });
  const zero = topicSummary(store.db, "domain", "all", NOW);
  assert.equal(zero.score, 0);
  assert.equal(zero.assessed, 2);
  for (const r of store.db
    .prepare("SELECT acc FROM expertise_topics WHERE node_id='domain'")
    .all()) {
    const acc = JSON.parse(r.acc);
    assert.equal(acc.score, 0);
    assert.equal(acc.scoreCorrection, 0);
    assert.equal(acc.positive, 0);
  }
  assert.equal(concept(store, "unknown").summary.score, null);
  store.transaction(() => rebuildTopology(store, NOW.getTime()));
  assert.equal(topicSummary(store.db, "domain", "all", NOW).score, 0);
  rate(store, "small", "Hard", NOW);
  refresh(store, { now: NOW, budget: 1 });
  const restoredPositive = topicSummary(store.db, "domain", "all", NOW).score;
  assert(restoredPositive > 0);
  store.transaction(() => rebuildTopology(store, NOW.getTime()));
  assertClose(
    topicSummary(store.db, "domain", "all", NOW).score,
    restoredPositive,
  );
});

test("precision migration resumes bounded work from checkpoints without reading old reviews", (t) => {
  const cards = Array.from({ length: 5 }, (_, i) => card(`upgrade-${i}`));
  const state = fixture(t, cards);
  for (const c of cards) weakPositive(state.store, c.id);
  settle(state.store);
  const durable = durableRows(state.store);
  // Emulate the old rounded derived cache while retaining its event checkpoints.
  for (const row of state.store.db
    .prepare("SELECT card_id,data FROM expertise_cards")
    .all()) {
    const value = JSON.parse(row.data);
    assert(value.summary.score > 0 && value.summary.score < 0.1);
    value.summary.score = 0;
    state.store.db
      .prepare("UPDATE expertise_cards SET data=? WHERE card_id=?")
      .run(JSON.stringify(value), row.card_id);
  }
  state.store.db
    .prepare("DELETE FROM expertise_meta WHERE key='scorePrecision'")
    .run();
  state.store.close();
  state.store = new Store(state.folder);
  let rowsRead = 0;
  function watchHistory() {
    const prepare = state.store.db.prepare.bind(state.store.db);
    state.store.db.prepare = (sql) => {
      const stmt = prepare(sql);
      if (!/\bSELECT\b[\s\S]*\bFROM\s+reviews\b/i.test(sql)) return stmt;
      return new Proxy(stmt, {
        get(target, key) {
          if (key === "all")
            return (...args) => {
              const rows = target.all(...args);
              rowsRead += rows.length;
              return rows;
            };
          const value = target[key];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    return () => {
      state.store.db.prepare = prepare;
    };
  }
  assert.equal(
    state.store.db
      .prepare("SELECT count(*) AS n FROM expertise_dirty WHERE replay=0")
      .get().n,
    5,
  );
  let restore = watchHistory();
  const first = refresh(state.store, { now: NOW, budget: 2 });
  restore();
  assert.equal(first.processed, 2);
  assert.equal(first.pending, 3);
  const pending = state.store.db
    .prepare("SELECT card_id FROM expertise_dirty ORDER BY card_id")
    .all();
  state.store.close();
  state.store = new Store(state.folder);
  assert.deepEqual(
    state.store.db
      .prepare("SELECT card_id FROM expertise_dirty ORDER BY card_id")
      .all(),
    pending,
    "Reopening must not requeue completed migration work",
  );
  restore = watchHistory();
  for (let remaining = 3; remaining > 0; remaining -= 2) {
    const work = refresh(state.store, { now: NOW, budget: 2 });
    assert.equal(work.processed, Math.min(2, remaining));
    assert.equal(work.pending, Math.max(0, remaining - 2));
  }
  restore();
  assert.equal(
    rowsRead,
    0,
    "Precision-only migration reuses recorded event statistics",
  );
  assert.deepEqual(durableRows(state.store), durable);
  assert(
    state.store.db
      .prepare("SELECT data FROM expertise_cards")
      .all()
      .every((r) => JSON.parse(r.data).summary.score > 0),
  );
  assert.equal(refresh(state.store, { now: NOW, budget: 1 }).processed, 0);
});

test("precision migration preserves pending correction and deleted-card replay work", (t) => {
  const { store } = fixture(t, [
    card("corrected"),
    card("deleted"),
    card("unchanged"),
  ]);
  for (const id of ["corrected", "deleted", "unchanged"]) spaced(store, id);
  settle(store);
  store.db
    .prepare("UPDATE reviews SET rating='Again' WHERE card_id='corrected'")
    .run();
  store.db.prepare("DELETE FROM cards WHERE id='deleted'").run();
  store.db
    .prepare("DELETE FROM expertise_meta WHERE key='scorePrecision'")
    .run();
  const durable = durableRows(store);
  install(store.db);
  const queued = new Map(
    store.db
      .prepare("SELECT card_id,replay FROM expertise_dirty")
      .all()
      .map((r) => [r.card_id, r.replay]),
  );
  assert.equal(queued.get("corrected"), 1);
  assert.equal(queued.get("deleted"), 1);
  assert.equal(queued.get("unchanged"), 0);
  settle(store);
  assert.equal(concept(store, "corrected").summary.score, 0);
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM expertise_cards WHERE card_id='deleted'",
      )
      .get().n,
    0,
  );
  assert.deepEqual(durableRows(store), durable);
});
