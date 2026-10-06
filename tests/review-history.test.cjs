const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store } = require("../electron/store.cjs");
const { saveConfig } = require("../electron/config.cjs");
const { page } = require("../electron/review-history.cjs");
test("ledger reads all review history, filters by local day and format, and preserves state", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-ledger-"));
  saveConfig(dir, { timeZone: "America/New_York" });
  const s = new Store(dir);
  t.after(() => {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  s.import(structuredClone(require("../examples/demo.json").cards));
  const cs = s.cards();
  const insert = s.db.prepare(
    "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,?,'{}',?,?)",
  );
  for (let i = 0; i < 135; i++)
    insert.run(
      cs[i % cs.length].id,
      "2026-09-30T02:00:00Z",
      i % 2 ? "Good" : "Hard",
      i % 3 === 0 ? 1 : 0,
      JSON.stringify({ due: "2026-10-04T00:00:00Z" }),
      i === 0 ? 1 : 0,
    );
  const before = s.snapshot();
  assert.equal(page(s).total, 135);
  assert.equal(page(s).events.length, 30);
  assert.equal(page(s, { offset: 120 }).events.length, 15);
  assert.equal(page(s, { day: "2026-09-29" }).total, 135);
  assert.equal(page(s, { day: "2026-09-30" }).total, 0);
  const result = page(s, { kind: "math", rating: "Good" });
  assert(result.events.length > 0);
  assert(
    result.events.every(
      (r) =>
        r.rating === "Good" &&
        cs.find((c) => c.id === r.card_id).kind === "math",
    ),
  );
  assert.equal(page(s, { query: "nonsense-absent" }).total, 0);
  assert.equal(page(s).events[0].nextDue, "2026-10-04T00:00:00Z");
  assert.throws(() => page(s, { offset: -1 }), /Invalid/);
  assert.throws(() => page(s, { kind: "bad" }), /Invalid/);
  assert.deepEqual(s.snapshot(), before);
});

test("ledger follows the selected profile timezone when the same review crosses a day boundary", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-ledger-zone-")),
    s = new Store(dir);
  t.after(() => {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  s.import(structuredClone(require("../examples/demo.json").cards));
  s.db
    .prepare(
      "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule) VALUES(?,?,'Good',0,'{}','{}')",
    )
    .run(s.cards()[0].id, "2026-09-30T02:00:00Z");
  const before = s.snapshot();
  for (const [timeZone, day, excluded] of [
    ["UTC", "2026-09-30", "2026-09-29"],
    ["America/New_York", "2026-09-29", "2026-09-30"],
    ["Asia/Tokyo", "2026-09-30", "2026-09-29"],
  ]) {
    saveConfig(dir, { timeZone });
    const result = page(s, { day });
    assert.equal(result.timeZone, timeZone);
    assert.equal(result.total, 1, timeZone);
    assert.equal(page(s, { day: excluded }).total, 0, timeZone);
  }
  assert.deepEqual(s.snapshot(), before);
});
