// Read-only presentation rules. Opening Atlas never writes learning evidence.
export const lanes = ["recall", "explain", "apply"];
export const stateLabels = {
  untried: "Not tried",
  needs_practice: "Needs practice",
  unclear: "Needs clarification",
  partial: "Some evidence",
  practiced: "Successful attempt",
  recalled_later: "Recalled after a day+",
};
export const successful = (e) =>
  ["practiced", "recalled_later"].includes(e.state);
export const evidence = (row) => lanes.flatMap((lane) => row[lane] || []);
export function stateOf(row) {
  const items = evidence(row);
  if (items.some((e) => e.state === "needs_practice")) return "needs_practice";
  if (items.some((e) => e.state === "unclear")) return "unclear";

  // Optional, untried Speak practice does not erase a scored card result.
  // An untried *card format* remains visible, including in Mixed sessions.
  const primary = [...(row.recall || []), ...(row.apply || [])];
  const positive = items.some(successful);
  if (!positive) return "untried";
  if (primary.some((e) => e.state === "untried")) return "partial";
  if (primary.length && primary.every((e) => e.state === "recalled_later"))
    return "recalled_later";
  return "practiced";
}
export function filterConcepts(
  concepts,
  selection,
  search = "",
  text = String,
) {
  const query = search.trim().toLocaleLowerCase();
  return concepts
    .filter(
      (c) =>
        (!selection.topics.length || selection.topics.includes(c.topic)) &&
        (!query ||
          text(c.title + " " + c.topic)
            .toLocaleLowerCase()
            .includes(query)),
    )
    .map((c) => {
      const cards = c.cards.filter(
        (v) =>
          (selection.deck === "all" || v.decks.includes(selection.deck)) &&
          (selection.difficulty === "all" ||
            v.difficulty === selection.difficulty) &&
          (selection.format === "all" || v.kind === selection.format),
      );
      const ids = new Set(cards.map((v) => v.id));
      return {
        ...c,
        cards,
        events: (c.events || []).filter((e) => ids.has(e.cardId)),
        ...Object.fromEntries(
          lanes.map((lane) => [
            lane,
            (c[lane] || []).filter((e) => ids.has(e.cardId)),
          ]),
        ),
      };
    })
    .filter((c) => c.cards.length);
}
export function summarize(rows) {
  const counts = Object.fromEntries(
    Object.keys(stateLabels).map((s) => [s, 0]),
  );
  for (const row of rows) counts[stateOf(row)]++;
  return {
    ...counts,
    total: rows.length,
    tried: rows.filter((r) => evidence(r).some((e) => e.at)).length,
    successful: rows.filter((r) => evidence(r).some(successful)).length,
  };
}
const priority = {
  needs_practice: 0,
  unclear: 1,
  partial: 2,
  untried: 3,
  practiced: 4,
  recalled_later: 5,
};
export function rank(rows) {
  return [...rows].sort(
    (a, b) =>
      priority[stateOf(a)] - priority[stateOf(b)] ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}
export function practiceIds(rows, preferredId) {
  const chosen = preferredId
    ? rows.filter((r) => r.id === preferredId)
    : rank(rows);
  const items = chosen.flatMap((r) => [...r.recall, ...r.apply]);
  items.sort((a, b) => priority[a.state] - priority[b.state]);
  return [...new Set(items.map((e) => e.cardId))].slice(0, 3);
}
// Only explicit card links create paths. A shared exercise can demonstrate a
// connection only when its exact-revision test or scored attempt succeeded.
export function connections(rows) {
  const byCard = new Map(rows.flatMap((r) => r.cards.map((c) => [c.id, r.id])));
  const paths = new Map();
  const add = (a, b, sourceCardId, demonstrated = false) => {
    if (!a || !b || a === b) return;

    const ids = [a, b].sort(),
      key = ids.join("\0");
    if (!paths.has(key) || demonstrated)
      paths.set(key, { a: ids[0], b: ids[1], sourceCardId, demonstrated });
  };
  for (const row of rows)
    for (const card of row.cards) {
      for (const id of card.relatedCardIds || [])
        add(row.id, byCard.get(id), card.id);
      const parents = [
        ...new Set(
          (card.parentCardIds || [])
            .map((id) => byCard.get(id))
            .filter(Boolean),
        ),
      ];
      const attempt = [...row.recall, ...row.apply].find(
        (e) => e.cardId === card.id,
      );
      for (let i = 0; i < parents.length; i++)
        for (let j = i + 1; j < parents.length; j++) {
          add(
            parents[i],
            parents[j],
            card.id,
            !!attempt && successful(attempt),
          );
        }
    }
  return [...paths.values()];
}
