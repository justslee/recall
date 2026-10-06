const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Store } = require("../electron/store.cjs"),
  backups = require("../electron/backup.cjs"),
  { exerciseHash, canRunExercise } = require("../electron/exercise-trust.cjs");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-backup-test-")),
    folder = path.join(root, "profile"),
    store = new Store(folder);
  store.import(require("../examples/demo.json").cards);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, folder, store };
}

test("profile backup excludes current and legacy credentials and accepts an empty destination", (t) => {
  const { root, folder, store } = setup(t),
    credentials = path.join(folder, "credentials"),
    destination = path.join(root, "empty-backup");
  fs.mkdirSync(credentials, { mode: 0o700 });
  fs.writeFileSync(
    path.join(credentials, "openai.key"),
    "synthetic-local-credential",
  );
  fs.writeFileSync(
    path.join(credentials, "openai.enc"),
    "synthetic-legacy-ciphertext",
  );
  fs.mkdirSync(destination);

  assert.equal(backups.backup(store, destination).backup, destination);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(destination, "manifest.json"), "utf8"),
  );
  assert(manifest.checksums["recall.sqlite"]);
  assert.equal(fs.existsSync(path.join(destination, "credentials")), false);
  assert(
    Object.keys(manifest.checksums).every(
      (file) => !file.startsWith("credentials/"),
    ),
  );
  assert.equal(
    fs.readFileSync(path.join(credentials, "openai.key"), "utf8"),
    "synthetic-local-credential",
  );
  assert.equal(
    fs.readFileSync(path.join(credentials, "openai.enc"), "utf8"),
    "synthetic-legacy-ciphertext",
  );
});

test("backup rejects a nonempty destination without changing its contents or permissions", (t) => {
  const { root, store } = setup(t),
    destination = path.join(root, "existing-folder"),
    credentials = path.join(destination, "credentials");
  fs.mkdirSync(credentials, { recursive: true });
  fs.chmodSync(destination, 0o755);
  for (const name of ["openai.key", "openai.enc"])
    fs.writeFileSync(
      path.join(credentials, name),
      "existing-synthetic-credential",
    );

  assert.throws(() => backups.backup(store, destination), /empty directory/);
  assert.deepEqual(fs.readdirSync(destination), ["credentials"]);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o755);
  for (const name of ["openai.key", "openai.enc"])
    assert.equal(
      fs.readFileSync(path.join(credentials, name), "utf8"),
      "existing-synthetic-credential",
    );
  assert.equal(fs.existsSync(path.join(destination, "recall.sqlite")), false);
  assert.equal(fs.existsSync(path.join(destination, "manifest.json")), false);
});

test("restore rejects current and legacy credential members before changing the profile", (t) => {
  const { root, store } = setup(t),
    destination = backups.backup(store, path.join(root, "backup")).backup,
    manifestPath = path.join(destination, "manifest.json"),
    original = JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    target = path.join(root, "restore-target"),
    current = new Store(target);
  current.import(require("../examples/demo.json").cards);
  current.set("backup-test", { preserved: true });
  current.close();
  const before = fs.readFileSync(path.join(target, "recall.sqlite"));
  fs.mkdirSync(path.join(destination, "credentials"));

  for (const name of ["openai.key", "openai.enc"]) {
    const rel = path.join("credentials", name),
      contents = "synthetic-disallowed-credential";
    fs.writeFileSync(path.join(destination, rel), contents);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        ...original,
        checksums: {
          ...original.checksums,
          [rel]: crypto.createHash("sha256").update(contents).digest("hex"),
        },
      }),
    );

    assert.throws(
      () => backups.restore(target, destination),
      /Unexpected backup member/,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(target, "recall.sqlite")),
      before,
    );
    assert.equal(fs.existsSync(path.join(target, "credentials")), false);
  }
});

test("restore revokes backup-carried execution approvals while preserving every other row and live approvals", (t) => {
  const { root, store } = setup(t),
    card = {
      ...store.cards().find((item) => item.kind === "code"),
      id: "synthetic:restore:code",
      catalog: { id: "synthetic-catalog", title: "Synthetic catalog" },
    },
    approvalKey = "validated-code:" + card.id,
    approval = { sha256: exerciseHash(card), source: "local-review" };
  store.syncCatalog({
    schemaVersion: 1,
    catalogId: card.catalog.id,
    title: card.catalog.title,
    cards: [card],
    contentHash: require("../electron/catalog.cjs").hash([card]),
  });
  store.set(approvalKey, approval);
  store.set("draft:" + card.id, { code: "A retained coding draft" });
  store.set("validated-codebook", { unrelated: "Retained setting" });
  store.challengeState(card.id, { notes: "Retained notes", bookmarked: true });
  store.recordChallengeAttempt(card, "python", "draft", {
    status: "failed",
    output: "Synthetic retained attempt",
  });
  const tables = [
      "cards",
      "settings",
      "reviews",
      "attachments",
      "catalog_entries",
      "challenge_state",
      "challenge_attempts",
    ],
    rows = (database, table) =>
      database.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
    baseline = Object.fromEntries(
      tables.map((table) => [table, rows(store.db, table)]),
    ),
    destination = backups.backup(store, path.join(root, "backup")).backup,
    manifestBefore = fs.readFileSync(path.join(destination, "manifest.json")),
    archiveBefore = fs.readFileSync(path.join(destination, "recall.sqlite")),
    target = path.join(root, "restored"),
    result = backups.restore(target, destination),
    restored = new Store(target);
  try {
    assert.equal(result.executionApprovalsCleared, 1);
    assert.equal(
      canRunExercise(card, (key) => restored.get(key)),
      false,
    );
    assert.equal(restored.get(approvalKey), null);
    assert.equal(
      canRunExercise(card, (key) => store.get(key)),
      true,
    );
    assert.deepEqual(store.get(approvalKey), approval);
    for (const table of tables) {
      const expected =
        table === "settings"
          ? baseline[table].filter((row) => row.key !== approvalKey)
          : baseline[table];
      assert.deepEqual(rows(restored.db, table), expected, table);
      assert.deepEqual(rows(store.db, table), baseline[table], "live " + table);
    }
    assert.deepEqual(
      fs.readFileSync(path.join(destination, "manifest.json")),
      manifestBefore,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(destination, "recall.sqlite")),
      archiveBefore,
    );
  } finally {
    restored.close();
  }
});

test("restore rejects a crafted approval-reinstating trigger before changing the target profile", (t) => {
  const { root, store } = setup(t),
    card = store.cards().find((item) => item.kind === "code"),
    { DatabaseSync } = require("node:sqlite");
  store.set("validated-code:" + card.id, { sha256: exerciseHash(card) });
  const destination = backups.backup(store, path.join(root, "backup")).backup,
    databasePath = path.join(destination, "recall.sqlite"),
    archive = new DatabaseSync(databasePath);
  try {
    archive.exec(`
      CREATE TRIGGER reinstate_approval AFTER DELETE ON settings
      WHEN OLD.key GLOB 'validated-code:*'
      BEGIN
        INSERT INTO settings(key,value) VALUES(OLD.key,OLD.value);
      END;
    `);
  } finally {
    archive.close();
  }
  const manifestPath = path.join(destination, "manifest.json"),
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.checksums["recall.sqlite"] = crypto
    .createHash("sha256")
    .update(fs.readFileSync(databasePath))
    .digest("hex");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const target = path.join(root, "target"),
    current = new Store(target);
  current.set("draft:kept", { answer: "Preserve this draft" });
  current.close();
  const before = fs.readFileSync(path.join(target, "recall.sqlite"));

  assert.throws(
    () => backups.restore(target, destination),
    /unsupported database triggers/,
  );
  assert.deepEqual(fs.readFileSync(path.join(target, "recall.sqlite")), before);
  assert.equal(
    canRunExercise(card, (key) => store.get(key)),
    true,
  );
});
