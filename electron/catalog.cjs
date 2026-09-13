const { createHash } = require("node:crypto");
const stable = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const hash = (v) => createHash("sha256").update(stable(v)).digest("hex");
const equal = (a, b) => stable(a) === stable(b);
function mergeContent(previous, current, incoming, conflicts, prefix = "") {
  const result = { ...current };
  for (const key of new Set([
    ...Object.keys(previous),
    ...Object.keys(incoming),
  ])) {
    const p = previous[key],
      c = current[key],
      n = incoming[key];
    if (equal(c, p)) {
      if (n === undefined) delete result[key];
      else result[key] = n;
    } else if (
      ["tags", "decks"].includes(key) &&
      [p, c, n].every(Array.isArray)
    ) {
      const removed = new Set(p.filter((x) => !c.includes(x)));
      result[key] = [
        ...new Set([
          ...n.filter((x) => !removed.has(x)),
          ...c.filter((x) => !p.includes(x)),
        ]),
      ];
    } else if (!equal(c, n) && !equal(p, n)) conflicts.push(prefix + key);
  }
  return result;
}
function validateBundle(bundle) {
  if (
    bundle.schemaVersion !== 1 ||
    !bundle.catalogId ||
    !bundle.title ||
    !Array.isArray(bundle.cards)
  )
    throw Error("Invalid catalog");
  if (bundle.contentHash !== hash(bundle.cards))
    throw Error("Catalog checksum mismatch");
  require("./bundles.cjs").validateCards(bundle.cards);
  if (
    bundle.cards.some(
      (c) => c.kind !== "code" || c.catalog?.id !== bundle.catalogId,
    )
  )
    throw Error("Catalog card identity mismatch");
  return bundle;
}
function syncCatalog(store, raw) {
  const b = validateBundle(raw);
  return store.transaction(() => {
    const report = {
      catalogId: b.catalogId,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      conflicts: [],
      retainedAbsent: [],
    };
    for (const c of b.cards) {
      const row = store.db
          .prepare("SELECT content FROM cards WHERE id=?")
          .get(c.id),
        old = store.db
          .prepare(
            "SELECT content,catalog_id FROM catalog_entries WHERE card_id=?",
          )
          .get(c.id);
      if (row && (!old || old.catalog_id !== b.catalogId))
        throw Error("Catalog ID collision: " + c.id);
      if (!row) {
        const { createEmptyCard } = require("ts-fsrs");
        store.db
          .prepare("INSERT INTO cards(id,content,schedule) VALUES(?,?,?)")
          .run(c.id, JSON.stringify(c), JSON.stringify(createEmptyCard()));
        report.inserted++;
      } else {
        const before = JSON.parse(row.content),
          conflicts = [],
          next = mergeContent(JSON.parse(old.content), before, c, conflicts);
        if (conflicts.length)
          report.conflicts.push({ id: c.id, fields: conflicts });
        if (equal(before, next)) report.unchanged++;
        else {
          store.db
            .prepare("UPDATE cards SET content=? WHERE id=?")
            .run(JSON.stringify(next), c.id);
          report.updated++;
        }
      }
      store.db
        .prepare(
          "INSERT INTO catalog_entries VALUES(?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET content=excluded.content,hash=excluded.hash",
        )
        .run(c.id, b.catalogId, JSON.stringify(c), hash(c));
    }
    report.retainedAbsent = store.db
      .prepare("SELECT card_id FROM catalog_entries WHERE catalog_id=?")
      .all(b.catalogId)
      .filter((r) => !b.cards.some((c) => c.id === r.card_id))
      .map((r) => r.card_id);
    store.set("decks", [...new Set([...store.get("decks", []), b.title])]);
    store.set("catalog-manifest:" + b.catalogId, {
      ...b.manifest,
      title: b.title,
      contentHash: b.contentHash,
      retainedAbsent: report.retainedAbsent,
    });
    // Catalog metadata never grants execution trust. A separate local decision does.
    return report;
  });
}
module.exports = { stable, hash, mergeContent, validateBundle, syncCatalog };
