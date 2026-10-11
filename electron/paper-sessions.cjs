const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  files = require("./private-files.cjs"),
  contract = require("../shared/handwriting-contract.cjs");
const failure = (message) => new contract.ProtocolError(message);
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const READ_BYTES = 16 * 1024 * 1024;
function bounded(value, limit, name, optional = false) {
  if (optional && value === undefined) return null;
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw failure("Invalid " + name + ".");

  return value.trim();
}
function problem(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    revision: row.revision,
    title: row.title,
    prompt: row.prompt,
    kind: row.kind,
    createdAt: row.created_at,
  };
}
class PaperSessions {
  constructor({ store, paper, onChange = () => {}, onRead = () => {} }) {
    Object.assign(this, { store, paper, onChange, onRead });
    this.db = store.db;
    this.waiters = new Set();
    this.closed = false;
    this.file = path.join(
      files.directory(path.join(store.folder, "paper-authority")),
      "credentials.json",
    );
    this.authority = { version: 1, activeSessionId: null, hashes: {} };
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(files.read(this.file, 256 * 1024));
      if (
        saved.version !== 1 ||
        !saved.hashes ||
        typeof saved.hashes !== "object" ||
        Array.isArray(saved.hashes) ||
        Object.keys(saved.hashes).length > 500
      )
        throw failure("Paper session authorization needs repair.");

      for (const [id, hash] of Object.entries(saved.hashes)) {
        contract.checkedId(id);
        if (!digestPattern.test(hash))
          throw failure("Invalid paper session authorization.");
      }
      if (saved.activeSessionId !== null)
        contract.checkedId(saved.activeSessionId);
      this.authority = saved;
    }
  }
  saveAuthority() {
    files.atomicText(this.file, JSON.stringify(this.authority));
  }
  authorize(input) {
    contract.checkedId(input.sessionId);
    if (
      typeof input.capability !== "string" ||
      !capabilityPattern.test(input.capability)
    )
      throw failure(
        "This chat needs its original paper session authorization.",
      );

    const expected = this.authority.hashes[input.sessionId],
      actual = contract.digest(input.capability);
    if (
      !expected ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      throw failure("This chat is not authorized for that paper session.");

    const row = this.db
      .prepare("SELECT * FROM paper_tutor_sessions WHERE id=?")
      .get(input.sessionId);
    if (!row) throw failure("Paper session not found.");
    if (row.status === "restored")
      throw failure(
        "Restored paper sessions need new chat authorization. Your work is preserved.",
      );

    return row;
  }
  session(id) {
    const row = this.db
      .prepare("SELECT * FROM paper_tutor_sessions WHERE id=?")
      .get(id);
    if (!row) throw failure("Paper session not found.");

    const problems = this.db
      .prepare(
        "SELECT * FROM paper_tutor_problems WHERE session_id=? ORDER BY revision DESC LIMIT 3",
      )
      .all(id)
      .reverse()
      .map(problem);
    return {
      version: 1,
      mode: "tutor",
      target: "assistant",
      handoffId: id,
      currentQuestionId: null,
      questions: [],
      tutorTitle: row.title,
      currentProblemId: row.current_problem_id,
      problems,
    };
  }
  activeSession() {
    const id = this.authority.activeSessionId;
    if (!id || !this.authority.hashes[id]) return null;

    const row = this.db
      .prepare("SELECT status FROM paper_tutor_sessions WHERE id=?")
      .get(id);
    return row?.status === "active" ? this.session(id) : null;
  }
  changed() {
    this.onChange(this.activeSession());
    this.notify();
  }
  start(input) {
    const title = bounded(
        input.title ?? "Paper learning",
        240,
        "session title",
      ),
      client = input.client ?? "codex",
      conversationId = bounded(
        input.conversationId,
        160,
        "conversation label",
        true,
      );
    if (!["codex", "claude", "chatgpt"].includes(client))
      throw failure("Choose a supported assistant connection.");
    if (Object.keys(this.authority.hashes).length >= 500)
      throw failure(
        "Keep fewer than 500 authorized paper sessions in this profile.",
      );

    const id = crypto.randomUUID(),
      capability = crypto.randomBytes(32).toString("base64url"),
      createdAt = new Date().toISOString();
    const prior = structuredClone(this.authority);
    try {
      this.store.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO paper_tutor_sessions VALUES(?,?,?,?,?,0,NULL,?,NULL)",
          )
          .run(id, title, client, conversationId, "active", createdAt);
        // Authorization is private profile authority, never part of the library database.
        this.authority.hashes[id] = contract.digest(capability);
        this.authority.activeSessionId = id;
        this.saveAuthority();
      });
    } catch (error) {
      this.authority = prior;
      try {
        this.saveAuthority();
      } catch {}
      throw error;
    }
    this.changed();
    return { sessionId: id, capability, session: this.session(id) };
  }
  publish(input) {
    const row = this.authorize(input);
    if (row.status !== "active")
      throw failure(
        "This paper session has ended. Start a new session for a new prompt.",
      );
    if (row.revision >= 1000)
      throw failure("Start a new paper session after 1,000 writing prompts.");
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== row.revision
    )
      throw failure(
        "The writing prompt changed. Check this session before publishing again.",
      );

    const title = bounded(
        input.title ??
          (input.kind === "note" ? "Writing notes" : "Work on paper"),
        240,
        "prompt title",
      ),
      source = bounded(input.prompt, 40000, "writing prompt"),
      kind = input.kind ?? "problem";
    if (!["problem", "note"].includes(kind))
      throw failure("Choose a problem or note prompt.");

    const prompt = contract.questionFront(source, this.paper.decodeImage).html;
    if (Buffer.byteLength(prompt) > 64000)
      throw failure("The rendered writing prompt must be at most 64 KB.");

    const item = {
      id: crypto.randomUUID(),
      sessionId: row.id,
      revision: row.revision + 1,
      title,
      prompt,
      kind,
      createdAt: new Date().toISOString(),
    };
    const prior = structuredClone(this.authority);
    try {
      this.store.transaction(() => {
        this.db
          .prepare("INSERT INTO paper_tutor_problems VALUES(?,?,?,?,?,?,?)")
          .run(
            item.id,
            row.id,
            item.revision,
            title,
            prompt,
            kind,
            item.createdAt,
          );
        this.db
          .prepare(
            "UPDATE paper_tutor_sessions SET revision=?,current_problem_id=? WHERE id=?",
          )
          .run(item.revision, item.id, row.id);
        this.authority.activeSessionId = row.id;
        this.saveAuthority();
      });
    } catch (error) {
      this.authority = prior;
      try {
        this.saveAuthority();
      } catch {}
      throw error;
    }
    this.changed();
    return { sessionId: row.id, problem: item, session: this.session(row.id) };
  }
  submissions(id, after = 0, problemId) {
    if (!Number.isSafeInteger(after) || after < 0)
      throw failure("Invalid paper submission cursor.");
    if (problemId !== undefined) {
      contract.checkedId(problemId);
      const p = this.db
        .prepare("SELECT session_id FROM paper_tutor_problems WHERE id=?")
        .get(problemId);
      if (!p || p.session_id !== id)
        throw failure("This writing prompt belongs to another session.");
    }
    return this.db
      .prepare(
        `SELECT b.sequence,b.attempt_id,b.problem_id,b.read_at,a.received_at,a.manifest FROM paper_tutor_attempt_bindings b JOIN paper_attempts a ON a.id=b.attempt_id WHERE b.session_id=? AND b.sequence>?${problemId ? " AND b.problem_id=?" : ""} ORDER BY b.sequence LIMIT 20`,
      )
      .all(id, after, ...(problemId ? [problemId] : []))
      .map((row) => ({
        submissionId: row.attempt_id,
        problemId: row.problem_id,
        cursor: row.sequence,
        receivedAt: row.received_at,
        pageCount: JSON.parse(row.manifest).pages.length,
        availableToTutor: !!row.read_at,
      }));
  }
  snapshot(input) {
    const row = this.authorize(input),
      submissions = this.submissions(row.id, input.after ?? 0, input.problemId);
    return {
      sessionId: row.id,
      status: row.status,
      session: this.session(row.id),
      submissions,
      cursor: submissions.at(-1)?.cursor ?? input.after ?? 0,
    };
  }
  wait(input) {
    const timeout = input.timeoutMs ?? 30000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 30000)
      throw failure("Wait for at most 30 seconds at a time.");

    const result = this.snapshot(input);
    if (
      result.submissions.length ||
      result.status !== "active" ||
      timeout === 0
    )
      return Promise.resolve(result);
    if (this.waiters.size >= 32)
      throw failure("Too many paper submission waits are active.");

    return new Promise((resolve, reject) => {
      const waiter = {
        input,
        finish: () => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          try {
            resolve(this.snapshot(input));
          } catch (error) {
            reject(error);
          }
        },
      };
      waiter.timer = setTimeout(waiter.finish, timeout);
      this.waiters.add(waiter);
    });
  }
  notify() {
    for (const waiter of [...this.waiters]) {
      try {
        const result = this.snapshot(waiter.input);
        if (result.submissions.length || result.status !== "active")
          waiter.finish();
      } catch {
        waiter.finish();
      }
    }
  }
  read(input) {
    const row = this.authorize(input);
    contract.checkedId(input.submissionId);
    const binding = this.db
      .prepare(
        "SELECT * FROM paper_tutor_attempt_bindings WHERE attempt_id=? AND session_id=?",
      )
      .get(input.submissionId, row.id);
    if (!binding)
      throw failure("This submission belongs to another paper session.");

    const attempt = this.paper.attempt(input.submissionId),
      requested =
        input.pageIndexes ??
        attempt.manifest.pages.slice(0, 2).map((p) => p.index);
    if (
      !Array.isArray(requested) ||
      !requested.length ||
      requested.length > 3 ||
      new Set(requested).size !== requested.length ||
      requested.some(
        (index) =>
          !Number.isInteger(index) || index < 0 || index >= attempt.pageCount,
      )
    )
      throw failure("Read 1–3 valid ordered page indexes at a time.");

    const indexes = [...requested].sort((a, b) => a - b),
      assets = this.paper.pages(input.submissionId),
      pages = [];
    let bytes = 0;
    for (const index of indexes) {
      const page = assets[index];
      if (bytes + page.bytes.length > READ_BYTES) break;
      bytes += page.bytes.length;
      pages.push({
        index,
        name: attempt.manifest.pages[index].name,
        mime: page.mime,
        hash: page.hash,
        data: page.bytes.toString("base64"),
      });
    }
    const p = this.db
      .prepare("SELECT * FROM paper_tutor_problems WHERE id=?")
      .get(binding.problem_id);
    this.db
      .prepare(
        "UPDATE paper_tutor_attempt_bindings SET read_at=COALESCE(read_at,?) WHERE attempt_id=?",
      )
      .run(new Date().toISOString(), attempt.id);
    this.onRead(attempt.id);
    return {
      sessionId: row.id,
      submissionId: attempt.id,
      documentId: attempt.documentId,
      revision: attempt.manifest.revision,
      problem: problem(p),
      pageCount: attempt.pageCount,
      pages,
      nextPageIndexes: attempt.manifest.pages
        .map((page) => page.index)
        .filter((index) => index > pages.at(-1).index),
      receivedAt: attempt.receivedAt,
    };
  }
  end(input) {
    const row = this.authorize(input);
    this.db
      .prepare(
        "UPDATE paper_tutor_sessions SET status='ended',ended_at=COALESCE(ended_at,?) WHERE id=?",
      )
      .run(new Date().toISOString(), row.id);
    if (this.authority.activeSessionId === row.id) {
      this.authority.activeSessionId = null;
      this.saveAuthority();
    }
    this.changed();
    return this.snapshot(input);
  }
  async call(operation, input = {}) {
    if (this.closed)
      throw failure("Recall is closing. Your paper work is saved.");
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw failure("Invalid paper session request.");
    switch (operation) {
      case "start":
        return this.start(input);
      case "publish":
        return this.publish(input);
      case "status":
        return this.snapshot(input);
      case "wait":
        return this.wait(input);
      case "read":
        return this.read(input);
      case "end":
        return this.end(input);
      default:
        throw failure("Unknown paper session operation.");
    }
  }
  close() {
    this.closed = true;
    for (const waiter of [...this.waiters]) waiter.finish();
  }
}
module.exports = { PaperSessions };
