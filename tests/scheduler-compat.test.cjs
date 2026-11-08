const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createScheduler } = require("../electron/scheduler.cjs");
const { Store } = require("../electron/store.cjs");
const baseline = require("./fixtures/fsrs5-schedules.json");
const names = ["Again", "Hard", "Good", "Easy"];

// Frozen, synthetic outputs generated with ts-fsrs@5.4.2 before upgrading.
// v6 no longer emits elapsed_days; Recall never used it. Persisted JSON must
// still survive opening, previewing and Undo without being rewritten.
function schedulingFields(card) {
  const { elapsed_days, ...rest } = JSON.parse(JSON.stringify(card));
  return rest;
}

for (const example of baseline.cases) {
  test(`FSRS upgrade preserves ${example.name} scheduling and readiness`, () => {
    const scheduler = createScheduler();
    const before = structuredClone(example.card);
    const results = scheduler.repeat(example.card, example.at);
    for (const [grade, expected] of Object.entries(example.expected)) {
      assert.deepEqual(
        schedulingFields(results[grade].card),
        schedulingFields(expected),
      );
    }
    assert.equal(
      scheduler.retrievability(example.card, example.at),
      example.readiness,
    );
    assert.deepEqual(example.card, before);
  });
}

test("old persisted schedules and history survive reopen, preview, rating and Undo", (t) => {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-scheduler-upgrade-"),
  );
  let store = new Store(folder);
  t.after(() => {
    store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const example = baseline.cases.find(
    (entry) => entry.name === "review-overdue",
  );
  store.import([
    {
      id: "old-review",
      title: "Synthetic review",
      prompt: "Question",
      answer: "Answer",
      kind: "concept",
      topic: "Examples",
      decks: ["Examples"],
      status: "ready",
    },
  ]);
  const oldSchedule = JSON.stringify(example.card, null, 2);
  store.db
    .prepare("UPDATE cards SET schedule=? WHERE id=?")
    .run(oldSchedule, "old-review");
  store.db
    .prepare(
      "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,0,?,?,0)",
    )
    .run("old-review", example.card.last_review, "Easy", "{}", oldSchedule);
  const originalCards = store.db.prepare("SELECT * FROM cards").all();
  const originalHistory = store.db.prepare("SELECT * FROM reviews").all();
  store.close();
  store = new Store(folder);
  assert.deepEqual(
    store.db.prepare("SELECT * FROM cards").all(),
    originalCards,
  );
  assert.deepEqual(
    store.db.prepare("SELECT * FROM reviews").all(),
    originalHistory,
  );
  assert.deepEqual(
    store.intervals("old-review", new Date(example.at)),
    Object.fromEntries(
      names.map((name, i) => [name, example.expected[i + 1].due]),
    ),
  );
  assert.equal(store.card("old-review").schedule, oldSchedule);
  for (const [i, rating] of names.entries()) {
    const sessionId = `upgrade-${rating}`;
    store.set("session", {
      id: sessionId,
      ids: ["old-review"],
      index: 0,
      revealed: true,
      selection: { practice: false },
    });
    store.rate({ id: "old-review", rating, sessionId }, new Date(example.at));
    assert.deepEqual(
      schedulingFields(JSON.parse(store.card("old-review").schedule)),
      schedulingFields(example.expected[i + 1]),
    );
    store.undo();
    assert.equal(store.card("old-review").schedule, oldSchedule);
  }
  assert.deepEqual(
    store.db
      .prepare("SELECT * FROM reviews WHERE id=?")
      .all(originalHistory[0].id),
    originalHistory,
  );
});
