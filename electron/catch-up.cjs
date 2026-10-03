const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { atomic, config, lock } = require("./config.cjs");
const connections = require("./connections.cjs"),
  inbox = require("./inbox.cjs");
const within = (p, root) => p === root || p.startsWith(root + path.sep);
function canonical(folder) {
  try {
    return fs.realpathSync(folder);
  } catch {
    throw Error("Project scope is unavailable; no capture made for: " + folder);
  }
}
function files(root) {
  const found = [];
  function visit(dir, depth) {
    if (depth > 5 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink() || ["subagents", "tool-results"].includes(e.name))
        continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) visit(p, depth + 1);
      else if (e.name.endsWith(".jsonl")) found.push(p);
    }
  }
  visit(root, 0);
  return found;
}
function message(row, host) {
  let role,
    content,
    at = row.timestamp;
  if (
    host === "codex" &&
    row.type === "response_item" &&
    row.payload?.type === "message"
  ) {
    if (
      row.payload.role === "assistant" &&
      row.payload.channel &&
      row.payload.channel !== "final"
    )
      return null;
    ({ role, content } = row.payload);
  } else if (host === "claude" && ["user", "assistant"].includes(row.type)) {
    if (
      row.type === "assistant" &&
      row.message?.stop_reason &&
      !["end_turn", "stop_sequence"].includes(row.message.stop_reason)
    )
      return null;
    if (
      row.type === "assistant" &&
      Array.isArray(row.message?.content) &&
      row.message.content.some((c) => c.type === "tool_use")
    )
      return null;
    ({ role, content } = row.message || {});
  } else return null;
  if (!["user", "assistant"].includes(role)) return null;
  const text =
    typeof content === "string"
      ? content
      : (content || [])
          .filter((x) => ["text", "input_text", "output_text"].includes(x.type))
          .map((x) => x.text || "")
          .join("\n");
  if (
    !text.trim() ||
    /<heartbeat>|<environment_context>|<permissions instructions>|<system-reminder>|# AGENTS\.md instructions/.test(
      text,
    )
  )
    return null;
  if (!Number.isFinite(Date.parse(at)))
    throw Error("Message lacks a readable timestamp");
  // Tool payloads, analysis and system instructions never enter the inbox.
  // Best-effort: common provider keys, cloud/chat tokens, JWTs, HTTP auth
  // headers and inline password/key assignments. Not a guarantee.
  const redacted = text
    .replace(
      /\b(?:sk-(?:proj-|ant-)?[\w-]{20,}|ghp_\w{20,}|gho_\w{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]{10,}|AIza[\w-]{30,}|ntn_\w{20,}|secret_\w{20,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})\b/g,
      "[credential removed]",
    )
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]{16,}/gi, "$1 [credential removed]")
    .replace(
      /\b((?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["']?)[^\s"']{8,}/gi,
      "$1[credential removed]",
    )
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[private key removed]",
    );
  return { role, text: redacted, at };
}
// A byte offset is valid only while the already-read prefix is unchanged.
// Session writers may rewrite earlier records (including metadata) in place.
const CHECKPOINT_VERSION = 2;
const CHUNK_BYTES = 8 * 1024 * 1024;
function prefixHash(handle, length) {
  const hash = crypto.createHash("sha256"),
    buffer = Buffer.alloc(64 * 1024);
  for (let offset = 0; offset < length;) {
    const count = fs.readSync(
      handle,
      buffer,
      0,
      Math.min(buffer.length, length - offset),
      offset,
    );
    if (!count)
      throw Error("Session changed while reading; retry on the next scan");
    hash.update(buffer.subarray(0, count));
    offset += count;
  }
  return hash.digest("hex");
}
function completeChunk(handle, offset, size) {
  const buffer = Buffer.alloc(Math.min(size - offset, CHUNK_BYTES));
  const count = fs.readSync(handle, buffer, 0, buffer.length, offset);
  const end = buffer.subarray(0, count).lastIndexOf(10);
  if (end < 0)
    throw Error("Incomplete or oversized record; waiting for a complete line");
  return buffer.subarray(0, end + 1).toString("utf8");
}
const turnKey = (input) =>
  inbox.hash(JSON.stringify([input.host, input.sessionId, input.messages]));
function scan(folder) {
  const cfg = connections.settings(folder),
    scope = cfg.catchUp;
  if (!config(folder).captureEnabled || !scope.enabled)
    return { paused: true, queued: 0 };
  const base = inbox.root(folder),
    stateFile = path.join(base, "catch-up.json");
  const release = lock(path.join(base, "scan-lock"));
  try {
    const state = fs.existsSync(stateFile)
      ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
      : { files: {} };
    const fingerprint = inbox.hash(JSON.stringify(scope));
    if (state.scope !== fingerprint) {
      state.files = {};
      state.scope = fingerprint;
    }
    const issues = [];
    // Match legacy byte-offset IDs as well as new content IDs. Replaying a
    // rewritten source must not duplicate a turn or replace its disposition.
    const knownTurns = new Map(
      inbox
        .read(folder)
        .items.filter((item) => item.type === "session")
        .map((item) => [turnKey(item.input), item.id]),
    );
    let queued = 0,
      checked = 0,
      remainingFiles = 0,
      replayedFiles = 0,
      excludedFiles = 0;
    for (const host of ["codex", "claude"]) {
      if (!connections.status(folder).hosts[host].connected) continue;
      const directory = path.join(
        path.dirname(cfg.hosts[host].instructions),
        host === "codex" ? "sessions" : "projects",
      );
      if (!fs.existsSync(directory)) {
        issues.push({
          source: host,
          error: "Session directory is unavailable",
        });
        continue;
      }
      for (const file of files(directory)) {
        const stat = fs.statSync(file),
          key = inbox.hash(file),
          prior = state.files[key];
        if (prior?.error) issues.push({ source: file, error: prior.error });
        if (
          stat.mtimeMs < Date.parse(scope.since) ||
          (prior?.version === CHECKPOINT_VERSION &&
            prior?.offset === stat.size &&
            prior?.mtime === stat.mtimeMs &&
            prior?.inode === stat.ino) ||
          (prior?.version === CHECKPOINT_VERSION &&
            prior?.inode === stat.ino &&
            prior?.error &&
            !prior.error.startsWith("Project scope is unavailable") &&
            prior.mtime === stat.mtimeMs)
        )
          continue;
        if (checked >= 100) {
          remainingFiles++;
          continue;
        }
        checked++;
        try {
          const handle = fs.openSync(file, "r");
          let text,
            offset = 0,
            resume = false,
            digest;
          try {
            const first = completeChunk(handle, 0, stat.size).split("\n", 1)[0];
            const metadata = JSON.parse(first);
            // Excluded workers never need their conversation bodies parsed.
            // Recheck metadata after a file change instead of trusting a stale
            // excluded flag on a replaced file.
            const worker =
              host === "codex"
                ? metadata.type === "session_meta" &&
                  !!metadata.payload?.source?.subagent
                : !!metadata.isSidechain;
            if (worker) {
              state.files[key] = {
                version: CHECKPOINT_VERSION,
                inode: stat.ino,
                offset: stat.size,
                mtime: stat.mtimeMs,
                excluded: true,
                pending: [],
                cwd: host === "codex" ? metadata.payload?.cwd : metadata.cwd,
                sessionId:
                  host === "codex" ? metadata.payload?.id : metadata.sessionId,
              };
              const issue = issues.findIndex((i) => i.source === file);
              if (issue >= 0) issues.splice(issue, 1);
              excludedFiles++;
              continue;
            }
            resume =
              prior?.version === CHECKPOINT_VERSION &&
              Number.isSafeInteger(prior.offset) &&
              prior.offset >= 0 &&
              prior.offset <= stat.size &&
              !!prior.prefixHash &&
              prefixHash(handle, prior.offset) === prior.prefixHash;
            offset = resume ? prior.offset : 0;
            if (prior && !resume) replayedFiles++;
            text =
              offset === stat.size
                ? ""
                : completeChunk(handle, offset, stat.size);
            digest = prefixHash(handle, offset + Buffer.byteLength(text));
            const after = fs.fstatSync(handle);
            // Never checkpoint a mixture of two versions of a file.
            if (
              after.size !== stat.size ||
              after.mtimeMs !== stat.mtimeMs ||
              after.ino !== stat.ino
            )
              throw Error(
                "Session changed while reading; retry on the next scan",
              );
          } finally {
            fs.closeSync(handle);
          }
          const lines = text.split("\n").slice(0, -1);
          let cwd = resume ? prior?.cwd : undefined,
            sessionId = resume ? prior?.sessionId : undefined,
            excluded = resume && !!prior?.excluded;
          let pending = resume ? [...(prior?.pending || [])] : [],
            start = resume ? prior?.start : undefined,
            cursor = offset;
          for (const line of lines) {
            const row = JSON.parse(line),
              position = cursor;
            cursor += Buffer.byteLength(line) + 1;
            if (host === "codex" && row.type === "session_meta") {
              cwd = row.payload?.cwd;
              sessionId = row.payload?.id;
              excluded ||= !!row.payload?.source?.subagent;
            }
            if (host === "claude") {
              cwd ||= row.cwd;
              sessionId ||= row.sessionId;
              excluded ||= !!row.isSidechain;
            }
            const m = message(row, host);
            if (!m || Date.parse(m.at) < Date.parse(scope.since)) continue;
            if (!cwd || !sessionId)
              throw Error("Unknown session format or missing project identity");
            cwd = canonical(cwd);
            const allowed =
              !excluded &&
              !within(cwd, canonical(base)) &&
              !scope.exclude.map(canonical).some((p) => within(cwd, p)) &&
              (scope.allProjects ||
                scope.projects.map(canonical).some((p) => within(cwd, p)));
            if (!allowed) {
              pending = [];
              start = null;
              continue;
            }
            if (m.role === "user") {
              if (!pending.length) start = position;
              pending.push(m);
            } else if (pending.length) {
              pending.push(m);
              if (JSON.stringify(pending).length > 120000)
                throw Error(
                  "Learning turn exceeds the 120 KB preparation limit; source retained",
                );
              const input = {
                type: "session",
                title: `Learning from ${path.basename(cwd)}`,
                host,
                sessionId: `${host}/${sessionId}`,
                project: cwd,
                source: file,
                messages: pending,
              };
              const signature = turnKey(input);
              if (!knownTurns.has(signature)) {
                const id = `catchup/${host}/${sessionId}/${signature}`;
                const result = inbox.enqueue(folder, { id, ...input });
                knownTurns.set(signature, id);
                if (result.inserted) queued++;
              }
              pending = [];
              start = null;
            }
          }
          state.files[key] = {
            version: CHECKPOINT_VERSION,
            inode: stat.ino,
            prefixHash: digest,
            offset: cursor,
            mtime: stat.mtimeMs,
            cwd,
            sessionId,
            excluded,
            pending,
            start,
          };
          if (cursor < stat.size) remainingFiles++;
          const issue = issues.findIndex((i) => i.source === file);
          if (issue >= 0) issues.splice(issue, 1);
        } catch (e) {
          state.files[key] = {
            ...prior,
            version: CHECKPOINT_VERSION,
            inode: stat.ino,
            offset: prior?.offset || 0,
            mtime: stat.mtimeMs,
            error: e.message,
          };
          const issue = issues.findIndex((i) => i.source === file);
          if (issue >= 0) issues.splice(issue, 1);
          issues.push({ source: file, error: e.message });
        }
      }
    }
    state.lastCheckedAt = new Date().toISOString();
    state.issues = issues;
    state.queued = queued;
    state.remainingFiles = remainingFiles;
    state.pendingTurns = Object.values(state.files).filter(
      (f) => f.pending?.length,
    ).length;
    atomic(stateFile, state);
    return {
      checked,
      queued,
      replayedFiles,
      excludedFiles,
      issues,
      remainingFiles,
      pendingTurns: state.pendingTurns,
      lastCheckedAt: state.lastCheckedAt,
    };
  } finally {
    release();
  }
}
module.exports = { scan, message, within };
