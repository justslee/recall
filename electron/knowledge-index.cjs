const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { config } = require("./config.cjs");
const files = require("./knowledge-files.cjs");
const kb = require("../adapters/knowledge.cjs");
const pause = () => new Promise((resolve) => setImmediate(resolve));
const fold = (value) =>
  String(value).normalize("NFKC").toLocaleLowerCase().trim();

class KnowledgeIndex {
  constructor(folder) {
    this.folder = folder;
    const dir = path.join(folder, "cache", "knowledge");
    require("./private-files.cjs").directory(dir);
    const file = path.join(dir, "search-v1.sqlite");
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw Error("Unsafe search cache.");
    this.db = new DatabaseSync(file);
    fs.chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS scopes (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, checked TEXT, issues TEXT DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS notes (rowid INTEGER PRIMARY KEY, source TEXT NOT NULL, path TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, format TEXT NOT NULL, revision TEXT NOT NULL, modified REAL NOT NULL, size INTEGER NOT NULL, stamp TEXT NOT NULL, metadata TEXT NOT NULL, excerpt TEXT NOT NULL, UNIQUE(source,path));
      CREATE INDEX IF NOT EXISTS notes_identity ON notes(id);
      CREATE INDEX IF NOT EXISTS notes_recent ON notes(source,modified DESC);
      CREATE TABLE IF NOT EXISTS aliases (value TEXT NOT NULL, note INTEGER NOT NULL, UNIQUE(value,note));
      CREATE INDEX IF NOT EXISTS alias_note ON aliases(note);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title, aliases, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3');
      CREATE TABLE IF NOT EXISTS links (note INTEGER NOT NULL, target TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS link_target ON links(target);`);
    this.syncing = false;
    this.changed = 0;
  }

  sources() {
    return config(this.folder).sources.filter((s) =>
      ["markdown", "obsidian"].includes(s.type),
    );
  }
  fingerprint(s) {
    return kb.digest([s.id, s.root, s.type]);
  }
  removeRow(rowid) {
    this.db.prepare("DELETE FROM aliases WHERE note=?").run(rowid);
    this.db.prepare("DELETE FROM links WHERE note=?").run(rowid);
    this.db.prepare("DELETE FROM search WHERE rowid=?").run(rowid);
    this.db.prepare("DELETE FROM notes WHERE rowid=?").run(rowid);
  }
  reconcileScopes() {
    const sources = this.sources();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const old of this.db.prepare("SELECT * FROM scopes").all()) {
        const next = sources.find((s) => s.id === old.id);
        if (!next || this.fingerprint(next) !== old.fingerprint) {
          for (const row of this.db
            .prepare("SELECT rowid FROM notes WHERE source=?")
            .all(old.id))
            this.removeRow(row.rowid);
          this.db.prepare("DELETE FROM scopes WHERE id=?").run(old.id);
        }
      }
      for (const source of sources)
        this.db
          .prepare("INSERT OR IGNORE INTO scopes(id,fingerprint) VALUES(?,?)")
          .run(source.id, this.fingerprint(source));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return sources;
  }

  update(source, relative, force = false) {
    const file = files.checkedPath(source, relative);
    const stat = fs.statSync(file);
    const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
    const old = this.db
      .prepare("SELECT rowid,stamp FROM notes WHERE source=? AND path=?")
      .get(source.id, relative);
    if (!force && old?.stamp === stamp) return false;

    const raw = require("./private-files.cjs").read(file, files.MAX_BYTES);
    const note = files.describe(
      source,
      relative,
      raw,
      stat,
      files.identity(this.folder, source.id, relative),
    );
    const { body, text, ...meta } = note;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (old) this.removeRow(old.rowid);
      const rowid = this.db
        .prepare(
          "INSERT INTO notes(source,path,id,title,format,revision,modified,size,stamp,metadata,excerpt) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          source.id,
          relative,
          note.id,
          note.title,
          note.format,
          note.revision,
          note.modified,
          note.size,
          stamp,
          JSON.stringify(meta),
          text
            .replace(/^#{1,6}\s+.+$/gm, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 240),
        ).lastInsertRowid;
      this.db
        .prepare("INSERT INTO search(rowid,title,aliases,body) VALUES(?,?,?,?)")
        .run(rowid, note.title, note.aliases.join(" "), text);
      const alias = this.db.prepare(
        "INSERT OR IGNORE INTO aliases(value,note) VALUES(?,?)",
      );
      for (const value of new Set(
        [
          note.id,
          note.title,
          path.basename(relative, path.extname(relative)),
          ...note.aliases,
        ].map(fold),
      ))
        alias.run(value, rowid);
      const link = this.db.prepare(
        "INSERT INTO links(note,target) VALUES(?,?)",
      );
      for (const target of new Set(note.links.map(fold)))
        link.run(rowid, target);
      this.db.exec("COMMIT");
      this.changed++;
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async refresh() {
    if (this.syncing) {
      this.refreshAgain = true;
      return this.pending;
    }
    this.syncing = true;
    this.pending = (async () => {
      let result;
      do {
        this.refreshAgain = false;
        result = await this.scan();
      } while (this.refreshAgain);
      return result;
    })().finally(() => {
      this.syncing = false;
    });
    return this.pending;
  }
  async scan() {
    const sources = this.reconcileScopes();
    for (const source of sources) {
      if (this.stopping) break;
      const seen = new Set(),
        issues = [],
        dirs = [""];
      let count = 0,
        complete = true;
      try {
        const root = fs.realpathSync(source.root);
        while (dirs.length) {
          const dir = dirs.pop();
          const absolute = dir ? files.checkedPath(source, dir) : root;
          let entries;
          try {
            entries = fs.readdirSync(absolute, { withFileTypes: true });
          } catch {
            issues.push({
              path: dir || ".",
              reason: "Folder could not be read.",
            });
            complete = false;
            continue;
          }
          for (const entry of entries) {
            if (this.stopping) {
              complete = false;
              dirs.length = 0;
              break;
            }
            if (
              entry.name.startsWith(".") ||
              ["node_modules", "__pycache__"].includes(entry.name)
            )
              continue;
            if (++count > 200000) {
              issues.push({
                path: ".",
                reason: "Folder entry limit reached. Select a smaller scope.",
              });
              complete = false;
              dirs.length = 0;
              break;
            }
            const relative = dir ? dir + "/" + entry.name : entry.name;
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
              if (relative.split("/").length < 32) dirs.push(relative);
              else {
                complete = false;
                issues.push({
                  path: relative,
                  reason: "Folder nesting limit reached.",
                });
              }
            } else if (entry.isFile() && files.supported(relative)) {
              seen.add(relative);
              try {
                this.update(source, relative);
              } catch (e) {
                // A stale readable copy must never masquerade as the current file.
                const old = this.db
                  .prepare("SELECT rowid FROM notes WHERE source=? AND path=?")
                  .get(source.id, relative);
                if (old) this.removeRow(old.rowid);
                issues.push({ path: relative, reason: e.message });
              }
            }
            if (count % 32 === 0) await pause(); // Queries can run while a large initial scan progresses.
          }
        }
        if (complete) {
          for (const row of this.db
            .prepare("SELECT rowid,path FROM notes WHERE source=?")
            .all(source.id))
            if (!seen.has(row.path)) this.removeRow(row.rowid);
        }
      } catch {
        complete = false;
        issues.push({
          path: ".",
          reason:
            "Knowledge folder is unavailable. Reconnect it or check its location.",
        });
      }
      this.db
        .prepare("UPDATE scopes SET checked=?,issues=? WHERE id=?")
        .run(
          new Date().toISOString(),
          JSON.stringify(issues.slice(0, 200)),
          source.id,
        );
    }
    return this.status();
  }

  status() {
    const sources = this.sources().map((s) => {
      const state = this.db
        .prepare("SELECT * FROM scopes WHERE id=? AND fingerprint=?")
        .get(s.id, this.fingerprint(s));
      const count = state
        ? this.db
            .prepare("SELECT count(*) n FROM notes WHERE source=?")
            .get(s.id).n
        : 0;
      return {
        id: s.id,
        name: s.name || path.basename(s.root),
        root: s.root,
        type: s.type,
        writable: !!s.write,
        count,
        checkedAt: state?.checked || null,
        issues: JSON.parse(state?.issues || "[]"),
      };
    });
    return {
      sources,
      indexing: this.syncing,
      count: sources.reduce((n, s) => n + s.count, 0),
    };
  }

  query({
    query = "",
    sourceId = "",
    directory = "",
    offset = 0,
    limit = 40,
  } = {}) {
    const started = performance.now();
    if (
      typeof query !== "string" ||
      query.length > 400 ||
      typeof directory !== "string" ||
      typeof sourceId !== "string"
    )
      throw Error("Invalid search.");
    limit = Math.max(1, Math.min(80, Number(limit) || 40));
    offset = Math.max(0, Math.min(100000, Number(offset) || 0));
    const sources = this.sources()
      .filter((s) => !sourceId || s.id === sourceId)
      .filter((s) =>
        this.db
          .prepare("SELECT id FROM scopes WHERE id=? AND fingerprint=?")
          .get(s.id, this.fingerprint(s)),
      );
    if (!sources.length)
      return {
        documents: [],
        hasMore: false,
        elapsedMs: performance.now() - started,
      };

    const params = sources.map((s) => s.id);
    let where = `n.source IN (${params.map(() => "?").join(",")})`;
    if (directory) {
      where += " AND substr(n.path,1,?)=?";
      params.push(directory.length + 1, directory + "/");
    }
    const select = "n.metadata,n.excerpt";
    const tokens =
      query
        .normalize("NFKC")
        .match(/[\p{L}\p{N}_]+/gu)
        ?.slice(0, 12) || [];
    let rows;
    if (query.trim()) {
      const exact = this.db
        .prepare(
          `SELECT ${select},0 priority FROM aliases a JOIN notes n ON n.rowid=a.note WHERE a.value=? AND ${where} LIMIT 80`,
        )
        .all(fold(query), ...params);
      const match = tokens.map((t) => '"' + t + '"*').join(" AND ");
      const full = match
        ? this.db
            .prepare(
              `SELECT ${select},1 priority FROM search JOIN notes n ON n.rowid=search.rowid WHERE search MATCH ? AND ${where} ORDER BY bm25(search,8,5,1) LIMIT ? OFFSET ?`,
            )
            .all(match, ...params, limit + offset + 1, 0)
        : [];
      const seen = new Set();
      rows = [...exact, ...full]
        .filter((row) => {
          const n = JSON.parse(row.metadata),
            id = n.sourceId + "/" + n.path;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .slice(offset, offset + limit + 1);
    } else
      rows = this.db
        .prepare(
          `SELECT ${select} FROM notes n WHERE ${where} ORDER BY n.modified DESC,n.path LIMIT ? OFFSET ?`,
        )
        .all(...params, limit + 1, offset);
    return {
      documents: rows
        .slice(0, limit)
        .map((r) => ({ ...JSON.parse(r.metadata), excerpt: r.excerpt })),
      hasMore: rows.length > limit,
      elapsedMs: performance.now() - started,
    };
  }

  folders(sourceId) {
    if (!this.sources().some((s) => s.id === sourceId)) return [];
    const folders = new Set();
    for (const row of this.db
      .prepare("SELECT path FROM notes WHERE source=?")
      .all(sourceId)) {
      const parts = row.path.split("/");
      parts.pop();
      for (let i = 1; i <= parts.length; i++)
        folders.add(parts.slice(0, i).join("/"));
    }
    return [...folders].sort().slice(0, 500);
  }
  backlinks(note) {
    const targets = [
      note.id,
      note.title,
      note.path,
      path.basename(note.path, path.extname(note.path)),
      ...note.aliases,
    ].map(fold);
    return this.db
      .prepare(
        `SELECT DISTINCT n.metadata FROM links l JOIN notes n ON n.rowid=l.note WHERE n.source=? AND l.target IN (${targets.map(() => "?").join(",")}) AND n.path<>? LIMIT 30`,
      )
      .all(note.sourceId, ...targets, note.path)
      .map((r) => JSON.parse(r.metadata));
  }
  close() {
    this.db.close();
  }
}
module.exports = { KnowledgeIndex };
