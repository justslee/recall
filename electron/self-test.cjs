const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { config } = require("./config.cjs");
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayOf = (at = new Date(), timeZone = TIME_ZONE) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
const root = (folder) => path.join(folder, "self-tests");
function validate(entry) {
  require("../shared/contracts.cjs").validate("LearningCapture", entry);
  for (const key of ["id", "sessionId", "title", "objective", "context", "at"])
    if (
      typeof entry[key] !== "string" ||
      !entry[key].trim() ||
      entry[key].length > 10000
    )
      throw Error(`Invalid ${key}`);
  if (
    !/(Z|[+-]\d{2}:\d{2})$/.test(entry.at) ||
    !Number.isFinite(Date.parse(entry.at))
  )
    throw Error("Invalid timestamp");
  if (
    !Array.isArray(entry.cardIds) ||
    entry.cardIds.some((id) => typeof id !== "string" || !id)
  )
    throw Error("cardIds must be an array of IDs");
  if (!["discussed", "explained", "solved"].includes(entry.evidence))
    throw Error("Invalid evidence");
  return {
    ...(entry.day ? { day: entry.day, timeZone: entry.timeZone } : {}),
    id: entry.id,
    sessionId: entry.sessionId,
    title: entry.title,
    objective: entry.objective,
    context: entry.context,
    at: new Date(entry.at).toISOString(),
    evidence: entry.evidence,
    source: String(entry.source || ""),
    kbUrl: String(entry.kbUrl || ""),
    cardIds: [...new Set(entry.cardIds)].sort(),
  };
}
function publish(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value, null, 2) + "\n";
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(temp, text, { flag: "wx" });
  try {
    fs.linkSync(temp, file);
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (fs.readFileSync(file, "utf8") !== text)
      throw Error(
        "Capture ID already exists with different content. Use a new checkpoint ID.",
      );
    return false;
  } finally {
    fs.unlinkSync(temp);
  }
}
function capture(folder, input) {
  const zone = config(folder).timeZone;
  const prior = read(folder).entries.find((e) => e.id === input.id);
  const entry = validate({
    ...input,
    timeZone: prior?.timeZone || zone,
    day: prior?.day || dayOf(input.at, zone),
  });
  const hash = crypto.createHash("sha256").update(entry.id).digest("hex");
  const inserted = publish(
    path.join(root(folder), "entries", hash + ".json"),
    entry,
  );
  prepare(folder);
  return { inserted, day: entry.day, id: entry.id };
}
function read(folder) {
  const entries = [],
    issues = [];
  const dir = path.join(root(folder), "entries");
  if (fs.existsSync(dir))
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        entries.push(
          validate(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))),
        );
      } catch (e) {
        issues.push(`${file}: ${e.message}`);
      }
    }
  const links = path.join(root(folder), "links");
  if (fs.existsSync(links))
    for (const file of fs
      .readdirSync(links)
      .filter((f) => f.endsWith(".json"))) {
      try {
        const link = JSON.parse(
          fs.readFileSync(path.join(links, file), "utf8"),
        );
        const entry = entries.find((e) => e.id === link.entryId);
        if (
          !entry ||
          !Array.isArray(link.cardIds) ||
          link.cardIds.some((id) => typeof id !== "string" || !id)
        )
          throw Error("Invalid card link");
        entry.cardIds = [...new Set([...entry.cardIds, ...link.cardIds])];
      } catch (e) {
        issues.push(`${file}: ${e.message}`);
      }
    }
  return { entries: entries.sort((a, b) => a.at.localeCompare(b.at)), issues };
}
function link(folder, entryId, cardIds) {
  if (!read(folder).entries.some((e) => e.id === entryId))
    throw Error("Capture not found");
  if (
    !Array.isArray(cardIds) ||
    !cardIds.length ||
    cardIds.some((id) => typeof id !== "string" || !id)
  )
    throw Error("Invalid card IDs");
  const value = { entryId, cardIds: [...new Set(cardIds)].sort() };
  publish(
    path.join(
      root(folder),
      "links",
      crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex") +
        ".json",
    ),
    value,
  );
  prepare(folder);
}
function prepare(folder) {
  const { entries, issues } = read(folder);
  const zone = config(folder).timeZone;
  const days = [
    ...new Set(
      entries.map((e) => e.day || dayOf(e.at, config(folder).timeZone)),
    ),
  ];
  for (const day of days) {
    const text =
      `# Self Test · ${day}\n\nCaptured learning only; this log does not establish mastery. Time zone: ${zone}.\n\n` +
      entries
        .filter((e) => (e.day || dayOf(e.at, config(folder).timeZone)) === day)
        .map(
          (e) =>
            `## ${e.title}\n\n- Objective: ${e.objective}\n- Context: ${e.context}\n- Evidence: ${e.evidence}\n- Session: ${e.sessionId}\n- Source: ${e.source || "Current learning session"}\n- KB: ${e.kbUrl || "Not linked"}\n- Cards: ${e.cardIds.join(", ") || "Needs a card"}\n- Capture ID: ${e.id}\n`,
        )
        .join("\n");
    const dir = path.join(root(folder), "days");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, day + ".md"),
      temp = file + "." + crypto.randomUUID() + ".tmp";
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  }
  return { days, entries: entries.length, issues };
}
function snapshot(store, now = new Date()) {
  const { entries, issues } = read(store.folder),
    today = dayOf(now, config(store.folder).timeZone),
    cards = new Map(store.cards().map((c) => [c.id, c]));
  const reviews = store.db
    .prepare(
      "SELECT card_id,at,rating FROM reviews WHERE undone=0 AND practice=0 AND rating!='Skip' ORDER BY id",
    )
    .all();
  const days = [
    ...new Set([
      today,
      ...entries.map(
        (e) => e.day || dayOf(e.at, config(store.folder).timeZone),
      ),
    ]),
  ]
    .sort()
    .reverse()
    .map((day) => {
      const items = entries.filter(
        (e) => (e.day || dayOf(e.at, config(store.folder).timeZone)) === day,
      );
      const refs = [...new Set(items.flatMap((e) => e.cardIds))].map((id) => {
        const card = cards.get(id),
          review = reviews
            .filter(
              (r) =>
                r.card_id === id &&
                dayOf(
                  r.at,
                  items[0]?.timeZone || config(store.folder).timeZone,
                ) >= day &&
                new Date(r.at) <= new Date(now),
            )
            .at(-1);
        return {
          id,
          title: card?.title || "Missing card",
          kind: card?.kind,
          conceptId: card?.conceptId || id,
          available: !!card && card.status === "ready" && !card.suspended,
          tested: !!review,
          rating: review?.rating,
        };
      });
      return {
        day,
        entries: items,
        sessions: new Set(items.map((e) => e.sessionId)).size,
        cards: refs,
        gaps: items.filter(
          (e) => !e.cardIds.length || e.cardIds.some((id) => !cards.has(id)),
        ).length,
        pending: refs.filter((c) => c.available && !c.tested).map((c) => c.id),
      };
    });
  return { today, timeZone: config(store.folder).timeZone, days, issues };
}
function start(store, { day, replace = false }, now = new Date()) {
  return store.transaction(() => {
    const current = store.get("session");
    if (current && current.index < current.ids.length && !replace)
      throw Error(
        "Resume your current session or explicitly replace its remaining queue.",
      );
    const data = snapshot(store, now),
      target = data.days.find((d) => d.day === day);
    if (!target || !target.pending.length)
      throw Error("No untested cards are ready for this day.");
    const groups = new Map();
    for (const card of target.cards.filter((c) =>
      target.pending.includes(c.id),
    )) {
      if (!groups.has(card.conceptId)) groups.set(card.conceptId, []);
      groups.get(card.conceptId).push(card.id);
    }
    const ids = [];
    while ([...groups.values()].some((g) => g.length))
      for (const group of groups.values())
        if (group.length) ids.push(group.shift());
    return store.set("session", {
      id: crypto.randomUUID(),
      ids,
      index: 0,
      selection: {
        deck: "all",
        topics: [],
        format: "all",
        difficulty: "all",
        practice: false,
        limit: ids.length,
        selfTestDay: day,
      },
      revealed: false,
      rated: 0,
      skipped: 0,
      startedAt: new Date(now).toISOString(),
    });
  });
}
module.exports = { capture, read, link, prepare, snapshot, start, dayOf, root };
