const { createHash } = require("node:crypto");
const { hash } = require("./catalog.cjs");
const ratings = new Set(["Again", "Hard", "Good", "Easy"]);
const parsed = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
function build(
  cards,
  {
    reviews = [],
    explanations = [],
    challenges = [],
    handwriting = [],
    now = Date.now(),
  } = {},
) {
  const clock = new Date(now).getTime();
  const eligible = cards.filter((c) => c.status === "ready" && !c.suspended);
  const validTime = (at) =>
    Number.isFinite(Date.parse(at)) && Date.parse(at) <= clock;
  const groups = new Map();
  const latest = (events) =>
    events
      .filter((e) => validTime(e.at))
      .sort(
        (a, b) =>
          Date.parse(b.at) - Date.parse(a.at) ||
          (Number(b.id) || 0) - (Number(a.id) || 0),
      )[0];
  const history = new Map();
  for (const review of reviews) {
    if (
      review.undone ||
      review.practice ||
      !ratings.has(review.rating) ||
      !validTime(review.at)
    )
      continue;
    if (!history.has(review.card_id)) history.set(review.card_id, []);
    history.get(review.card_id).push(review);
  }
  for (const card of eligible) {
    const id = card.conceptId || card.id;
    if (!groups.has(id))
      groups.set(id, {
        id,
        title: card.title,
        topic: card.topic,
        decks: [],
        cards: [],
        recall: [],
        explain: [],
        apply: [],
        events: [],
      });
    const group = groups.get(id);
    if (card.kind === "concept") {
      group.title = card.title;
      group.topic = card.topic;
    }
    group.decks = [...new Set([...group.decks, ...(card.decks || [])])];
    group.cards.push({
      id: card.id,
      title: card.title,
      kind: card.kind,
      difficulty: card.difficulty,
      decks: card.decks || [],
      relatedCardIds: [
        ...new Set([
          ...(Array.isArray(card.relatedCardIds) ? card.relatedCardIds : []),
          ...(Array.isArray(card.parentCardIds) ? card.parentCardIds : []),
        ]),
      ].filter((id) => typeof id === "string" && id !== card.id),
      parentCardIds: Array.isArray(card.parentCardIds)
        ? card.parentCardIds.filter(
            (id) => typeof id === "string" && id !== card.id,
          )
        : [],
    });
    const base = {
      cardId: card.id,
      kind: card.kind,
      state: "untried",
      label: "Not tried",
      at: null,
      source: null,
    };
    const events = history.get(card.id) || [],
      review = latest(events);
    group.events.push(
      ...events.map((e) => ({
        ...base,
        at: e.at,
        eventId: e.id,
        source: "Self-rated",
        detail: e.rating,
        lane: card.kind === "concept" ? "recall" : "apply",
        state: ["Again", "Hard"].includes(e.rating)
          ? "needs_practice"
          : "practiced",
      })),
    );
    let recalled = { ...base };
    if (review) {
      const previous = events
        .filter((r) => Date.parse(r.at) < Date.parse(review.at))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      const delayed =
        previous && Date.parse(review.at) - Date.parse(previous.at) >= 86400000;
      const weak = ["Again", "Hard"].includes(review.rating);
      recalled = {
        ...base,
        state: weak
          ? "needs_practice"
          : delayed
            ? "recalled_later"
            : "practiced",
        label: weak
          ? "Needs practice"
          : delayed
            ? "Recalled after a day+"
            : "Practiced",
        at: review.at,
        source: "Self-rated",
        detail: review.rating,
        eventId: review.id,
      };
    }
    if (card.kind === "concept") {
      group.recall.push(recalled);
      const sourceId =
        "card-" +
        createHash("sha256").update(card.id).digest("hex").slice(0, 32);
      const attempt = latest(
        explanations.filter(
          (e) =>
            e.config?.sourceId === sourceId &&
            e.config?.grounding === "library",
        ),
      );
      const outcome = attempt?.feedback?.outcome;
      group.explain.push(
        !attempt
          ? { ...base }
          : {
              ...base,
              state:
                outcome === "grounded"
                  ? "practiced"
                  : outcome === "partial"
                    ? "needs_practice"
                    : "unclear",
              label:
                outcome === "grounded"
                  ? "Explained"
                  : outcome === "partial"
                    ? "Needs practice"
                    : "Needs clarification",
              at: attempt.at,
              source: "AI feedback · saved reference",
              detail: outcome,
              eventId: attempt.id,
            },
      );
      if (attempt)
        group.events.push({ ...group.explain.at(-1), lane: "explain" });
    } else if (["math", "code"].includes(card.kind)) {
      const extra =
        card.kind === "code"
          ? latest(
              challenges.filter(
                (e) =>
                  e.card_id === card.id &&
                  e.content_hash === hash(card) &&
                  ["passed", "failed"].includes(e.result?.status),
              ),
            )
          : latest(
              handwriting.filter(
                (e) => e.card_id === card.id && e.status === "feedback_ready",
              ),
            );
      if (extra && (!review || Date.parse(extra.at) > Date.parse(review.at))) {
        const outcome =
          card.kind === "code" ? extra.result.status : extra.feedback?.verdict;
        const strong = ["passed", "solid"].includes(outcome),
          weak = ["failed", "partial", "needs_work"].includes(outcome);
        group.apply.push({
          ...base,
          state: strong ? "practiced" : weak ? "needs_practice" : "unclear",
          label: strong
            ? card.kind === "code"
              ? "Tests passed"
              : "Worked through"
            : weak
              ? "Needs practice"
              : "Needs clarification",
          source:
            card.kind === "code"
              ? "Local exercise tests"
              : "AI feedback · saved question",
          at: extra.at,
          detail: outcome,
          eventId: extra.id,
        });
      } else group.apply.push(recalled);
      if (extra) {
        const outcome =
          card.kind === "code" ? extra.result.status : extra.feedback?.verdict;
        group.events.push({
          ...base,
          at: extra.at,
          eventId: extra.id,
          lane: "apply",
          detail: outcome,
          source:
            card.kind === "code"
              ? "Local exercise tests"
              : "AI feedback · saved question",
          state: ["passed", "solid"].includes(outcome)
            ? "practiced"
            : ["failed", "partial", "needs_work"].includes(outcome)
              ? "needs_practice"
              : "unclear",
        });
      }
    }
  }
  for (const group of groups.values()) {
    group.events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
  return [...groups.values()].sort(
    (a, b) => a.topic.localeCompare(b.topic) || a.title.localeCompare(b.title),
  );
}
function snapshot(store, { now = Date.now() } = {}) {
  // Read-only projection. No transcripts or full code are sent to the renderer.
  const cards = store.db
    .prepare("SELECT content,suspended FROM cards")
    .all()
    .filter((r) => !r.suspended)
    .map((r) => parsed(r.content))
    .filter(Boolean);
  const evidence = {
    reviews: store.db
      .prepare("SELECT id,card_id,at,rating,practice,undone FROM reviews")
      .all(),
    explanations: store.db
      .prepare("SELECT value FROM settings WHERE key LIKE 'speak:attempt:%'")
      .all()
      .map((r) => parsed(r.value))
      .filter(Boolean),
    challenges: store.db
      .prepare(
        "SELECT id,card_id,at,result,content_hash FROM challenge_attempts",
      )
      .all()
      .map((r) => ({ ...r, result: parsed(r.result) })),
    handwriting: store.db
      .prepare(
        "SELECT a.id,p.card_id,a.created_at AS at,a.status,a.feedback FROM paper_assessments a JOIN paper_attempts p ON p.id=a.attempt_id",
      )
      .all()
      .map((r) => ({ ...r, feedback: parsed(r.feedback) })),
  };
  const clock = new Date(now).getTime();
  const previousAt = new Date(clock - 7 * 86400000).toISOString();
  return {
    concepts: build(cards, { ...evidence, now: clock }),
    previous: {
      at: previousAt,
      concepts: build(cards, { ...evidence, now: previousAt }),
    },
    generatedAt: new Date(clock).toISOString(),
    timeZone: require("./config.cjs").config(store.folder).timeZone,
  };
}
module.exports = { build, snapshot };
