export const defaultSelection = {
  deck: "all",
  topics: [],
  format: "all",
  difficulty: "all",
  practice: false,
  limit: 10,
};
export const inDeck = (card, deck) =>
  deck === "all" || card.decks.includes(deck);
export function matches(card, selection, ignoreFormat = false) {
  return (
    inDeck(card, selection.deck) &&
    (!selection.topics.length || selection.topics.includes(card.topic)) &&
    (ignoreFormat ||
      selection.format === "all" ||
      card.kind === selection.format) &&
    (selection.difficulty === "all" || card.difficulty === selection.difficulty)
  );
}
export function queue(cards, selection, now = Date.now()) {
  const seen = new Set();
  return cards
    .filter(
      (c) =>
        matches(c, selection) &&
        !c.suspended &&
        c.status === "ready" &&
        (selection.practice || new Date(c.schedule.due).getTime() <= now),
    )
    .sort(
      (a, b) =>
        (a.schedule.state === 0) - (b.schedule.state === 0) ||
        new Date(a.schedule.due) - new Date(b.schedule.due),
    )
    .filter((c) => {
      const id = c.conceptId || c.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, selection.limit);
}
export const plain = (html) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent || "";
};
export const formatLabel = {
  all: "Mixed",
  concept: "Concepts",
  math: "Math",
  code: "Coding",
};
export const scopeText = (s) =>
  s.selfTestDay
    ? `Self test · ${s.selfTestDay}`
    : (s.deck === "all" ? "All decks" : s.deck) +
      " / " +
      (s.topics.length ? s.topics.join(" + ") : "All topics") +
      " / " +
      formatLabel[s.format];

/** Compact duration such as 6m, 3h or 12d. */
export function spanLabel(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  return mins < 60
    ? mins + "m"
    : mins < 1440
      ? Math.round(mins / 60) + "h"
      : Math.round(mins / 1440) + "d";
}
/** A review-eligible card whose scheduled date has arrived. New cards are not "due". */
export const isDue = (card, now = Date.now()) =>
  card.status === "ready" &&
  !card.suspended &&
  card.schedule.state !== 0 &&
  new Date(card.schedule.due).getTime() <= now;
/** Where a card stands in its schedule, for status chips. */
export function dueInfo(card, now = Date.now()) {
  if (card.status === "draft") return { key: "draft", label: "Draft" };
  if (card.suspended) return { key: "suspended", label: "Suspended" };
  const s = card.schedule;
  if (!s || s.state === 0) return { key: "new", label: "New" };
  const due = new Date(s.due).getTime();
  if (due <= now) return { key: "due", label: "Due" };
  return {
    key: s.state === 2 ? "scheduled" : "learning",
    label: "in " + spanLabel(due - now),
  };
}
export function sameDay(iso, ref = new Date()) {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}
export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(iso, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(iso, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}
