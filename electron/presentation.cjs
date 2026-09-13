// Legacy visuals are user-owned compatibility data, never bundled private content.
function presentationFor(card, entries = {}) {
  const entry = entries[card.id];
  return entry && entry.answer === card.answer
    ? { ...card, presentation: entry.presentation }
    : card;
}
module.exports = { presentationFor };
