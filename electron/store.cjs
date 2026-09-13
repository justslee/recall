const { DatabaseSync } = require("node:sqlite");
const { fsrs, createEmptyCard, Rating } = require("ts-fsrs");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { presentationFor } = require("./presentation.cjs");
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false });
const unpack = (s) => JSON.parse(s);
const hydrate = (s) => ({
  ...s,
  due: new Date(s.due),
  ...(s.last_review ? { last_review: new Date(s.last_review) } : {}),
});
class Store {
  constructor(folder) {
    this.folder = folder;
    this.releaseLock = require("./config.cjs").lock(folder);
    try {
      const presentationFile = path.join(folder, "presentations.json");
      this.presentations = fs.existsSync(presentationFile)
        ? JSON.parse(fs.readFileSync(presentationFile, "utf8"))
        : {};
      fs.mkdirSync(folder, { recursive: true });
      this.file = path.join(folder, "recall.sqlite");
      this.db = new DatabaseSync(this.file);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, content TEXT NOT NULL, schedule TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,card_id TEXT NOT NULL,at TEXT NOT NULL,rating TEXT NOT NULL,practice INTEGER NOT NULL,before_schedule TEXT NOT NULL,after_schedule TEXT NOT NULL,session_before TEXT,undone INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,card_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,at TEXT NOT NULL);
 `);
      const version = this.db.prepare("PRAGMA user_version").get().user_version;
      if (version > 2)
        throw Error("This library needs a newer Recall version.");
      if (version < 2)
        this.transaction(() => {
          this.db.exec(`
        CREATE TABLE IF NOT EXISTS catalog_entries(card_id TEXT PRIMARY KEY REFERENCES cards(id),catalog_id TEXT NOT NULL,content TEXT NOT NULL,hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS challenge_state(card_id TEXT PRIMARY KEY REFERENCES cards(id),value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS challenge_attempts(id INTEGER PRIMARY KEY,card_id TEXT NOT NULL REFERENCES cards(id),at TEXT NOT NULL,language TEXT NOT NULL,code TEXT NOT NULL,result TEXT NOT NULL,content_hash TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS challenge_attempts_by_card ON challenge_attempts(card_id,id DESC);
        PRAGMA user_version=2;
      `);
        });
    } catch (error) {
      this.db?.close();
      this.releaseLock();
      throw error;
    }
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get(key, fallback = null) {
    const r = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key);
    return r ? unpack(r.value) : fallback;
  }
  set(key, value) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
    return value;
  }
  cards() {
    return this.db
      .prepare("SELECT * FROM cards")
      .all()
      .map((r) =>
        presentationFor(
          {
            ...unpack(r.content),
            schedule: unpack(r.schedule),
            suspended: !!r.suspended,
          },
          this.presentations,
        ),
      );
  }
  card(id) {
    const r = this.db.prepare("SELECT * FROM cards WHERE id=?").get(id);
    if (!r) throw Error("Card not found");
    return r;
  }
  snapshot() {
    return {
      cards: this.cards(),
      challengeStates: Object.fromEntries(
        this.db
          .prepare("SELECT card_id,value FROM challenge_state")
          .all()
          .map((r) => [r.card_id, unpack(r.value)]),
      ),
      challengeAttemptCounts: Object.fromEntries(
        this.db
          .prepare(
            "SELECT card_id,count(*) AS count FROM challenge_attempts GROUP BY card_id",
          )
          .all()
          .map((r) => [r.card_id, r.count]),
      ),
      catalogManifests: Object.fromEntries(
        this.db
          .prepare(
            "SELECT key,value FROM settings WHERE key LIKE 'catalog-manifest:%'",
          )
          .all()
          .map((r) => [r.key.slice(17), JSON.parse(r.value)]),
      ),
      decks: this.get("decks", []),
      selection: this.get("selection"),
      session: this.get("session"),
      history: this.db
        .prepare(
          "SELECT id,card_id,at,rating,practice,undone FROM reviews ORDER BY id DESC LIMIT 100",
        )
        .all(),
      folder: this.folder,
    };
  }
  import(cards) {
    return this.transaction(() => {
      let inserted = 0,
        unchanged = 0;
      for (const card of cards) {
        if (
          !card.id ||
          !card.title ||
          !card.answer ||
          !["concept", "math", "code"].includes(card.kind)
        )
          throw Error("Invalid card bundle");
        const exists = this.db
          .prepare("SELECT id FROM cards WHERE id=?")
          .get(card.id);
        if (exists) {
          unchanged++;
          continue;
        }
        this.db
          .prepare("INSERT INTO cards(id,content,schedule) VALUES(?,?,?)")
          .run(
            card.id,
            JSON.stringify(card),
            JSON.stringify(createEmptyCard()),
          );
        inserted++;
      }
      const decks = [
        ...new Set([
          ...this.get("decks", []),
          ...cards.flatMap((c) => c.decks),
        ]),
      ];
      this.set("decks", decks);
      return { inserted, unchanged };
    });
  }
  syncCatalog(bundle) {
    return require("./catalog.cjs").syncCatalog(this, bundle);
  }
  challengeState(id, patch) {
    const card = unpack(this.card(id).content);
    if (!card.catalog) throw Error("Not a catalog challenge");
    const allowed = [
      "notes",
      "explanation",
      "completed",
      "bookmarked",
      "customTags",
    ];
    if (
      !patch ||
      typeof patch !== "object" ||
      Object.keys(patch).some((k) => !allowed.includes(k))
    )
      throw Error("Invalid challenge state");
    for (const [key, value] of Object.entries(patch)) {
      if (
        ["notes", "explanation"].includes(key) &&
        (typeof value !== "string" || value.length > 100000)
      )
        throw Error("Notes exceed the supported size");
      if (
        ["completed", "bookmarked"].includes(key) &&
        typeof value !== "boolean"
      )
        throw Error("Invalid progress value");
      if (
        key === "customTags" &&
        (!Array.isArray(value) ||
          value.length > 50 ||
          value.some((x) => typeof x !== "string" || x.length > 80))
      )
        throw Error("Invalid personal tags");
    }
    const row = this.db
      .prepare("SELECT value FROM challenge_state WHERE card_id=?")
      .get(id);
    const next = { ...(row ? unpack(row.value) : {}), ...patch };
    this.db
      .prepare(
        "INSERT INTO challenge_state VALUES(?,?) ON CONFLICT(card_id) DO UPDATE SET value=excluded.value",
      )
      .run(id, JSON.stringify(next));
    return next;
  }
  recordChallengeAttempt(card, language, code, result) {
    if (!card.catalog) return;
    this.db
      .prepare(
        "INSERT INTO challenge_attempts(card_id,at,language,code,result,content_hash) VALUES(?,?,?,?,?,?)",
      )
      .run(
        card.id,
        new Date().toISOString(),
        language,
        code,
        JSON.stringify(result),
        require("./catalog.cjs").hash(card),
      );
  }
  challengeAttempts(id) {
    this.card(id);
    return this.db
      .prepare(
        "SELECT * FROM challenge_attempts WHERE card_id=? ORDER BY id DESC LIMIT 50",
      )
      .all(id)
      .map((r) => ({ ...r, result: unpack(r.result) }));
  }
  saveCard(card) {
    if (!card.title?.trim() || !card.answer?.trim() || !card.topic?.trim())
      throw Error("Question, answer and topic are required.");
    if (
      !["concept", "math", "code"].includes(card.kind) ||
      !["ready", "draft"].includes(card.status)
    )
      throw Error("Invalid card type/status");
    if (!Array.isArray(card.decks) || !card.decks.length)
      throw Error("Choose a deck.");
    if (
      card.widgetsAllowed !== undefined &&
      typeof card.widgetsAllowed !== "boolean"
    )
      throw Error("Invalid widget permission");
    const id = card.id || crypto.randomUUID();
    const existing = this.db
      .prepare("SELECT content FROM cards WHERE id=?")
      .get(id);
    if (existing) {
      const before = unpack(existing.content);
      if (before.kind !== card.kind)
        throw Error("Create a new card to change its format.");
      if (
        before.kind !== "concept" &&
        ["title", "prompt", "answer"].some((key) => before[key] !== card[key])
      )
        throw Error(
          "Specialist content editing requires its matching tests and grading criteria. Use the forthcoming specialist editor.",
        );
      const allowed = [
        "title",
        "prompt",
        "answer",
        "topic",
        "tags",
        "decks",
        "difficulty",
        "status",
      ];
      for (const key of allowed) before[key] = card[key];
      // Imported cards start with widgets off; an explicit edit can allow them.
      before.widgetsAllowed = card.widgetsAllowed === true;
      before.revision = (before.revision || 0) + 1;
      this.db
        .prepare("UPDATE cards SET content=? WHERE id=?")
        .run(JSON.stringify(before), id);
    } else {
      if (card.kind !== "concept")
        throw Error(
          "The initial manual editor creates concept cards. Specialist authoring is the next milestone.",
        );
      // Cards written in the app allow their widgets unless the author opts out.
      this.import([
        { ...card, id, widgetsAllowed: card.widgetsAllowed !== false },
      ]);
    }
    return id;
  }
  intervals(id, now = new Date()) {
    const r = this.card(id);
    const result = scheduler.repeat(hydrate(unpack(r.schedule)), now);
    return Object.fromEntries(
      ["Again", "Hard", "Good", "Easy"].map((name) => [
        name,
        result[Rating[name]].card.due.toISOString(),
      ]),
    );
  }
  rate({ id, rating, practice = false, sessionId }, now = new Date()) {
    if (!["Again", "Hard", "Good", "Easy", "Skip"].includes(rating))
      throw Error("Invalid rating");
    return this.transaction(() => {
      const session = this.get("session");
      if (
        !session ||
        session.id !== sessionId ||
        session.ids[session.index] !== id
      )
        throw Error("This review has already advanced.");
      practice = !!session.selection?.practice;
      if (rating !== "Skip" && !session.revealed)
        throw Error("Reveal the answer before rating.");
      const row = this.card(id);
      const result =
        rating === "Skip" || practice
          ? null
          : scheduler.repeat(hydrate(unpack(row.schedule)), now)[
              Rating[rating]
            ];
      const after = result ? JSON.stringify(result.card) : row.schedule;
      this.db
        .prepare(
          "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,session_before) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          id,
          now.toISOString(),
          rating,
          practice ? 1 : 0,
          row.schedule,
          after,
          JSON.stringify(session),
        );
      if (result)
        this.db
          .prepare("UPDATE cards SET schedule=? WHERE id=?")
          .run(after, id);
      session.index++;
      session.revealed = false;
      session.rated = (session.rated || 0) + (rating === "Skip" ? 0 : 1);
      session.skipped = (session.skipped || 0) + (rating === "Skip" ? 1 : 0);
      this.set("session", session);
      return session;
    });
  }
  undo() {
    return this.transaction(() => {
      const last = this.db
        .prepare(
          "SELECT * FROM reviews WHERE undone=0 ORDER BY id DESC LIMIT 1",
        )
        .get();
      if (!last) return null;
      const current = this.get("session");
      const old = unpack(last.session_before);
      if (current?.id !== old.id)
        throw Error("Undo is available within the current session.");
      this.db
        .prepare("UPDATE cards SET schedule=? WHERE id=?")
        .run(last.before_schedule, last.card_id);
      this.db.prepare("UPDATE reviews SET undone=1 WHERE id=?").run(last.id);
      this.set("session", old);
      return old;
    });
  }
  suspend(id, value) {
    this.card(id);
    this.db
      .prepare("UPDATE cards SET suspended=? WHERE id=?")
      .run(value ? 1 : 0, id);
  }
  attach(cardId, name, mime, bytes) {
    this.card(cardId);
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(mime) ||
      bytes.length > 12 * 1024 * 1024
    )
      throw Error("Use PNG, JPEG or WebP up to 12 MB.");
    const id = crypto.randomUUID();
    this.db
      .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?)")
      .run(id, cardId, name, mime, bytes, new Date().toISOString());
    return id;
  }
  attachments(cardId) {
    return this.db
      .prepare(
        "SELECT id,name,mime,bytes FROM attachments WHERE card_id=? ORDER BY at",
      )
      .all(cardId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        url: `data:${r.mime};base64,${Buffer.from(r.bytes).toString("base64")}`,
      }));
  }
  backup() {
    const result = require("./backup.cjs").backup(this);
    return path.join(result.backup, "recall.sqlite");
  }
  close() {
    this.db.close();
    this.releaseLock?.();
  }
}
module.exports = { Store };
