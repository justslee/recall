// Explicit, widget-only revisions. Card identity, prose, permissions and learning
// records cannot be changed by this request contract.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const files = require("./private-files.cjs"),
  { stable } = require("./catalog.cjs");
const root = (folder) => path.join(folder, "card-revisions");
const hash = (value) =>
  crypto.createHash("sha256").update(stable(value)).digest("hex");
const fence = () => /```widget[^\S\n]*([^\n]*)\r?\n([\s\S]*?)```/g;
function request(raw) {
  if (
    raw?.schemaVersion !== 1 ||
    !Array.isArray(raw.cards) ||
    !raw.cards.length ||
    raw.cards.length > 20 ||
    Object.keys(raw).some((k) => !["schemaVersion", "cards"].includes(k))
  )
    throw Error("Expected a version 1 widget revision with 1–20 cards");
  const seen = new Set();
  for (const c of raw.cards) {
    if (
      !c ||
      Object.keys(c).some(
        (k) =>
          !["id", "expectedContentHash", "widgetIndex", "widget"].includes(k),
      ) ||
      typeof c.id !== "string" ||
      !c.id ||
      seen.has(c.id) ||
      !/^[a-f0-9]{64}$/.test(c.expectedContentHash || "") ||
      !Number.isSafeInteger(c.widgetIndex) ||
      c.widgetIndex < 0 ||
      typeof c.widget?.html !== "string" ||
      !c.widget.html.trim() ||
      typeof c.widget?.title !== "string" ||
      !c.widget.title.trim() ||
      /[\r\n]|```/.test(c.widget.title) ||
      c.widget.html.includes("```") ||
      Object.keys(c.widget).some((k) => !["title", "html"].includes(k))
    )
      throw Error("Invalid widget revision or duplicate card ID");
    seen.add(c.id);
  }
  if (Buffer.byteLength(JSON.stringify(raw)) > 5_000_000)
    throw Error("Widget revision exceeds 5 MB");
  return raw;
}
function plan(store, raw) {
  request(raw);
  return raw.cards.map((edit) => {
    const row = store.db
      .prepare("SELECT content FROM cards WHERE id=?")
      .get(edit.id);
    if (!row) throw Error("Card not found: " + edit.id);
    const card = JSON.parse(row.content);
    if (
      card.id !== edit.id ||
      typeof card.answer !== "string" ||
      (card.revision !== undefined &&
        (!Number.isSafeInteger(card.revision) ||
          card.revision < 0 ||
          card.revision >= Number.MAX_SAFE_INTEGER))
    )
      throw Error("Unsupported stored card identity or revision");
    if (hash(card) !== edit.expectedContentHash)
      throw Error("Card changed; preview a fresh revision: " + edit.id);
    const matches = [...card.answer.matchAll(fence())],
      match = matches[edit.widgetIndex];
    if (!match) throw Error("Widget not found: " + edit.id);
    const replacement =
      "```widget " + edit.widget.title + "\n" + edit.widget.html + "\n```";
    const answer =
      card.answer.slice(0, match.index) +
      replacement +
      card.answer.slice(match.index + match[0].length);
    const next = { ...card, answer, revision: (card.revision || 0) + 1 };
    // This narrow operation cannot repair unrelated legacy metadata (for
    // example an old card with an empty optional prompt). Validate the new
    // executable markup using the same check as new imports, and preserve all
    // other fields byte-for-byte semantically instead of normalizing them.
    require("./bundles.cjs").validateWidgetMarkup(replacement);
    return { id: card.id, previous: row.content, next };
  });
}
function preview(store, raw) {
  const edits = plan(store, raw);
  return {
    mode: "preview",
    requestId: hash(raw),
    cards: edits.map((e) => ({ id: e.id, revision: e.next.revision })),
    scope: "widget-only",
  };
}
function status(folder, id) {
  if (!/^[a-f0-9]{64}$/.test(id || ""))
    throw Error("Invalid revision request ID");
  const dir = root(folder),
    stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Unsafe private directory");
  const item = JSON.parse(files.read(path.join(dir, id + ".json"), 5_100_000));
  return {
    requestId: id,
    mode: item.status,
    receipt: item.receipt || null,
    error: item.error || null,
  };
}
function enqueue(folder, raw) {
  request(raw);
  const id = hash(raw),
    dir = files.directory(root(folder)),
    file = path.join(dir, id + ".json"),
    temp = path.join(dir, crypto.randomUUID() + ".tmp");
  files.write(
    temp,
    JSON.stringify({
      version: 1,
      id,
      status: "queued",
      createdAt: new Date().toISOString(),
      request: raw,
    }),
  );
  try {
    try {
      fs.linkSync(temp, file);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const previous = JSON.parse(files.read(file, 5_100_000));
      if (previous.status === "needs_resubmission")
        files.atomicText(file, files.read(temp, 5_100_000));
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return status(folder, id);
}
function applyPending(store) {
  const dir = root(store.folder);
  let applied = 0;
  if (!fs.existsSync(dir)) return { applied };
  files.directory(dir);
  for (const name of fs
    .readdirSync(dir)
    .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
    const file = path.join(dir, name);
    let item;
    try {
      item = JSON.parse(files.read(file, 5_100_000));
      if (item.status !== "queued") continue;
      if (
        item.version !== 1 ||
        item.id !== name.slice(0, -5) ||
        hash(request(item.request)) !== item.id
      )
        throw Error("Revision content does not match its identity");
      const receiptKey = "widget-revision:" + item.id;
      let receipt = store.get(receiptKey);
      if (!receipt) {
        receipt = store.transaction(() => {
          const edits = plan(store, item.request);
          for (const e of edits) {
            store.set("widget-revision-previous:" + e.id, JSON.parse(e.previous));
            store.db
              .prepare("UPDATE cards SET content=? WHERE id=?")
              .run(JSON.stringify(e.next), e.id);
          }
          return store.set(receiptKey, {
            cardIds: edits.map((e) => e.id),
            scope: "widget-only",
            appliedAt: new Date().toISOString(),
          });
        });
      }
      files.atomicText(
        file,
        JSON.stringify({
          version: 1,
          id: item.id,
          status: "revised",
          createdAt: item.createdAt,
          receipt,
        }),
      );
      applied++;
    } catch (error) {
      // The DB receipt commits with the edit. A failed filesystem receipt is
      // recoverable on the next poll, not a failed/stale content revision.
      if (
        item?.id === name.slice(0, -5) &&
        store.get("widget-revision:" + item.id)
      )
        continue;
      if (
        item?.status === "queued" &&
        fs.existsSync(file) &&
        !fs.lstatSync(file).isSymbolicLink()
      )
        files.atomicText(
          file,
          JSON.stringify({ ...item, status: "blocked", error: error.message }),
        );
    }
  }
  return { applied };
}
module.exports = { hash, request, preview, enqueue, status, applyPending };
