const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const contract = require("../shared/handwriting-contract.cjs");
const { Store } = require("../electron/store.cjs");
const { PaperStore } = require("../electron/paper-store.cjs");
const demo = require("../examples/demo.json").cards;
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=";
const image = `<img src="data:image/png;base64,${PNG}" onerror="alert('private')">`;

test("question fronts preserve validated embedded illustrations and math but exclude executable content", () => {
  const front = contract.questionFront(
    `<p>Find $x^2$ from the figure.</p>${image}<script>secret()</script>`,
  );
  assert.equal(front.images.length, 1);
  assert.deepEqual(front.images[0], { mime: "image/png", data: PNG });
  assert.match(front.html, /Find \$x\^2\$/);
  assert.match(front.html, /<img src="data:image\/png;base64,/);
  assert(!front.html.includes("onerror"));
  assert(!front.html.includes("secret"));
  assert(!front.html.includes("<script"));
  const encoded = contract.questionFront(
    "&lt;script&gt;never execute&lt;/script&gt;",
  );
  assert(!encoded.html.includes("<script"));
});

test("math inequalities survive HTML stripping and remain escaped on the iPad front", () => {
  const prompt = "<p>Explain $x<y$ when $y>0$, and solve \\(a<b<c\\).</p>";
  const plain = contract.referenceText(prompt);
  assert.equal(plain, "Explain $x<y$ when $y>0$, and solve \\(a<b<c\\).");
  const front = contract.questionFront(prompt).html;
  assert.match(front, /\$x&lt;y\$/);
  assert.match(front, /y&gt;0/);
  assert(!front.includes("<y"));
  assert.equal(
    contract.referenceText("<p>Solve $x &lt; 3$ and $y &gt; 2$.</p>"),
    "Solve $x < 3$ and $y > 2$.",
  );
  assert.equal(
    contract.referenceText("Is 10 < 20 and 30 > 15?"),
    "Is 10 < 20 and 30 > 15?",
  );
});

test("unsupported, oversized and undecodable front illustrations fail explicitly", () => {
  for (const source of [
    '<img src="https://example.test/question.png">',
    '<img src="file:///private/question.png">',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
    "<svg><path /></svg>",
    "```widget\n<script>example()</script>\n```",
    "```mermaid\ngraph LR\nA-->B\n```",
  ])
    assert.throws(() => contract.questionFront(source), contract.ProtocolError);
  assert.throws(() => contract.questionFront(image.repeat(5)), /four images/);
  assert.throws(
    () => contract.questionFront(image, () => null),
    /decoded safely/,
  );
  assert.throws(
    () => contract.questionFront('<img src="data:image/png;base64,AA==">'),
    /format/,
  );
  const tooLarge = `<img src="data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}">`;
  assert.throws(() => contract.questionFront(tooLarge), /four images/);
});

test("Mac-held references include the displayed answer and question illustration, with immutable snapshots", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-front-test-"));
  const store = new Store(root);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  store.import(demo);
  const card = { ...demo[0], prompt: `Use this figure: ${image}` };
  store.saveCard(card);
  store.presentations[card.id] = {
    answer: card.answer,
    presentation: { answer: "The displayed reference answer." },
  };
  const paper = new PaperStore(store);
  const handoff = crypto.randomUUID();
  const front = paper.questions(handoff, [card.id])[0];
  const reference = paper.reference(front.id).value;
  assert.equal(reference.answer, "The displayed reference answer.");
  assert.deepEqual(reference.questionImages, [
    { mime: "image/png", data: PNG },
  ]);
  assert(!JSON.stringify(front).includes("displayed reference"));
  assert.equal(store.db.prepare("PRAGMA synchronous").get().synchronous, 2);
  store.saveCard({ ...card, answer: "A later answer." });
  assert.deepEqual(paper.reference(front.id).value, reference);
  const newer = paper.questions(handoff, [card.id])[0];
  assert.equal(paper.reference(newer.id).value.answer, "A later answer.");
  assert.notEqual(newer.referenceHash, front.referenceHash);
});
