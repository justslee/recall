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

test("first and repeat reviews use the earliest surviving scored event across all history", () => {
  const history = [
    event(8, "a", "Easy"),
    event(7, "b", "Good"),
    event(6, "b", "Again"),
    event(5, "c", "Hard"),
    event(4, "b", "Again", { practice: 1, at: "2026-08-01T12:00:00Z" }),
    event(3, "c", "Again", { undone: 1, at: "2026-08-01T12:00:00Z" }),
    event(2, "a", "Good", { at: "2026-08-01T12:00:00Z" }),
    event(1, "c", "Skip", { at: "2026-08-01T12:00:00Z" }),
    event(9, "d", "Good", { at: "2026-09-28T12:00:00Z" }),
  ];
  const before = structuredClone(history);
  const result = summarize([card("a"), card("b"), card("c")], history, {
    now,
    days: 7,
  });
  assert.equal(result.daily.at(-1).firstReviews, 2);
  assert.equal(result.daily.at(-1).repeatReviews, 2);
  assert.equal(result.daily.at(-1).reviews, 4);
  assert.equal(
    result.daily.reduce((n, d) => n + d.firstReviews, 0),
    2,
  );
  assert.deepEqual(history, before);
  assert.deepEqual(
    summarize([card("a"), card("b"), card("c")], [...history].reverse(), {
      now,
      days: 7,
    }).daily,
    result.daily,
  );
});

test("rolling recall weights review counts and includes six days before the displayed range", () => {
  const history = [
    event(1, "a", "Again", { at: "2026-09-14T12:00:00Z" }),
    event(2, "a", "Again", { at: "2026-09-15T12:00:00Z" }),
    ...Array.from({ length: 9 }, (_, i) =>
      event(i + 3, "a", "Good", { at: "2026-09-21T12:00:00Z" }),
    ),
    event(12, "a", "Again", { at: "2026-09-21T12:00:00Z", undone: 1 }),
    event(13, "a", "Again", { at: "2026-09-21T12:00:00Z", practice: 1 }),
    event(14, "a", "Skip", { at: "2026-09-21T12:00:00Z" }),
    event(15, "a", "Again", { at: "invalid" }),
    event(16, "a", "Again", { at: "2026-09-27T23:00:00Z" }),
  ];
  const result = summarize([card("a")], history, { now, days: 7 });
  assert.equal(result.reviews, 9);
  assert.equal(result.daily[0].rollingReviews, 10);
  assert.equal(result.daily[0].rollingRecallRate, 90);
  assert.equal(result.daily[1].rollingReviews, 9);
  assert.equal(result.daily[1].rollingRecallRate, 100);
  assert.equal(result.daily.at(-1).rollingReviews, 9);
  assert.equal(result.daily.at(-1).rollingRecallRate, 100);
  assert.equal(result.daily[0].firstReviews, 0);
  assert.equal(result.daily[0].repeatReviews, 9);
  const longer = summarize([card("a")], history, { now, days: 28 });
  assert.deepEqual(longer.daily.slice(-7), result.daily);
});

test("empty rolling windows stay unknown rather than becoming zero-percent recall", () => {
  const result = summarize([], [], { now, days: 90 });
  assert.equal(result.daily.length, 90);
  assert(result.daily.every((d) => d.rollingRecallRate === null));
  assert(result.daily.every((d) => d.rollingReviews === 0));
  assert(
    result.daily.every((d) => d.firstReviews === 0 && d.repeatReviews === 0),
  );
  assert.deepEqual(
    result.forecast.days.map((d) => d.due),
    Array(7).fill(0),
  );
  assert.equal(result.forecast.overdue, 0);
  assert.equal(result.forecast.today, 0);
  const expired = summarize(
    [],
    [
      event(1, "gone", "Again", {
        at: "2026-09-20T12:00:00Z",
      }),
    ],
    { now, days: 7 },
  );
  assert.equal(expired.daily[0].rollingRecallRate, 0);
  assert.equal(expired.daily.at(-1).rollingRecallRate, null);
});

test("rolling windows use calendar days through a DST transition", () => {
  const result = summarize(
    [],
    [
      event(1, "a", "Again", { at: "2026-03-01T13:00:00Z" }),
      event(2, "a", "Good", { at: "2026-03-07T23:00:00Z" }),
      event(3, "a", "Hard", { at: "2026-03-08T06:30:00Z" }),
      event(4, "a", "Again", { at: "2026-03-09T03:00:00Z" }),
    ],
    {
      now: new Date("2026-03-09T03:30:00Z"),
      timeZone: "America/New_York",
      days: 7,
    },
  );
  assert.equal(result.daily.at(-1).day, "2026-03-08");
  assert.equal(result.daily.at(-1).rollingReviews, 3);
  assert.equal(result.daily.at(-1).rollingRecallRate, 67);
  assert.equal(result.daily.at(-1).repeatReviews, 2);
});

test("due outlook uses current eligible schedules and local calendar days without double-counting overdue", () => {
  const scheduled = (id, due, patch = {}) =>
    card(id, {
      schedule: { state: 2, due },
      ...patch,
    });
  const cards = [
    scheduled("overdue", "2026-11-01T03:59:59Z"),
    scheduled("today-past", "2026-11-01T04:00:00Z"),
    scheduled("today-future", "2026-11-02T04:59:59Z"),
    scheduled("tomorrow", "2026-11-02T05:00:00Z"),
    scheduled("last-day", "2026-11-07T22:00:00Z"),
    scheduled("later", "2026-11-08T05:00:00Z"),
    scheduled("suspended", "2026-11-01T05:00:00Z", { suspended: true }),
    scheduled("draft", "2026-11-01T05:00:00Z", { status: "draft" }),
    scheduled("new", "2026-11-01T05:00:00Z", {
      schedule: { state: 0, due: "2026-11-01T05:00:00Z" },
    }),
    scheduled("invalid", "not a date"),
    scheduled("missing", undefined),
  ];
  const before = structuredClone(cards);
  const result = summarize(cards, [], {
    now: new Date("2026-11-01T06:30:00Z"),
    timeZone: "America/New_York",
  });
  assert.equal(result.due, 2);
  assert.equal(result.forecast.overdue, 1);
  assert.equal(result.forecast.today, 2);
  assert.deepEqual(result.forecast.days, [
    { day: "2026-11-01", due: 2 },
    { day: "2026-11-02", due: 1 },
    { day: "2026-11-03", due: 0 },
    { day: "2026-11-04", due: 0 },
    { day: "2026-11-05", due: 0 },
    { day: "2026-11-06", due: 0 },
    { day: "2026-11-07", due: 1 },
  ]);
  assert.deepEqual(cards, before);
});
