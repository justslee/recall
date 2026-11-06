// Local files are the source of truth. The search database is disposable.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const YAML = require("yaml");
const kb = require("../adapters/knowledge.cjs");
const { atomic, lock, config, saveConfig } = require("./config.cjs");
const privateFiles = require("./private-files.cjs");
const MAX_BYTES = 2 * 1024 * 1024;
const supported = (p) => /\.(md|markdown|html?)$/i.test(p);
const strings = (value) =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .filter((x) => typeof x === "string")
    .slice(0, 200);

function checkedPath(source, relative, exists = true) {
  if (
    typeof relative !== "string" ||
    !relative ||
    relative.length > 4096 ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((x) => !x || x.startsWith("."))
  )
    throw Error("Choose a note inside this knowledge folder.");

  const file = kb.scoped(source, relative, exists);
  let current = fs.realpathSync(source.root);
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw Error("Symbolic links are not opened or edited.");
  }
  return file;
}

function identityPath(folder, sourceId, relative) {
  return path.join(
    folder,
    "knowledge",
    "file-identities",
    kb.digest([sourceId, relative]) + ".json",
  );
}
function identity(folder, sourceId, relative) {
  const file = identityPath(folder, sourceId, relative);
  return fs.existsSync(file)
    ? JSON.parse(privateFiles.read(file, 4096)).id
    : null;
}
function describe(source, relative, raw, stat = {}, retainedId) {
  const format = /\.html?$/i.test(relative) ? "html" : "markdown";
  const { meta, body } =
    format === "html" ? { meta: {}, body: raw } : kb.parse(raw);
  const record =
    meta.recall && typeof meta.recall === "object" ? meta.recall : {};
  const id =
    record.id ||
    meta.recall_id ||
    meta.canonicalId ||
    (meta.notion_id
      ? `notion:${String(meta.notion_id).replaceAll("-", "").toLowerCase()}`
      : retainedId ||
        `file:${kb.digest(source.id + "/" + relative).slice(0, 32)}`);
  const title =
    meta.title ||
    record.title ||
    (format === "html"
      ? body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
        body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      : body.match(/^#\s+(.+)$/m)?.[1]) ||
    path.basename(relative, path.extname(relative));
  const plain = body
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot);/g, " ");
  return {
    sourceId: source.id,
    path: relative,
    id: String(id),
    title: String(title)
      .replace(/<[^>]+>/g, "")
      .slice(0, 400),
    format,
    revision: kb.digest(raw),
    body,
    text: plain,
    aliases: strings(record.aliases || meta.aliases),
    topics: strings(record.topics || meta.tags),
    cardIds: strings(record.cardIds),
    conceptIds: strings(record.conceptIds),
    references: strings(record.sources).concat(strings(meta.notion_url)),
    links: [
      ...body.matchAll(
        /(?<!!)\[\[([^\]|#]+)(?:[^\]]*)\]\]|(?<!!)\[[^\]]*\]\(([^\s)#]+)[^)]*\)/g,
      ),
    ]
      .map((m) => m[1] || m[2])
      .slice(0, 200),
    modified: stat.mtimeMs || 0,
    size: stat.size || Buffer.byteLength(raw),
  };
}

function readNote(folder, sourceId, relative) {
  const source = kb.source(folder, sourceId);
  if (!["markdown", "obsidian"].includes(source.type) || !supported(relative))
    throw Error("Choose a local Markdown or HTML note.");

  const file = checkedPath(source, relative);
  const raw = privateFiles.read(file, MAX_BYTES);
  return {
    ...describe(
      source,
      relative,
      raw,
      fs.statSync(file),
      identity(folder, sourceId, relative),
    ),
    raw,
    writable: !!source.write,
  };
}

function draftPath(folder, sourceId, relative) {
  return path.join(
    folder,
    "knowledge",
    "drafts",
    kb.digest([sourceId, relative]) + ".json",
  );
}

function draft(folder, input) {
  const { sourceId, path: relative, raw, revision } = input;
  const source = kb.source(folder, sourceId);
  checkedPath(source, relative, false);
  if (!supported(relative)) throw Error("Unsupported note format.");

  const file = draftPath(folder, sourceId, relative);
  if (raw === undefined)
    return fs.existsSync(file)
      ? JSON.parse(privateFiles.read(file, MAX_BYTES * 7))
      : null;
  if (
    typeof raw !== "string" ||
    Buffer.byteLength(raw) > MAX_BYTES ||
    typeof revision !== "string"
  )
    throw Error("Invalid note draft.");

  try {
    const disk = readNote(folder, sourceId, relative);
    if (disk.raw === raw && disk.revision === revision) {
      fs.rmSync(file, { force: true });
      return { status: "unchanged" };
    }
  } catch {
    /* A moved or unavailable source must not prevent draft recovery. */
  }

  atomic(file, {
    sourceId,
    path: relative,
    raw,
    revision,
    savedAt: new Date().toISOString(),
  });
  return { status: "draft-saved" };
}

function saveNote(folder, input) {
  const { sourceId, path: relative, raw, revision } = input;
  const source = kb.source(folder, sourceId);
  if (!source.write)
    throw Error(
      "This folder is read-only. Enable authoring in Connections to edit it.",
    );
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_BYTES)
    throw Error("Notes must be at most 2 MB.");
  if (!supported(relative)) throw Error("Use Markdown or HTML.");
  if (!/\.html?$/i.test(relative)) kb.parse(raw);

  const release = lock(path.join(folder, "knowledge"));
  try {
    const file = checkedPath(source, relative, !input.create);
    const exists = fs.existsSync(file);
    if (input.create && exists)
      throw Error("A note with this name already exists.");
    if (!input.create && !exists)
      throw Error("This note moved or was deleted. Your draft is kept.");

    const old = exists ? privateFiles.read(file, MAX_BYTES) : "";
    if (exists && kb.digest(old) !== revision)
      throw Error(
        "This file changed in another editor. Your draft is kept. Compare with the file before saving.",
      );
    if (exists && old === raw) {
      fs.rmSync(draftPath(folder, sourceId, relative), { force: true });
      return readNote(folder, sourceId, relative);
    }

    if (exists) {
      const backup = path.join(
        folder,
        "knowledge",
        "backups",
        kb.digest(sourceId).slice(0, 24),
        `${Date.now()}-${crypto.randomUUID()}${path.extname(file)}`,
      );
      privateFiles.write(backup, old);
    }
    // No directory creation here: the chosen parent must already exist.
    const temp = path.join(
      path.dirname(file),
      "." + crypto.randomUUID() + ".tmp",
    );
    const fd = fs.openSync(
      temp,
      "wx",
      exists ? fs.statSync(file).mode & 0o777 : 0o600,
    );
    try {
      fs.writeFileSync(fd, raw);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      checkedPath(source, relative, exists);
      if (exists) {
        if (kb.digest(privateFiles.read(file, MAX_BYTES)) !== revision)
          throw Error("File changed during saving. Your draft is kept.");
        fs.renameSync(temp, file);
      } else fs.linkSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    fs.rmSync(draftPath(folder, sourceId, relative), { force: true });
    return readNote(folder, sourceId, relative);
  } finally {
    release();
  }
}

function createNote(
  folder,
  { sourceId, directory = "", title = "Untitled note" },
) {
  if (typeof title !== "string" || title.length > 200 || !title.trim())
    throw Error("Give the note a title.");

  const slug =
    title
      .trim()
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 100) || "Untitled note";
  const id = `note:${crypto.randomUUID()}`;
  const source = kb.source(folder, sourceId);
  let relative = (directory ? directory + "/" : "") + slug + ".md";
  if (fs.existsSync(checkedPath(source, relative, false)))
    relative =
      relative.slice(0, -3) + "-" + crypto.randomUUID().slice(0, 8) + ".md";
  const raw =
    "---\n" +
    YAML.stringify({
      recall: { id },
      title: title.trim(),
      aliases: [],
      tags: [],
    }) +
    "---\n\n# " +
    title.trim() +
    "\n\n";
  return saveNote(folder, { sourceId, path: relative, raw, create: true });
}

function moveNote(folder, input) {
  const source = kb.source(folder, input.sourceId);
  if (!source.write) throw Error("This folder is read-only.");
  if (!supported(input.to)) throw Error("Keep a Markdown or HTML extension.");
  const release = lock(path.join(folder, "knowledge"));
  try {
    const before = readNote(folder, input.sourceId, input.path);
    if (before.revision !== input.revision)
      throw Error("The note changed. Reload it before moving.");
    if (draft(folder, { sourceId: input.sourceId, path: input.path }))
      throw Error("Save or discard your draft before moving the note.");
    const from = checkedPath(source, input.path),
      to = checkedPath(source, input.to, false);
    // Exclusive creation prevents overwriting another note on a naming conflict.
    fs.linkSync(from, to);
    try {
      atomic(identityPath(folder, source.id, input.to), { id: before.id });
      fs.unlinkSync(from);
    } catch (e) {
      fs.unlinkSync(to);
      throw e;
    }
    return readNote(folder, input.sourceId, input.to);
  } finally {
    release();
  }
}

function createSpace(folder, target) {
  if (typeof target !== "string" || !path.isAbsolute(target))
    throw Error("Choose a folder location.");
  const parent = fs.realpathSync(path.dirname(target));
  const root = path.join(parent, path.basename(target));
  if (
    root.startsWith(path.resolve(folder) + path.sep) ||
    root === path.resolve(folder)
  )
    throw Error("Choose a folder outside Recall’s private profile.");
  fs.mkdirSync(root, { mode: 0o700 }); // Explicitly never adopt an existing directory.
  const source = {
    id: `kb:${crypto.randomUUID()}`,
    name: path.basename(root),
    type: "markdown",
    root,
    write: true,
  };
  try {
    saveConfig(folder, { sources: [...config(folder).sources, source] });
  } catch (e) {
    fs.rmdirSync(root);
    throw e;
  }
  return source;
}

module.exports = {
  supported,
  checkedPath,
  describe,
  readNote,
  saveNote,
  createNote,
  moveNote,
  createSpace,
  draft,
  draftPath,
  identity,
  strings,
  MAX_BYTES,
};
