const { config } = require("./config.cjs");
const RATINGS = ["Again", "Hard", "Good", "Easy"];
function shift(day, offset) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function summarize(
  cards,
  history,
  { days = 28, timeZone = "UTC", now = new Date() } = {},
) {
  if (![7, 28, 90].includes(days)) throw Error("Choose 7, 28 or 90 days");
  const clock = new Date(now).getTime();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateOf = (value) => formatter.format(new Date(value));
  const today = dateOf(now),
    start = shift(today, 1 - days);
  const daily = Array.from({ length: days }, (_, i) => ({
    day: shift(start, i),
    reviews: 0,
    recalled: 0,
    firstReviews: 0,
    repeatReviews: 0,
    rollingReviews: 0,
    rollingRecallRate: null,
    ratings: Object.fromEntries(RATINGS.map((r) => [r, 0])),
  }));
  const dayMap = new Map(daily.map((d) => [d.day, d]));
  const trendDays = Array.from({ length: days + 6 }, (_, i) => ({
    day: shift(start, i - 6),
    reviews: 0,
    recalled: 0,
  }));
  const trendMap = new Map(trendDays.map((d) => [d.day, d]));
  const forecast = {
    overdue: 0,
    today: 0,
    days: Array.from({ length: 7 }, (_, i) => ({
      day: shift(today, i),
      due: 0,
    })),
  };
  const forecastMap = new Map(forecast.days.map((d) => [d.day, d]));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const eligible = cards.filter((c) => c.status === "ready" && !c.suspended);
  const ratings = Object.fromEntries(RATINGS.map((r) => [r, 0]));
  const formats = Object.fromEntries(
    ["concept", "math", "code", "other"].map((kind) => [
      kind,
      { kind, reviews: 0, recalled: 0 },
    ]),
  );
  const topics = new Map();
  const topicOf = (name) => {
    if (!topics.has(name))
      topics.set(name, {
        topic: name,
        reviews: 0,
        recalled: 0,
        needsPractice: 0,
        due: 0,
      });
    return topics.get(name);
  };
  const latest = new Map(),
    first = new Map(),
    activeDates = new Set(),
    unique = new Set();
  let practice = 0;
  for (const event of history) {
    const at = new Date(event.at).getTime();
    if (
      event.undone ||
      !RATINGS.includes(event.rating) ||
      !Number.isFinite(at) ||
      at > clock
    )
      continue;
    const day = dateOf(event.at),
      bucket = dayMap.get(day);
    if (event.practice) {
      if (bucket) practice++;
      continue;
    }

    const recalled = event.rating !== "Again" ? 1 : 0;
    const trend = trendMap.get(day);
    if (trend) {
      trend.reviews++;
      trend.recalled += recalled;
    }
    const earliest = first.get(event.card_id);
    if (
      !earliest ||
      at < new Date(earliest.at).getTime() ||
      (at === new Date(earliest.at).getTime() && event.id < earliest.id)
    )
      first.set(event.card_id, event);
    activeDates.add(day);
    const previous = latest.get(event.card_id);
    if (
      !previous ||
      at > new Date(previous.at).getTime() ||
      (at === new Date(previous.at).getTime() && event.id > previous.id)
    )
      latest.set(event.card_id, event);
    if (!bucket) continue;
    bucket.reviews++;
    bucket.ratings[event.rating]++;
    bucket.recalled += recalled;
    ratings[event.rating]++;
    unique.add(event.card_id);
    const card = byId.get(event.card_id);
    const format = formats[card?.kind] || formats.other;
    format.reviews++;
    format.recalled += recalled;
    const topic = topicOf(card?.topic || "Unavailable cards");
    topic.reviews++;
    topic.recalled += recalled;
  }
  for (const event of first.values()) {
    const bucket = dayMap.get(dateOf(event.at));
    if (bucket) bucket.firstReviews++;
  }
  let rollingReviews = 0,
    rollingRecalled = 0;
  for (let i = 0; i < trendDays.length; i++) {
    rollingReviews += trendDays[i].reviews;
    rollingRecalled += trendDays[i].recalled;
    if (i >= 7) {
      rollingReviews -= trendDays[i - 7].reviews;
      rollingRecalled -= trendDays[i - 7].recalled;
    }
    const bucket = dayMap.get(trendDays[i].day);
    if (!bucket) continue;

    bucket.repeatReviews = bucket.reviews - bucket.firstReviews;
    bucket.rollingReviews = rollingReviews;
    bucket.rollingRecallRate = rollingReviews
      ? Math.round((100 * rollingRecalled) / rollingReviews)
      : null;
  }
  const needsPractice = [];
  let due = 0;
  for (const card of eligible) {
    const topic = topicOf(card.topic || "Uncategorized");
    const isDue =
      card.schedule?.state > 0 &&
      new Date(card.schedule.due).getTime() <= clock;
    if (isDue) {
      due++;
      topic.due++;
    }
    const scheduledAt = new Date(card.schedule?.due).getTime();
    if (card.schedule?.state > 0 && Number.isFinite(scheduledAt)) {
      const day = dateOf(scheduledAt);
      if (day < today) forecast.overdue++;
      if (day === today) forecast.today++;
      const bucket = forecastMap.get(day);
      if (bucket) bucket.due++;
    }
    const review = latest.get(card.id);
    if (review && ["Again", "Hard"].includes(review.rating)) {
      topic.needsPractice++;
      needsPractice.push({
        id: card.id,
        title: card.title,
        topic: card.topic,
        kind: card.kind,
        rating: review.rating,
        at: review.at,
        due: isDue,
      });
    }
  }
  needsPractice.sort(
    (a, b) => Number(b.due) - Number(a.due) || new Date(b.at) - new Date(a.at),
  );
  let streak = 0,
    cursor = activeDates.has(today) ? today : shift(today, -1);
  while (activeDates.has(cursor)) {
    streak++;
    cursor = shift(cursor, -1);
  }
  const reviews = daily.reduce((n, d) => n + d.reviews, 0);
  const recalled = reviews - ratings.Again;
  return {
    days,
    timeZone,
    today,
    start,
    daily,
    ratings,
    reviews,
    recalled,
    recallRate: reviews ? Math.round((100 * recalled) / reviews) : null,
    uniqueCards: unique.size,
    activeDays: daily.filter((d) => d.reviews).length,
    streak,
    practice,
    due,
    forecast,
    library: {
      available: eligible.length,
      reviewed: eligible.filter((c) => latest.has(c.id)).length,
    },
    formats: Object.values(formats).filter(
      (f) => f.kind !== "other" || f.reviews,
    ),
    topics: [...topics.values()]
      .filter((t) => t.reviews || t.needsPractice || t.due)
      .sort(
        (a, b) =>
          b.needsPractice - a.needsPractice ||
          b.reviews - a.reviews ||
          a.topic.localeCompare(b.topic),
      ),
    needsPractice,
  };
}
function snapshot(store, options = {}) {
  return summarize(
    store.cards(),
    store.db
      .prepare("SELECT id,card_id,at,rating,practice,undone FROM reviews")
      .all(),
    { days: options.days, timeZone: config(store.folder).timeZone },
  );
}
module.exports = { summarize, snapshot };
