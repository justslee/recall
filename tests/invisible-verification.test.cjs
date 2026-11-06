const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createProfile, enabled } = require("../electron/verification-mode.cjs");
const { indexFor } = require("../electron/learning-context.cjs");
test("invisible mode refuses unmarked profiles and symlink aliases", (t) => {
  const folder = createProfile();
  const alias = path.join(os.tmpdir(), "recall-verify-link-" + Date.now());
  t.after(() => {
    fs.rmSync(folder, { force: true, recursive: true });
    fs.rmSync(alias, { force: true });
  });
  assert.equal(enabled({}), false);
  assert.throws(() => enabled({ RECALL_VERIFY: "1" }));
  assert.equal(enabled({ RECALL_VERIFY: "1", RECALL_DATA_DIR: folder }), true);
  fs.symlinkSync(folder, alias);
  assert.throws(() => enabled({ RECALL_VERIFY: "1", RECALL_DATA_DIR: alias }));
  fs.unlinkSync(path.join(folder, ".recall-verification-profile"));
  assert.throws(() => enabled({ RECALL_VERIFY: "1", RECALL_DATA_DIR: folder }));
});
test("search index reuses unchanged entries, invalidates edited/suspended cards and excludes widget code", () => {
  const c = {
    id: "a",
    status: "ready",
    title: "Duration gap",
    answer:
      "Bond duration.\n```widget Demo\n<script>maliciouskeyword</script>\n```",
  };
  const first = indexFor("fixture", [c]).get(c.id);
  assert(!first.secondary.has("maliciouskeyword"));
  assert.equal(indexFor("fixture", [{ ...c }]).get(c.id), first);
  assert.notEqual(
    indexFor("fixture", [{ ...c, answer: "Changed" }]).get(c.id),
    first,
  );
  assert.equal(indexFor("fixture", [{ ...c, suspended: true }]).size, 0);
});
