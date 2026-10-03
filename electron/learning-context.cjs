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
  const ranked = cards
    .filter((c) => c.status === "ready" && !c.suspended)
    .map((c) => {
      const primary = new Set(
        terms(
          [c.title, c.prompt, ...(c.tags || []), ...(c.aliases || [])].join(
            " ",
          ),
        ),
      );
      const secondary = new Set(terms(c.answer));
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
      answer: c.answer.slice(0, 6000),
      answerTruncated: c.answer.length > 6000,
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
module.exports = { context };
