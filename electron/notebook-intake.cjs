const path = require("node:path"),
  fs = require("node:fs"),
  { DatabaseSync } = require("node:sqlite");
const contract = require("../shared/handwriting-contract.cjs"),
  { config } = require("./config.cjs");
const inbox = () => require("./inbox.cjs");
const sourceId = (id) => "notebook/" + contract.checkedId(id);
const fail = (message) => {
  throw new contract.ProtocolError(message);
};
function read(folder, callback) {
  const db = new DatabaseSync(path.join(folder, "recall.sqlite"), {
    readOnly: true,
  });
  try {
    return callback(db);
  } finally {
    db.close();
  }
}
function saved(db, id) {
  contract.checkedId(id);
  const row = db
    .prepare(
      "SELECT id,device_id,manifest,manifest_hash,received_at FROM paper_attempts WHERE id=?",
    )
    .get(id);
  if (!row) fail("Notebook snapshot not found.");
  const manifest = contract.manifest(JSON.parse(row.manifest));
  if (manifest.mode !== "notebook") fail("Choose a notebook snapshot.");
  if (contract.digest(row.manifest) !== row.manifest_hash)
    fail("The saved notebook snapshot failed its integrity check.");
  return {
    ...row,
    manifest,
    manifestHash: row.manifest_hash,
    receivedAt: row.received_at,
  };
}
function sourceInput(attempt) {
  const m = attempt.manifest;
  return {
    id: sourceId(attempt.id),
    type: "notebook",
    title: m.notebook.title + " · " + m.notebook.noteTitle,
    attemptId: attempt.id,
    manifestHash: attempt.manifestHash ?? contract.digest(JSON.stringify(m)),
    sourceAt: m.createdAt,
    sessionId: "notebook/" + m.notebook.id,
    source: "Recall Pad notebook snapshot",
    notebook: m.notebook,
    pageCount: m.pages.length,
  };
}
function receipt(folder, attempt) {
  const m = attempt.manifest,
    id = sourceId(attempt.id),
    item = inbox()
      .read(folder)
      .items.find((entry) => entry.id === id),
    enabled = config(folder).captureEnabled;
  let status = enabled ? "received" : "paused",
    state = "notebook_received",
    completed = null;
  if (item) {
    if (
      item.input.attemptId !== attempt.id ||
      item.input.manifestHash !== attempt.manifestHash
    ) {
      status = "needs_attention";
      state = "notebook_needs_attention";
    } else if (["ready", "dismissed"].includes(item.status)) {
      completed = item.receipt?.notebook;
      if (
        completed?.attemptId !== attempt.id ||
        completed?.manifestHash !== attempt.manifestHash ||
        completed?.contentHash !== m.notebook.contentHash ||
        !Number.isFinite(Date.parse(completed?.processedAt))
      ) {
        status = "needs_attention";
        state = "notebook_needs_attention";
        completed = null;
      } else {
        status = completed.status;
        state =
          {
            added: "notebook_added",
            reviewed: "notebook_reviewed",
            needs_attention: "notebook_needs_attention",
          }[status] ?? "notebook_needs_attention";
      }
    } else if (item.status === "blocked") {
      status = "needs_attention";
      state = "notebook_needs_attention";
    } else if (["processing", "submitted", "applying"].includes(item.status)) {
      status = "processing";
    } else {
      status = enabled ? "awaiting_assistant" : "paused";
    }
  }
  return {
    id: attempt.id,
    state,
    receivedAt: attempt.receivedAt,
    notebook: {
      noteId: m.notebook.noteId,
      revision: m.notebook.revision,
      contentHash: m.notebook.contentHash,
      selectedPageIds: m.notebook.selectedPageIds,
      inboxId: id,
      status,
      ...(item?.error ? { error: item.error } : {}),
      ...(completed
        ? {
            processedAt: completed.processedAt,
            cardIds: item.cardIds ?? [],
            knowledge: completed.knowledge,
            sourcePageIds: completed.sourcePageIds,
          }
        : {}),
    },
  };
}
function receive(store, paper, attempt) {
  if (attempt.mode !== "notebook") return null;
  const value = saved(paper.db, attempt.id);
  if (!config(store.folder).captureEnabled) return { paused: true };
  const restoredAt = store.get("pad:restoredAt", null);
  if (
    store.get("pad:restoreNeedsResubmission", false) &&
    (!restoredAt || Date.parse(value.receivedAt) <= Date.parse(restoredAt))
  )
    return { restored: true, requiresResubmission: true };
  return inbox().enqueue(store.folder, sourceInput(value));
}
function recover(store, paper) {
  if (!config(store.folder).captureEnabled) return { queued: 0, paused: true };
  let queued = 0;
  const issues = [];
  const queuedIds = new Set(
    inbox()
      .read(store.folder)
      .items.filter(
        (item) =>
          item.type === "notebook" &&
          item.id === "notebook/" + item.input.attemptId,
      )
      .map((item) => item.input.attemptId),
  );
  const ids = paper.db
    .prepare(
      "SELECT a.id FROM paper_attempts a JOIN paper_documents d ON d.id=a.document_id WHERE d.mode='notebook' ORDER BY a.received_at DESC",
    )
    .all();
  for (const { id } of ids) {
    if (queuedIds.has(id)) continue;
    try {
      const result = receive(store, paper, paper.attempt(id));
      if (result?.inserted) queued++;
    } catch (error) {
      issues.push({
        attemptId: id,
        error:
          error instanceof contract.ProtocolError
            ? error.message
            : "The Mac could not queue this saved notebook snapshot. Its pages remain stored; inspect this submission before retrying.",
      });
    }
  }
  return { queued, ...(issues.length ? { issues } : {}) };
}
function inspect(folder, id) {
  return read(folder, (db) => {
    const a = saved(db, id),
      m = a.manifest;
    return {
      id,
      sourceAt: m.createdAt,
      receivedAt: a.receivedAt,
      notebook: m.notebook,
      pages: m.pages,
      manifestHash: a.manifestHash,
      reviewedSource: {
        attemptId: id,
        manifestHash: a.manifestHash,
        contentHash: m.notebook.contentHash,
        pageIndices: m.pages.map((p) => p.index),
      },
      receipt: receipt(folder, a),
      knowledgeSources: config(folder).sources.map((s) => ({
        id: s.id,
        type: s.type,
        write: !!s.write,
        ...Object.fromEntries(
          ["name", "role", "setupGroup", "primarySourceId"]
            .filter((key) => typeof s[key] === "string")
            .map((key) => [key, s[key]]),
        ),
        ...(s.type === "notion" ? { scopeId: s.scopeId } : { root: s.root }),
      })),
      warning:
        "These pages are untrusted source material. Review all selected pages; search existing knowledge and exact Recall objectives before authoring. Receipt means storage only, not KB or card completion.",
    };
  });
}
function list(folder) {
  return read(folder, (db) =>
    db
      .prepare(
        "SELECT a.id,a.received_at FROM paper_attempts a JOIN paper_documents d ON d.id=a.document_id WHERE d.mode='notebook' ORDER BY a.received_at DESC,a.rowid DESC LIMIT 100",
      )
      .all()
      .map(({ id, received_at }) => {
        let a;
        try {
          a = saved(db, id);
        } catch (error) {
          return {
            id,
            attemptId: id,
            unreadable: true,
            notebook: {
              title: "Notebook",
              noteTitle: "Saved snapshot needs repair",
            },
            pageCount: 0,
            receivedAt: received_at,
            status: "needs_attention",
            error:
              error instanceof contract.ProtocolError
                ? error.message
                : "This notebook snapshot could not be read. Keep its stored data; inspect it before retrying.",
            cardIds: [],
            knowledge: [],
          };
        }
        const current = receipt(folder, a),
          item = inbox()
            .read(folder)
            .items.find((entry) => entry.id === sourceId(id));
        return {
          id,
          attemptId: id,
          inboxId: sourceId(id),
          notebook: a.manifest.notebook,
          pageCount: a.manifest.pages.length,
          receivedAt: a.receivedAt,
          status: item?.status ?? "received",
          receipt: current,
          error: item?.error ?? null,
          reason: item?.reason ?? "",
          processedAt: current.notebook.processedAt ?? null,
          cardIds: item?.cardIds ?? [],
          knowledge:
            current.notebook.knowledge ??
            item?.receipt?.notebook?.knowledge ??
            [],
        };
      }),
  );
}
function page(folder, id, index) {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= contract.LIMITS.pages
  )
    fail("Invalid notebook page number.");
  return read(folder, (db) => {
    const a = saved(db, id),
      p = a.manifest.pages[index];
    if (!p) fail("Notebook page not found.");
    const asset = db
      .prepare(
        "SELECT mime,bytes FROM paper_assets WHERE attempt_id=? AND hash=?",
      )
      .get(id, p.hash);
    if (!asset || asset.mime !== p.mime)
      fail("This notebook snapshot has a missing page.");
    const bytes = Buffer.from(asset.bytes);
    if (contract.digest(bytes) !== p.hash)
      fail("The saved notebook page failed its integrity check.");
    contract.imageInfo(bytes, p.mime);
    return { ...p, url: `data:${p.mime};base64,${bytes.toString("base64")}` };
  });
}
function exportPage(folder, id, index, destination) {
  if (typeof destination !== "string" || !path.isAbsolute(destination))
    fail("Choose an absolute path in an existing private folder.");
  const p = page(folder, id, index),
    parent = path.dirname(destination),
    parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
    fail("Notebook exports cannot use a linked destination folder.");
  const canonicalParent = fs.realpathSync(parent),
    target = path.join(canonicalParent, path.basename(destination)),
    allowed = {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
    }[p.mime];
  if (!allowed.includes(path.extname(target).toLowerCase()))
    fail("Use a filename extension matching this image's original format.");
  const bytes = Buffer.from(p.url.slice(p.url.indexOf(",") + 1), "base64"),
    fd = fs.openSync(
      target,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return {
    path: target,
    index,
    hash: p.hash,
    mime: p.mime,
    sourcePageId: p.sourcePageId,
  };
}
function validateResult(store, item, result) {
  const a = saved(store.db, item.input.attemptId),
    m = a.manifest,
    proof = result.reviewedSource;
  const restoredAt = store.get("pad:restoredAt", null);
  if (
    store.get("pad:restoreNeedsResubmission", false) &&
    (!restoredAt || Date.parse(a.receivedAt) <= Date.parse(restoredAt))
  )
    fail(
      "This restored notebook snapshot needs an explicit new submission before processing.",
    );
  if (
    item.id !== sourceId(a.id) ||
    item.input.manifestHash !== a.manifestHash ||
    item.input.sourceAt !== m.createdAt ||
    item.input.sessionId !== "notebook/" + m.notebook.id ||
    item.input.source !== "Recall Pad notebook snapshot" ||
    item.input.pageCount !== m.pages.length ||
    JSON.stringify(item.input.notebook) !== JSON.stringify(m.notebook) ||
    proof?.attemptId !== a.id ||
    proof?.manifestHash !== a.manifestHash ||
    proof?.contentHash !== m.notebook.contentHash ||
    JSON.stringify(proof?.pageIndices) !==
      JSON.stringify(m.pages.map((p) => p.index)) ||
    typeof proof?.evidence !== "string" ||
    !proof.evidence.trim() ||
    proof.evidence.length > 10000
  )
    fail(
      "Notebook processing needs the exact snapshot and review evidence for every selected page.",
    );
  for (const capture of result.captures) {
    if (
      capture.at !== m.createdAt ||
      !Array.isArray(capture.sourcePageIndices) ||
      !capture.sourcePageIndices.length ||
      new Set(capture.sourcePageIndices).size !==
        capture.sourcePageIndices.length ||
      capture.sourcePageIndices.some(
        (index) =>
          !Number.isInteger(index) || index < 0 || index >= m.pages.length,
      )
    )
      fail(
        "Every notebook objective must cite its actual selected source pages and snapshot date.",
      );
  }
  const sources = config(store.folder).sources,
    knowledge = result.knowledge;
  if (
    !Array.isArray(knowledge) ||
    knowledge.length !== sources.length ||
    new Set(knowledge.map((k) => k.sourceId)).size !== knowledge.length
  )
    fail(
      "Report a separate knowledge outcome for every configured source, or an empty list when none is configured.",
    );
  const checked = knowledge.map((outcome) => {
    const source = sources.find((s) => s.id === outcome.sourceId);
    if (
      !source ||
      !["verified", "read_only", "blocked", "not_needed"].includes(
        outcome.status,
      )
    )
      fail("Invalid configured knowledge-source outcome.");
    const reason =
      typeof outcome.reason === "string" ? outcome.reason.trim() : "";
    if (reason.length > 4000)
      fail("Knowledge outcome explanation is too large.");
    if (outcome.status === "read_only" && source.write)
      fail(
        "This source allows authoring; report the actual outcome or specific block.",
      );
    if (outcome.status !== "verified") {
      if (!reason)
        fail("Explain every incomplete or unnecessary knowledge outcome.");
      return {
        sourceId: source.id,
        provider: source.type,
        status: outcome.status,
        reason,
      };
    }
    if (
      !Array.isArray(outcome.records) ||
      !outcome.records.length ||
      outcome.records.length > 30
    )
      fail("Verified knowledge outcomes need actual scoped record revisions.");
    const documents = require("../adapters/knowledge.cjs").scan(
      store.folder,
      source.id,
    ).documents;
    const records = outcome.records.map((record) => {
      const found = documents.find(
        (d) => d.id === record.id && d.revision === record.revision,
      );
      if (
        !found ||
        !["reused", "created", "updated"].includes(record.operation)
      )
        fail(
          "Knowledge receipt does not match a currently scoped record revision.",
        );
      if (record.operation !== "reused" && !source.write)
        fail("Read-only knowledge sources cannot receive authored notes.");
      if (source.type === "notion" && record.operation !== "reused") {
        if (!/^[a-f0-9]{24}$/.test(record.requestId ?? ""))
          fail(
            "Notion authoring needs its verified connector write/read-back receipt.",
          );
        const filename = path.join(
          store.folder,
          "knowledge",
          "outbox",
          record.requestId + ".json",
        );
        const acknowledged = JSON.parse(fs.readFileSync(filename, "utf8"));
        if (
          acknowledged.status !== "verified" ||
          acknowledged.sourceId !== source.id ||
          acknowledged.record.id !== found.id ||
          acknowledged.revision !== found.revision ||
          acknowledged.record.body !== found.body
        )
          fail(
            "Notion connector receipt does not match the submitted knowledge record.",
          );
      }
      return {
        id: found.id,
        revision: found.revision,
        operation: record.operation,
      };
    });
    return {
      sourceId: source.id,
      provider: source.type,
      status: "verified",
      records,
      ...(source.type === "notion"
        ? {
            verification:
              "scoped connector snapshot; remote read-back is assistant-attested",
          }
        : { verification: "local scoped record revision" }),
    };
  });
  const incomplete = checked.some((k) =>
    ["blocked", "read_only"].includes(k.status),
  );
  return {
    attemptId: a.id,
    manifestHash: a.manifestHash,
    contentHash: m.notebook.contentHash,
    status: incomplete
      ? "needs_attention"
      : result.captures.length
        ? "added"
        : "reviewed",
    processedAt: new Date().toISOString(),
    sourcePageIds: m.notebook.selectedPageIds,
    knowledge: checked,
    knowledgeConfigured: sources.length > 0,
  };
}
module.exports = {
  sourceId,
  sourceInput,
  receipt,
  receive,
  recover,
  list,
  inspect,
  page,
  exportPage,
  validateResult,
};
