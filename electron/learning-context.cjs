const { createHash } = require("node:crypto");
const st = require("./self-test.cjs");
const stop = new Set(
  "a an and are as at be by can could did do does explain for from how i in is it me of on or that the their this to was what when where which why with you your".split(
    " ",
  ),
);
const terms = (text) =>
  [
    ...new Set(
      String(text)
        .toLowerCase()
        .replace(/<[^>]*>/g, " ")
        .match(/[a-z0-9]+/g) || [],
    ),
  ]
    .filter((t) => t.length > 2 && !stop.has(t))
    .map((t) => t.replace(/s$/, ""));
const take = (object, keys) =>
  Object.fromEntries(
    keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]]),
  );
const sessionKey = (id) => String(id || "").replace(/^(codex|claude)\//, "");
// A process-local index, with exact source comparisons on every lookup. A card
// edit invalidates only that card; a newly imported card is immediately found.
// Executable widget/CSS source must not influence concept search.
const indices = new Map();
const answerText = (text) =>
  String(text || "")
    .replace(/```(?:widget|mermaid)[^\n]*\n[\s\S]*?```/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
function indexFor(folder, cards) {
  if (!indices.has(folder)) {
    if (indices.size >= 4) indices.delete(indices.keys().next().value);
    indices.set(folder, new Map());
  }
  const index = indices.get(folder),
    seen = new Set();
  for (const card of cards) {
    if (card.status !== "ready" || card.suspended) continue;
    seen.add(card.id);
    const primaryText = [
      card.title,
      card.prompt,
      ...(card.tags || []),
      ...(card.aliases || []),
    ].join(" ");
    const old = index.get(card.id);
    if (!old || old.primaryText !== primaryText || old.answer !== card.answer)
      index.set(card.id, {
        primaryText,
        answer: card.answer,
        primary: new Set(terms(primaryText)),
        secondary: new Set(terms(answerText(card.answer))),
      });
  }
  for (const id of index.keys()) if (!seen.has(id)) index.delete(id);
  return index;
}
function context(folder, item, cards) {
  const input = item.input;
  const source =
    input.type === "objective"
      ? {
          type: "objective",
          capture: take(input.capture, [
            "title",
            "objective",
            "context",
            "at",
            "evidence",
            "cardIds",
          ]),
          needsAuthoring: !!input.needsAuthoring,
        }
      : {
          type: "session",
          messages: (input.messages || []).map((m) =>
            take(m, ["role", "text", "at"]),
          ),
        };
  if (Buffer.byteLength(JSON.stringify(source)) > 120000)
    throw Error("Selected learning exceeds the 120 KB preparation limit");
  const query = terms(
    input.type === "objective"
      ? [
          input.capture.title,
          input.capture.objective,
          input.capture.context,
        ].join(" ")
      : (input.messages || [])
          .filter((m) => m.role === "user")
          .map((m) => m.text)
          .join(" "),
  );
  const explicit = new Set(input.capture?.cardIds || []);
  const index = indexFor(folder, cards);
  const ranked = cards
    .filter((c) => c.status === "ready" && !c.suspended)
    .map((c) => {
      const { primary, secondary } = index.get(c.id);
      const hits = query.filter((t) => primary.has(t));
      const score = explicit.has(c.id)
        ? 10000
        : hits.length * 5 + query.filter((t) => secondary.has(t)).length;
      return {
        c,
        score,
        relevant:
          explicit.has(c.id) ||
          hits.length > 0 ||
          query.filter((t) => secondary.has(t)).length >= 2,
      };
    })
    .filter((x) => x.relevant)
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  let remaining = 48000;
  const candidates = [];
  for (const { c } of ranked.slice(0, 12)) {
    const readableAnswer = answerText(c.answer);
    const record = {
      ...take(c, [
        "id",
        "conceptId",
        "title",
        "kind",
        "topic",
        "tags",
        "prompt",
      ]),
      answer: readableAnswer.slice(0, 6000),
      answerTruncated: readableAnswer.length > 6000,
      visualSourceOmitted: readableAnswer !== c.answer,
    };
    const size = Buffer.byteLength(JSON.stringify(record));
    if (size > remaining) continue;
    remaining -= size;
    candidates.push(record);
  }
  const sessionId = sessionKey(input.sessionId || input.capture?.sessionId);
  const captures = [];
  let captureBytes = 0;
  for (const entry of st
    .read(folder)
    .entries.filter((e) => sessionId && sessionKey(e.sessionId) === sessionId)
    .slice(-30)
    .reverse()) {
    const record = take(entry, ["objective", "at", "cardIds"]);
    const size = Buffer.byteLength(JSON.stringify(record));
    if (size + captureBytes > 16000) continue;
    captureBytes += size;
    captures.unshift(record);
  }
  const payload = { source, candidates, captures };
  return {
    id: item.id,
    title: item.title,
    payload,
    candidateCount: candidates.length,
    captureCount: captures.length,
    bytes: Buffer.byteLength(JSON.stringify(payload)),
    digest: createHash("sha256")
      .update(JSON.stringify([item.id, payload]))
      .digest("hex"),
  };
}
module.exports = { context, indexFor };
