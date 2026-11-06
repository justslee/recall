const { test } = require("node:test");
const assert = require("node:assert/strict");
const { build, snapshot } = require("../electron/learning-map.cjs");
const { Store } = require("../electron/store.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const model = import("../src/atlas-model.js");
const selected = { format: "all", deck: "all", topics: [], difficulty: "all" };
const card = (id, kind = "concept", extra = {}) => ({
  id,
  conceptId: "idea",
  title: id,
  kind,
  topic: "Mathematics",
  decks: ["Notebook"],
  difficulty: "Foundation",
  status: "ready",
  prompt: "Question",
  answer: "Reference",
  ...extra,
});
const rating = (card_id, at, value = "Good", extra = {}) => ({
  id: 1,
  card_id,
  at,
  rating: value,
  ...extra,
});

test("Atlas keeps concept, math, code and mixed evidence and practice independent", async () => {
  const { filterConcepts, stateOf, practiceIds, summarize } = await model;
  const rows = build([card("c"), card("m", "math"), card("p", "code")], {
    reviews: [rating("c", "2026-10-01")],
    now: "2026-10-10",
  });
  assert.equal(stateOf(rows[0]), "partial");
  assert.equal(summarize(rows).successful, 1);
  for (const [format, id, state] of [
    ["concept", "c", "practiced"],
    ["math", "m", "untried"],
    ["code", "p", "untried"],
  ]) {
    const filtered = filterConcepts(rows, { ...selected, format });
    assert.equal(stateOf(filtered[0]), state);
    assert.deepEqual(practiceIds(filtered), [id]);
    assert(filtered[0].events.every((e) => e.kind === format));
  }
  assert.equal(new Set(practiceIds(rows)).size, 3);
});

test("Atlas cannot leak cards outside a collection, difficulty or topic into sessions", async () => {
  const { filterConcepts, practiceIds } = await model;
  const rows = build([
    card("c"),
    card("m", "math", { difficulty: "Advanced" }),
    card("p", "code", { decks: ["Other"] }),
  ]);
  assert.deepEqual(
    practiceIds(
      filterConcepts(rows, {
        ...selected,
        deck: "Notebook",
        difficulty: "Foundation",
      }),
    ),
    ["c"],
  );
  assert.deepEqual(
    filterConcepts(rows, { ...selected, topics: ["Finance"] }),
    [],
  );
  assert.deepEqual(practiceIds(filterConcepts(rows, selected, "no match")), []);
  assert.deepEqual(practiceIds(rows, "missing"), []);
});

test("Mixed never awards a delayed ring to an untested or weaker format", async () => {
  const { stateOf, filterConcepts } = await model;
  const cards = [card("c"), card("m", "math")];
  const history = [
    rating("c", "2026-10-01"),
    rating("c", "2026-10-03"),
    rating("m", "2026-10-03", "Hard"),
  ];
  const rows = build(cards, { reviews: history, now: "2026-10-10" });
  assert.equal(stateOf(rows[0]), "needs_practice");
  assert.equal(
    stateOf(filterConcepts(rows, { ...selected, format: "concept" })[0]),
    "recalled_later",
  );
});

test("Atlas paths require explicit links and demonstrated bridges require successful shared exercises", async () => {
  const { connections } = await model;
  const cards = [
    card("a", "concept", { conceptId: "a" }),
    card("b", "concept", { conceptId: "b" }),
    card("exercise", "math", {
      conceptId: "exercise",
      parentCardIds: ["a", "b", "missing"],
    }),
  ];
  assert.deepEqual(connections(build(cards.slice(0, 2))), []);
  const untouched = connections(build(cards));
  assert.equal(untouched.length, 3);
  assert(untouched.every((l) => !l.demonstrated));
  for (const value of ["Good", "Hard"]) {
    const paths = connections(
      build(cards, {
        reviews: [rating("exercise", "2026-10-02", value)],
        now: "2026-10-10",
      }),
    );
    const bridge = paths.find((l) => l.a === "a" && l.b === "b");
    assert.equal(bridge.demonstrated, value === "Good");
    assert.equal(bridge.sourceCardId, "exercise");
  }
});

test("Atlas snapshots replay a week-ago cutoff without modifying any stored rows", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-atlas-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { force: true, recursive: true });
  });
  const cards = require("../examples/demo.json").cards;
  store.import(cards);
  const insert = store.db.prepare(
    "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,0,'{}','{}',0)",
  );
  insert.run(cards[0].id, "2026-10-01", "Hard");
  insert.run(cards[0].id, "2026-10-09", "Good");
  const tables = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((t) => t.name);
  const saved = () =>
    Object.fromEntries(
      tables.map((name) => [
        name,
        store.db.prepare(`SELECT * FROM "${name}"`).all(),
      ]),
    );
  const before = saved();
  const result = snapshot(store, { now: "2026-10-10T12:00:00Z" });
  const current = result.concepts.find((r) =>
    r.cards.some((c) => c.id === cards[0].id),
  );
  const previous = result.previous.concepts.find((r) => r.id === current.id);
  assert.equal(current.recall[0].state, "recalled_later");
  assert.equal(previous.recall[0].state, "needs_practice");
  assert.equal(previous.events.length, 1);
  assert.equal(current.events.length, 2);
  assert.deepEqual(saved(), before);
});

test("historical snapshots exclude future feedback and never count skipped, undone or practice ratings", async () => {
  const { stateOf } = await model;
  const rows = build([card("c")], {
    now: "2026-10-01",
    reviews: [
      rating("c", "2026-09-01", "Skip"),
      rating("c", "2026-09-02", "Good", { practice: true }),
      rating("c", "2026-09-03", "Good", { undone: true }),
      rating("c", "2026-10-02"),
    ],
    explanations: [
      { at: "2026-10-02", config: {}, feedback: { outcome: "grounded" } },
    ],
  });
  assert.equal(stateOf(rows[0]), "untried");
  assert.deepEqual(rows[0].events, []);
});
