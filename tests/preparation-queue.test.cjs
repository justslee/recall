const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store } = require("../electron/store.cjs"),
  { saveConfig } = require("../electron/config.cjs");
const inbox = require("../electron/inbox.cjs"),
  { createQueue } = require("../electron/preparation-queue.cjs");
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-batch-"));
  saveConfig(folder, { captureEnabled: true });
  const store = new Store(folder);
  store.import(require("../examples/demo.json").cards);
  t.after(() => {
    store.close();
    fs.rmSync(folder, { force: true, recursive: true });
  });
  const add = (id) =>
    inbox.add(
      folder,
      {
        id,
        sessionId: "test",
        title: id,
        objective: "Explain " + id,
        context: "Discussed the mechanism",
        evidence: "discussed",
        at: "2026-10-31T12:00:00Z",
        cardIds: [],
      },
      store.cards(),
    );
  return { folder, store, add };
}
async function finished(queue) {
  for (let i = 0; i < 100 && queue.status().running; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(queue.status().running, false);
}
test("a bounded batch returns immediately, serializes work, reuses cards and preserves schedules/reviews", async (t) => {
  const { folder, store, add } = fixture(t);
  for (let i = 0; i < 10; i++) add("objective-" + i);
  let concurrency = 0,
    max = 0,
    calls = 0;
  const before = store.snapshot();
  const queue = createQueue(store, {
    prepare: async (_folder, cards, { itemId }) => {
      max = Math.max(max, ++concurrency);
      calls++;
      await new Promise((r) => setTimeout(r, 3));
      inbox.submit(folder, itemId, { captures: [{ cardIds: [cards[0].id] }] });
      concurrency--;
      return { prepared: 1, status: "submitted" };
    },
  });
  const preview = queue.preview();
  assert.equal(preview.items.length, 8);
  const start = queue.start(preview.digest);
  assert.equal(start.running, true);
  assert.equal(calls, 0);
  assert.throws(() => queue.start(preview.digest), /already/);
  await finished(queue);
  assert.equal(max, 1);
  assert.equal(calls, 8);
  assert.equal(
    queue.status().items.filter((i) => i.status === "ready").length,
    8,
  );
  assert.equal(
    inbox.read(folder).items.filter((i) => i.status === "pending").length,
    2,
  );
  assert.deepEqual(store.snapshot().cards, before.cards);
  assert.deepEqual(store.snapshot().history, before.history);
});
test("source changes invalidate preview; capture pause stops at the item boundary; restart does not silently retry", async (t) => {
  const { folder, store, add } = fixture(t);
  add("one");
  const queue = createQueue(store, {
    prepare: async (_folder, cards, { itemId }) => {
      saveConfig(folder, { captureEnabled: false });
      return { status: "pending" };
    },
  });
  const preview = queue.preview();
  add("two");
  assert.throws(() => queue.start(preview.digest), /changed/);
  queue.start(queue.preview().digest);
  await finished(queue);
  assert.equal(queue.status().status, "paused");
  assert.equal(queue.status().items.filter((i) => i.startedAt).length, 1);
  const stateFile = path.join(inbox.root(folder), "preparation-batch.json");
  fs.writeFileSync(stateFile, JSON.stringify({ status: "running", items: [] }));
  assert.equal(createQueue(store).status().status, "interrupted");
  assert.equal(inbox.read(folder).items.length, 2);
});
test("a failed capture is retained and does not prevent the next item from finishing", async (t) => {
  const { folder, store, add } = fixture(t);
  add("first");
  add("second");
  let calls = 0;
  const queue = createQueue(store, {
    prepare: async (_folder, cards, { itemId }) => {
      if (++calls === 1) throw Error("Provider unavailable");

      inbox.submit(folder, itemId, { captures: [{ cardIds: [cards[0].id] }] });
      return { status: "submitted" };
    },
  });
  queue.start(queue.preview().digest);
  await finished(queue);
  const items = inbox.read(folder).items;
  assert.equal(items.filter((i) => i.status === "blocked").length, 1);
  assert.equal(items.filter((i) => i.status === "ready").length, 1);
  assert.ok(items.every((i) => i.input.capture.objective));
});
test("an unreadable batch record is preserved instead of overwritten", (t) => {
  const { folder, store, add } = fixture(t);
  add("one");
  const file = path.join(inbox.root(folder), "preparation-batch.json");
  fs.writeFileSync(file, "{interrupted write");
  const queue = createQueue(store);
  assert.equal(queue.status().status, "unreadable");
  assert.throws(() => queue.start(queue.preview().digest), /unreadable/);
  assert.equal(fs.readFileSync(file, "utf8"), "{interrupted write");
  assert.equal(inbox.read(folder).items[0].status, "pending");
});
