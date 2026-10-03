const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../electron/store.cjs");
const st = require("../electron/self-test.cjs");
const now = new Date("2026-09-13T18:00:00Z");
const entry = (patch = {}) => ({
  id: "session/objective/1",
  sessionId: "learning-1",
  title: "Duration",
  objective: "Explain a duration gap",
  context: "Discussed while reading Yen thesis",
  at: "2026-09-13T14:00:00Z",
  evidence: "discussed",
  cardIds: ["concept"],
  ...patch,
});
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-self-test-"));
  const s = new Store(folder);
  s.import(
    ["concept", "math", "code", "other"].map((id, i) => ({
      id,
      title: id,
      kind: id === "other" ? "concept" : id,
      conceptId: i < 3 ? "duration" : "other",
      status: "ready",
      topic: "Test",
      decks: ["Test"],
      answer: "hidden",
      prompt: "Question?",
    })),
  );
  t.after(() => {
    s.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return s;
}
test("capture is idempotent, immutable, validates evidence, and never changes schedules", (t) => {
  const s = fixture(t),
    before = s.cards();
  assert.equal(st.capture(s.folder, entry()).inserted, true);
  assert.equal(st.capture(s.folder, entry()).inserted, false);
  assert.throws(
    () => st.capture(s.folder, entry({ context: "different" })),
    /different content/,
  );
  assert.throws(
    () => st.capture(s.folder, entry({ evidence: "mastered" })),
    /evidence/,
  );
  assert.deepEqual(s.cards(), before);
  assert.equal(st.snapshot(s, now).days[0].sessions, 1);
  assert.match(
    fs.readFileSync(
      path.join(s.folder, "self-tests/days/2026-09-13.md"),
      "utf8",
    ),
    /Explain a duration gap/,
  );
});
test("dates use local day across midnight and DST", () => {
  assert.equal(st.dayOf("2026-09-14T02:00:00Z"), "2026-09-13");
  assert.equal(st.dayOf("2026-03-08T06:59:00Z"), "2026-03-08");
  assert.equal(st.dayOf("2026-03-08T07:01:00Z"), "2026-03-08");
});
test("deduplicate repeated cards, keep math/code siblings and interleave objectives", (t) => {
  const s = fixture(t);
  st.capture(
    s.folder,
    entry({ cardIds: ["concept", "math", "code", "other"] }),
  );
  st.capture(s.folder, entry({ id: "repeat", sessionId: "learning-2" }));
  const session = st.start(s, { day: "2026-09-13" }, now);
  assert.deepEqual(session.ids, ["concept", "other", "code", "math"]);
  assert.equal(session.revealed, false);
  assert.equal(session.selection.practice, false);
  assert.throws(() => st.start(s, { day: "2026-09-13" }, now), /Resume/);
  assert.equal(
    st.start(s, { day: "2026-09-13", replace: true }, now).ids.length,
    4,
  );
});
test("ratings count as tested; Skip and undo leave questions untested; queue guard still applies", (t) => {
  const s = fixture(t);
  st.capture(s.folder, entry());
  const session = st.start(s, { day: "2026-09-13" }, now);
  assert.throws(() =>
    s.rate({ id: "concept", rating: "Good", sessionId: session.id }, now),
  );
  s.set("session", { ...session, revealed: true });
  s.rate({ id: "concept", rating: "Again", sessionId: session.id }, now);
  assert.equal(st.snapshot(s, now).days[0].pending.length, 0);
  assert.equal(st.snapshot(s, now).days[0].cards[0].rating, "Again");
  assert.throws(() =>
    s.rate({ id: "concept", rating: "Good", sessionId: session.id }, now),
  );
  s.undo();
  assert.deepEqual(st.snapshot(s, now).days[0].pending, ["concept"]);
  s.rate({ id: "concept", rating: "Skip", sessionId: session.id }, now);
  assert.deepEqual(st.snapshot(s, now).days[0].pending, ["concept"]);
});
test("practice and future reviews do not count, older day can be completed later, all history is considered", (t) => {
  const s = fixture(t);
  st.capture(s.folder, entry());
  const insert = s.db.prepare(
    "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule) VALUES(?,?,?,?,?,?)",
  );
  insert.run("concept", now.toISOString(), "Good", 1, "{}", "{}");
  assert.equal(st.snapshot(s, now).days[0].pending.length, 1);
  insert.run("concept", "2026-09-15T18:00:00Z", "Good", 0, "{}", "{}");
  assert.equal(st.snapshot(s, now).days[0].pending.length, 1);
  insert.run("concept", now.toISOString(), "Good", 0, "{}", "{}");
  for (let i = 0; i < 110; i++)
    insert.run("other", now.toISOString(), "Good", 0, "{}", "{}");
  assert.equal(st.snapshot(s, now).days[0].pending.length, 0);
  assert.equal(
    st
      .snapshot(s, new Date("2026-09-14T18:00:00Z"))
      .days.find((d) => d.day === "2026-09-13").pending.length,
    0,
  );
});
test("gaps, unavailable cards, later links and unreadable records stay visible; backup includes learning", (t) => {
  const s = fixture(t);
  st.capture(s.folder, entry({ cardIds: [] }));
  assert.equal(st.snapshot(s, now).days[0].gaps, 1);
  st.link(s.folder, entry().id, ["concept"]);
  st.link(s.folder, entry().id, ["concept"]);
  assert.equal(st.snapshot(s, now).days[0].gaps, 0);
  s.suspend("concept", true);
  assert.equal(st.snapshot(s, now).days[0].pending.length, 0);
  st.capture(s.folder, entry({ id: "missing", cardIds: ["missing"] }));
  assert.equal(st.snapshot(s, now).days[0].gaps, 1);
  fs.writeFileSync(path.join(s.folder, "self-tests/entries/bad.json"), "{");
  assert.equal(st.snapshot(s, now).issues.length, 1);
  const backup = s.backup();
  assert(
    fs.existsSync(
      path.join(path.dirname(backup), "self-tests/days/2026-09-13.md"),
    ),
  );
});

test("a previous day can repeat weak or all cards without resetting history; only ratings reschedule", (t) => {
  const s = fixture(t);
  st.capture(
    s.folder,
    entry({ cardIds: ["concept", "math", "code", "other"] }),
  );
  const session = st.start(s, { day: "2026-09-13" }, now);
  for (const id of session.ids) {
    s.set("session", { ...s.get("session"), revealed: true });
    s.rate(
      {
        id,
        rating: id === "concept" ? "Again" : id === "math" ? "Hard" : "Good",
        sessionId: session.id,
      },
      now,
    );
  }
  const later = new Date("2026-09-14T18:00:00Z");
  const day = st.snapshot(s, later).days.find((d) => d.day === "2026-09-13");
  assert.equal(day.pending.length, 0);
  assert.equal(day.cards.find((c) => c.id === "concept").dueNow, true);
  assert.equal(
    day.cards.find((c) => c.id === "concept").due,
    JSON.parse(s.card("concept").schedule).due,
  );
  const cardsBefore = s.db.prepare("SELECT * FROM cards ORDER BY id").all();
  const reviewsBefore = s.db.prepare("SELECT * FROM reviews ORDER BY id").all();
  assert.throws(
    () => st.start(s, { day: "2026-09-13", mode: "invalid" }, later),
    /Unknown/,
  );
  assert.throws(
    () => st.start(s, { day: "2026-09-13" }, later),
    /No available/,
  );
  const retry = st.start(
    s,
    { day: "2026-09-13", mode: "needs-practice" },
    later,
  );
  assert.deepEqual(new Set(retry.ids), new Set(["concept", "math"]));
  assert.equal(retry.revealed, false);
  assert.equal(retry.selection.practice, false);
  assert.equal(retry.selection.selfTestDay, "2026-09-13");
  assert.deepEqual(
    s.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    cardsBefore,
  );
  assert.deepEqual(
    s.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
    reviewsBefore,
  );
  assert.throws(
    () => st.start(s, { day: "2026-09-13", mode: "all" }, later),
    /Resume/,
  );
  s.set("session", { ...retry, revealed: true });
  s.rate({ id: retry.ids[0], rating: "Good", sessionId: retry.id }, later);
  assert.notEqual(
    s.card(retry.ids[0]).schedule,
    cardsBefore.find((c) => c.id === retry.ids[0]).schedule,
  );
  assert.equal(
    st
      .snapshot(s, later)
      .days.find((d) => d.day === "2026-09-13")
      .cards.find((c) => c.id === retry.ids[0]).rating,
    "Good",
  );
  s.undo();
  assert.equal(
    st
      .snapshot(s, later)
      .days.find((d) => d.day === "2026-09-13")
      .cards.find((c) => c.id === retry.ids[0]).rating,
    "Again",
  );
  s.suspend("code", true);
  s.saveCard({ ...JSON.parse(s.card("other").content), status: "draft" });
  const all = st.start(
    s,
    { day: "2026-09-13", mode: "all", replace: true },
    later,
  );
  assert.deepEqual(new Set(all.ids), new Set(["concept", "math"]));
  assert.equal(all.selection.selfTestMode, "all");
});

test("format selection is strict for daily and repeat passes and never falls back", (t) => {
  const s = fixture(t);
  st.capture(
    s.folder,
    entry({ cardIds: ["concept", "math", "code", "other"] }),
  );
  const before = s.cards();
  for (const format of ["concept", "math", "code", "all"]) {
    const result = st.start(
      s,
      { day: "2026-09-13", replace: true, mode: "all", format },
      now,
    );
    assert.equal(result.selection.format, format);
    assert(
      result.ids.every(
        (id) =>
          format === "all" || before.find((c) => c.id === id).kind === format,
      ),
    );
    assert.equal(
      result.ids.length,
      format === "all" ? 4 : format === "concept" ? 2 : 1,
    );
    assert.equal(result.revealed, false);
  }
  const session = s.get("session");
  assert.throws(
    () =>
      st.start(
        s,
        {
          day: "2026-09-13",
          replace: true,
          mode: "needs-practice",
          format: "code",
        },
        now,
      ),
    /No available/,
  );
  assert.throws(
    () =>
      st.start(s, { day: "2026-09-13", replace: true, format: "unknown" }, now),
    /format/,
  );
  assert.deepEqual(s.get("session"), session);
  assert.deepEqual(s.cards(), before);
  assert.equal(s.snapshot().history.length, 0);
});
