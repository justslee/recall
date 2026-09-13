export const catalogDefaults = {
  tab: "path",
  query: "",
  category: "all",
  language: "all",
  difficulty: "all",
  provider: "all",
  access: "all",
  firm: "all",
  stage: "all",
  confidence: "all",
  progress: "all",
  sort: "rank",
};
export function catalogInfo(cards) {
  const first = cards.find((c) => c.catalog);
  if (!first) return null;
  const m = first.catalog;
  return {
    id: m.id,
    title: m.title || first.decks[0],
    provider:
      m.provider ||
      (first.source.startsWith("https:")
        ? new URL(first.source).hostname.replace(/^www\./, "")
        : "Local collection"),
    pathLabel:
      m.pathLabel ||
      (m.curriculum?.inQuantDev50 ? "Quant Dev 50" : "Learning path"),
  };
}
export function displayCatalog(card) {
  const m = card.catalog;
  if (!m) return card;
  return {
    ...card,
    catalog: {
      category: card.topic,
      language: Object.keys(card.code || {})[0],
      sourceDifficulty: card.difficulty.toLowerCase(),
      accessLevel: "original",
      firmTags: [],
      assumptions: [],
      tests: [],
      validationNotes: [],
      classification: "Exercise",
      attribution: card.source,
      reconstruction: { isReconstructed: false },
      ...m,
      curriculum: { inQuantDev50: false, ...m.curriculum },
    },
  };
}
export function challengeProgress(card, states = {}, attempts = {}) {
  const s = states[card.id] || {};
  return s.completed
    ? "completed"
    : attempts[card.id] || s.notes || s.explanation
      ? "in-progress"
      : "not-started";
}
export function filterCatalog(cards, f, states = {}, attempts = {}) {
  const q = f.query.trim().toLowerCase();
  const result = cards.filter((c) => {
    const m = c.catalog,
      s = states[c.id] || {};
    if (!m) return false;
    return (
      (f.tab !== "path" || m.curriculum.inQuantDev50) &&
      (f.category === "all" || m.category === f.category) &&
      (f.language === "all" || m.language === f.language) &&
      (f.difficulty === "all" || m.sourceDifficulty === f.difficulty) &&
      (f.provider === "all" ||
        f.provider ===
          (m.provider ||
            (c.source.startsWith("https:")
              ? new URL(c.source).hostname.replace(/^www\./, "")
              : "Local collection"))) &&
      (f.access === "all" || m.accessLevel === f.access) &&
      (f.firm === "all" || m.firmTags.includes(f.firm)) &&
      (f.stage === "all" || String(m.curriculum.stageNumber) === f.stage) &&
      (f.confidence === "all" ||
        m.reconstruction?.confidenceLabel === f.confidence) &&
      (f.progress === "all" ||
        (f.progress === "bookmarked"
          ? s.bookmarked
          : challengeProgress(c, states, attempts) === f.progress)) &&
      (!q ||
        [
          c.title,
          m.category,
          m.classification,
          ...c.tags,
          ...(s.customTags || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q))
    );
  });
  const difficulty = { easy: 0, medium: 1, hard: 2 };
  const rank = (c) => c.catalog.curriculum.rank ?? Number.MAX_SAFE_INTEGER;
  const score = (c) =>
    c.catalog.reconstruction?.overallEducationalEquivalenceConfidence ?? -1;
  return result.sort((a, b) => {
    let order = 0;
    if (f.sort === "rank") order = rank(a) - rank(b);
    if (f.sort === "category")
      order = a.catalog.category.localeCompare(b.catalog.category);
    if (f.sort === "difficulty")
      order =
        difficulty[a.catalog.sourceDifficulty] -
        difficulty[b.catalog.sourceDifficulty];
    if (f.sort === "confidence") order = score(b) - score(a);
    return order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}
