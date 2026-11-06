const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { build, snapshot } = require("../electron/learning-map.cjs");
const { hash } = require("../electron/catalog.cjs");
const { Store } = require("../electron/store.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const card = (id, kind = "concept") => ({
  id,
  conceptId: "idea",
  title: id,
  topic: "Math",
  decks: ["Examples"],
  kind,
  status: "ready",
  prompt: "Question",
  answer: "Answer",
});
const review = (id, at, rating, extra = {}) => ({
  id,
  card_id: "concept",
  at,
  rating,
  ...extra,
});
test("map distinguishes exposure, weak recall, delayed recall, undo and inapplicable exercise lanes", () => {
  const c = card("concept");
  let [row] = build([c]);
  assert.equal(row.recall[0].state, "untried");
  assert.deepEqual(row.apply, []);
  const events = [
    review(1, "2026-10-01T12:00:00Z", "Again"),
    review(2, "2026-10-03T12:00:00Z", "Good"),
  ];
  [row] = build([c], { reviews: events, now: "2026-10-31T12:00:00Z" });
  assert.equal(row.recall[0].state, "recalled_later");
  [row] = build([c], {
    reviews: [
      ...events,
      review(3, "2026-10-05T12:00:00Z", "Hard"),
      review(4, "2026-10-06T12:00:00Z", "Good", { undone: 1 }),
    ],
  });
  assert.equal(row.recall[0].state, "needs_practice");
  assert.equal(row.explain[0].state, "untried");
  assert.equal(
    build([c], {
      reviews: [
        review(5, "2099-01-01", "Good"),
        review(6, "2026-10-01", "Easy", { practice: 1 }),
      ],
    })[0].recall[0].state,
    "untried",
  );
});
test("only card-linked explanation evidence and exact-revision code attempts enter the map", () => {
  const c = card("concept"),
    code = card("code", "code");
  const explanations = [
    {
      id: "s",
      at: "2026-10-05",
      config: {
        sourceId:
          "card-" +
          createHash("sha256").update(c.id).digest("hex").slice(0, 32),
        grounding: "library",
      },
      feedback: { outcome: "partial" },
    },
  ];
  const attempts = [
    {
      id: 1,
      card_id: code.id,
      content_hash: hash(code),
      at: "2026-10-05",
      result: { status: "passed" },
    },
  ];
  let [row] = build([c, code], { explanations, challenges: attempts });
  assert.equal(row.explain[0].state, "needs_practice");
  assert.equal(row.apply[0].label, "Tests passed");
  [row] = build([c, { ...code, answer: "Edited exercise" }], {
    challenges: attempts,
  });
  assert.equal(row.apply[0].state, "untried");
  [row] = build([c], {
    explanations: [
      { ...explanations[0], config: { sourceId: "custom", grounding: "none" } },
    ],
  });
  assert.equal(row.explain[0].state, "untried");
});
test("map reads preserve all library state; all coding cards can record future attempts", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-map-"));
  const store = new Store(folder);
  t.after(() => {
    store.close();
    fs.rmSync(folder, { force: true, recursive: true });
  });
  store.import(require("../examples/demo.json").cards);
  const before = store.db.prepare("SELECT * FROM cards").all();
  const reviews = store.db.prepare("SELECT * FROM reviews").all();
  assert(snapshot(store).concepts.length > 0);
  assert.deepEqual(store.db.prepare("SELECT * FROM cards").all(), before);
  assert.deepEqual(store.db.prepare("SELECT * FROM reviews").all(), reviews);
  const code = require("../examples/demo.json").cards.find(
    (c) => c.kind === "code",
  );
  store.recordChallengeAttempt(code, "python", "learner code", {
    status: "passed",
  });
  assert.equal(
    snapshot(store)
      .concepts.flatMap((c) => c.apply)
      .find((e) => e.cardId === code.id).label,
    "Tests passed",
  );
});
