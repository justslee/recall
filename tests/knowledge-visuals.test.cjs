const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store } = require("../electron/store.cjs");
const model = import("../src/knowledge-visual-model.js");
const demo = require("../examples/demo.json");
test("Knowledge references resolve only an existing indexed card widget, including compatibility presentations", async () => {
  const { parseKnowledgeVisual: parse, resolveKnowledgeVisual: resolve } =
    await model;
  const ref = parse('{"cardId":"demo:visual","widgetIndex":1}');
  assert.deepEqual(ref, { cardId: "demo:visual", widgetIndex: 1 });
  for (const bad of [
    "null",
    "[]",
    '{"cardId":"x","widgetIndex":-1}',
    '{"cardId":"x","widgetIndex":0,"html":"<script>"}',
    '{"cardId":"x","widgetIndex":0.5}',
    '{"cardId":"x","widgetIndex":64}',
    "{",
  ])
    assert.equal(parse(bad), null);
  const card = {
    id: "demo:visual",
    answer:
      "```widget First\n<p>One</p>\n```\n```widget Second\n<p>Two</p>\n```",
    widgetsAllowed: false,
  };
  assert.equal(resolve(ref, [card]).title, "Second");
  assert.equal(resolve(ref, []), null);
  assert.equal(resolve({ ...ref, widgetIndex: 2 }, [card]), null);
  assert.equal(
    resolve({ ...ref, widgetIndex: 0 }, [
      {
        ...card,
        presentation: { answer: "```widget Compatibility\n<p>View</p>\n```" },
      },
    ]).title,
    "Compatibility",
  );
  assert.equal(card.widgetsAllowed, false);
});
test("Explicit widget permission changes preserve card content, schedules, reviews, sessions and revisions; stale views reject", (t) => {
  const folder = fs.mkdtempSync(
      path.join(os.tmpdir(), "recall-knowledge-visual-"),
    ),
    store = new Store(folder);
  t.after(() => {
    store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  store.import([{ ...demo.cards[0], widgetsAllowed: false }]);
  const card = JSON.parse(store.card(demo.cards[0].id).content);
  store.set("session", { id: "unfinished", ids: [card.id], index: 0 });
  store.set("draft:" + card.id, { answer: "unfinished writing" });
  const before = store.card(card.id),
    settings = store.db.prepare("select * from settings order by key").all(),
    reviews = store.db.prepare("select * from reviews").all();
  const request = {
    id: card.id,
    expectedRevision: card.revision || 0,
    expectedAnswer: card.answer,
    allowed: true,
  };
  assert.throws(
    () => store.setWidgetPermission({ ...request, expectedAnswer: "changed" }),
    /changed/,
  );
  assert.throws(
    () => store.setWidgetPermission({ ...request, expectedRevision: 99 }),
    /changed/,
  );
  assert.throws(
    () => store.setWidgetPermission({ ...request, allowed: "yes" }),
    /Invalid/,
  );
  store.setWidgetPermission(request);
  let updated = store.card(card.id);
  assert.deepEqual(JSON.parse(updated.content), {
    ...card,
    widgetsAllowed: true,
  });
  assert.deepEqual({ ...updated, content: before.content }, { ...before });
  assert.deepEqual(
    store.db.prepare("select * from settings order by key").all(),
    settings,
  );
  assert.deepEqual(store.db.prepare("select * from reviews").all(), reviews);
  store.setWidgetPermission({ ...request, allowed: false });
  assert.deepEqual(JSON.parse(store.card(card.id).content), card);
  store.presentations = {
    [card.id]: {
      answer: card.answer,
      presentation: { answer: "approved compatibility visual" },
    },
  };
  assert.throws(() => store.setWidgetPermission(request), /changed/);
  store.setWidgetPermission({
    ...request,
    expectedAnswer: "approved compatibility visual",
  });
});
