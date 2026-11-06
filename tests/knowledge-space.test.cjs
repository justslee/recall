const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { saveConfig, config } = require("../electron/config.cjs");
const { KnowledgeIndex } = require("../electron/knowledge-index.cjs");
const files = require("../electron/knowledge-files.cjs");
const {
  KnowledgeSpace,
  linkCard,
  practiceLinks,
} = require("../electron/knowledge-space.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "recall-knowledge-space-"),
    ),
    folder = path.join(root, "profile"),
    notes = path.join(root, "notes");
  fs.mkdirSync(notes);
  saveConfig(folder, {
    captureEnabled: false,
    sources: [
      {
        id: "local",
        name: "My notes",
        root: notes,
        type: "markdown",
        write: true,
      },
    ],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, folder, notes };
}
test("persisted search uses native full text and exact aliases without rereading files per query", async (t) => {
  const { folder, notes } = fixture(t);
  fs.writeFileSync(
    path.join(notes, "ecs.md"),
    "---\nrecall:\n  id: aws:ecs\naliases: [ECS, Amazon Elastic Container Service]\ntags: [Systems]\n---\n# Container orchestration\nServices keep tasks running.\n",
  );
  fs.writeFileSync(
    path.join(notes, "queue.html"),
    "<title>Event queues</title><h1>Event queues</h1><p>Asynchronous delivery</p>",
  );
  let index = new KnowledgeIndex(folder);
  await index.refresh();
  assert.equal(
    index.query({ query: "Amazon Elastic Container Service" }).documents[0].id,
    "aws:ecs",
  );
  assert.equal(index.query({ query: "tasks running" }).documents.length, 1);
  assert.equal(index.query({ query: "event" }).documents[0].format, "html");
  assert.equal(index.query({ query: "unknown" }).documents.length, 0);
  assert.doesNotThrow(() => index.query({ query: '" OR * NOT (' }));
  index.close();
  index = new KnowledgeIndex(folder);
  const before = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    if (String(file).endsWith("ecs.md"))
      throw Error("Should not read source during search");
    return before.call(this, file, ...args);
  };
  try {
    assert.equal(
      index.query({ query: "ECS" }).documents[0].title,
      "Container orchestration",
    );
  } finally {
    fs.readFileSync = before;
    index.close();
  }
});
test("index reconciles edits, renames, deletions, unreadable notes and removed scopes", async (t) => {
  const { folder, notes } = fixture(t);
  const note = files.createNote(folder, {
    sourceId: "local",
    title: "Vectors",
  });
  const index = new KnowledgeIndex(folder);
  t.after(() => index.close());
  await index.refresh();
  assert.equal(index.query({ query: "Vectors" }).documents.length, 1);
  fs.writeFileSync(path.join(notes, note.path), note.raw + "\nOrthogonality\n");
  await index.refresh();
  assert.equal(index.query({ query: "Orthogonality" }).documents.length, 1);
  fs.renameSync(path.join(notes, note.path), path.join(notes, "Renamed.md"));
  await index.refresh();
  assert.equal(index.query({ query: note.id }).documents[0].path, "Renamed.md");
  fs.writeFileSync(path.join(notes, "Broken.md"), "---\nx: [\n---\n");
  await index.refresh();
  assert.equal(index.status().sources[0].issues.length, 1);
  fs.unlinkSync(path.join(notes, "Renamed.md"));
  await index.refresh();
  assert.equal(index.query({ query: "Vectors" }).documents.length, 0);
  saveConfig(folder, { sources: [] });
  assert.equal(index.query({}).documents.length, 0);
});
test("save preserves frontmatter and rejects external revisions, read-only scope and symlink escapes", (t) => {
  const { root, folder, notes } = fixture(t);
  const raw =
    "---\r\n# custom comment\r\ntitle: Existing\r\ncustom: kept\r\n---\r\n# Existing\r\n";
  fs.writeFileSync(path.join(notes, "Existing.md"), raw);
  const note = files.readNote(folder, "local", "Existing.md");
  const updated = files.saveNote(folder, { ...note, raw: raw + "Hello\r\n" });
  assert.equal(updated.raw, raw + "Hello\r\n");
  assert.throws(
    () => files.saveNote(folder, { ...note, raw: "stale" }),
    /changed/,
  );
  assert.equal(
    fs.readFileSync(path.join(notes, "Existing.md"), "utf8"),
    updated.raw,
  );
  fs.writeFileSync(path.join(root, "outside.md"), "private");
  fs.symlinkSync(path.join(root, "outside.md"), path.join(notes, "link.md"));
  assert.throws(
    () => files.readNote(folder, "local", "link.md"),
    /Symlink|Symbolic/,
  );
  assert.throws(
    () => files.readNote(folder, "local", "../outside.md"),
    /inside/,
  );
  assert.throws(() => files.readNote(folder, "local", "/outside.md"), /inside/);
  saveConfig(folder, {
    sources: config(folder).sources.map((s) => ({ ...s, write: false })),
  });
  assert.throws(
    () => files.saveNote(folder, { ...updated, raw: "denied" }),
    /read-only/,
  );
  assert.throws(
    () => files.createNote(folder, { sourceId: "local" }),
    /read-only/,
  );
});
test("draft recovery, stable IDs and exclusive move preserve notes and linked card state", (t) => {
  const { folder } = fixture(t);
  const note = files.createNote(folder, {
    sourceId: "local",
    title: "Matrix multiplication",
  });
  files.draft(folder, { ...note, raw: note.raw + "Pending thought" });
  assert.match(
    files.draft(folder, { sourceId: "local", path: note.path }).raw,
    /Pending thought/,
  );
  assert.throws(
    () => files.moveNote(folder, { ...note, to: "Moved.md" }),
    /draft/,
  );
  const saved = files.saveNote(folder, {
    ...note,
    raw: note.raw + "Saved thought",
  });
  assert.equal(
    files.draft(folder, { sourceId: "local", path: note.path }),
    null,
  );
  const cards = [
      {
        id: "card1",
        conceptId: "other",
        status: "ready",
        suspended: false,
        kind: "math",
        schedule: { due: "untouched" },
      },
    ],
    before = structuredClone(cards);
  linkCard(folder, saved, "card1", cards);
  const moved = files.moveNote(folder, { ...saved, to: "Moved.md" });
  assert.equal(moved.id, note.id);
  assert.equal(practiceLinks(folder, moved, cards).cards[0].id, "card1");
  assert.deepEqual(cards, before);
  const edited = files.saveNote(folder, {
    ...moved,
    raw: moved.raw + "\nNew fact",
  });
  assert.equal(practiceLinks(folder, edited, cards).needsCheck, true);
  files.createNote(folder, { sourceId: "local", title: "Existing" });
  assert.throws(
    () => files.moveNote(folder, { ...edited, to: "Existing.md" }),
    /EEXIST/,
  );
});
test("worker watches external edits and keeps search available without main-thread parsing", async (t) => {
  const { folder, notes } = fixture(t);
  const service = new KnowledgeSpace(folder);
  t.after(() => service.close());
  await service.call("refresh");
  const note = await service.call("create", {
    sourceId: "local",
    title: "Background note",
  });
  assert.equal(
    (await service.call("search", { query: "Background" })).documents.length,
    1,
  );
  fs.writeFileSync(
    path.join(notes, note.path),
    note.raw + "\nIncremental retrieval\n",
  );
  let found = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (
      (await service.call("search", { query: "incremental" })).documents.length
    ) {
      found = true;
      break;
    }
  }
  assert.equal(found, true);
  const read = await service.call("read", {
    sourceId: "local",
    path: note.path,
  });
  assert.match(read.raw, /Incremental/);
  await service.close();
});

test("new spaces and legacy note moves preserve configuration and practice identities", (t) => {
  const { root, folder, notes } = fixture(t);
  const before = config(folder);
  const space = files.createSpace(folder, path.join(root, "A new space"));
  assert.equal(space.write, true);
  assert.equal(config(folder).sources.length, 2);
  assert.deepEqual(config(folder).sources[0], before.sources[0]);
  assert.equal(config(folder).captureEnabled, false);
  assert.throws(() => files.createSpace(folder, notes), /EEXIST/);
  fs.writeFileSync(
    path.join(notes, "Legacy.html"),
    "<h1>Legacy document</h1><p>Retained source</p>",
  );
  const note = files.readNote(folder, "local", "Legacy.html");
  const moved = files.moveNote(folder, {
    sourceId: "local",
    path: note.path,
    revision: note.revision,
    to: "Moved.html",
  });
  assert.equal(moved.id, note.id);
  assert.equal(moved.raw, note.raw);
});

test("profile backups include recovery and practice links but exclude the derived index and external originals", async (t) => {
  const { folder, notes, root } = fixture(t);
  const note = files.createNote(folder, {
    sourceId: "local",
    title: "Backup example",
  });
  files.draft(folder, { ...note, raw: note.raw + "Recover this draft" });
  linkCard(folder, note, "example", [{ id: "example" }]);
  const index = new KnowledgeIndex(folder);
  await index.refresh();
  index.close();
  const { Store } = require("../electron/store.cjs");
  const store = new Store(folder);
  const result = require("../electron/backup.cjs").backup(
    store,
    path.join(root, "export"),
  );
  store.close();
  assert.equal(fs.existsSync(path.join(result.backup, "cache")), false);
  assert.equal(
    fs.existsSync(path.join(result.backup, "knowledge", "drafts")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(result.backup, "knowledge", "practice-links")),
    true,
  );
  assert.equal(fs.existsSync(path.join(result.backup, note.path)), false);
  assert.equal(fs.readFileSync(path.join(notes, note.path), "utf8"), note.raw);
});
