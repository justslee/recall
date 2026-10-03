const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Store } = require("../electron/store.cjs"),
  backups = require("../electron/backup.cjs");

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
