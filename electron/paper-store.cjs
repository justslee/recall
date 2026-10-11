const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const contract = require("../shared/handwriting-contract.cjs");
const Error = (message) => new contract.ProtocolError(message);
const privateFiles = require("./private-files.cjs");
const { presentationFor } = require("./presentation.cjs");
function migratePaper(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_questions(id TEXT PRIMARY KEY,handoff_id TEXT NOT NULL,card_id TEXT NOT NULL,reference_hash TEXT NOT NULL,front TEXT NOT NULL,reference TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS paper_questions_handoff ON paper_questions(handoff_id,card_id,reference_hash);
    CREATE TABLE IF NOT EXISTS paper_documents(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,mode TEXT NOT NULL,card_id TEXT,latest_revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS paper_attempts(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,device_id TEXT NOT NULL,card_id TEXT,question_id TEXT,manifest TEXT NOT NULL,manifest_hash TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,received_at TEXT NOT NULL,feedback TEXT,error TEXT);
    CREATE INDEX IF NOT EXISTS paper_attempts_card ON paper_attempts(card_id,received_at DESC);
    CREATE TABLE IF NOT EXISTS paper_assets(attempt_id TEXT NOT NULL REFERENCES paper_attempts(id),hash TEXT NOT NULL,mime TEXT NOT NULL,page_index INTEGER,bytes BLOB NOT NULL,PRIMARY KEY(attempt_id,hash));
    CREATE TABLE IF NOT EXISTS paper_staging(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,manifest TEXT NOT NULL,manifest_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS paper_assessments(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES paper_attempts(id),reference_hash TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,feedback TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS paper_device_grants(device_id TEXT NOT NULL,handoff_id TEXT NOT NULL,mode TEXT NOT NULL,questions TEXT NOT NULL,offline INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(device_id,handoff_id));
    CREATE TABLE IF NOT EXISTS paper_tutor_sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,client TEXT NOT NULL,conversation_id TEXT,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,current_problem_id TEXT,created_at TEXT NOT NULL,ended_at TEXT);
    CREATE TABLE IF NOT EXISTS paper_tutor_problems(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES paper_tutor_sessions(id),revision INTEGER NOT NULL,title TEXT NOT NULL,prompt TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(session_id,revision));
    CREATE TABLE IF NOT EXISTS paper_tutor_attempt_bindings(sequence INTEGER PRIMARY KEY AUTOINCREMENT,attempt_id TEXT NOT NULL UNIQUE REFERENCES paper_attempts(id),session_id TEXT NOT NULL REFERENCES paper_tutor_sessions(id),problem_id TEXT NOT NULL REFERENCES paper_tutor_problems(id),device_id TEXT NOT NULL,read_at TEXT);
    CREATE INDEX IF NOT EXISTS paper_tutor_attempt_session ON paper_tutor_attempt_bindings(session_id,problem_id);
  `);
}
class PaperStore {
  constructor(store, { decodeImage } = {}) {
    this.store = store;
    this.db = store.db;
    this.decodeImage = decodeImage;
    // Additive compatibility for earlier schema-3 development profiles.
    migratePaper(this.db);
    this.stageFolder = privateFiles.directory(
      path.join(store.folder, "pad-staging"),
    );
    this.db
      .prepare(
        "UPDATE paper_attempts SET status='interrupted',error='Evaluation was interrupted. Retry explicitly.' WHERE status='evaluating' OR (document_id IN (SELECT id FROM paper_documents WHERE mode='study') AND status IN ('queued','needs_resume'))",
      )
      .run();
    this.db
      .prepare(
        "UPDATE paper_attempts SET status='needs_resume' WHERE document_id IN (SELECT id FROM paper_documents WHERE mode='tutor') AND status IN ('pasting','queued')",
      )
      .run();
    this.db
      .prepare(
        "UPDATE paper_assessments SET status='interrupted',error='Evaluation was interrupted. Retry explicitly.' WHERE status='evaluating'",
      )
      .run();
  }
  questions(handoffId, ids) {
    contract.checkedId(handoffId);
    if (!Array.isArray(ids) || ids.length > 1000)
      throw Error("Invalid study session.");
    const fronts = [];
    let frontBytes = 0;
    const appendFront = (front) => {
      frontBytes += Buffer.byteLength(JSON.stringify(front));
      if (frontBytes > contract.LIMITS.frontBytes)
        throw Error(
          "These question fronts exceed 16 MB. Start a smaller study session.",
        );
      fronts.push(front);
    };
    this.store.transaction(() => {
      for (const id of [...new Set(ids)].slice(0, contract.LIMITS.questions)) {
        const card = presentationFor(
          JSON.parse(this.store.card(id).content),
          this.store.presentations,
        );
        if (!["concept", "math"].includes(card.kind)) continue;
        const question = contract.questionFront(card.prompt, this.decodeImage);
        const reference = {
          title: contract.referenceText(card.title),
          prompt: contract.referenceText(card.prompt),
          answer: contract.referenceText(
            card.presentation?.answer ?? card.answer,
          ),
          kind: card.kind,
          ...(question.images.length
            ? { questionImages: question.images }
            : {}),
          ...(card.numeric ? { numeric: card.numeric } : {}),
        };
        if (
          reference.title.length > 12000 ||
          reference.prompt.length > 40000 ||
          reference.answer.length > 48000
        )
          throw Error("This card is too large for a handwriting handoff.");
        const referenceHash = contract.digest(JSON.stringify(reference));
        const old = this.db
          .prepare(
            "SELECT id,front FROM paper_questions WHERE handoff_id=? AND card_id=? AND reference_hash=?",
          )
          .get(handoffId, id, referenceHash);
        if (old) {
          appendFront(JSON.parse(old.front));
          continue;
        }
        const front = {
          id: crypto.randomUUID(),
          cardId: id,
          title: reference.title,
          prompt: question.html,
          topic: String(card.topic || ""),
          kind: card.kind,
          referenceHash,
        };
        this.db
          .prepare("INSERT INTO paper_questions VALUES(?,?,?,?,?,?,?)")
          .run(
            front.id,
            handoffId,
            id,
            referenceHash,
            JSON.stringify(front),
            JSON.stringify(reference),
            new Date().toISOString(),
          );
        appendFront(front);
      }
    });
    return fronts;
  }
  reference(questionId) {
    const row = this.db
      .prepare(
        "SELECT reference,reference_hash,card_id,handoff_id FROM paper_questions WHERE id=?",
      )
      .get(questionId);
    if (!row)
      throw Error(
        "This attempt needs its original reference. Send the question again.",
      );
    return { ...row, value: JSON.parse(row.reference) };
  }
  assistantBinding(deviceId, m) {
    if (m.version !== 2) return null;

    const problem = this.db
        .prepare("SELECT session_id FROM paper_tutor_problems WHERE id=?")
        .get(m.questionId),
      grant = this.db
        .prepare(
          "SELECT mode,questions FROM paper_device_grants WHERE device_id=? AND handoff_id=?",
        )
        .get(deviceId, m.handoffId);
    if (
      !problem ||
      problem.session_id !== m.handoffId ||
      grant?.mode !== "tutor" ||
      !JSON.parse(grant.questions).includes(m.questionId)
    )
      throw Error("This writing prompt was not issued to this device.");

    return { sessionId: m.handoffId, problemId: m.questionId };
  }
  sameDocumentBinding(m) {
    const earlier = this.db
      .prepare(
        "SELECT manifest FROM paper_attempts WHERE document_id=? LIMIT 1",
      )
      .get(m.documentId);
    if (!earlier) return;

    const old = JSON.parse(earlier.manifest);
    if (
      (m.version === 2 || old.version === 2) &&
      (m.version !== old.version ||
        m.handoffId !== old.handoffId ||
        m.questionId !== old.questionId)
    )
      throw Error("A bound sheet belongs to its original writing prompt.");
  }
  prepare(deviceId, input) {
    const m = contract.manifest(input),
      serialized = JSON.stringify(m),
      hash = contract.digest(serialized);
    const old = this.db
      .prepare(
        "SELECT device_id,manifest_hash,received_at FROM paper_attempts WHERE id=?",
      )
      .get(m.id);
    if (old) {
      if (old.device_id !== deviceId || old.manifest_hash !== hash)
        throw Error("Submission identifier conflicts with existing work.");
      return { id: m.id, missing: [], state: "received" };
    }
    this.assistantBinding(deviceId, m);
    this.sameDocumentBinding(m);
    const document = this.db
      .prepare("SELECT device_id,mode,card_id FROM paper_documents WHERE id=?")
      .get(m.documentId);
    const ref = m.mode === "study" ? this.reference(m.questionId) : null;
    if (ref && ref.handoff_id !== m.handoffId)
      throw Error("Question does not belong to this handoff.");
    if (
      document &&
      (document.device_id !== deviceId ||
        document.mode !== m.mode ||
        document.card_id !== (ref?.card_id ?? null))
    )
      throw Error("Document belongs to a different question or device.");
    const staged = this.db
      .prepare("SELECT device_id,manifest_hash FROM paper_staging WHERE id=?")
      .get(m.id);
    if (
      staged &&
      (staged.device_id !== deviceId || staged.manifest_hash !== hash)
    )
      throw Error("Submission identifier conflicts with staged work.");
    privateFiles.directory(path.join(this.stageFolder, m.id));
    this.db
      .prepare("INSERT OR IGNORE INTO paper_staging VALUES(?,?,?,?,?)")
      .run(m.id, deviceId, serialized, hash, new Date().toISOString());
    const missing = this.assets(m)
      .map((a) => a.hash)
      .filter((h) => !this.stagedExists(m.id, h));
    return { id: m.id, missing, state: "staging" };
  }
  assets(m) {
    return [
      ...new Map(
        m.pages.map((p) => [
          p.hash,
          { ...p, limit: contract.LIMITS.imageBytes },
        ]),
      ).values(),
      ...(m.drawing
        ? [
            {
              ...m.drawing,
              mime: "application/x-pencilkit",
              limit: contract.LIMITS.drawingBytes,
            },
          ]
        : []),
    ];
  }
  stagedExists(id, hash) {
    const file = path.join(this.stageFolder, id, hash);
    if (!fs.existsSync(file)) return false;
    const s = fs.lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink()) throw Error("Unsafe staged asset.");
    return true;
  }
  stage(deviceId, id, hash, bytes) {
    contract.checkedId(id);
    const row = this.db
      .prepare("SELECT * FROM paper_staging WHERE id=? AND device_id=?")
      .get(id, deviceId);
    if (!row) throw Error("Upload a manifest before its assets.");
    const m = JSON.parse(row.manifest),
      asset = this.assets(m).find((a) => a.hash === hash);
    if (!asset) throw Error("Asset was not declared.");
    bytes = Buffer.from(bytes);
    if (
      !bytes.length ||
      bytes.length > asset.limit ||
      contract.digest(bytes) !== hash
    )
      throw Error("Asset size or digest is invalid.");
    if (asset.mime !== "application/x-pencilkit") {
      const info = contract.imageInfo(bytes, asset.mime, this.decodeImage);
      if (info.width !== asset.width || info.height !== asset.height)
        throw Error("Declared image dimensions differ from its contents.");
    } else if (bytes.length !== m.drawing.bytes)
      throw Error("Editable drawing size is invalid.");
    let total = bytes.length;
    for (const a of this.assets(m))
      if (a.hash !== hash && this.stagedExists(id, a.hash))
        total += fs.statSync(path.join(this.stageFolder, id, a.hash)).size;
    if (total > contract.LIMITS.totalBytes)
      throw Error("Split work larger than 64 MB into smaller submissions.");
    const target = path.join(this.stageFolder, id, hash);
    const tmp = target + "." + crypto.randomUUID() + ".tmp";
    privateFiles.write(tmp, bytes);
    const fd = fs.openSync(tmp, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
    const stagedTotal =
      m.pages.reduce((sum, p) => {
        return (
          sum +
          (this.stagedExists(id, p.hash)
            ? fs.statSync(path.join(this.stageFolder, id, p.hash)).size
            : 0)
        );
      }, 0) +
      (m.drawing && this.stagedExists(id, m.drawing.hash)
        ? m.drawing.bytes
        : 0);
    if (stagedTotal > contract.LIMITS.totalBytes)
      throw Error("Split work larger than 64 MB into smaller submissions.");
    return { hash, stored: true };
  }
  commit(deviceId, id) {
    contract.checkedId(id);
    const existing = this.db
      .prepare("SELECT device_id,received_at FROM paper_attempts WHERE id=?")
      .get(id);
    if (existing) {
      if (existing.device_id !== deviceId)
        throw Error("Submission belongs to another device.");
      return { id, state: "received", receivedAt: existing.received_at };
    }
    const row = this.db
      .prepare("SELECT * FROM paper_staging WHERE id=? AND device_id=?")
      .get(id, deviceId);
    if (!row) throw Error("Submission is not staged.");
    const m = JSON.parse(row.manifest),
      assets = this.assets(m),
      receivedAt = new Date().toISOString();
    let total = 0;
    const data = assets.map((a) => {
      if (!this.stagedExists(id, a.hash))
        throw Error("Submission still has missing pages.");
      const bytes = fs.readFileSync(path.join(this.stageFolder, id, a.hash));
      total += bytes.length;
      if (
        total > contract.LIMITS.totalBytes ||
        contract.digest(bytes) !== a.hash
      )
        throw Error("Staged work failed its integrity check.");
      if (a.mime !== "application/x-pencilkit")
        contract.imageInfo(bytes, a.mime, this.decodeImage);
      return { ...a, data: bytes };
    });
    const lengths = new Map(
      data.map((asset) => [asset.hash, asset.data.length]),
    );
    const expandedBytes =
      m.pages.reduce((sum, page) => sum + lengths.get(page.hash), 0) +
      (m.drawing?.bytes ?? 0);
    if (expandedBytes > contract.LIMITS.totalBytes)
      throw Error("Split work larger than 64 MB into smaller submissions.");
    const ref = m.mode === "study" ? this.reference(m.questionId) : null;
    this.store.transaction(() => {
      const binding = this.assistantBinding(deviceId, m);
      this.sameDocumentBinding(m);
      // A second manifest could have staged the same document before its first commit.
      const document = this.db
        .prepare(
          "SELECT device_id,mode,card_id FROM paper_documents WHERE id=?",
        )
        .get(m.documentId);
      if (
        document &&
        (document.device_id !== deviceId ||
          document.mode !== m.mode ||
          document.card_id !== (ref?.card_id ?? null))
      )
        throw Error("Document belongs to a different question or device.");
      const revision = this.db
        .prepare("SELECT manifest FROM paper_attempts WHERE document_id=?")
        .all(m.documentId)
        .map((r) => JSON.parse(r.manifest))
        .find((a) => a.revision === m.revision);
      if (
        revision &&
        (JSON.stringify(revision.pages) !== JSON.stringify(m.pages) ||
          JSON.stringify(revision.drawing) !== JSON.stringify(m.drawing))
      )
        throw Error(
          "Document revision conflicts with an earlier submission. Save a new revision.",
        );
      this.db
        .prepare(
          "INSERT INTO paper_documents VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET latest_revision=max(latest_revision,excluded.latest_revision),updated_at=excluded.updated_at",
        )
        .run(
          m.documentId,
          deviceId,
          m.mode,
          ref?.card_id ?? null,
          m.revision,
          receivedAt,
        );
      this.db
        .prepare("INSERT INTO paper_attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          m.documentId,
          deviceId,
          ref?.card_id ?? null,
          m.questionId,
          row.manifest,
          row.manifest_hash,
          "received",
          m.createdAt,
          receivedAt,
          null,
          null,
        );
      if (binding)
        this.db
          .prepare(
            "INSERT INTO paper_tutor_attempt_bindings(attempt_id,session_id,problem_id,device_id,read_at) VALUES(?,?,?,?,NULL)",
          )
          .run(id, binding.sessionId, binding.problemId, deviceId);
      for (const a of data)
        this.db
          .prepare("INSERT INTO paper_assets VALUES(?,?,?,?,?)")
          .run(id, a.hash, a.mime, a.index ?? null, a.data);
      this.db.prepare("DELETE FROM paper_staging WHERE id=?").run(id);
    });
    // A cleanup failure must not turn a durably committed attempt into a failed receipt.
    try {
      fs.rmSync(path.join(this.stageFolder, id), {
        recursive: true,
        force: true,
      });
    } catch {}
    return { id, state: "received", receivedAt };
  }
  receipt(deviceId, id) {
    contract.checkedId(id);
    const row = this.db
      .prepare(
        "SELECT received_at,status FROM paper_attempts WHERE id=? AND device_id=?",
      )
      .get(id, deviceId);
    if (!row) return { id, state: "staging" };
    const shared = this.db
      .prepare(
        "SELECT read_at FROM paper_tutor_attempt_bindings WHERE attempt_id=? AND device_id=?",
      )
      .get(id, deviceId);
    if (shared?.read_at)
      return { id, state: "available_to_tutor", receivedAt: row.received_at };
    const state =
      {
        evaluating: "evaluating",
        feedback_ready: "feedback_ready",
        staged_in_chat: "staged_in_chat",
        pasted_unverified: "pasted_unverified",
        copied: "copied",
        manual_page_tray: "manual_page_tray",
        pasting: "pasting",
        queued: "queued",
        failed: "needs_attention",
        interrupted: "needs_attention",
        needs_resume: "needs_resume",
      }[row.status] || "received";
    return { id, state, receivedAt: row.received_at };
  }
  attempt(id) {
    contract.checkedId(id);
    const row = this.db
      .prepare("SELECT * FROM paper_attempts WHERE id=?")
      .get(id);
    if (!row) throw Error("Handwritten attempt not found.");
    const m = JSON.parse(row.manifest);
    const assessments = this.db
      .prepare(
        "SELECT id,model,status,created_at,feedback,error FROM paper_assessments WHERE attempt_id=? ORDER BY created_at DESC,rowid DESC",
      )
      .all(id)
      .map((a) => ({
        ...a,
        createdAt: a.created_at,
        feedback: a.feedback ? JSON.parse(a.feedback) : null,
      }));
    return {
      id: row.id,
      documentId: row.document_id,
      cardId: row.card_id,
      mode: m.mode,
      destination: m.target ?? null,
      status: row.status,
      createdAt: row.created_at,
      receivedAt: row.received_at,
      pageCount: m.pages.length,
      feedback: row.feedback ? JSON.parse(row.feedback) : null,
      error: row.error,
      referenceHash:
        m.mode === "study" ? this.reference(m.questionId).reference_hash : null,
      manifest: m,
      deviceId: row.device_id,
      assessments,
    };
  }
  attempts(cardId, mode) {
    if (mode !== undefined && !["study", "tutor"].includes(mode))
      throw Error("Choose Study or Tutor Pad work.");
    const rows = mode
      ? this.db
          .prepare(
            `SELECT a.id FROM paper_attempts a JOIN paper_documents d ON d.id=a.document_id WHERE d.mode=?${cardId ? " AND a.card_id=?" : ""} ORDER BY a.received_at DESC,a.rowid DESC LIMIT 50`,
          )
          .all(mode, ...(cardId ? [cardId] : []))
      : cardId
        ? this.db
            .prepare(
              "SELECT id FROM paper_attempts WHERE card_id=? ORDER BY received_at DESC LIMIT 50",
            )
            .all(cardId)
        : this.db
            .prepare(
              "SELECT id FROM paper_attempts ORDER BY received_at DESC LIMIT 50",
            )
            .all();
    return rows.map((r) => {
      const a = this.attempt(r.id);
      delete a.manifest;
      delete a.deviceId;
      return a;
    });
  }
  pages(id) {
    const attempt = this.attempt(id),
      assets = this.db
        .prepare(
          "SELECT mime,bytes,hash FROM paper_assets WHERE attempt_id=? AND page_index IS NOT NULL",
        )
        .all(id);
    return attempt.manifest.pages.map((p) => {
      const asset = assets.find((a) => a.hash === p.hash);
      if (!asset) throw Error("This saved attempt has a missing page.");
      return { ...asset, page_index: p.index, bytes: Buffer.from(asset.bytes) };
    });
  }
  page(id, index) {
    if (!Number.isInteger(index) || index < 0 || index >= contract.LIMITS.pages)
      throw Error("Invalid page number.");
    const a = this.attempt(id),
      p = this.pages(id).find((p) => p.page_index === index);
    if (!p) throw Error("Page not found.");
    return {
      url: `data:${p.mime};base64,${p.bytes.toString("base64")}`,
      name: a.manifest.pages[index].name,
      index,
    };
  }
  state(id, status, { feedback = null, error = null } = {}) {
    this.attempt(id);
    this.db
      .prepare(
        "UPDATE paper_attempts SET status=?,feedback=?,error=? WHERE id=?",
      )
      .run(status, feedback ? JSON.stringify(feedback) : null, error, id);
    return this.attempt(id);
  }
  import(cardId, pages) {
    if (
      !Array.isArray(pages) ||
      !pages.length ||
      pages.length > contract.LIMITS.pages
    )
      throw Error("Choose 1–20 images.");
    const handoffId = crypto.randomUUID(),
      question = this.questions(handoffId, [cardId])[0];
    if (!question)
      throw Error("Handwriting is available for concept and math cards.");
    const assets = pages.map((p, index) => {
      const bytes = Buffer.from(p.bytes),
        info = contract.imageInfo(bytes, p.mime, this.decodeImage);
      return {
        index,
        name: String(p.name || `Page ${index + 1}`).slice(0, 160),
        mime: p.mime,
        hash: contract.digest(bytes),
        width: info.width,
        height: info.height,
        bytes,
      };
    });
    const m = {
      version: 1,
      id: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      revision: 1,
      mode: "study",
      questionId: question.id,
      handoffId,
      createdAt: new Date().toISOString(),
      pages: assets.map(({ bytes, ...p }) => p),
      drawing: null,
      evaluate: false,
    };
    this.prepare("local", m);
    for (const a of assets) this.stage("local", m.id, a.hash, a.bytes);
    this.commit("local", m.id);
    return this.attempt(m.id);
  }
}
module.exports = { PaperStore, migratePaper };
