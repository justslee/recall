const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const files = require("./knowledge-files.cjs"),
  kb = require("../adapters/knowledge.cjs");
const privateFiles = require("./private-files.cjs"),
  { lock } = require("./config.cjs");
const PREFIX = "note-visual~";
const digest = (text) => crypto.createHash("sha256").update(text).digest("hex");
const assetPath = (value) =>
  typeof value === "string" &&
  /^Visuals\/[a-f0-9]{64}\.recall-visual\.json$/.test(value);
function validate(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    Object.keys(value).some(
      (k) => !["schemaVersion", "title", "html"].includes(k),
    ) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 200 ||
    typeof value.html !== "string" ||
    !value.html.trim() ||
    value.html.includes("```") ||
    Buffer.byteLength(JSON.stringify(value) + "\n") > 2_000_000
  )
    throw Error("Invalid note visual asset.");
  require("./bundles.cjs").validateWidgetMarkup(
    "```widget Visual\n" + value.html + "\n```",
  );
  return value;
}
function references(raw, asset) {
  return [...raw.matchAll(/```recall-visual[^\n]*\n([\s\S]*?)```/g)].some(
    (m) => {
      try {
        const r = JSON.parse(m[1]);
        return r && Object.keys(r).length === 1 && r.asset === asset;
      } catch {
        return false;
      }
    },
  );
}
function read(folder, input) {
  if (!input || !assetPath(input.asset))
    throw Error("Invalid note visual reference.");
  const note = files.readNote(folder, input.sourceId, input.path);
  if (note.format !== "markdown" || !references(note.raw, input.asset))
    throw Error("This note no longer references the visual.");
  const source = kb.source(folder, input.sourceId);
  const raw = privateFiles.read(
    files.checkedPath(source, input.asset),
    2_000_000,
  );
  const hash = digest(raw);
  if (input.asset !== "Visuals/" + hash + ".recall-visual.json")
    throw Error("The note visual changed.");
  const asset = validate(JSON.parse(raw));
  const identity = [input.sourceId, input.path, input.asset];
  const id =
    PREFIX + Buffer.from(JSON.stringify(identity)).toString("base64url");
  const permission = path.join(
    folder,
    "knowledge",
    "visual-permissions",
    digest(JSON.stringify(identity)) + ".json",
  );
  let allowed = false;
  if (fs.existsSync(permission)) {
    const saved = JSON.parse(privateFiles.read(permission, 4096));
    allowed = saved.allowed === true && saved.digest === hash;
  }
  return {
    asset,
    id,
    digest: hash,
    noteRevision: note.revision,
    allowed,
    permission,
  };
}
function inspect(folder, input) {
  const value = read(folder, input);
  return {
    id: value.id,
    title: value.asset.title,
    digest: value.digest,
    noteRevision: value.noteRevision,
    allowed: value.allowed,
  };
}
function setPermission(folder, input) {
  if (typeof input?.allowed !== "boolean")
    throw Error("Invalid visual permission.");
  const release = lock(path.join(folder, "knowledge"));
  try {
    const value = read(folder, input);
    if (
      value.digest !== input.expectedDigest ||
      value.noteRevision !== input.expectedNoteRevision
    )
      throw Error("The note or visual changed. Reopen it before enabling.");
    privateFiles.atomicText(
      value.permission,
      JSON.stringify({ digest: value.digest, allowed: input.allowed }) + "\n",
    );
    return inspect(folder, input);
  } finally {
    release();
  }
}
function response(folder, id, index) {
  if (!id.startsWith(PREFIX) || id.length > 12000 || index !== "0")
    throw Error("Invalid note visual request.");
  const encoded = id.slice(PREFIX.length);
  const parts = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (
    !Array.isArray(parts) ||
    parts.length !== 3 ||
    parts.some((p) => typeof p !== "string")
  )
    throw Error("Invalid note visual identity.");
  const value = read(folder, {
    sourceId: parts[0],
    path: parts[1],
    asset: parts[2],
  });
  if (id !== value.id) throw Error("Invalid note visual identity.");
  return { allowed: value.allowed, widget: value.asset };
}
function previewAsset(folder, sourceId, asset) {
  validate(asset);
  const source = kb.source(folder, sourceId);
  if (!source.write || !["markdown", "obsidian"].includes(source.type))
    throw Error("This knowledge source is read-only.");
  const raw = JSON.stringify(asset) + "\n",
    hash = digest(raw),
    relative = "Visuals/" + hash + ".recall-visual.json";
  return { asset: relative, digest: hash, bytes: Buffer.byteLength(raw) };
}
function saveAsset(folder, sourceId, asset) {
  const preview = previewAsset(folder, sourceId, asset),
    source = kb.source(folder, sourceId),
    raw = JSON.stringify(asset) + "\n",
    hash = preview.digest,
    relative = preview.asset;
  const release = lock(path.join(folder, "knowledge"));
  try {
    const directory = files.checkedPath(source, "Visuals", false);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    const destination = files.checkedPath(source, relative, false);
    if (fs.existsSync(destination)) {
      if (privateFiles.read(destination, 2_000_000) !== raw)
        throw Error("An existing visual conflicts with this asset.");
    } else {
      const fd = fs.openSync(
        destination,
        fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_WRONLY |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      try {
        fs.writeFileSync(fd, raw);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const parent = fs.openSync(directory, "r");
      try {
        fs.fsyncSync(parent);
      } finally {
        fs.closeSync(parent);
      }
    }
    return { asset: relative, digest: hash };
  } finally {
    release();
  }
}
module.exports = {
  PREFIX,
  assetPath,
  validate,
  inspect,
  setPermission,
  response,
  saveAsset,
  previewAsset,
};
