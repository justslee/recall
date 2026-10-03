const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { atomic, config, lock } = require("./config.cjs");
const st = require("./self-test.cjs"),
  bundles = require("./bundles.cjs");
const root = (folder) => path.join(folder, "learning-inbox");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const itemFile = (folder, id) =>
  path.join(root(folder), "items", hash(id) + ".json");
function read(folder) {
  const directory = path.join(root(folder), "items"),
    items = [],
    issues = [];
  if (fs.existsSync(directory))
    for (const name of fs
      .readdirSync(directory)
      .filter((n) => n.endsWith(".json"))) {
      try {
        const value = JSON.parse(
          fs.readFileSync(path.join(directory, name), "utf8"),
        );
        if (
          !value.id ||
          !value.status ||
          !["objective", "session"].includes(value.type)
        )
          throw Error("Invalid inbox item");
        items.push(value);
      } catch (e) {
        issues.push({ file: name, error: e.message });
      }
    }
  return {
    items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    issues,
  };
}
function update(folder, id, patch) {
  const release = lock(path.join(root(folder), "queue-lock"));
  try {
    const target = itemFile(folder, id),
      value = JSON.parse(fs.readFileSync(target, "utf8"));
    const changes = typeof patch === "function" ? patch(value) : patch;
    if (!changes) return value;
    const next = { ...value, ...changes, updatedAt: new Date().toISOString() };
    atomic(target, next);
    return next;
  } finally {
    release();
  }
}
function enqueue(folder, input) {
  if (!config(folder).captureEnabled) throw Error("Learning capture is paused");
  const release = lock(path.join(root(folder), "queue-lock"));
  try {
    const target = itemFile(folder, input.id);
    if (fs.existsSync(target)) {
      const prior = JSON.parse(fs.readFileSync(target, "utf8"));
      if (JSON.stringify(prior.input) !== JSON.stringify(input))
        throw Error("Inbox identity already exists with different content");
      return { id: input.id, inserted: false, status: prior.status };
    }
    if (!input.id || !["objective", "session"].includes(input.type))
      throw Error("Invalid inbox item");
    const value = {
      id: input.id,
      type: input.type,
      title: input.title,
      createdAt: new Date().toISOString(),
      status: "pending",
      input,
    };
    atomic(target, value);
    return { id: input.id, inserted: true, status: value.status };
  } finally {
    release();
  }
}
function add(folder, entry, cards) {
  if (!config(folder).captureEnabled) throw Error("Learning capture is paused");
  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const id of entry.cardIds || []) {
    const card = byId.get(id);
    if (!card || card.suspended || card.status !== "ready")
      throw Error("Unavailable card: " + id);
  }
  st.capture(folder, entry);
  const result = enqueue(folder, {
    id: entry.id,
    type: "objective",
    title: entry.title,
    capture: entry,
    needsAuthoring: !!entry.needsAuthoring,
  });
  if (entry.cardIds.length && !entry.needsAuthoring)
    update(folder, entry.id, { status: "ready", cardIds: entry.cardIds });
  return {
    ...result,
    status:
      entry.cardIds.length && !entry.needsAuthoring ? "ready" : result.status,
  };
}
function submit(folder, id, result) {
  if (!config(folder).captureEnabled) throw Error("Learning capture is paused");

  if (!Array.isArray(result.captures) || result.captures.length > 30)
    throw Error("Expected at most 30 grounded captures");
  if (result.pack) bundles.normalizePack(result.pack);
  if (!result.captures.length && result.pack)
    throw Error("Unlinked cards cannot be imported");
  if (!result.captures.length && !result.reason)
    throw Error("Explain why no learning was found");
  update(folder, id, (item) => {
    if (["ready", "dismissed", "submitted", "applying"].includes(item.status))
      throw Error("Item is already resolved or submitted");
    return { status: "submitted", result, error: null };
  });
  return { submitted: id };
}
function applyOne(store, item) {
  const r = item.result,
    all = new Map(store.cards().map((c) => [c.id, c]));
  const pack = r.pack ? bundles.normalizePack(r.pack) : null;
  if (pack) {
    const checked = r.quality?.reviewedCardIds;
    if (
      !Array.isArray(checked) ||
      typeof r.quality?.evidence !== "string" ||
      !r.quality.evidence.trim() ||
      pack.cards.some((c) => !checked.includes(c.id))
    )
      throw Error("Editorial/visual validation is incomplete");
    for (const c of pack.cards) {
      if (c.status !== "ready")
        throw Error("Only validated ready cards may resolve an objective");
      if (all.get(c.id)?.suspended)
        throw Error("Existing card is suspended: " + c.id);
      all.set(c.id, c);
    }
    const ids = new Set(r.captures.flatMap((c) => c.cardIds || []));
    if (pack.cards.some((c) => !ids.has(c.id)))
      throw Error("Every new card must cover a captured objective");
  }
  const captures = r.captures.map((c) => {
    if (!c.cardIds?.length) throw Error("Unresolved objective: " + c.title);
    for (const id of c.cardIds) {
      const card = all.get(id);
      if (!card || card.suspended || card.status !== "ready")
        throw Error("Unavailable reference: " + id);
    }
    if (item.type === "objective")
      return { ...item.input.capture, cardIds: c.cardIds };
    const messages = item.input.messages || [];
    if (!messages.some((m) => m.at === c.at))
      throw Error("Capture timestamp must come from the source messages");
    return {
      title: c.title,
      objective: c.objective,
      context: c.context,
      at: c.at,
      cardIds: c.cardIds,
      kbUrl: c.kbUrl || "",
      id: item.id + "/" + hash(c.objective.trim().toLowerCase()).slice(0, 20),
      sessionId: item.input.sessionId,
      evidence: "discussed",
      source: item.input.source,
    };
  });
  if (item.type === "objective" && captures.length !== 1)
    throw Error("Resolve one objective per objective item");
  // Validate capture structure without touching the live log before import.
  for (const c of captures) st.validate(c);
  // Packs come from a model reading untrusted text, so they cannot switch on
  // interactive widgets; the reader enables them per card in the editor.
  const imported = pack
    ? bundles.importPack(store, pack, { apply: true, widgets: false })
    : { inserted: 0, unchanged: 0 };
  // Model-supplied reports are content, never authority to execute native code.
  // Explicit local review/validation is a separate operation.
  for (const c of captures) {
    const entries = st.read(store.folder).entries;
    const prior =
      entries.find((e) => e.id === c.id) ||
      (item.type === "session" &&
        entries.find(
          (e) =>
            e.sessionId.replace(/^(codex|claude)\//, "") ===
              c.sessionId.replace(/^(codex|claude)\//, "") &&
            e.objective.trim().toLowerCase() ===
              c.objective.trim().toLowerCase(),
        ));
    if (prior) st.link(store.folder, prior.id, c.cardIds);
    else st.capture(store.folder, c);
  }
  update(store.folder, item.id, {
    status: captures.length ? "ready" : "dismissed",
    cardIds: [...new Set(captures.flatMap((c) => c.cardIds))],
    receipt: {
      inserted: imported.inserted,
      unchanged: imported.unchanged,
      captures: captures.length,
    },
    reason: r.reason || "",
    result: null,
    error: null,
  });
}
function applyPending(store) {
  if (!config(store.folder).captureEnabled) return { applied: 0, paused: true };
  const release = lock(path.join(root(store.folder), "apply-lock"));
  let applied = 0;
  try {
    for (const item of read(store.folder).items.filter(
      (i) => i.status === "submitted",
    )) {
      try {
        update(store.folder, item.id, { status: "applying" });
        applyOne(store, item);
        applied++;
      } catch (e) {
        update(store.folder, item.id, { status: "blocked", error: e.message });
      }
    }
  } finally {
    release();
  }
  return { applied };
}
function retry(folder, id) {
  update(folder, id, (item) => {
    if (item.status !== "blocked")
      throw Error("Only blocked items can be retried");
    return { status: item.result ? "submitted" : "pending", error: null };
  });
}
function summary(folder) {
  const value = read(folder);
  const scanFile = path.join(root(folder), "catch-up.json");
  const scan = fs.existsSync(scanFile)
    ? JSON.parse(fs.readFileSync(scanFile, "utf8"))
    : {};
  return {
    items: value.items.map(
      ({ id, type, title, status, createdAt, cardIds, error, reason }) => ({
        id,
        type,
        title,
        status,
        createdAt,
        cardIds,
        error,
        reason,
      }),
    ),
    issues: [...value.issues, ...(scan.issues || [])],
    lastCheckedAt: scan.lastCheckedAt || null,
    remainingFiles: scan.remainingFiles || 0,
    pendingTurns: scan.pendingTurns || 0,
  };
}
module.exports = {
  summary,
  root,
  hash,
  read,
  enqueue,
  add,
  submit,
  applyPending,
  update,
  retry,
  itemFile,
};
