const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store } = require("../electron/store.cjs"),
  { saveConfig } = require("../electron/config.cjs"),
  kb = require("../adapters/knowledge.cjs"),
  bundles = require("../electron/bundles.cjs"),
  st = require("../electron/self-test.cjs"),
  backups = require("../electron/backup.cjs");
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-public-")),
    folder = path.join(root, "profile"),
    notes = path.join(root, "notes");
  fs.mkdirSync(notes);
  saveConfig(folder, {
    timeZone: "UTC",
    captureEnabled: true,
    sources: [{ id: "kb", type: "markdown", root: notes, write: true }],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, folder, notes };
}
test("doctor reports the same xcrun-selected tools as execution and the selected scientific runtime", (t) => {
  const { folder } = setup(t);
  const selected = [];
  const paths = {
    python3: "/selected/toolchain/python3",
    "clang++": "/selected/toolchain/clang++",
  };
  const runtimes = require("../electron/runtime-info.cjs").diagnostics(folder, {
    runner: {
      tool: (name) => paths[name],
      scientificPythonPath: () => {
        throw Error("Optional environment is missing");
      },
    },
    execute: (file) => {
      selected.push(file);
      return { status: 0, stdout: "Selected runtime 1.0\n" };
    },
  });
  assert.deepEqual(selected, Object.values(paths));
  assert.equal(runtimes.python3.path, paths.python3);
  assert.equal(runtimes["clang++"].path, paths["clang++"]);
  assert.equal(runtimes["scientific-python"].available, false);
  assert.equal(
    runtimes["scientific-python"].configuredPath,
    path.join(folder, "python/bin/python3"),
  );
  assert.equal(runtimes["scientific-python"].dependenciesChecked, false);
});

test(
  "exercise validation selects scientific Python through --data or RECALL_DATA_DIR",
  { skip: process.platform !== "darwin" },
  (t) => {
    const { root, folder } = setup(t);
    const interpreter = new (require("../electron/runner.cjs").Runner)().tool(
      "python3",
    );
    fs.mkdirSync(path.join(folder, "python/bin"), { recursive: true });
    fs.symlinkSync(interpreter, path.join(folder, "python/bin/python3"));
    const card = structuredClone(
      require("../examples/cards.json").find((c) => c.kind === "code"),
    );
    card.code = {
      python: { ...card.code.python, runtime: "scientific-python" },
    };
    const cards = path.join(root, "cards.json"),
      mutants = path.join(root, "mutants.json");
    fs.writeFileSync(cards, JSON.stringify([card]));
    fs.writeFileSync(
      mutants,
      JSON.stringify(require("../examples/mutants.json")),
    );
    const { execFileSync } = require("node:child_process");
    for (const explicit of [false, true]) {
      const report = path.join(
        root,
        explicit ? "explicit.json" : "environment.json",
      );
      execFileSync(
        process.execPath,
        [
          path.resolve(__dirname, "../scripts/validate-card-exercises.cjs"),
          ...(explicit ? ["--data", folder] : []),
          cards,
          mutants,
          report,
        ],
        {
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            RECALL_DATA_DIR: explicit ? path.join(root, "unused") : folder,
          },
        },
      );
      const result = JSON.parse(fs.readFileSync(report));
      assert.equal(result.exercises[0].id, card.id);
      assert.equal(result.exercises[0].languages.python.reference, "passed");
      assert.equal(result.exercises[0].languages.python.stub, "failed");
      assert(result.exercises[0].languages.python.rejectedMutants.length > 0);
    }
  },
);

test("complete learning journey: note, duplicate protection, cards, daily test, rating, restart and restore", (t) => {
  const { root, folder } = setup(t),
    record = require("../examples/knowledge.json");
  const preview = kb.save(folder, "kb", record);
  assert.equal(preview.status, "preview");
  assert.equal(kb.scan(folder, "kb").documents.length, 0);
  const saved = kb.save(folder, "kb", record, { apply: true });
  assert.equal(saved.status, "saved");
  assert.equal(
    kb.save(folder, "kb", record, { apply: true }).status,
    "unchanged",
  );
  assert.throws(
    () => kb.save(folder, "kb", { ...record, id: "different" }),
    /Matching/,
  );
  let store = new Store(folder);
  const initial = store.cards();
  assert.equal(initial.length, 0);
  const pack = require("../examples/demo.json");
  assert.equal(bundles.importPack(store, pack).inserted.length, 3);
  assert.equal(store.cards().length, 0);
  assert.equal(
    bundles.importPack(store, pack, { apply: true, widgets: true }).inserted,
    3,
  );
  assert.equal(
    bundles.importPack(store, pack, { apply: true, widgets: true }).unchanged,
    3,
  );
  assert.equal(
    require("../electron/exercise-trust.cjs").canRunExercise(
      store.cards().find((c) => c.kind === "code"),
      (k) => store.get(k),
    ),
    false,
  );
  const now = new Date("2026-09-13T12:00:00Z");
  st.capture(folder, {
    id: "session/mean",
    sessionId: "session",
    title: "Weighted mean",
    objective: "Apply weights",
    context: "Worked through a course score example",
    at: now.toISOString(),
    evidence: "discussed",
    cardIds: pack.cards.map((c) => c.id),
  });
  const session = st.start(store, { day: "2026-09-13" }, now);
  assert.equal(session.ids.length, 3);
  assert.equal(session.revealed, false);
  assert.throws(
    () =>
      store.rate(
        { id: session.ids[0], rating: "Good", sessionId: session.id },
        now,
      ),
    /Reveal/,
  );
  store.set("session", { ...session, revealed: true });
  store.rate(
    { id: session.ids[0], rating: "Good", sessionId: session.id },
    now,
  );
  assert.equal(
    st.snapshot(store, now).days.find((d) => d.day === "2026-09-13").pending
      .length,
    2,
  );
  const snapshot = store.cards();
  const backup = backups.backup(store, path.join(root, "backup"));
  store.close();
  store = new Store(folder);
  assert.deepEqual(store.cards(), snapshot);
  store.close();
  const restored = path.join(root, "restored");
  backups.restore(restored, backup.backup);
  store = new Store(restored);
  assert.deepEqual(store.cards(), snapshot);
  assert.equal(st.read(restored).entries.length, 1);
  store.close();
});
test("KB updates preserve user prose/frontmatter, reject stale revisions, resolve assets, retain identity after rename", (t) => {
  const { folder, notes } = setup(t);
  fs.writeFileSync(
    path.join(notes, "custom.md"),
    "---\ntitle: Original\ncustom: keep\naliases: [Alias]\n---\n# Original\n\nMy own words.\n",
  );
  const original = kb.scan(folder, "kb").documents[0];
  assert.equal(kb.search(folder, "kb", "alias").documents.length, 1);
  const record = {
    id: original.id,
    title: "Original",
    body: "## Explanation\n\nNew material with $5 and $$x^2$$.",
    aliases: ["Alias"],
  };
  assert.throws(
    () =>
      kb.save(folder, "kb", record, { apply: true, expectedRevision: "stale" }),
    /Revision/,
  );
  const changed = kb.save(folder, "kb", record, {
    apply: true,
    expectedRevision: original.revision,
  });
  assert.match(changed.after, /My own words/);
  assert.match(changed.after, /custom: keep/);
  assert.match(changed.after, /\$5/);
  assert(fs.existsSync(changed.backup));
  fs.renameSync(path.join(notes, "custom.md"), path.join(notes, "renamed.md"));
  assert.equal(kb.scan(folder, "kb").documents[0].id, original.id);
  fs.writeFileSync(
    path.join(notes, "image.png"),
    Buffer.from([137, 80, 78, 71]),
  );
  assert(
    kb
      .asset(folder, "kb", "renamed.md", "image.png")
      .dataUri.startsWith("data:image/png"),
  );
  assert.throws(
    () => kb.asset(folder, "kb", "renamed.md", "../outside.png"),
    /escapes/,
  );
});
test("Notion bridge scopes snapshots, records pending writes and verifies actual fetched result", (t) => {
  const { folder } = setup(t);
  saveConfig(folder, {
    sources: [
      {
        id: "notion",
        type: "notion",
        scopeId: "scope-example",
        write: true,
        propertyMap: { title: "Concept" },
      },
    ],
  });
  assert.throws(
    () =>
      kb.ingestNotion(folder, "notion", [
        { id: "x", scopeId: "wrong", body: "x", title: "x", revision: "1" },
      ]),
    /scoped/,
  );
  const record = {
    id: "concept:example",
    title: "Example",
    body: "An example.",
  };
  const request = kb.save(folder, "notion", record, { apply: true });
  assert.equal(request.status, "pending");
  const doc = {
    id: "page-example",
    scopeId: "scope-example",
    canonicalId: record.id,
    title: record.title,
    body: record.body,
    revision: "v1",
  };
  assert.throws(
    () => kb.acknowledge(folder, request.id, { ...doc, body: "different" }),
    /match/,
  );
  assert.equal(kb.acknowledge(folder, request.id, doc).status, "verified");
  assert.equal(kb.scan(folder, "notion").documents.length, 1);
});
test("writer coordination, code trust and conflicting imports do not reset state", (t) => {
  const { folder } = setup(t),
    store = new Store(folder);
  t.after(() => store.close());
  assert.throws(() => new Store(folder), /using this library/);
  const pack = require("../examples/demo.json");
  bundles.importPack(store, pack, { apply: true });
  const before = store.cards();
  assert.throws(
    () =>
      bundles.importPack(
        store,
        {
          ...pack,
          cards: pack.cards.map((c) => ({ ...c, title: "different" })),
        },
        { apply: true },
      ),
    /Conflicting/,
  );
  assert.deepEqual(store.cards(), before);
  assert.throws(
    () =>
      bundles.trustCode(store, "demo:weighted-mean:code", {
        version: 1,
        validatedAt: new Date().toISOString(),
        exercises: [],
      }),
    /digest/,
  );
});
test("captured days survive later timezone changes", (t) => {
  const { folder } = setup(t);
  saveConfig(folder, { timeZone: "Pacific/Honolulu" });
  st.capture(folder, {
    id: "timezone",
    sessionId: "s",
    title: "T",
    objective: "O",
    context: "C",
    at: "2026-09-14T02:00:00Z",
    evidence: "discussed",
    cardIds: [],
  });
  saveConfig(folder, { timeZone: "Asia/Tokyo" });
  const s = new Store(folder);
  t.after(() => s.close());
  assert.equal(
    st
      .snapshot(s, new Date("2026-09-14T04:00:00Z"))
      .days.find((d) => d.entries.length).day,
    "2026-09-13",
  );
});
test("restore refuses corrupt backups before touching the current library", (t) => {
  const { root, folder } = setup(t);
  const s = new Store(folder);
  bundles.importPack(s, require("../examples/demo.json"), { apply: true });
  const before = s.cards(),
    backup = backups.backup(s, path.join(root, "saved"));
  s.close();
  fs.appendFileSync(path.join(backup.backup, "recall.sqlite"), "corruption");
  assert.throws(() => backups.restore(folder, backup.backup), /checksum/);
  const after = new Store(folder);
  assert.deepEqual(after.cards(), before);
  after.close();
});
test("catalog refresh retains absent cards and local changes without granting execution trust", (t) => {
  const { folder } = setup(t),
    s = new Store(folder);
  t.after(() => s.close());
  const { syncCatalog, hash } = require("../electron/catalog.cjs");
  const c = {
    ...require("../examples/demo.json").cards.find((c) => c.kind === "code"),
    catalog: { id: "original-catalog", title: "Original catalog" },
    decks: ["Original catalog"],
  };
  const pack = {
    schemaVersion: 1,
    catalogId: "original-catalog",
    title: "Original catalog",
    manifest: {},
    cards: [c],
    contentHash: hash([c]),
  };
  assert.equal(syncCatalog(s, pack).inserted, 1);
  const local = { ...c, answer: "My edited explanation" };
  s.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(local), c.id);
  const upstream = { ...c, answer: "New upstream explanation" };
  const result = syncCatalog(s, {
    ...pack,
    cards: [upstream],
    contentHash: hash([upstream]),
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(JSON.parse(s.card(c.id).content).answer, local.answer);
  assert.equal(s.get("validated-code:" + c.id), null);
});
