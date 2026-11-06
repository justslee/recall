const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const { Store } = require("../electron/store.cjs"),
  revisions = require("../electron/card-revisions.cjs"),
  demo = require("../examples/demo.json");
function setup(t) {
  const folder = fs.mkdtempSync(
      path.join(os.tmpdir(), "recall-widget-revision-"),
    ),
    store = new Store(folder);
  const card = {
    ...demo.cards[0],
    answer:
      "Definition stays.\n```widget Before\n<p>Before</p>\n```\nExample stays.",
    widgetsAllowed: false,
  };
  store.import([card]);
  t.after(() => {
    store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const edit = () => ({
    id: card.id,
    expectedContentHash: revisions.hash(
      JSON.parse(store.card(card.id).content),
    ),
    widgetIndex: 0,
    widget: {
      title: "After",
      html: "<p>After</p><script>const value = 1;</script>",
    },
  });
  return { folder, store, card, edit };
}
test("widget-only queued revisions preserve all learning records and answer prose, with durable idempotence", (t) => {
  const { folder, store, card, edit } = setup(t);
  store.set("session", {
    id: "preserved-review",
    ids: [card.id],
    index: 0,
    revealed: true,
    selection: {},
  });
  store.rate({ id: card.id, rating: "Good", sessionId: "preserved-review" });
  store.set("draft:example", "Keep my attempt");
  store.set("session", { ids: [card.id], index: 0, revealed: true });
  const before = store.card(card.id),
    reviews = store.db.prepare("SELECT * FROM reviews").all(),
    settings = store.db.prepare("SELECT * FROM settings ORDER BY key").all();
  const raw = { schemaVersion: 1, cards: [edit()] },
    file = path.join(folder, "revision.json");
  fs.writeFileSync(file, JSON.stringify(raw));
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
  assert.equal(cli("revise", file).mode, "preview");
  const queued = cli("revise", file, "--apply");
  assert.equal(queued.mode, "queued");
  assert.deepEqual(store.card(card.id), before);
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  const after = store.card(card.id),
    content = JSON.parse(after.content),
    old = JSON.parse(before.content);
  assert.equal(
    content.answer,
    "Definition stays.\n```widget After\n<p>After</p><script>const value = 1;</script>\n```\nExample stays.",
  );
  assert.equal(content.widgetsAllowed, false);
  const preserved = { ...content, answer: old.answer };
  if (old.revision === undefined) delete preserved.revision;
  else preserved.revision = old.revision;
  assert.deepEqual(preserved, old);
  assert.equal(after.schedule, before.schedule);
  assert.equal(after.suspended, before.suspended);
  assert.deepEqual(store.db.prepare("SELECT * FROM reviews").all(), reviews);
  assert.deepEqual(
    store.db
      .prepare(
        "SELECT * FROM settings WHERE key NOT GLOB 'widget-revision:*' AND key NOT GLOB 'widget-revision-previous:*' ORDER BY key",
      )
      .all(),
    settings,
  );
  const receipt = cli("revision-status", queued.requestId);
  assert.equal(receipt.mode, "revised");
  assert.equal(receipt.receipt.backup, undefined);
  assert.equal(fs.existsSync(path.join(folder, "backups")), false);
  assert.deepEqual(cli("inspect", card.id, "--previous"), { card: old });
  assert.equal(cli("revise", file, "--apply").mode, "revised");
  assert.deepEqual(revisions.applyPending(store), { applied: 0 });
  // Simulate a crash after commit, before its queue receipt was saved.
  fs.writeFileSync(
    path.join(folder, "card-revisions", queued.requestId + ".json"),
    JSON.stringify({
      version: 1,
      id: queued.requestId,
      status: "queued",
      request: raw,
    }),
  );
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  assert.deepEqual(store.card(card.id), after);
});
test("stale, malformed and conflicting batches never partially revise a card", (t) => {
  const { folder, store, card, edit } = setup(t),
    before = store.card(card.id);
  const good = edit(),
    missing = { ...edit(), id: "missing" };
  const pending = revisions.enqueue(folder, {
    schemaVersion: 1,
    cards: [good, missing],
  });
  assert.deepEqual(revisions.applyPending(store), { applied: 0 });
  assert.equal(revisions.status(folder, pending.requestId).mode, "blocked");
  assert.deepEqual(store.card(card.id), before);
  assert.throws(
    () =>
      revisions.preview(store, {
        schemaVersion: 1,
        cards: [{ ...good, expectedContentHash: "0".repeat(64) }],
      }),
    /changed/,
  );
  assert.throws(
    () =>
      revisions.request({
        schemaVersion: 1,
        cards: [{ ...good, widgetsAllowed: true }],
      }),
    /Invalid/,
  );
  assert.throws(
    () =>
      revisions.request({
        schemaVersion: 1,
        cards: [
          {
            ...good,
            widget: { ...good.widget, title: "x\n```widget injected" },
          },
        ],
      }),
    /Invalid/,
  );
  assert.throws(
    () =>
      revisions.preview(store, {
        schemaVersion: 1,
        cards: [
          {
            ...good,
            widget: { title: "Broken", html: "<script>const = ;</script>" },
          },
        ],
      }),
    /Unexpected/,
  );
});
test("a failed filesystem receipt after commit remains recoverable without revising twice", (t) => {
  const { folder, store, card, edit } = setup(t);
  const queued = revisions.enqueue(folder, {
    schemaVersion: 1,
    cards: [edit()],
  });
  const files = require("../electron/private-files.cjs"),
    original = files.atomicText;
  try {
    files.atomicText = (file, text) => {
      if (file.includes(path.sep + "card-revisions" + path.sep))
        throw Error("Synthetic receipt disk failure");
      return original(file, text);
    };
    assert.deepEqual(revisions.applyPending(store), { applied: 0 });
  } finally {
    files.atomicText = original;
  }
  const after = store.card(card.id);
  assert.equal(JSON.parse(after.content).revision, 1);
  assert.equal(revisions.status(folder, queued.requestId).mode, "queued");
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  assert.equal(revisions.status(folder, queued.requestId).mode, "revised");
  assert.deepEqual(store.card(card.id), after);
});
test("widget revisions preserve legacy metadata instead of silently repairing unrelated card fields", (t) => {
  const { folder, store, card, edit } = setup(t);
  const legacy = JSON.parse(store.card(card.id).content);
  legacy.prompt = "";
  store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(legacy), card.id);
  const change = edit();
  assert.equal(
    revisions.preview(store, { schemaVersion: 1, cards: [change] }).cards
      .length,
    1,
  );
  revisions.enqueue(folder, { schemaVersion: 1, cards: [change] });
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  const actual = JSON.parse(store.card(card.id).content);
  delete actual.revision;
  actual.answer = legacy.answer;
  assert.deepEqual(actual, legacy);
});
test("revisions reject tampering and symlinks; restored pending requests require resubmission", (t) => {
  const { folder, store, edit } = setup(t),
    raw = { schemaVersion: 1, cards: [edit()] };
  const pending = revisions.enqueue(folder, raw),
    file = path.join(folder, "card-revisions", pending.requestId + ".json");
  const item = JSON.parse(fs.readFileSync(file));
  item.request.cards[0].widget.html = "Tampered";
  fs.writeFileSync(file, JSON.stringify(item));
  revisions.applyPending(store);
  assert.equal(revisions.status(folder, pending.requestId).mode, "blocked");
  const canary = path.join(folder, "outside.json");
  fs.writeFileSync(canary, "preserve");
  fs.symlinkSync(
    canary,
    path.join(folder, "card-revisions", "a".repeat(64) + ".json"),
  );
  revisions.applyPending(store);
  assert.equal(fs.readFileSync(canary, "utf8"), "preserve");
  fs.unlinkSync(path.join(folder, "card-revisions", "a".repeat(64) + ".json"));
  const queued = revisions.enqueue(folder, {
    schemaVersion: 1,
    cards: [
      { ...edit(), widget: { title: "Restore", html: "<p>Retained</p>" } },
    ],
  });
  const backup = require("../electron/backup.cjs").backup(store).backup;
  const restored = path.join(folder, "restored");
  fs.mkdirSync(restored);
  require("../electron/backup.cjs").restore(restored, backup);
  const other = new Store(restored);
  try {
    assert.equal(
      revisions.status(restored, queued.requestId).mode,
      "needs_resubmission",
    );
    assert.deepEqual(revisions.applyPending(other), { applied: 0 });
    const explicit = revisions.enqueue(restored, {
      schemaVersion: 1,
      cards: [
        { ...edit(), widget: { title: "Restore", html: "<p>Retained</p>" } },
      ],
    });
    assert.equal(explicit.mode, "queued");
    assert.deepEqual(revisions.applyPending(other), { applied: 1 });
    assert.equal(revisions.status(restored, queued.requestId).mode, "revised");
  } finally {
    other.close();
  }
});
