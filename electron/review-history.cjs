const { config } = require("./config.cjs");
const RATINGS = ["Again", "Hard", "Good", "Easy", "Skip"];
/** Read-only ledger. Return bounded pages, without current drafts or card answers. */
function page(store, options = {}, now = new Date()) {
  const {
    query = "",
    rating = "all",
    kind = "all",
    day = "",
    days = 0,
    offset = 0,
  } = options;
  if (
    typeof query !== "string" ||
    query.length > 200 ||
    !["all", ...RATINGS].includes(rating) ||
    !["all", "concept", "math", "code"].includes(kind) ||
    ![0, 7, 28, 90].includes(days) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))
  )
    throw Error("Invalid history filter");
  const timeZone = config(store.folder).timeZone;
  const dateOf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = dateOf.format(now);
  const since = new Date(today + "T12:00:00Z");
  since.setUTCDate(since.getUTCDate() - days + 1);
  const cutoff = days ? since.toISOString().slice(0, 10) : "";
  const cards = new Map(store.cards().map((c) => [c.id, c]));
  const rows = store.db
    .prepare(
      "SELECT id,card_id,at,rating,practice,after_schedule,undone FROM reviews ORDER BY at DESC,id DESC",
    )
    .all();
  const selected = rows.filter((r) => {
    const date = dateOf.format(new Date(r.at)),
      card = cards.get(r.card_id);
    return (
      (!day || date === day) &&
      (!cutoff || (date >= cutoff && date <= today)) &&
      (rating === "all" || r.rating === rating) &&
      (kind === "all" || card?.kind === kind) &&
      (!query ||
        [card?.title, card?.topic, ...(card?.decks || [])]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()))
    );
  });
  return {
    total: selected.length,
    offset,
    pageSize: 30,
    timeZone,
    events: selected
      .slice(offset, offset + 30)
      .map(({ after_schedule, ...r }) => ({
        ...r,
        nextDue: JSON.parse(after_schedule || "{}").due || null,
      })),
  };
}
module.exports = { page };
