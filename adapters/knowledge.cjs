const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  YAML = require("yaml");
const { config, atomic } = require("../electron/config.cjs");
const digest = (x) =>
  crypto
    .createHash("sha256")
    .update(typeof x === "string" ? x : JSON.stringify(x))
    .digest("hex");
const key = (x) => digest(x).slice(0, 24);
function source(folder, id) {
  const s = config(folder).sources.find((s) => s.id === id);
  if (!s) throw Error("Unknown configured source");
  return s;
}
function scoped(s, relative, exists = true) {
  if (!s.root) throw Error("Source has no local root");
  const root = fs.realpathSync(s.root),
    file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep))
    throw Error("Path escapes selected source");
  const ancestor = exists ? file : path.dirname(file);
  let check = ancestor;
  while (!fs.existsSync(check)) check = path.dirname(check);
  const real = fs.realpathSync(check);
  if (real !== root && !real.startsWith(root + path.sep))
    throw Error("Symlink escapes source");
  return file;
}
function parse(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const doc = YAML.parseDocument(m?.[1] || "");
  if (doc.errors.length) throw Error("Invalid note frontmatter");
  const meta = doc.toJSON() || {};
  if (typeof meta !== "object" || Array.isArray(meta))
    throw Error("Frontmatter must be a mapping");
  return { doc, meta, body: text.slice(m?.[0].length || 0) };
}
function normalize(s, relative, text, index) {
  const { meta, body } = parse(text),
    revision = digest(text),
    known = index.find((n) => n.path === relative),
    renamed = index.filter((n) => n.revision === revision);
  const id =
    meta.recall?.id ||
    meta.recall_id ||
    meta.canonicalId ||
    known?.id ||
    (renamed.length === 1
      ? renamed[0].id
      : `note:${key(s.id + ":" + relative)}`);
  const record = meta.recall || {};
  return {
    id,
    sourceId: s.id,
    provider: s.type,
    path: relative,
    revision,
    title:
      meta.title ||
      record.title ||
      body.match(/^#\s+(.+)$/m)?.[1] ||
      path.basename(relative, ".md"),
    aliases: record.aliases || meta.aliases || [],
    topics: record.topics || meta.tags || [],
    body,
    sourceReferences: record.sources || [],
    related: record.related || [],
    assets: [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)|!\[\[([^\]]+)\]\]/g)].map(
      (m) => (m[1] || m[2]).split("|")[0],
    ),
    links: [...body.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g)].map(
      (m) => m[1].split("|")[0],
    ),
  };
}
function indexFile(folder, id) {
  return path.join(folder, "knowledge", "indexes", key(id) + ".json");
}
function scan(folder, id) {
  const s = source(folder, id);
  if (s.type === "notion") return notionDocuments(folder, id);
  const indexPath = indexFile(folder, id),
    old = fs.existsSync(indexPath)
      ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
      : [],
    docs = [],
    issues = [];
  function walk(relative = "") {
    for (const item of fs.readdirSync(scoped(s, relative || ".")).sort()) {
      if (item.startsWith(".")) continue;
      const rel = path.join(relative, item),
        file = scoped(s, rel),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        issues.push({ path: rel, reason: "Symlink skipped" });
        continue;
      }
      if (stat.isDirectory()) walk(rel);
      else if (item.endsWith(".md")) {
        try {
          if (stat.size > 2 * 1024 * 1024) throw Error("Note exceeds 2 MB");
          docs.push(normalize(s, rel, fs.readFileSync(file, "utf8"), old));
        } catch (e) {
          issues.push({ path: rel, reason: e.message });
        }
      }
    }
  }
  walk();
  atomic(
    indexPath,
    docs.map(({ id, path, revision }) => ({ id, path, revision })),
  );
  return { documents: docs, issues };
}
function search(folder, id, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean),
    result = scan(folder, id);
  return {
    ...result,
    documents: result.documents.filter((n) =>
      terms.every((t) =>
        `${n.title} ${JSON.stringify(n.aliases)} ${n.body}`
          .toLowerCase()
          .includes(t),
      ),
    ),
  };
}
function validRecord(record) {
  require("../shared/contracts.cjs").validate("KnowledgeRecord", record);
  for (const k of ["id", "title", "body"])
    if (typeof record[k] !== "string" || !record[k].trim())
      throw Error(k + " required");
  if (record.body.includes("<!-- recall:"))
    throw Error("Reserved marker in body");
  for (const k of ["aliases", "topics", "related", "sources"])
    if (record[k] !== undefined && !Array.isArray(record[k]))
      throw Error(k + " must be an array");
  return record;
}
function save(folder, id, input, { apply = false, expectedRevision } = {}) {
  const s = source(folder, id);
  if (!s.write)
    throw Error(
      "Source is read-only; enable scoped authoring in configuration",
    );
  if (s.type === "notion")
    return requestNotion(folder, id, input, { apply, expectedRevision });
  const record = validRecord(input),
    { documents, issues } = scan(folder, id);
  if (issues.length)
    throw Error(
      "Resolve unreadable source notes before authoring to avoid duplicates",
    );
  const same = documents.filter((n) => n.id === record.id);
  if (same.length > 1)
    throw Error("Duplicate canonical IDs require reconciliation");
  const existing = same[0];
  const aliases = [record.title, ...(record.aliases || [])].map((x) =>
    x.toLowerCase().trim(),
  );
  if (
    !existing &&
    documents.some((n) =>
      [n.title, ...(Array.isArray(n.aliases) ? n.aliases : [n.aliases])].some(
        (x) => aliases.includes(String(x).toLowerCase().trim()),
      ),
    )
  )
    throw Error("Matching title/alias exists; inspect and reuse its ID");
  const relative =
    existing?.path ||
    `${
      record.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 70) || "concept"
    }-${key(record.id).slice(0, 8)}.md`;
  const file = scoped(s, relative, !!existing),
    old = existing ? fs.readFileSync(file, "utf8") : "",
    parsed = parse(old);
  const start = "<!-- recall:begin -->",
    end = "<!-- recall:end -->",
    block = start + "\n" + record.body.trim() + "\n" + end;
  if (parsed.body.includes(start) !== parsed.body.includes(end))
    throw Error("Malformed managed block; repair before updating");
  const body = parsed.body.includes(start)
    ? parsed.body.replace(
        /<!-- recall:begin -->[\s\S]*?<!-- recall:end -->/,
        () => block,
      )
    : parsed.body.trimEnd() + (parsed.body.trim() ? "\n\n" : "") + block + "\n";
  parsed.doc.set("recall", {
    id: record.id,
    title: record.title,
    aliases: record.aliases || [],
    topics: record.topics || [],
    related: record.related || [],
    sources: record.sources || [],
  });
  const next = "---\n" + parsed.doc.toString() + "---\n" + body;
  if (next === old)
    return {
      status: "unchanged",
      id: record.id,
      path: relative,
      revision: digest(old),
    };
  if (existing && expectedRevision !== existing.revision)
    throw Error("Revision conflict; read the note again before updating");
  const report = {
    status: apply ? "saved" : "preview",
    id: record.id,
    path: relative,
    before: old,
    after: next,
    revision: digest(next),
  };
  if (!apply) return report;
  const release = require("../electron/config.cjs").lock(
    path.join(folder, "knowledge"),
  );
  try {
    if (!existing) {
      const latest = scan(folder, id).documents;
      if (
        latest.some(
          (n) =>
            n.id === record.id ||
            [
              n.title,
              ...(Array.isArray(n.aliases) ? n.aliases : [n.aliases]),
            ].some((x) => aliases.includes(String(x).toLowerCase().trim())),
        )
      )
        throw Error(
          "Concept appeared during authoring; read and reconcile before retrying",
        );
    }
    if (existing && digest(fs.readFileSync(file, "utf8")) !== expectedRevision)
      throw Error("Note changed since preview");
    if (existing) {
      const backup = path.join(
        folder,
        "knowledge",
        "backups",
        key(id),
        Date.now() + "-" + crypto.randomUUID() + ".md",
      );
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, old);
      report.backup = backup;
    }
    const temp = file + "." + crypto.randomUUID() + ".tmp";
    fs.writeFileSync(temp, next, { flag: "wx" });
    if (existing) fs.renameSync(temp, file);
    else {
      try {
        fs.linkSync(temp, file);
      } finally {
        fs.unlinkSync(temp);
      }
    }
    scan(folder, id);
    return report;
  } finally {
    release();
  }
}
function asset(folder, id, notePath, reference) {
  const s = source(folder, id);
  if (s.type === "notion")
    throw Error("Notion assets must be explicitly exported to a local source");
  if (/^(?:[a-z]+:|\/)/i.test(reference))
    throw Error("Only local relative assets are supported");
  const file = scoped(
      s,
      path.join(path.dirname(notePath), decodeURIComponent(reference)),
    ),
    ext = path.extname(file).toLowerCase(),
    mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    }[ext];
  if (!mime || fs.statSync(file).size > 12 * 1024 * 1024)
    throw Error("Use PNG, JPEG or WebP up to 12 MB");
  return {
    mime,
    dataUri: `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`,
  };
}
function notionDocuments(folder, id) {
  const dir = path.join(folder, "knowledge", "notion", key(id)),
    documents = [];
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")))
      documents.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  return { documents, issues: [] };
}
function ingestNotion(folder, id, items) {
  const s = source(folder, id);
  if (s.type !== "notion") throw Error("Not a Notion source");
  if (!Array.isArray(items)) throw Error("Expected fetched document array");
  const docs = items.map((n) => {
    if (
      n.scopeId !== s.scopeId ||
      !n.id ||
      !n.revision ||
      typeof n.body !== "string" ||
      !n.title
    )
      throw Error(
        "Notion document missing scoped identity, title, body or revision",
      );
    return {
      ...n,
      provider: "notion",
      sourceId: id,
      id: n.canonicalId || `notion:${n.id}`,
      remoteId: n.id,
    };
  });
  for (const n of docs)
    atomic(
      path.join(folder, "knowledge", "notion", key(id), key(n.id) + ".json"),
      n,
    );
  return { ingested: docs.length };
}
function requestNotion(
  folder,
  id,
  input,
  { apply = false, expectedRevision } = {},
) {
  const s = source(folder, id),
    record = validRecord(input),
    docs = notionDocuments(folder, id).documents,
    existing = docs.find((d) => d.id === record.id);
  if (existing && existing.revision !== expectedRevision)
    throw Error("Revision conflict");
  if (
    !existing &&
    docs.some((d) => d.title.toLowerCase() === record.title.toLowerCase())
  )
    throw Error("Existing title; inspect it before creating");
  const request = {
    version: 1,
    sourceId: id,
    scopeId: s.scopeId,
    record,
    operation: existing ? "update" : "create",
    remoteId: existing?.remoteId,
    expectedRevision,
    propertyMap: s.propertyMap || { title: "Name" },
    status: "pending",
  };
  request.id = key(request);
  if (apply)
    atomic(
      path.join(folder, "knowledge", "outbox", request.id + ".json"),
      request,
    );
  return request;
}
function acknowledge(folder, requestId, document) {
  if (!/^[a-f0-9]{24}$/.test(requestId)) throw Error("Invalid receipt ID");
  const file = path.join(folder, "knowledge", "outbox", requestId + ".json"),
    r = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    document.scopeId !== r.scopeId ||
    document.canonicalId !== r.record.id ||
    document.title !== r.record.title ||
    document.body !== r.record.body ||
    !document.revision
  )
    throw Error("Fetched result does not match requested content");
  if (r.remoteId && r.remoteId !== document.id)
    throw Error("Wrong remote page");
  ingestNotion(folder, r.sourceId, [document]);
  atomic(file, {
    ...r,
    status: "verified",
    remoteId: document.id,
    revision: document.revision,
  });
  return { status: "verified", id: requestId };
}
module.exports = {
  source,
  scoped,
  parse,
  scan,
  search,
  save,
  asset,
  ingestNotion,
  acknowledge,
  digest,
  validRecord,
};
