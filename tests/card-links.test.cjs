const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const { cardLink, parseCardLink } = require("../electron/card-links.cjs");
const { Store } = require("../electron/store.cjs");
const st = require("../electron/self-test.cjs");
test("card links round-trip source IDs and reject executable or ambiguous routes", () => {
  for (const id of [
    "duration",
    "kb/page/concept",
    "利率 gap (a)[b]#?%",
    "percent%2Fslash",
  ]) {
    assert.equal(parseCardLink(cardLink(id)), id);
    assert(!/[()\[\] ]/.test(cardLink(id)));
  }
  for (const url of [
    "https://card/a",
    "recall://app/",
    "recall://widget/a/0",
    "recall://card/",
    "recall://card/a?reveal=true",
    "recall://card/a#run",
    "recall://user@card/a",
    "recall://card:80/a",
    "recall://card/a/b",
    "recall://card/%00",
    "recall://card/%zz",
    "recall://card/..",
    null,
  ])
    assert.throws(() => parseCardLink(url));
});
test("verified CLI links and linked daily logs preserve cards and review state", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-card-links-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const s = new Store(folder);
  t.after(() => s.close());
  const id = "kb/a (test)/concept";
  s.import([
    {
      id,
      conceptId: "unique-source-identity",
      kind: "concept",
      title: "Example",
      prompt: "Why?",
      answer: "Because",
      status: "ready",
      decks: ["Example"],
      topic: "Example",
    },
  ]);
  s.set("session", { id: "paused", ids: [id], index: 0, revealed: true });
  const tables = () =>
    Object.fromEntries(
      ["cards", "reviews", "settings"].map((table) => [
        table,
        s.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
      ]),
    );
  const before = tables();
  const cli = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(__dirname, "../cli/recall.cjs"), "--data", folder, ...args],
      { encoding: "utf8" },
    );
  const result = cli("cards", "link", id);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseCardLink(JSON.parse(result.stdout).url), id);
  assert.equal(JSON.parse(result.stdout).available, true);
  assert.equal(cli("cards", "link", "missing").status, 1);
  const found = JSON.parse(
    cli("cards", "search", "unique-source-identity").stdout,
  );
  assert.deepEqual(
    found.map((c) => c.id),
    [id],
  );
  st.capture(folder, {
    id: "reading/1",
    sessionId: "reading",
    title: "Example",
    objective: "Explain why",
    context: "Discussed in reading",
    at: "2026-09-27T14:00:00Z",
    evidence: "discussed",
    cardIds: [id],
  });
  const logs = fs.readdirSync(path.join(folder, "self-tests/days"));
  assert(
    fs
      .readFileSync(path.join(folder, "self-tests/days", logs[0]), "utf8")
      .includes(cardLink(id)),
  );
  assert.deepEqual(tables(), before);
});
