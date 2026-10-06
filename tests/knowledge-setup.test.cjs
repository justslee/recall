const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  {
    createKnowledgeSetup,
    scopeId,
  } = require("../electron/knowledge-setup.cjs"),
  { config, saveConfig } = require("../electron/config.cjs"),
  knowledge = require("../adapters/knowledge.cjs");

function fixture(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-knowledge-")),
    folder = path.join(root, "profile"),
    notes = path.join(root, "notes");
  fs.mkdirSync(notes);
  saveConfig(folder, { timeZone: "UTC", captureEnabled: true, custom: "kept" });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, folder, notes, setup: createKnowledgeSetup(folder, options) };
}

function local(setup, notes, extra = {}) {
  return {
    type: "markdown",
    name: "My knowledge",
    write: false,
    ...setup.selectFolder(notes),
    ...extra,
  };
}

test("guided local setup tests explicitly and preserves notes and unrelated profile policy", (t) => {
  const { folder, notes, setup } = fixture(t),
    file = path.join(notes, "example.md"),
    original = "---\ntitle: Example\n---\n# Example\nA real note.\n";
  fs.writeFileSync(file, original);
  const draft = local(setup, notes);
  assert.throws(
    () => setup.saveSource(draft, "forged"),
    /Test this connection/,
  );
  assert.equal(config(folder).sources.length, 0);
  const checked = setup.testSource(draft);
  assert.equal(checked.ok, true);
  assert.equal(checked.notesChecked, 1);
  assert.equal(checked.readiness, "ready");
  assert.equal(config(folder).sources.length, 0);
  const saved = setup.saveSource(draft, checked.testId);
  assert.equal(saved.status, "saved");
  assert.equal(saved.source.root, fs.realpathSync(notes));
  assert.equal(saved.source.write, false);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(config(folder).custom, "kept");
  assert.equal(config(folder).captureEnabled, true);
  assert.equal(config(folder).timeZone, "UTC");
  assert.equal(
    fs.statSync(path.join(folder, "config.json")).mode & 0o777,
    0o600,
  );
  assert.throws(
    () => setup.saveSource(draft, checked.testId),
    /Test this connection/,
  );
});

test("folder choice is main-side and scopes cannot be forged, broadened or redirected", (t) => {
  const { root, folder, notes, setup } = fixture(t);
  assert.throws(
    () =>
      setup.testSource({
        type: "markdown",
        name: "Forged",
        write: true,
        root: notes,
      }),
    /Choose the folder/,
  );
  for (const broad of [os.homedir(), folder, root])
    assert.throws(
      () => setup.selectFolder(broad),
      /dedicated knowledge folder/,
    );

  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const draft = local(setup, notes);
  fs.renameSync(notes, notes + "-old");
  fs.symlinkSync(outside, notes);
  assert.throws(() => setup.testSource(draft), /selected folder changed/);
});

test("access, identity and concurrent configuration changes invalidate a previous check", (t) => {
  const { folder, notes, setup } = fixture(t),
    draft = local(setup, notes),
    checked = setup.testSource(draft);
  assert.throws(
    () => setup.saveSource({ ...draft, write: true }, checked.testId),
    /changed/,
  );
  const saved = setup.saveSource(draft, checked.testId).source,
    edit = { ...saved, name: "Renamed source", write: true },
    editing = setup.testSource(edit);
  saveConfig(folder, {
    sources: [{ ...config(folder).sources[0], name: "Changed elsewhere" }],
  });
  assert.throws(() => setup.saveSource(edit, editing.testId), /changed/);
  assert.throws(
    () => setup.testSource({ ...edit, root: path.dirname(notes) }),
    /different folder/,
  );
  assert.throws(
    () => setup.testSource({ ...edit, type: "obsidian" }),
    /different provider/,
  );
});

test("bounded preflight skips hidden paths and symlinks and never authors a note", (t) => {
  const { root, notes, setup } = fixture(t),
    outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "private.md"), "---\n: [invalid\n---\n");
  fs.writeFileSync(path.join(notes, "good.md"), "# Safe note");
  fs.writeFileSync(path.join(notes, ".hidden.md"), "---\n: [invalid\n---\n");
  fs.symlinkSync(outside, path.join(notes, "outside"));
  const names = fs.readdirSync(notes),
    result = setup.testSource(local(setup, notes, { write: true }));
  assert.equal(result.ok, true);
  assert.equal(result.notesChecked, 1);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(fs.readdirSync(notes), names);
  assert.equal(
    fs.readFileSync(path.join(outside, "private.md"), "utf8"),
    "---\n: [invalid\n---\n",
  );
});

test("bad or oversized notes are reported and do not receive a savable test receipt", (t) => {
  const { notes, setup } = fixture(t);
  fs.writeFileSync(
    path.join(notes, "broken.md"),
    "---\nname: [unfinished\n---\n",
  );
  const draft = local(setup, notes),
    result = setup.testSource(draft);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].path, "broken.md");
  assert.throws(
    () => setup.saveSource(draft, result.testId),
    /Test this connection/,
  );
  fs.unlinkSync(path.join(notes, "broken.md"));
  fs.writeFileSync(
    path.join(notes, "oversized.md"),
    "x".repeat(2 * 1024 * 1024 + 1),
  );
  assert.match(setup.testSource(draft).issues[0].reason, /2 MB/);
});

test("large sources use a bounded sample rather than claiming full coverage", (t) => {
  const { notes, setup } = fixture(t);
  for (let i = 0; i < 100; i++)
    fs.writeFileSync(path.join(notes, `${i}.md`), `# Note ${i}`);
  const result = setup.testSource(local(setup, notes));
  assert.equal(result.ok, true);
  assert.equal(result.notesChecked, 40);
  assert.equal(result.limited, true);
});

test("Notion scope setup distinguishes a local configuration from actual live verification", (t) => {
  const { root, folder, setup } = fixture(t),
    id = "12345678-abcd-4321-1234-123456789abc",
    draft = {
      type: "notion",
      name: "My Notion concepts",
      write: false,
      scopeId: `https://www.notion.so/Concepts-${id.replaceAll("-", "")}?v=ignore`,
    },
    result = setup.testSource(draft);
  assert.equal(result.ok, true);
  assert.equal(result.transport, "assistant");
  assert.equal(result.readiness, "needs-assistant");
  assert.equal(result.scope.scopeId, id);
  const source = setup.saveSource(draft, result.testId).source;
  assert.equal(source.snapshotCount, 0);
  assert.equal(config(folder).sources[0].setupTest.liveVerified, false);
  assert.equal(setup.list().launcherReady, false);
  assert.throws(
    () => setup.assistantPrompt(source.id),
    /Connect Codex or Claude/,
  );
  require("../electron/connections.cjs").connect(folder, "codex", {
    apply: true,
    home: path.join(root, "assistant-home"),
  });
  assert.equal(setup.list().launcherReady, true);
  const prompt = setup.assistantPrompt(source.id).prompt;
  assert(prompt.includes(id));
  assert(prompt.includes(path.join(folder, "connections", "recall")));
  assert.match(prompt, /Do not write to Notion/);
  knowledge.ingestNotion(folder, source.id, [
    {
      id: "remote-note",
      scopeId: id,
      title: "Fetched note",
      body: "Real fetched text",
      revision: "revision-1",
    },
  ]);
  assert.equal(setup.list().sources[0].snapshotCount, 1);
  const cached = setup.testSource(source);
  assert.equal(cached.readiness, "snapshot-ready");
  assert.match(cached.message, /Live Notion access still needs verification/);
  assert.throws(() => scopeId(`https://attacker.example/${id}`), /Notion page/);
  assert.throws(() => scopeId("not-a-page"), /valid page/);
  assert.equal(scopeId(id.toUpperCase()), id);
  const launcher = path.join(folder, "connections", "recall");
  fs.chmodSync(launcher, 0o600);
  assert.equal(setup.list().launcherReady, false);
  assert.throws(
    () => setup.assistantPrompt(source.id),
    /Connect Codex or Claude/,
  );
  fs.chmodSync(launcher, 0o700);
  fs.renameSync(launcher, launcher + "-original");
  fs.symlinkSync(launcher + "-original", launcher);
  assert.equal(setup.list().launcherReady, false);
  assert.throws(
    () => setup.assistantPrompt(source.id),
    /Connect Codex or Claude/,
  );
});

test("editing and disconnecting a source preserve its canonical identity, metadata and cached content", (t) => {
  const { folder, notes, setup } = fixture(t);
  saveConfig(folder, {
    sources: [
      {
        id: "old",
        type: "obsidian",
        root: notes,
        write: false,
        metadata: { keep: true },
      },
    ],
  });
  fs.writeFileSync(path.join(notes, "kept.md"), "# Kept concept");
  const draft = { ...setup.list().sources[0], name: "My vault", write: true },
    checked = setup.testSource(draft),
    edited = setup.saveSource(draft, checked.testId).source;
  assert.equal(edited.id, "old");
  assert.equal(edited.type, "obsidian");
  assert.equal(edited.write, true);
  assert.deepEqual(config(folder).sources[0].metadata, { keep: true });
  setup.removeSource(edited.id);
  assert.deepEqual(config(folder).sources, []);
  assert.equal(
    fs.readFileSync(path.join(notes, "kept.md"), "utf8"),
    "# Kept concept",
  );
  assert.equal(config(folder).custom, "kept");
});

test("selection and connection-check receipts expire and duplicate scopes are explicit", (t) => {
  let time = Date.now();
  const { notes, setup } = fixture(t, { now: () => time }),
    draft = local(setup, notes),
    checked = setup.testSource(draft);
  time += 16 * 60 * 1000;
  assert.throws(
    () => setup.saveSource(draft, checked.testId),
    /Test this connection/,
  );
  assert.throws(() => setup.testSource(draft), /selection expired/);
  const latest = local(setup, notes),
    result = setup.testSource(latest);
  setup.saveSource(latest, result.testId);
  assert.throws(
    () => setup.testSource(local(setup, notes)),
    /already connected/,
  );
});
