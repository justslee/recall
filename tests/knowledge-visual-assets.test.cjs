const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const v = require("../electron/knowledge-visual-assets.cjs"),
  { saveConfig } = require("../electron/config.cjs");
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-note-assets-"));
  const root = path.join(folder, "notes");
  fs.mkdirSync(root);
  saveConfig(folder, {
    sources: [
      { id: "notes", type: "markdown", name: "Notes", root, write: true },
    ],
  });
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return { folder, root };
}
const asset = {
  schemaVersion: 1,
  title: "A bounded queue",
  html: '<button id="step">Step</button><output>0</output><script>document.querySelector("#step").onclick=()=>document.querySelector("output").textContent="1";</script>',
};
function note(root, name, reference) {
  fs.writeFileSync(
    path.join(root, name),
    "# Queue\n\n```recall-visual\n" + JSON.stringify(reference) + "\n```",
  );
}
test("Note assets require an exact referenced content hash and separate permission, without a card", (t) => {
  const { folder, root } = fixture(t),
    saved = v.saveAsset(folder, "notes", asset),
    input = { sourceId: "notes", path: "Queue.md", asset: saved.asset };
  note(root, input.path, { asset: input.asset });
  note(root, "Other.md", { asset: input.asset });
  const view = v.inspect(folder, input);
  assert.equal(view.allowed, false);
  assert.equal(v.response(folder, view.id, "0").allowed, false);
  assert.throws(
    () =>
      v.setPermission(folder, {
        ...input,
        allowed: true,
        expectedDigest: view.digest,
        expectedNoteRevision: "stale",
      }),
    /changed/,
  );
  v.setPermission(folder, {
    ...input,
    allowed: true,
    expectedDigest: view.digest,
    expectedNoteRevision: view.noteRevision,
  });
  assert.equal(v.response(folder, view.id, "0").allowed, true);
  assert.equal(
    v.inspect(folder, { ...input, path: "Other.md" }).allowed,
    false,
  );
  assert.equal(fs.existsSync(path.join(folder, "recall.sqlite")), false);
  assert.deepEqual(v.saveAsset(folder, "notes", asset), saved);
  fs.writeFileSync(
    path.join(root, input.asset),
    JSON.stringify({ ...asset, html: "<p>Changed</p>" }),
  );
  assert.throws(() => v.response(folder, view.id, "0"), /changed/);
});
test("Unreferenced, missing, malformed and out-of-scope assets fail closed", (t) => {
  const { folder, root } = fixture(t),
    saved = v.saveAsset(folder, "notes", asset),
    input = { sourceId: "notes", path: "Queue.md", asset: saved.asset };
  note(root, input.path, { asset: input.asset });
  const view = v.inspect(folder, input);
  assert.throws(() => v.response(folder, view.id, "1"), /Invalid/);
  assert.throws(
    () =>
      v.response(
        folder,
        v.PREFIX +
          Buffer.from(
            JSON.stringify(["notes", "Queue.md", "../secret"]),
          ).toString("base64url"),
        "0",
      ),
    /Invalid/,
  );
  assert.throws(
    () => v.inspect(folder, { ...input, asset: "/etc/passwd" }),
    /Invalid/,
  );
  fs.writeFileSync(path.join(root, input.path), "# Queue\nOriginal prose");
  assert.throws(() => v.response(folder, view.id, "0"), /no longer references/);
  note(root, input.path, { asset: input.asset });
  fs.unlinkSync(path.join(root, input.asset));
  fs.symlinkSync(path.join(root, "Queue.md"), path.join(root, input.asset));
  assert.throws(() => v.inspect(folder, input), /Symbolic|scope|link/);
  assert.throws(() => v.validate({ ...asset, extra: true }), /Invalid/);
  assert.throws(() => v.validate({ ...asset, html: "```" }), /Invalid/);
});
test("Source authoring permission and the asset directory cannot be bypassed", (t) => {
  const { folder, root } = fixture(t);
  saveConfig(folder, {
    sources: [
      { id: "notes", type: "markdown", name: "Notes", root, write: false },
    ],
  });
  assert.throws(() => v.saveAsset(folder, "notes", asset), /read-only/);
  saveConfig(folder, {
    sources: [
      { id: "notes", type: "markdown", name: "Notes", root, write: true },
    ],
  });
  const outside = path.join(folder, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, "Visuals"));
  assert.throws(
    () => v.saveAsset(folder, "notes", asset),
    /Symbolic|scope|link/,
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("Preview has no side effects; changed references and explicit revocation deny loading", (t) => {
  const { folder, root } = fixture(t);
  const preview = v.previewAsset(folder, "notes", asset);
  assert.deepEqual(fs.readdirSync(root), []);
  const saved = v.saveAsset(folder, "notes", asset);
  assert.equal(saved.asset, preview.asset);
  const input = { sourceId: "notes", path: "Queue.md", asset: saved.asset };
  note(root, input.path, { asset: saved.asset });
  const view = v.inspect(folder, input);
  const permission = {
    ...input,
    expectedDigest: view.digest,
    expectedNoteRevision: view.noteRevision,
  };
  v.setPermission(folder, { ...permission, allowed: true });
  assert.equal(v.response(folder, view.id, "0").allowed, true);
  v.setPermission(folder, { ...permission, allowed: false });
  assert.equal(v.response(folder, view.id, "0").allowed, false);
  assert.throws(
    () => v.validate({ ...asset, html: "<script>const = ;</script>" }),
    /syntax|Unexpected|Invalid/i,
  );
  assert.throws(
    () => v.validate({ ...asset, html: "x".repeat(2_000_000) }),
    /Invalid/,
  );
});
