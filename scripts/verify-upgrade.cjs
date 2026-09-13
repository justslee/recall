// Private fixtures are supplied explicitly; never copy them into this repository.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { DatabaseSync } = require("node:sqlite");
const [profile, baselineFile] = process.argv.slice(2);
assert(
  profile && baselineFile,
  "Usage: verify-upgrade.cjs PROFILE BASELINE.sqlite",
);
const baseline = new DatabaseSync(baselineFile, { readOnly: true }),
  { Store } = require("../electron/store.cjs");
const tables = baseline
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all()
  .map((r) => r.name);
const store = new Store(profile);
try {
  for (const t of tables) {
    const old = baseline.prepare("SELECT * FROM " + t + " ORDER BY 1").all(),
      next = store.db.prepare("SELECT * FROM " + t + " ORDER BY 1").all();
    if (t === "settings") {
      for (const row of old)
        assert.deepEqual(
          next.find((n) => n.key === row.key),
          row,
          "Existing setting changed: " + row.key,
        );
    } else assert.deepEqual(next, old, "Table changed: " + t);
  }
  const legacy = path.join(path.dirname(baselineFile), "render-baseline.json");
  if (fs.existsSync(legacy)) {
    const before = JSON.parse(fs.readFileSync(legacy));
    assert.deepEqual(store.cards(), before.cards, "Rendered card data changed");
  }
  assert.equal(
    store.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  console.log(
    JSON.stringify(
      {
        preserved: true,
        cards: store.cards().length,
        tables,
        visualCompatibility: fs.existsSync(legacy),
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
  baseline.close();
}
