const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const { Store } = require("../electron/store.cjs"),
  imports = require("../electron/card-imports.cjs"),
  selfTest = require("../electron/self-test.cjs");
const demo = require("../examples/demo.json");
function setup(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-live-import-"));
  const store = new Store(folder);
  store.import(demo.cards);
  t.after(() => {
    store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { folder, store };
}
function pack(id = "fresh") {
  const card = structuredClone(demo.cards[0]);
  card.id = id;
  card.conceptId = id;
  card.decks = ["Extra collection"];
  return { schemaVersion: 1, id, title: "Extra collection", cards: [card] };
}
test("open-writer imports are queued, visible to that writer and idempotent without learning capture", (t) => {
  const { folder, store } = setup(t);
  store.set("session", { ids: [demo.cards[0].id], index: 0, revealed: true });
  store.set("draft:kept", "An unfinished answer");
  const before = store.db.prepare("SELECT * FROM cards ORDER BY id").all();
  const settings = store.db
    .prepare("SELECT * FROM settings WHERE key!='decks' ORDER BY key")
    .all();
  const file = path.join(folder, "pack.json");
  fs.writeFileSync(file, JSON.stringify(pack()));
  const cli = (...args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, "../cli/recall.cjs"),
          "--data",
          folder,
          "cards",
          ...args,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ),
    );
  assert.equal(cli("import", file).inserted.length, 1);
  const queued = cli("import", file, "--apply");
  assert.equal(queued.mode, "queued");
  assert.equal(store.cards().length, demo.cards.length);
  assert.equal(cli("import", file, "--apply").requestId, queued.requestId);
  assert.deepEqual(imports.applyPending(store), { applied: 1, inserted: 1 });
  assert.equal(cli("import-status", queued.requestId).mode, "imported");
  assert.equal(store.cards().length, demo.cards.length + 1);
  assert(store.get("decks").includes("Extra collection"));
  for (const old of before) assert.deepEqual(store.card(old.id), old);
  assert.deepEqual(
    store.db
      .prepare("SELECT * FROM settings WHERE key!='decks' ORDER BY key")
      .all(),
    settings,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM reviews").get().n,
    0,
  );
  assert.equal(selfTest.read(folder).entries.length, 0);
  assert.equal(JSON.parse(store.card("fresh").content).widgetsAllowed, false);
  assert.deepEqual(imports.applyPending(store), { applied: 0, inserted: 0 });
});
test("conflicting identities and tampered queue content fail without partial import", (t) => {
  const { folder, store } = setup(t);
  const conflict = pack("conflict");
  conflict.cards.push({ ...demo.cards[0], title: "Changed existing answer" });
  const request = imports.enqueue(folder, conflict);
  assert.deepEqual(imports.applyPending(store), { applied: 0, inserted: 0 });
  assert.equal(imports.status(folder, request.requestId).mode, "blocked");
  assert.equal(store.cards().length, demo.cards.length);
  const queued = imports.enqueue(folder, pack("tamper"));
  const file = path.join(folder, "card-imports", queued.requestId + ".json");
  const item = JSON.parse(fs.readFileSync(file));
  item.pack.cards[0].answer = "Tampered";
  fs.writeFileSync(file, JSON.stringify(item));
  imports.applyPending(store);
  assert.equal(imports.status(folder, queued.requestId).mode, "blocked");
  assert.equal(store.cards().length, demo.cards.length);
  assert.throws(() => imports.status(folder, "../outside"), /Invalid/);
});
test("queue imports cannot carry native execution trust and do not follow symlink requests", (t) => {
  const { folder, store } = setup(t);
  const code = structuredClone(demo.cards.find((c) => c.kind === "code"));
  code.id = "fresh-code";
  code.conceptId = "fresh-code";
  imports.enqueue(folder, {
    schemaVersion: 1,
    id: "code",
    title: "Code",
    cards: [code],
    codeReport: { trusted: true },
  });
  imports.applyPending(store);
  assert.equal(store.get("validated-code:fresh-code"), null);
  const outside = path.join(folder, "canary.json");
  fs.writeFileSync(outside, "preserve");
  fs.symlinkSync(
    outside,
    path.join(folder, "card-imports", "a".repeat(64) + ".json"),
  );
  imports.applyPending(store);
  assert.equal(fs.readFileSync(outside, "utf8"), "preserve");
});
test("a symlink import directory is rejected without touching its target", (t) => {
  const { folder, store } = setup(t);
  const outside = path.join(folder, "outside");
  fs.mkdirSync(outside);
  const canary = path.join(outside, "canary.json");
  fs.writeFileSync(canary, "preserve");
  fs.symlinkSync(outside, path.join(folder, "card-imports"));
  assert.throws(() => imports.enqueue(folder, pack()), /Unsafe/);
  assert.throws(() => imports.applyPending(store), /Unsafe/);
  assert.throws(() => imports.status(folder, "a".repeat(64)), /Unsafe/);
  assert.equal(fs.readFileSync(canary, "utf8"), "preserve");
  assert.deepEqual(fs.readdirSync(outside), ["canary.json"]);
});
