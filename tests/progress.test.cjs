const { test } = require("node:test");
const assert = require("node:assert/strict");
const { summarize, snapshot } = require("../electron/progress.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store } = require("../electron/store.cjs");
const now = new Date("2026-09-27T16:00:00Z");
const card = (id, patch = {}) => ({
  id,
  title: id,
  topic: "Systems",
  kind: "concept",
  status: "ready",
  suspended: false,
  schedule: { state: 2, due: "2026-09-27T12:00:00Z" },
  ...patch,
});
const event = (id, card_id, rating, patch = {}) => ({
  id,
  card_id,
  rating,
  at: "2026-09-27T14:00:00Z",
  undone: 0,
  practice: 0,
  ...patch,
});
test("progress separates attempts, distinct cards, recall, practice, skips, undo, and current weak cards", () => {
  const cards = [
    card("a"),
    card("b", { kind: "math" }),
    card("new", { schedule: { state: 0, due: now } }),
    card("suspended", { suspended: true }),
    card("draft", { status: "draft" }),
  ];
  const result = summarize(
    cards,
    [
      event(1, "a", "Again"),
      event(2, "a", "Good"),
      event(3, "b", "Hard"),
      event(4, "a", "Again", { practice: 1 }),
      event(5, "a", "Again", { undone: 1 }),
      event(6, "b", "Skip"),
      event(7, "new", "Easy", { at: "2026-09-28T12:00:00Z" }),
      event(8, "suspended", "Again", { at: "2026-08-01T12:00:00Z" }),
    ],
    { now },
  );
  assert.equal(result.reviews, 3);
  assert.equal(result.uniqueCards, 2);
  assert.equal(result.recallRate, 67);
  assert.equal(result.practice, 1);
  assert.equal(result.due, 2);
  assert.equal(result.library.available, 3);
  assert.deepEqual(
    result.needsPractice.map((c) => c.id),
    ["b"],
  );
  assert.equal(result.topics[0].needsPractice, 1);
  assert.equal(result.formats.find((f) => f.kind === "math").recalled, 1);
});
test("calendar windows and streaks use configured local dates across DST", () => {
  const data = summarize(
    [card("a")],
    [
      event(1, "a", "Good", { at: "2026-03-07T23:00:00Z" }),
      event(2, "a", "Good", { at: "2026-03-08T06:30:00Z" }),
      event(3, "a", "Again", { at: "2026-03-09T03:00:00Z" }),
    ],
    {
      days: 7,
      timeZone: "America/New_York",
      now: new Date("2026-03-09T03:30:00Z"),
    },
  );
  assert.equal(data.today, "2026-03-08");
  assert.equal(data.start, "2026-03-02");
  assert.equal(data.streak, 2);
  assert.equal(data.daily.at(-1).reviews, 2);
  const grace = summarize(
    [],
    [event(1, "gone", "Good", { at: "2026-09-26T14:00:00Z" })],
    { now },
  );
  assert.equal(grace.streak, 1);
  assert.equal(grace.topics[0].topic, "Unavailable cards");
  assert.equal(summarize([], [], { now }).recallRate, null);
  assert.throws(() => summarize([], [], { now, days: 999 }));
});
test("latest scored outcome includes older dates, with undo revealing the previous outcome", () => {
  const result = summarize(
    [card("a")],
    [
      event(1, "a", "Hard", { at: "2026-08-01T14:00:00Z" }),
      event(2, "a", "Good", { undone: 1 }),
    ],
    { now, days: 7 },
  );
  assert.equal(result.reviews, 0);
  assert.equal(result.needsPractice.length, 1);
});
test("dashboard reads beyond the 100-row history limit without modifying storage", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-progress-"));
  const s = new Store(folder);
  t.after(() => {
    s.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  s.import([
    { ...card("a"), answer: "Answer", prompt: "Question", decks: ["Examples"] },
  ]);
  const insert = s.db.prepare(
    "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,0,'{}','{}',0)",
  );
  for (let i = 0; i < 140; i++)
    insert.run("a", new Date(Date.now() - 60000).toISOString(), "Good");
  const before = s.snapshot();
  assert.equal(before.history.length, 100);
  assert.equal(snapshot(s, { days: 7 }).reviews, 140);
  assert.deepEqual(s.snapshot(), before);
});
