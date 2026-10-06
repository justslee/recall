const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const {
  inspectText,
  inspectFile,
  displayName,
} = require("../shared/privacy-audit.cjs");
const root = path.resolve(__dirname, ".."),
  sourceAudit = path.join(root, "scripts/audit-release.cjs"),
  packageAudit = path.join(root, "scripts/audit-package.cjs");
const repeated = (length, value = "S") => value.repeat(length);
const fixtureKey = () => "sk-" + repeated(32);
function temporary(t) {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-privacy-audit-"),
  );
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));

  return folder;
}
function write(folder, name, data) {
  const file = path.join(folder, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
function runAudit(script, folder) {
  const result = spawnSync(process.execPath, [script, folder], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.ifError(result.error);

  return { ...result, output: result.stdout + result.stderr };
}
function git(folder, args) {
  const result = spawnSync("git", args, {
    cwd: folder,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_AUTHOR_NAME: "Synthetic Contributor",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Synthetic Contributor",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  });
  assert.equal(result.status, 0, "Fixture Git operation failed");
}
function commit(folder, message) {
  git(folder, ["add", "."]);
  git(folder, ["-c", "commit.gpgsign=false", "commit", "-m", message]);
}

test("hosted privacy audit checks a full checkout without persisted Git credentials", () => {
  const { parse } = require("yaml");
  const workflow = parse(
    fs.readFileSync(path.join(root, ".github/workflows/verify.yml"), "utf8"),
  );
  const steps = workflow.jobs.verify.steps;
  const auditIndex = steps.findIndex(
    (step) => step.run === "npm run audit:release",
  );
  const checkoutIndex = steps.findIndex((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );

  assert(checkoutIndex >= 0 && auditIndex > checkoutIndex);
  assert.equal(steps[checkoutIndex].with?.["fetch-depth"], 0);
  assert.equal(steps[checkoutIndex].with?.["persist-credentials"], false);
  assert.equal(workflow.permissions.contents, "read");

  const knowledgeChecks = steps.filter(
    (step) => step.run === "node scripts/smoke-knowledge-setup.cjs",
  );
  assert.equal(knowledgeChecks.length, 2);
  assert.equal(knowledgeChecks[0].env?.RECALL_TEST_EXECUTABLE, undefined);
  assert.equal(
    knowledgeChecks[1].env?.RECALL_TEST_EXECUTABLE,
    "release/Recall-darwin-arm64/Recall.app/Contents/MacOS/Recall",
  );
});

test("shallow clones cannot report a complete history privacy audit", (t) => {
  const folder = temporary(t);
  const origin = path.join(folder, "origin");
  const clone = path.join(folder, "clone");
  fs.mkdirSync(origin);
  git(origin, ["init", "--quiet"]);
  write(origin, "README.md", "Synthetic source");
  write(origin, "examples/deleted.sqlite3", "Synthetic private artifact");
  commit(origin, "Add synthetic fixture");
  fs.unlinkSync(path.join(origin, "examples/deleted.sqlite3"));
  commit(origin, "Remove synthetic fixture");
  git(folder, ["clone", "--quiet", "--depth", "1", "file://" + origin, clone]);

  const result = runAudit(sourceAudit, clone);
  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Git history: shallow repository; audit incomplete/,
  );
  assert(!result.output.includes("PASS:"));
  assert(!result.output.includes(folder));
});

test("private database, credential and export artifacts fail even with harmless contents", () => {
  for (const name of [
    "examples/recall.sqlite3",
    "examples/recall.sqlite3-wal",
    "examples/library.db",
    "examples/library.db-shm",
    "examples/openai.enc",
    "examples/openai.key",
    "examples/profile-backup.zip",
    "examples/export.tar.gz",
    "examples/auth.json",
    "examples/.credentials.json",
    "examples/backups/snapshot.json",
  ])
    assert(
      inspectFile(name, "synthetic fixture").failures.includes(
        "private artifact type",
      ),
      name,
    );
});

test("renamed SQLite and unsupported binaries cannot hide behind a permitted directory or image suffix", () => {
  const database = Buffer.concat([
    Buffer.from("SQLite format 3"),
    Buffer.from([0]),
    Buffer.alloc(32),
  ]);
  assert(
    inspectFile("examples/snapshot.json", database).failures.includes(
      "SQLite database header",
    ),
  );
  assert(
    inspectFile("docs/images/preview.png", database).failures.includes(
      "SQLite database header",
    ),
  );
  assert(
    inspectFile(
      "examples/payload.bin",
      Buffer.from([0, 255, 1]),
    ).failures.includes("binary type requires explicit review"),
  );
  assert(
    inspectFile("docs/images/preview.png", "plain text").failures.includes(
      "invalid binary asset signature",
    ),
  );
  assert.deepEqual(
    inspectFile(
      "packaging/icon.png",
      fs.readFileSync(path.join(root, "packaging/icon.png")),
    ).failures,
    [],
  );
  assert.deepEqual(
    inspectFile(
      "packaging/icon.icns",
      fs.readFileSync(path.join(root, "packaging/icon.icns")),
    ).failures,
    [],
  );
});

test("provider, chat, JWT, authentication and inline credential shapes are reported without values", () => {
  const samples = [
    fixtureKey(),
    "xoxb-" +
      repeated(12, "1") +
      "-" +
      repeated(12, "2") +
      "-" +
      repeated(24, "a"),
    "eyJ" +
      repeated(12, "a") +
      "." +
      repeated(12, "b") +
      "." +
      repeated(12, "c"),
    "AIza" + repeated(32, "a"),
    "ntn_" + repeated(24, "a"),
    "-----BEGIN " + "ENCRYPTED PRIVATE KEY-----",
    "Authorization: Bearer " + repeated(24, "a"),
    "authorization: bearer " + repeated(24, "a"),
    "api_key = " + JSON.stringify(repeated(24, "a")),
    "password: " + JSON.stringify(repeated(24, "a")),
    "OPENAI_API_KEY=" + repeated(24, "a"),
  ];
  for (const sample of samples) {
    const findings = inspectText(sample);
    assert(findings.includes("possible credential"));
    assert(!JSON.stringify(findings).includes(sample));
  }
  assert.deepEqual(
    inspectText(
      'const token = "dictation-session"; contact: team@example.invalid; OPENAI_API_KEY=<your-key>',
    ),
    [],
  );
});

test("binary asset metadata receives the same credential and path checks", () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const image = Buffer.concat([signature, Buffer.from(fixtureKey())]);
  assert(
    inspectFile("docs/images/fixture.png", image).failures.includes(
      "possible credential",
    ),
  );
  const privatePath = path.join(
    path.sep,
    "Users",
    "synthetic-person",
    "Documents",
  );
  assert(inspectText(privatePath).includes("personal absolute path"));
});

test("source audit fails closed when Git history cannot be read", (t) => {
  const folder = temporary(t);
  fs.mkdirSync(path.join(folder, ".git"));
  write(folder, "README.md", "Synthetic source");
  const result = runAudit(sourceAudit, folder);
  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Git history: revision enumeration failed; audit incomplete/,
  );
  assert(!result.output.includes(folder));
});

test("deleted private database is still rejected from committed history", (t) => {
  const folder = temporary(t);
  git(folder, ["init", "--quiet"]);
  write(folder, "README.md", "Synthetic source");
  write(
    folder,
    "examples/deleted.sqlite3",
    Buffer.concat([Buffer.from("SQLite format 3"), Buffer.from([0])]),
  );
  commit(folder, "Add synthetic fixture");
  fs.unlinkSync(path.join(folder, "examples/deleted.sqlite3"));
  commit(folder, "Remove synthetic fixture");
  const result = runAudit(sourceAudit, folder);
  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /history: "examples\/deleted\.sqlite3": private artifact type/,
  );
  assert.match(
    result.output,
    /history: "examples\/deleted\.sqlite3": SQLite database header/,
  );
});

test("historical filenames are checked even when a private blob is renamed without changing bytes", (t) => {
  const folder = temporary(t);
  git(folder, ["init", "--quiet"]);
  write(folder, "docs/auth.json", "{}");
  commit(folder, "Add synthetic fixture");
  fs.renameSync(
    path.join(folder, "docs/auth.json"),
    path.join(folder, "docs/example.json"),
  );
  commit(folder, "Rename synthetic fixture");
  const result = runAudit(sourceAudit, folder);
  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /history: "docs\/auth\.json": private artifact type/,
  );
});

test("removed non-allowlisted prose cannot pass the committed-history audit", (t) => {
  const folder = temporary(t);
  git(folder, ["init", "--quiet"]);
  write(
    folder,
    "personal-note.md",
    "Synthetic ordinary prose with no secret pattern",
  );
  commit(folder, "Add synthetic fixture");
  fs.mkdirSync(path.join(folder, "docs"));
  fs.renameSync(
    path.join(folder, "personal-note.md"),
    path.join(folder, "docs/example.md"),
  );
  commit(folder, "Move synthetic fixture into approved scope");

  const result = runAudit(sourceAudit, folder);
  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /history: "personal-note\.md": not in release allowlist/,
  );
  assert(!result.output.includes("ordinary prose"));
});

test("excluded generated roots are rejected when staged or historically committed", (t) => {
  const folder = temporary(t);
  git(folder, ["init", "--quiet"]);
  write(folder, "README.md", "Synthetic source");
  write(folder, ".gitignore", "dist/\n");
  commit(folder, "Add synthetic source");
  write(folder, "dist/fixture.json", "{}");
  git(folder, ["add", "--force", "dist/fixture.json"]);

  const staged = runAudit(sourceAudit, folder);
  assert.notEqual(staged.status, 0);
  assert.match(
    staged.output,
    /"dist\/fixture\.json": tracked file in excluded root/,
  );
  commit(folder, "Add synthetic tracked generated fixture");
  fs.unlinkSync(path.join(folder, "dist/fixture.json"));
  commit(folder, "Remove synthetic tracked generated fixture");

  const removed = runAudit(sourceAudit, folder);
  assert.notEqual(removed.status, 0);
  assert.match(
    removed.output,
    /history: "dist\/fixture\.json": not in release allowlist/,
  );
});

test("nested annotated tag messages and sensitive ref names are scanned without values", (t) => {
  const folder = temporary(t),
    secret = fixtureKey();
  git(folder, ["init", "--quiet"]);
  write(folder, "README.md", "Synthetic source");
  commit(folder, "Add synthetic source");
  git(folder, [
    "-c",
    "tag.gpgsign=false",
    "tag",
    "--annotate",
    "inner-fixture",
    "--message",
    "Synthetic credential canary " + secret,
  ]);
  git(folder, [
    "-c",
    "tag.gpgsign=false",
    "tag",
    "--annotate",
    "outer-fixture",
    "inner-fixture",
    "--message",
    "Synthetic nested tag",
  ]);
  git(folder, ["tag", "--delete", "inner-fixture"]);
  git(folder, ["tag", secret]);

  const result = runAudit(sourceAudit, folder);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /2 annotated tags/);
  assert.match(
    result.output,
    /Git metadata: "tag [a-f0-9]+": possible credential/,
  );
  assert.match(
    result.output,
    /Git ref: "\[redacted filename\]": possible credential/,
  );
  assert(!result.output.includes(secret));
  assert(!result.output.includes("Synthetic Contributor"));
  assert(!result.output.includes("fixture@example.invalid"));
  assert(!result.output.includes(folder));
});

test("Git metadata is scanned without publishing identities or matched credential values", (t) => {
  const folder = temporary(t);
  git(folder, ["init", "--quiet"]);
  write(folder, "README.md", "Synthetic source");
  const secret = fixtureKey();
  commit(folder, "Synthetic credential canary " + secret);
  const result = runAudit(sourceAudit, folder);
  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Git metadata: "commit [a-f0-9]+": possible credential/,
  );
  assert.match(result.output, /1 author\/committer identities/);
  assert(!result.output.includes("Synthetic Contributor"));
  assert(!result.output.includes("fixture@example.invalid"));
  assert(!result.output.includes(secret));
});

test("source findings show categories and escaped filenames, never file contents", (t) => {
  const folder = temporary(t),
    secret = fixtureKey();
  write(folder, "docs/fixture\nname.md", secret);
  const result = runAudit(sourceAudit, folder);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /fixture\\nname\.md/);
  assert(!result.output.includes(secret));
});

test("credential-shaped filenames are flagged and redacted from reports", (t) => {
  const folder = temporary(t),
    secret = fixtureKey();
  const name = "docs/" + secret + ".md";
  write(folder, name, "synthetic fixture");
  assert(
    inspectFile(name, "synthetic fixture").failures.includes(
      "possible credential",
    ),
  );
  assert(!displayName(name).includes(secret));
  const result = runAudit(sourceAudit, folder);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /redacted filename/);
  assert(!result.output.includes(secret));
});

test("packaged first-party artifacts use the shared checks and keep errors sanitized", async (t) => {
  const folder = temporary(t),
    source = path.join(folder, "source"),
    archive = path.join(folder, "app.asar");
  write(source, "examples/private.sqlite3", "synthetic snapshot");
  const secret = fixtureKey();
  write(source, "electron/fixture.cjs", secret);
  write(source, "dist/unreviewed.bin", Buffer.from([0, 255]));
  const { createPackage } = await import("@electron/asar");
  await createPackage(source, archive);
  const result = runAudit(packageAudit, archive);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /private\.sqlite3": private artifact type/);
  assert.match(result.output, /fixture\.cjs": possible credential/);
  assert.match(
    result.output,
    /unreviewed\.bin": binary type requires explicit review/,
  );
  assert(!result.output.includes(secret));
  const absent = runAudit(packageAudit, path.join(folder, "missing.asar"));
  assert.notEqual(absent.status, 0);
  assert.match(absent.output, /failed or is incomplete/);
  assert(!absent.output.includes(folder));
});
