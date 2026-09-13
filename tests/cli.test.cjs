const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
test("documented CLI bootstraps KB, imports cards, captures learning, backs up and installs skills", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-cli-")),
    profile = path.join(root, "profile"),
    notes = path.join(root, "notes");
  fs.mkdirSync(notes);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function run(...args) {
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, "../cli/recall.cjs"), "--data", profile, ...args],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  }
  assert.equal(run("init").cards, 0);
  const config = path.join(root, "config.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      timeZone: "UTC",
      captureEnabled: true,
      sources: [{ id: "kb", type: "markdown", root: notes, write: true }],
    }),
  );
  run("config", config, "--apply");
  assert.equal(
    run(
      "kb",
      "save",
      "kb",
      path.join(__dirname, "../examples/knowledge.json"),
      "--apply",
    ).status,
    "saved",
  );
  assert.equal(run("kb", "search", "kb", "weighted").documents.length, 1);
  assert.equal(run("demo", "--apply").inserted, 3);
  assert.equal(run("cards", "search", "weighted").length, 3);
  const capture = path.join(root, "capture.json");
  fs.writeFileSync(
    capture,
    JSON.stringify({
      id: "cli/one",
      sessionId: "cli",
      title: "Weighted mean",
      objective: "Explain weights",
      context: "Course example",
      at: "2026-09-13T12:00:00Z",
      evidence: "discussed",
      cardIds: ["demo:weighted-mean:concept"],
    }),
  );
  assert.equal(run("capture", capture).inserted, true);
  assert.equal(run("capture", capture).inserted, false);
  assert.equal(run("self-test", "prepare").entries, 1);
  assert(fs.existsSync(run("backup", path.join(root, "backup")).backup));
  assert.equal(
    run("skills", "install", path.join(root, "skills"), "--apply").skills
      .length,
    11,
  );
  const refused = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "../cli/recall.cjs"),
      "skills",
      "install",
      path.join(root, "skills"),
      "--apply",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(refused.status, 0);
});
