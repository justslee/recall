export function parseKnowledgeVisual(text) {
  if (typeof text !== "string" || text.length > 4096) return null;
  try {
    const value = JSON.parse(text);
    if (
      value &&
      Object.keys(value).length === 1 &&
      typeof value.asset === "string" &&
      /^Visuals\/[a-f0-9]{64}\.recall-visual\.json$/.test(value.asset)
    )
      return value;
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !["cardId", "widgetIndex"].includes(k))
    )
      return null;
    if (
      typeof value.cardId !== "string" ||
      !value.cardId.trim() ||
      value.cardId.length > 1000 ||
      /[\u0000-\u001f]/.test(value.cardId)
    )
      return null;
    if (
      !Number.isInteger(value.widgetIndex) ||
      value.widgetIndex < 0 ||
      value.widgetIndex > 63
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function resolveKnowledgeVisual(reference, cards) {
  const card = cards.find((card) => card.id === reference.cardId);
  if (!card) return null;
  const answer = card.presentation?.answer ?? card.answer;
  const widgets = [
    ...String(answer || "").matchAll(
      /```widget[^\S\n]*([^\n]*)\r?\n([\s\S]*?)```/g,
    ),
  ];
  const widget = widgets[reference.widgetIndex];
  return widget
    ? { card, title: widget[1].trim() || "Interactive visual" }
    : null;
}
