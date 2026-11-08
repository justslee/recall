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

const figures = require("../electron/static-figures.cjs");
const oldSvg =
  '<svg viewBox="0 0 100 40"><text x="5" y="20">Before</text></svg>';
const newSvg =
  '<svg viewBox="0 0 100 40"><style>svg{--iv-blue:#D8E6FC}@media(prefers-color-scheme:dark){svg{--iv-blue:#2B4565}}rect{fill:var(--iv-blue);stroke:#30343B}</style><text x="5" y="20" fill="var(--iv-blue)" class="label">Before</text></svg>';
function staticSetup(
  t,
  answer = "Definition stays.\n" + oldSvg + "\nExample stays.",
  kind = "concept",
) {
  const ctx = setup(t),
    card = JSON.parse(ctx.store.card(ctx.card.id).content);
  card.answer = answer;
  card.kind = kind;
  if (kind === "math")
    card.numeric = { value: 6.5, tolerance: 0.01, unit: "billion yen" };
  ctx.store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(card), card.id);
  const edit = (figureIndex = 0, source = newSvg, figureKind = "svg") => ({
    id: card.id,
    expectedContentHash: revisions.hash(
      JSON.parse(ctx.store.card(card.id).content),
    ),
    figureIndex,
    figure: { kind: figureKind, source },
  });
  return { ...ctx, card, edit };
}
test("version 2 static math figures preserve numeric grading, all metadata, schedules and previous version", (t) => {
  const { folder, store, card, edit } = staticSetup(t, undefined, "math");
  store.set("draft:static", { typed: "learner work", score: null });
  store.set("session", { ids: [card.id], index: 0, revealed: false });
  const before = store.card(card.id),
    raw = { schemaVersion: 2, cards: [edit()] };
  assert.equal(revisions.preview(store, raw).scope, "static-figure-only");
  const queued = revisions.enqueue(folder, raw);
  assert.deepEqual(store.card(card.id), before);
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  const after = store.card(card.id),
    actual = JSON.parse(after.content),
    previous = JSON.parse(before.content);
  assert.equal(
    actual.answer,
    "Definition stays.\n" + newSvg + "\nExample stays.",
  );
  assert.equal(actual.revision, 1);
  actual.answer = previous.answer;
  delete actual.revision;
  assert.deepEqual(actual, previous);
  assert.equal(after.schedule, before.schedule);
  assert.equal(after.suspended, before.suspended);
  assert.deepEqual(store.get("draft:static"), {
    typed: "learner work",
    score: null,
  });
  assert.deepEqual(store.get("session"), {
    ids: [card.id],
    index: 0,
    revealed: false,
  });
  assert.deepEqual(store.get("widget-revision-previous:" + card.id), previous);
  assert.equal(
    revisions.status(folder, queued.requestId).receipt.scope,
    "static-figure-only",
  );
  assert.equal(revisions.enqueue(folder, raw).mode, "revised");
  assert.deepEqual(revisions.applyPending(store), { applied: 0 });
});
test("static extraction owns outer code blocks and never selects embedded widget or code figures", () => {
  const answer = [
    "Prose `" + oldSvg + "` remains.",
    "````text\n```mermaid\ngraph LR\n X-->Y\n```\n" + oldSvg + "\n````",
    "```widget Original\n" + oldSvg + "<script>const x=1;</script>\n```",
    "~~~python\n" + oldSvg + "\n~~~",
    '<pre class="code"><code>' +
      oldSvg +
      "\n```mermaid\nA-->B\n```</code></pre>",
    '<span title="' + oldSvg.replace(/"/g, "'") + '">Attribute example</span>',
    "<!-- " + oldSvg + " -->",
    '<script>const example="' + oldSvg.replace(/"/g, "'") + '";</script>',
    oldSvg,
    "```mermaid\nflowchart LR\n A-->B\n```",
    '<pre class="mermaid">flowchart TD\n C--&gt;D</pre>',
  ].join("\n");
  const found = figures.figuresOf(answer);
  assert.deepEqual(
    found.map((x) => x.kind),
    ["svg", "mermaid", "mermaid"],
  );
  assert.equal(answer.slice(found[0].start, found[0].end), oldSvg);
  const revised = figures.replaceFigure(
    answer,
    found[1],
    "flowchart LR\n A-->C",
  );
  assert.equal(
    revised,
    answer.slice(0, found[1].sourceStart) +
      "flowchart LR\n A-->C" +
      answer.slice(found[1].sourceEnd),
  );
  assert.equal(figures.figuresOf(revised).length, 3);
  const pre = figures.replaceFigure(answer, found[2], "flowchart TD\n C-->E");
  assert.ok(pre.includes('<pre class="mermaid">flowchart TD\n C--&gt;E</pre>'));
});
test("static Mermaid fences preserve original CRLF delimiters and handle empty bodies", () => {
  for (const answer of [
    "before\r\n```mermaid\r\nA-->B\r\n```\r\nafter",
    "```mermaid\n```",
    "```mermaid\n\n```\n",
  ]) {
    const [figure] = figures.figuresOf(answer);
    assert.ok(figure);
    const next = figures.replaceFigure(
      answer,
      figure,
      "flowchart LR\n A-->C\n",
    );
    assert.equal(figures.figuresOf(next).length, 1);
    assert.ok(next.includes("A-->C" + figure.eol + "```"));
  }
  assert.deepEqual(figures.figuresOf("```text\n" + oldSvg), []);
});
test("static revision rejects kind changes, missing figures, duplicate cards and cross-version fields", (t) => {
  const { store, edit } = staticSetup(t),
    good = edit();
  for (const invalid of [
    { ...good, widgetIndex: 0 },
    { ...good, numeric: { value: 0 } },
    { ...good, figureIndex: -1 },
    { ...good, figure: { ...good.figure, title: "not a field" } },
  ])
    assert.throws(
      () => revisions.request({ schemaVersion: 2, cards: [invalid] }),
      /Invalid/,
    );
  assert.throws(
    () => revisions.request({ schemaVersion: 2, cards: [good, good] }),
    /duplicate/,
  );
  assert.throws(
    () => revisions.request({ schemaVersion: 1, cards: [good] }),
    /Invalid/,
  );
  assert.throws(
    () => revisions.preview(store, { schemaVersion: 2, cards: [edit(1)] }),
    /not found/,
  );
  assert.throws(
    () =>
      revisions.preview(store, {
        schemaVersion: 2,
        cards: [edit(0, "flowchart LR\nA-->B", "mermaid")],
      }),
    /kind cannot change/,
  );
});
test("static SVG accepts presentation themes and local marker references, rejects execution and network routes", () => {
  const safe =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#30343B"/></marker></defs><path d="M1 20H90" marker-end="url(#arr)" style="fill:none;stroke:var(--ink);stroke-width:1.5px"/></svg>';
  assert.equal(figures.validateFigureSource("svg", safe), safe);
  figures.validateFigureSource("svg", newSvg);
  for (const malicious of [
    "<svg><script>alert(1)</script></svg>",
    '<svg onload="alert(1)"></svg>',
    "<svg><foreignObject><div>host</div></foreignObject></svg>",
    '<svg><image href="https://example.test/tracker"/></svg>',
    '<svg><use href="#remote"/></svg>',
    '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
    '<svg><path fill="url(https://example.test/a)"/></svg>',
    '<svg><path fill="url(&#x2f;&#x2f;example.test/a)"/></svg>',
    '<svg><path style="fill:u\\72l(https://example.test/a)"/></svg>',
    '<svg><style>@import "https://example.test/a";</style></svg>',
    "<svg><style>@font-face{font-family:x;src:url(https://example.test/a)}</style></svg>",
    "<svg><style>svg{--x:url(https://example.test/a)}</style></svg>",
    "<svg><style>svg{background-image:url(https://example.test/a)}</style></svg>",
    "<svg><style>svg{fill:red!important}</style></svg>",
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private">]><svg/>',
    '<svg xmlns="https://example.test/namespace"></svg>',
    "<svg/><svg/>",
    "<svg><rect></svg>",
    "<svg><svg/></svg>",
    '<svg><rect fill="red" fill="blue"/></svg>',
    "<svg><style>svg{fill:red</style></svg>",
  ])
    assert.throws(
      () => figures.validateFigureSource("svg", malicious),
      undefined,
      malicious,
    );
});
test("static Mermaid rejects configuration, HTML and interactive/network directives without weakening renderer security", () => {
  figures.validateFigureSource(
    "mermaid",
    "flowchart LR\n A[Source]-->B[Result]\nclassDef blue fill:#D8E6FC,stroke:#30343B,color:#30343B;\nclass A blue;",
  );
  for (const malicious of [
    "%%{init: {securityLevel: 'loose'}}%%\ngraph LR\nA-->B",
    'graph LR\nclick A "https://example.test"',
    "graph LR\nA-->B;click B callback",
    'graph LR\nA[<img src="https://example.test">]',
    "graph LR\nA[&lt;script&gt;bad&lt;/script&gt;]",
    'graph LR\nA@{ img: "https://example.test" }',
    "---\nconfig:\n securityLevel: loose\n---\ngraph LR\nA-->B",
    "graph LR\nclassDef x fill:url(https://example.test);",
    "```mermaid\ngraph LR\nA-->B\n```",
  ])
    assert.throws(
      () => figures.validateFigureSource("mermaid", malicious),
      /Mermaid/,
    );
});
test("static stale or conflicting batches remain atomic and widget overlap requires a fresh hash", (t) => {
  const answer =
    "Definition.\n" +
    oldSvg +
    "\n```widget Original\n<p>Keep this executable fence</p>\n```\nAfter.";
  const { folder, store, card, edit } = staticSetup(t, answer),
    before = store.card(card.id);
  const change = edit(),
    raw = { schemaVersion: 2, cards: [change, { ...change, id: "missing" }] };
  const queued = revisions.enqueue(folder, raw);
  assert.deepEqual(revisions.applyPending(store), { applied: 0 });
  assert.equal(revisions.status(folder, queued.requestId).mode, "blocked");
  assert.deepEqual(store.card(card.id), before);
  revisions.enqueue(folder, {
    schemaVersion: 1,
    cards: [
      {
        id: card.id,
        expectedContentHash: change.expectedContentHash,
        widgetIndex: 0,
        widget: { title: "Revised widget", html: "<p>Updated widget only</p>" },
      },
    ],
  });
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  assert.throws(
    () => revisions.preview(store, { schemaVersion: 2, cards: [change] }),
    /changed/,
  );
  const refreshed = edit();
  revisions.enqueue(folder, { schemaVersion: 2, cards: [refreshed] });
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  const content = JSON.parse(store.card(card.id).content);
  assert.equal(content.revision, 2);
  assert.ok(content.answer.includes(newSvg));
  assert.ok(
    content.answer.includes(
      "```widget Revised widget\n<p>Updated widget only</p>\n```",
    ),
  );
});
test("version 2 commit survives receipt failure and cannot replay twice", (t) => {
  const { folder, store, card, edit } = staticSetup(t),
    raw = { schemaVersion: 2, cards: [edit()] };
  const queued = revisions.enqueue(folder, raw),
    files = require("../electron/private-files.cjs"),
    original = files.atomicText;
  try {
    files.atomicText = (file, text) => {
      if (file.includes(path.sep + "card-revisions" + path.sep))
        throw Error("Synthetic v2 receipt failure");
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
  assert.equal(
    revisions.status(folder, queued.requestId).receipt.scope,
    "static-figure-only",
  );
  assert.deepEqual(store.card(card.id), after);
});

test("presentation proof accepts styling but rejects changed SVG content, geometry, references and Mermaid topology", () => {
  figures.assertPresentationOnly("svg", oldSvg, newSvg);
  const diagram = "flowchart LR\n A[Source]-->B[Result]";
  const styled =
    diagram +
    "\nclassDef blue fill:#D8E6FC,stroke:#30343B,stroke-width:1.5px,color:#30343B;\nclass A,B blue;";
  figures.assertPresentationOnly("mermaid", diagram, styled);
  for (const changed of [
    newSvg.replace("Before", "Different"),
    newSvg.replace('x="5"', 'x="6"'),
    newSvg.replace("0 0 100 40", "0 0 101 40"),
    newSvg.replace("</svg>", '<circle cx="1" cy="1" r="1"/></svg>'),
    newSvg.replace('class="label"', 'class="label" opacity="0"'),
  ])
    assert.throws(
      () => figures.assertPresentationOnly("svg", oldSvg, changed),
      /presentation changes only/,
    );
  const arrow =
    '<svg><defs><marker id="arr"><path d="M0 0L1 1"/></marker></defs><path d="M0 0L5 5" marker-end="url(#arr)"/></svg>';
  assert.throws(
    () =>
      figures.assertPresentationOnly(
        "svg",
        arrow,
        arrow.replace('marker-end="url(#arr)"', 'marker-start="url(#arr)"'),
      ),
    /presentation changes only/,
  );
  const rule =
    '<svg><style>.edge{marker-end:url(#arr)}</style><path class="edge" d="M0 0L5 5"/></svg>';
  assert.throws(
    () =>
      figures.assertPresentationOnly(
        "svg",
        rule,
        rule.replace('class="edge"', 'class="plain"'),
      ),
    /presentation changes only/,
  );
  for (const changed of [
    styled.replace("B[Result]", "C[Result]"),
    styled.replace("-->B", "---B"),
    styled + "\nC-->D",
    diagram + "\nclass A blue; C-->D",
    diagram + "\nclassDef blue opacity:0;",
    styled + "\nclass Unknown blue;",
  ]) {
    assert.throws(() =>
      figures.assertPresentationOnly("mermaid", diagram, changed),
    );
  }
  assert.throws(
    () =>
      figures.assertPresentationOnly(
        "svg",
        "<svg><script>oldCode()</script></svg>",
        "<svg/>",
      ),
    /Unsupported/,
  );
  for (const variable of [
    '<svg><style>svg{--o:1}path{opacity:var(--o)}</style><path d="M0 0L1 1"/></svg>',
    '<svg style="--o:1"><path d="M0 0L1 1" style="opacity:var(--o)"/></svg>',
    '<svg style="--o:1"><path d="M0 0L1 1" opacity="var(--o)"/></svg>',
    '<svg><path d="M0 0L1 1" transform="translate(env(x),0)"/></svg>',
  ])
    assert.throws(
      () =>
        figures.assertPresentationOnly(
          "svg",
          variable,
          variable.replace("--o:1", "--o:0"),
        ),
      /Structural SVG values/,
    );
});

test("version 2 rejects semantic figure changes during preview and apply without resetting expertise", (t) => {
  const { folder, store, card, edit } = staticSetup(t);
  const raw = {
    schemaVersion: 2,
    cards: [edit(0, newSvg.replace("Before", "Different answer"))],
  };
  const before = store.card(card.id),
    epochs = store.db.prepare("SELECT * FROM expertise_epochs").all();
  assert.throws(
    () => revisions.preview(store, raw),
    /presentation changes only/,
  );
  const queued = revisions.enqueue(folder, raw);
  assert.deepEqual(revisions.applyPending(store), { applied: 0 });
  assert.equal(revisions.status(folder, queued.requestId).mode, "blocked");
  assert.deepEqual(store.card(card.id), before);
  assert.deepEqual(
    store.db.prepare("SELECT * FROM expertise_epochs").all(),
    epochs,
  );
});

const expertise = require("../electron/expertise.cjs");
const fixedNow = new Date("2026-11-06T17:00:00Z");
const day = 86400000;
let revisionSession = 0;
function rateRevisionCard(store, id, rating, at) {
  const sessionId = "static-revision-test-" + ++revisionSession;
  store.set("session", {
    id: sessionId,
    ids: [id],
    index: 0,
    revealed: true,
    selection: {},
  });
  store.rate({ id, rating, sessionId }, new Date(at));
}
function refreshRevisionExpertise(store, now = fixedNow) {
  for (let i = 0; i < 20; i++) {
    if (!expertise.refresh(store, { now, budget: 1000 }).pending) return;
  }
  assert.fail("Fixture expertise did not settle");
}
function projection(store, id) {
  return JSON.parse(
    store.db.prepare("SELECT data FROM expertise_cards WHERE card_id=?").get(id)
      .data,
  );
}

test("presentation revisions retain historical cutoffs and exact expertise, then normal review and undo still work", (t) => {
  for (const kind of ["svg", "mermaid"]) {
    const original =
      kind === "svg"
        ? oldSvg
        : "```mermaid\nflowchart LR\n A[Source]-->B[Result]\n```";
    const replacement =
      kind === "svg"
        ? newSvg
        : "flowchart LR\n A[Source]-->B[Result]\nclassDef blue fill:#D8E6FC,stroke:#30343B,color:#30343B;\nclass A,B blue;";
    const { folder, store, card, edit } = staticSetup(
      t,
      "Original explanation.\n" + original,
      kind === "svg" ? "math" : "concept",
    );
    const now = fixedNow.getTime();
    rateRevisionCard(store, card.id, "Good", now - 12 * day);
    rateRevisionCard(store, card.id, "Good", now - 9 * day);
    refreshRevisionExpertise(store);
    const semantic = JSON.parse(store.card(card.id).content);
    semantic.answer = semantic.answer.replace(
      "Original explanation.",
      "Changed objective explanation.",
    );
    store.db
      .prepare("UPDATE cards SET content=? WHERE id=?")
      .run(JSON.stringify(semantic), card.id);
    const epoch = store.db
      .prepare("SELECT * FROM expertise_epochs WHERE card_id=?")
      .get(card.id);
    assert.equal(epoch.cutoff, 2);
    rateRevisionCard(store, card.id, "Good", now - 6 * day);
    rateRevisionCard(store, card.id, "Good", now - 3 * day);
    refreshRevisionExpertise(store);
    const beforeProjection = projection(store, card.id);
    assert.equal(beforeProjection.stats.count, 2);
    const before = store.card(card.id);
    const reviews = store.db.prepare("SELECT * FROM reviews ORDER BY id").all();
    const cached = store.db.prepare("SELECT * FROM expertise_cards").all();
    const session = store.get("session");
    const raw = { schemaVersion: 2, cards: [edit(0, replacement, kind)] };
    revisions.enqueue(folder, raw);
    assert.deepEqual(revisions.applyPending(store), { applied: 1 });
    assert.deepEqual(
      store.db
        .prepare("SELECT * FROM expertise_epochs WHERE card_id=?")
        .get(card.id),
      epoch,
    );
    assert.deepEqual(
      store.db.prepare("SELECT * FROM expertise_cards").all(),
      cached,
      "revision does not grant or rewrite cached evidence",
    );
    assert.deepEqual(
      store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
      reviews,
    );
    assert.equal(store.card(card.id).schedule, before.schedule);
    assert.deepEqual(store.get("session"), session);
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM expertise_dirty WHERE card_id=?")
        .get(card.id).n,
      1,
    );
    // Reinstalling the unchanged expertise triggers, as on app reopen, cannot
    // invalidate this preserved epoch. Normal refresh resolves the new hash.
    expertise.install(store.db);
    refreshRevisionExpertise(store);
    const afterProjection = projection(store, card.id);
    assert.notEqual(afterProjection.contentHash, beforeProjection.contentHash);
    assert.equal(
      afterProjection.contentHash,
      expertise.objectiveHash(JSON.parse(store.card(card.id).content)),
    );
    assert.deepEqual(
      { ...afterProjection, contentHash: beforeProjection.contentHash },
      beforeProjection,
    );
    assert.equal(
      store.db
        .prepare("SELECT content_hash FROM expertise_cards WHERE card_id=?")
        .get(card.id).content_hash,
      afterProjection.contentHash,
    );
    const later = new Date(now + day);
    refreshRevisionExpertise(store, later);
    const laterBefore = projection(store, card.id),
      scheduleBefore = store.card(card.id).schedule;
    rateRevisionCard(store, card.id, "Again", later);
    refreshRevisionExpertise(store, later);
    assert.equal(projection(store, card.id).stats.count, 3);
    assert.notDeepEqual(
      projection(store, card.id).summary,
      laterBefore.summary,
    );
    assert.equal(
      store.db
        .prepare("SELECT cutoff FROM expertise_epochs WHERE card_id=?")
        .get(card.id).cutoff,
      epoch.cutoff,
    );
    store.undo();
    refreshRevisionExpertise(store, later);
    assert.deepEqual(projection(store, card.id).summary, laterBefore.summary);
    assert.equal(projection(store, card.id).stats.count, 2);
    assert.equal(store.card(card.id).schedule, scheduleBefore);
    assert.equal(revisions.enqueue(folder, raw).mode, "revised");
    assert.deepEqual(revisions.applyPending(store), { applied: 0 });
    // The ordinary semantic-edit path still invalidates evidence after a style revision.
    const changed = JSON.parse(store.card(card.id).content);
    changed.answer += "\nA new semantic objective.";
    store.db
      .prepare("UPDATE cards SET content=? WHERE id=?")
      .run(JSON.stringify(changed), card.id);
    refreshRevisionExpertise(store, later);
    assert.equal(projection(store, card.id).stats.count, 0);
    assert.equal(projection(store, card.id).summary.score, null);
  }
});

test("presentation revisions preserve absent epochs and do not restore evidence hidden by an earlier pending semantic change", (t) => {
  const { folder, store, card, edit } = staticSetup(t);
  store.db.prepare("DELETE FROM expertise_epochs WHERE card_id=?").run(card.id);
  revisions.enqueue(folder, { schemaVersion: 2, cards: [edit()] });
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  assert.equal(
    store.db
      .prepare("SELECT * FROM expertise_epochs WHERE card_id=?")
      .get(card.id),
    undefined,
  );
  refreshRevisionExpertise(store);
  assert.equal(projection(store, card.id).stats.count, 0);
  assert.equal(projection(store, card.id).summary.score, null);
  rateRevisionCard(store, card.id, "Good", fixedNow.getTime() - 3 * day);
  refreshRevisionExpertise(store);
  const changed = JSON.parse(store.card(card.id).content);
  changed.answer += "\nA new capability.";
  store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(changed), card.id);
  const epoch = store.db
    .prepare("SELECT * FROM expertise_epochs WHERE card_id=?")
    .get(card.id);
  assert.equal(epoch.cutoff, 1);
  assert.equal(
    projection(store, card.id).stats.count,
    1,
    "cache is intentionally stale",
  );
  revisions.enqueue(folder, { schemaVersion: 2, cards: [edit(0, oldSvg)] });
  assert.deepEqual(revisions.applyPending(store), { applied: 1 });
  assert.deepEqual(
    store.db
      .prepare("SELECT * FROM expertise_epochs WHERE card_id=?")
      .get(card.id),
    epoch,
  );
  refreshRevisionExpertise(store);
  assert.equal(projection(store, card.id).stats.count, 0);
  assert.equal(projection(store, card.id).summary.score, null);
});

test("failed presentation transactions roll back card, epoch, dirty markers, cache and receipt together", (t) => {
  const { folder, store, card, edit } = staticSetup(t);
  rateRevisionCard(store, card.id, "Good", fixedNow.getTime() - 3 * day);
  refreshRevisionExpertise(store);
  const state = () =>
    Object.fromEntries(
      [
        "cards",
        "reviews",
        "expertise_epochs",
        "expertise_dirty",
        "expertise_clock",
        "expertise_cards",
        "settings",
      ].map((table) => [
        table,
        store.db.prepare("SELECT * FROM " + table).all(),
      ]),
    );
  const before = state();
  const queued = revisions.enqueue(folder, {
    schemaVersion: 2,
    cards: [edit()],
  });
  const original = store.set;
  store.set = function (key, value) {
    if (key.startsWith("widget-revision:"))
      throw Error("Synthetic transaction failure after epoch restoration");
    return original.call(this, key, value);
  };
  try {
    assert.deepEqual(revisions.applyPending(store), { applied: 0 });
  } finally {
    store.set = original;
  }
  assert.equal(revisions.status(folder, queued.requestId).mode, "blocked");
  assert.deepEqual(state(), before);
});
