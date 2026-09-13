const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { exerciseHash } = require("./exercise-trust.cjs"),
  { widgetsOf } = require("./widgets.cjs");
function validateCards(cards) {
  assert(
    Array.isArray(cards) && cards.length,
    "Expected a nonempty card array",
  );
  const ids = new Set();
  for (const c of cards) {
    require("../shared/contracts.cjs").validate("Card", c);
    for (const key of [
      "id",
      "conceptId",
      "title",
      "prompt",
      "answer",
      "topic",
      "source",
    ])
      assert(typeof c[key] === "string" && c[key].trim(), key + " required");
    assert(!ids.has(c.id), "Duplicate ID");
    ids.add(c.id);
    assert(["concept", "math", "code"].includes(c.kind));
    assert(["ready", "draft"].includes(c.status));
    assert(["Foundation", "Application", "Advanced"].includes(c.difficulty));
    assert(
      Array.isArray(c.decks) &&
        c.decks.length &&
        c.decks.every((x) => typeof x === "string" && x),
    );
    assert(Array.isArray(c.tags));
    if (c.kind === "math")
      assert(
        Number.isFinite(c.numeric?.value) &&
          Number.isFinite(c.numeric?.tolerance) &&
          c.numeric.tolerance >= 0,
        "Numeric value/tolerance required",
      );
    if (c.kind === "code") {
      assert(c.code && Object.keys(c.code).length);
      for (const [lang, v] of Object.entries(c.code)) {
        assert(["python", "cpp"].includes(lang));
        for (const key of ["stub", "solution", "harness"])
          assert(typeof v[key] === "string" && v[key].trim());
      }
    }
    for (const w of widgetsOf(c.answer))
      for (const script of w.html.matchAll(
        /<script[^>]*>([\s\S]*?)<\/script>/g,
      ))
        new vm.Script(script[1]);
  }
  return cards;
}
function normalizePack(raw) {
  if (Array.isArray(raw))
    return {
      schemaVersion: 1,
      id: "local-bundle",
      title: "Local bundle",
      cards: validateCards(raw),
    };
  assert(
    raw.schemaVersion === 1 &&
      typeof raw.id === "string" &&
      raw.id &&
      raw.title,
    "Invalid content pack",
  );
  validateCards(raw.cards);
  return raw;
}
function preview(store, raw) {
  const pack = normalizePack(raw),
    existing = new Map(
      store.db
        .prepare("SELECT id,content FROM cards")
        .all()
        .map((r) => [r.id, JSON.parse(r.content)]),
    );
  const { stable } = require("./catalog.cjs");
  const inserted = [],
    unchanged = [],
    conflicts = [];
  for (const c of pack.cards) {
    if (!existing.has(c.id)) inserted.push(c.id);
    else if (stable(existing.get(c.id)) === stable(c)) unchanged.push(c.id);
    else conflicts.push(c.id);
  }
  return { packId: pack.id, inserted, unchanged, conflicts };
}
function importPack(store, raw, { apply = false, widgets = false } = {}) {
  const pack = normalizePack(raw);
  // Untrusted packages cannot authorize widget execution; explicit local import can.
  const cards = pack.cards.map((c) => ({
    ...c,
    widgetsAllowed: widgets && c.widgetsAllowed === true,
  }));
  const report = preview(store, { ...pack, cards });
  if (!apply) return report;
  assert(
    !report.conflicts.length,
    "Conflicting card IDs; create a reviewed revision instead",
  );
  const backup = store.backup();
  const result = store.import(cards);
  const { atomic } = require("./config.cjs");
  atomic(
    path.join(
      store.folder,
      "packs",
      require("node:crypto")
        .createHash("sha256")
        .update(pack.id)
        .digest("hex") + ".json",
    ),
    {
      schemaVersion: 1,
      id: pack.id,
      title: pack.title,
      cardIds: cards.map((c) => c.id),
      importedAt: new Date().toISOString(),
    },
  );
  return { ...report, ...result, backup };
}
function trustCode(store, id, report) {
  require("../shared/contracts.cjs").validate("ValidationReport", report);
  const card = JSON.parse(store.card(id).content),
    entry = report.exercises?.find((e) => e.id === id);
  assert(
    report.version === 1 && entry?.sha256 === exerciseHash(card),
    "Validation digest mismatch",
  );
  for (const language of Object.keys(card.code || {})) {
    const v = entry.languages?.[language];
    assert(
      v?.reference === "passed" &&
        v.stub === "failed" &&
        v.rejectedMutants?.length,
      "Incomplete validation",
    );
  }
  assert(card.kind === "code" && Object.keys(card.code || {}).length);
  store.set("validated-code:" + id, {
    sha256: entry.sha256,
    validatedAt: report.validatedAt,
  });
  return { trusted: id };
}
module.exports = {
  validateCards,
  normalizePack,
  preview,
  importPack,
  trustCode,
};
