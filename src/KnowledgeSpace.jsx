import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Search,
  Plus,
  FolderOpen,
  FileText,
  ChevronRight,
  ArrowUpRight,
  PenLine,
  Check,
  X,
  RefreshCw,
  Link2,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  Copy,
  Clock3,
  Braces,
  Sigma,
  Leaf,
  ArrowLeft,
  Save,
  AlertCircle,
  MoveRight,
  Orbit,
} from "lucide-react";
import { KnowledgeDocument } from "./KnowledgeDocument";
import { Constellation } from "./Constellation";
import "./knowledge-space.css";
import { splitNote, titleInSource, sourceTitle } from "./knowledge-model";

const api = window.recall;
const formats = [
  ["concept", "Concepts", BookOpen],
  ["math", "Math", Sigma],
  ["code", "Coding", Braces],
  ["all", "Mixed", Layers],
];
const key = (note) => note && { sourceId: note.sourceId, path: note.path };
const date = (value) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(value || Date.now()),
  );

export function KnowledgeSpace({
  active,
  cards,
  onPractice,
  onEnableVisual,
  onCard,
  onSetup,
  notify,
  searchSignal,
}) {
  const [knowledgeView, setKnowledgeView] = useState("constellation");
  const [status, setStatus] = useState(null),
    [sourceId, setSourceId] = useState(""),
    [directory, setDirectory] = useState(""),
    [folders, setFolders] = useState([]);
  const [query, setQuery] = useState(""),
    [result, setResult] = useState({ documents: [] }),
    [offset, setOffset] = useState(0),
    [epoch, setEpoch] = useState(0);
  const [note, setNote] = useState(null),
    [raw, setRaw] = useState(""),
    [editing, setEditing] = useState(false),
    [draftStatus, setDraftStatus] = useState("");
  const [noteTitle, setNoteTitle] = useState(""),
    [showSource, setShowSource] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [external, setExternal] = useState(false);
  const [practice, setPractice] = useState({ cards: [] }),
    [format, setFormat] = useState("concept"),
    [rail, setRail] = useState(true),
    [linking, setLinking] = useState(false),
    [cardQuery, setCardQuery] = useState(""),
    [moving, setMoving] = useState(false),
    [target, setTarget] = useState("");
  const search = useRef(),
    editor = useRef(),
    readSequence = useRef(0),
    querySequence = useRef(0),
    draftWrite = useRef(Promise.resolve()),
    latest = useRef(null);
  const dirty = !!note && raw !== note.raw;
  latest.current = { note, raw, dirty };
  const fail = (e) =>
    setError(
      e.message?.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      ) || String(e),
    );
  const refresh = () => api.knowledgeStatus().then(setStatus).catch(fail);
  useEffect(() => {
    refresh();
    return api.onKnowledgeEvent((event) => {
      if (event.error) fail(Error(event.error));
      else {
        setStatus(event.status);
        setEpoch((n) => n + 1);
      }
    });
  }, []);
  useEffect(() => {
    if (active) {
      refresh();
      setEpoch((n) => n + 1);
    }
  }, [active]);
  useEffect(() => {
    if (active && searchSignal) {
      setKnowledgeView("notes");
      requestAnimationFrame(() => search.current?.focus());
    }
  }, [active, searchSignal]);
  useEffect(() => {
    if (status && !status.sources.some((s) => s.id === sourceId)) {
      setSourceId(status.sources[0]?.id || "");
      setDirectory("");
    }
    if (note && status && !status.sources.some((s) => s.id === note.sourceId)) {
      setNote(null);
      setRaw("");
      setPractice({ cards: [] });
    }
  }, [status]);
  useEffect(() => {
    if (sourceId) api.knowledgeFolders(sourceId).then(setFolders).catch(fail);
  }, [sourceId, epoch]);
  useEffect(() => {
    const sequence = ++querySequence.current;
    // A short debounce coalesces typing, not filesystem scans or provider calls.
    const timer = setTimeout(
      () =>
        api
          .knowledgeSearch({ sourceId, directory, query, offset })
          .then((value) => {
            if (sequence === querySequence.current)
              setResult({ ...value, query, sourceId, directory, offset });
          })
          .catch(fail),
      query ? 20 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, sourceId, directory, offset, epoch]);
  const persistDraft = () => {
    const value = latest.current;
    if (!value?.dirty || !value.note) return draftWrite.current;
    const input = {
      ...key(value.note),
      raw: value.raw,
      revision: value.note.draft?.revision || value.note.revision,
    };
    draftWrite.current = draftWrite.current
      .catch(() => {})
      .then(() => api.knowledgeDraft(input));
    return draftWrite.current;
  };
  useEffect(() => {
    if (!dirty) return;
    let live = true;
    setDraftStatus("Saving draft…");
    const timer = setTimeout(
      () =>
        persistDraft()
          .then(() => {
            if (live) setDraftStatus("Draft saved on this Mac");
          })
          .catch(fail),
      250,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [raw, note?.path]);
  useEffect(() => {
    const blur = () => persistDraft().catch(fail);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      blur();
    };
  }, []);
  const open = async (entry) => {
    const sequence = ++readSequence.current;
    try {
      await persistDraft();
      const value = await api.knowledgeRead(key(entry));
      if (sequence !== readSequence.current) return;
      setNote(value);
      setRaw(value.draft?.raw ?? value.raw);
      setEditing(!!value.draft);
      setExternal(!!value.draft && value.draft.revision !== value.revision);
      setNoteTitle(
        value.draft ? sourceTitle(value.draft.raw, value.title) : value.title,
      );
      setShowSource(false);
      setError("");
      setLinking(false);
      setMoving(false);
      setDraftStatus(value.draft ? "Recovered local draft" : "");
      const linked = await api.knowledgePractice(key(value));
      if (sequence === readSequence.current) setPractice(linked);
    } catch (e) {
      fail(e);
    }
  };
  useEffect(() => {
    if (!note && result.documents.length) open(result.documents[0]);
  }, [result.documents]);
  useEffect(() => {
    if (!note || !epoch) return;
    let live = true;
    api
      .knowledgeRead(key(note))
      .then((current) => {
        if (
          live &&
          current.path === latest.current?.note?.path &&
          current.sourceId === latest.current?.note?.sourceId &&
          current.revision !== latest.current?.note?.revision
        )
          setExternal(true);
      })
      .catch(() => {
        if (live) setExternal(true);
      });
    return () => {
      live = false;
    };
  }, [epoch, note?.path]);
  const save = async () => {
    if (!note || !dirty || busy) return;
    setBusy(true);
    setError("");
    try {
      await persistDraft();
      const value = await api.knowledgeSave({
        ...key(note),
        raw,
        revision: note.draft?.revision || note.revision,
      });
      setNote(value);
      setRaw(value.raw);
      setNoteTitle(value.title);
      setExternal(false);
      setDraftStatus("Saved to your folder");
      setEpoch((n) => n + 1);
      setPractice(await api.knowledgePractice(key(value)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!active) {
      persistDraft().catch(fail);
      return;
    }
    if (knowledgeView !== "notes") return;
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
      if (e.key === "Escape" && linking) setLinking(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, knowledgeView, note, raw, busy, linking]);
  const create = async () => {
    setBusy(true);
    try {
      await persistDraft();
      const value = await api.knowledgeCreate({ sourceId, directory });
      await open(value);
      setKnowledgeView("notes");
      setEditing(true);
      requestAnimationFrame(() => editor.current?.focus());
      setEpoch((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const reload = async (confirmed = false) => {
    if (dirty && confirmed !== true) {
      setDiscarding(true);
      return;
    }
    try {
      await draftWrite.current.catch(() => {});
      await api.knowledgeDiscard(key(note));
      latest.current = { ...latest.current, dirty: false };
      await open(note);
      setDiscarding(false);
    } catch (e) {
      fail(e);
    }
  };
  const followLink = async (value) => {
    if (/^https?:\/\//i.test(value)) {
      try {
        await api.knowledgeOpenLink(value);
      } catch (e) {
        fail(e);
      }
      return;
    }
    if (value.startsWith("#")) return;
    const title = decodeURIComponent(value)
      .replace(/\.(md|markdown|html?)$/i, "")
      .split("/")
      .pop()
      .split("#")[0];
    try {
      const found = await api.knowledgeSearch({
        sourceId: note.sourceId,
        query: title,
      });
      const exact = found.documents.filter((n) =>
        [
          n.title,
          n.path.replace(/\.(md|markdown|html?)$/i, ""),
          ...n.aliases,
        ].some((v) => v.toLowerCase() === title.toLowerCase()),
      );
      if (exact.length === 1) {
        await open(exact[0]);
        return;
      }
    } catch (e) {
      fail(e);
    }
    setQuery(title);
    setOffset(0);
    setDirectory("");
    search.current?.focus();
  };
  const link = async (cardId) => {
    try {
      setPractice(await api.knowledgeLink({ ...key(note), cardId }));
      setLinking(false);
    } catch (e) {
      fail(e);
    }
  };
  const author = async () => {
    try {
      const value = await api.knowledgeAuthorPrompt(key(note));
      await api.copyLearningText(value);
      notify("Practice prompt copied. Paste it into Codex or Claude.");
    } catch (e) {
      fail(e);
    }
  };
  const selectedSource = status?.sources.find((s) => s.id === sourceId);
  const eligible = practice.cards.filter(
    (c) =>
      c.status === "ready" &&
      !c.suspended &&
      (format === "all" || c.kind === format),
  );
  const changeScope = (id) => {
    setSourceId(id);
    setDirectory("");
    setQuery("");
    setOffset(0);
  };
  const createSpace = async () => {
    try {
      const source = await api.knowledgeCreateSpace();
      if (source) {
        await refresh();
        changeScope(source.id);
      }
    } catch (e) {
      fail(e);
    }
  };
  const switchKnowledgeView = async (value) => {
    try {
      await persistDraft();
      setKnowledgeView(value);
    } catch (e) {
      fail(e);
    }
  };
  const openGraphNote = async (entry) => {
    try {
      await persistDraft();
      await open(entry);
      if (entry.sourceId && entry.sourceId !== sourceId)
        changeScope(entry.sourceId);
      setKnowledgeView("notes");
    } catch (e) {
      fail(e);
    }
  };
  return (
    <section
      className={`knowledge-space ${rail ? "" : "knowledge-focus"}`}
      aria-label="Knowledge space"
      hidden={!active}
    >
      <header className="knowledge-heading">
        <div>
          <span className="eyebrow">
            <Leaf size={13} /> YOUR PERSONAL KNOWLEDGE SPACE
          </span>
          <h1>
            {knowledgeView === "constellation"
              ? "Your ideas, connected."
              : "Make room for an idea."}
          </h1>
          <p>
            {knowledgeView === "constellation"
              ? "Explore your knowledge, from the big picture to the ideas within."
              : "Write it down. Make a connection. Put it into practice."}
          </p>
        </div>
        <div className="knowledge-top-actions">
          <button className="ghost" onClick={onSetup}>
            <FolderOpen size={16} /> Manage spaces
          </button>
          <button
            className="primary"
            onClick={create}
            disabled={!selectedSource?.writable || busy}
          >
            <Plus size={17} /> New note
          </button>
        </div>
      </header>
      <div
        className="knowledge-view-switch"
        role="group"
        aria-label="Knowledge view"
      >
        <button
          aria-pressed={knowledgeView === "constellation"}
          onClick={() => switchKnowledgeView("constellation")}
        >
          <Orbit size={15} />
          Constellation
        </button>
        <button
          aria-pressed={knowledgeView === "notes"}
          onClick={() => switchKnowledgeView("notes")}
        >
          <FileText size={15} />
          Notes
        </button>
      </div>
      {error && (
        <div className="knowledge-message" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button
            aria-label="Dismiss knowledge error"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <Constellation
        active={active && knowledgeView === "constellation"}
        cards={cards}
        onOpenNote={openGraphNote}
        onCard={onCard}
        onNotes={() => switchKnowledgeView("notes")}
      />
      {status && !status.sources.length ? (
        <div className="knowledge-start" hidden={knowledgeView !== "notes"}>
          <div className="knowledge-paper-stack">
            <FileText size={42} />
            <span>A place to think.</span>
          </div>
          <h2>Your notes, with a place to grow.</h2>
          <p>
            Keep Markdown and HTML on your Mac. Find an idea in a moment, read
            it beautifully, and practice what matters.
          </p>
          <div>
            <button className="primary" onClick={createSpace}>
              <Plus size={16} /> Create a space
            </button>
            <button onClick={onSetup}>
              <FolderOpen size={16} /> Open an existing folder
            </button>
          </div>
          <small>Works with an Obsidian folder too. No account required.</small>
        </div>
      ) : (
        <div className="knowledge-layout" hidden={knowledgeView !== "notes"}>
          <aside className="knowledge-shelf" aria-label="Your notes">
            <div className="knowledge-space-picker">
              <label htmlFor="knowledge-source">SPACE</label>
              <select
                id="knowledge-source"
                value={sourceId}
                onChange={(e) => changeScope(e.target.value)}
              >
                {status?.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button aria-label="Create another space" onClick={createSpace}>
                <Plus size={15} />
              </button>
            </div>
            <div className="knowledge-search">
              <Search size={16} />
              <input
                ref={search}
                aria-label="Search knowledge"
                placeholder="Find an idea…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOffset(0);
                }}
              />
              {query ? (
                <button
                  aria-label="Clear note search"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd>⌘ K</kbd>
              )}
            </div>
            {folders.length > 0 && (
              <select
                className="knowledge-filter-folder"
                aria-label="Filter notes by folder"
                value={directory}
                onChange={(e) => {
                  setDirectory(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">All folders</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
            <div className="knowledge-list-heading">
              <span>{query ? "SEARCH RESULTS" : "YOUR NOTEBOOK"}</span>
              <span>{selectedSource?.count ?? 0} notes</span>
            </div>
            <div className="knowledge-entry-list">
              {result.documents.map((n) => (
                <button
                  key={n.sourceId + n.path}
                  className={`knowledge-entry ${note?.path === n.path && note?.sourceId === n.sourceId ? "selected" : ""}`}
                  onClick={() => open(n)}
                  disabled={
                    result.query !== query ||
                    result.sourceId !== sourceId ||
                    result.directory !== directory ||
                    result.offset !== offset ||
                    busy
                  }
                  aria-pressed={
                    note?.path === n.path && note?.sourceId === n.sourceId
                  }
                >
                  <div>
                    <FileText size={15} />
                    <span>
                      {n.format === "html" ? "HTML" : n.topics[0] || "NOTE"}
                    </span>
                    <time>{date(n.modified)}</time>
                  </div>
                  <strong>{n.title}</strong>
                  <p>{n.excerpt.replace(/^#+\s*/, "")}</p>
                </button>
              ))}
              {!result.documents.length && (
                <div className="knowledge-list-empty">
                  <Search size={22} />
                  <p>
                    {status?.indexing
                      ? "Gathering your notes…"
                      : query
                        ? "No matching notes. Try a title, alias or a few words from the text."
                        : "A fresh page awaits."}
                  </p>
                  {!query && (
                    <button
                      onClick={create}
                      disabled={!selectedSource?.writable}
                    >
                      Write your first note
                    </button>
                  )}
                </div>
              )}
            </div>
            {(offset > 0 || result.hasMore) && (
              <div className="knowledge-pagination">
                <button
                  disabled={!offset}
                  onClick={() => setOffset((n) => Math.max(0, n - 40))}
                >
                  Previous
                </button>
                <span>
                  {offset + 1}–{offset + result.documents.length}
                </span>
                <button
                  disabled={!result.hasMore}
                  onClick={() => setOffset((n) => n + 40)}
                >
                  Next
                </button>
              </div>
            )}
            <footer className="knowledge-index-status">
              <span
                className={`knowledge-status-dot ${status?.indexing ? "working" : ""}`}
              />
              <span>
                {status?.indexing
                  ? "Indexing in the background"
                  : selectedSource?.issues.length
                    ? "Some notes need attention"
                    : "Local index ready"}
              </span>
              <button
                aria-label="Refresh knowledge index"
                onClick={() => api.knowledgeRefresh().then(refresh).catch(fail)}
              >
                <RefreshCw size={13} />
              </button>
            </footer>
            {!!selectedSource?.issues.length && (
              <details className="knowledge-issues">
                <summary>
                  {selectedSource.issues.length} indexing issues
                </summary>
                {selectedSource.issues.map((issue, i) => (
                  <p key={i}>
                    {issue.path} · {issue.reason}
                  </p>
                ))}
              </details>
            )}
          </aside>
          {note ? (
            <div className="knowledge-desk">
              <div className="knowledge-document-toolbar">
                <span title={note.path}>
                  <FolderOpen size={14} />
                  {note.path.split("/").slice(0, -1).join(" / ") || "Notebook"}
                  <ChevronRight size={13} />
                  <span>
                    {note.format === "html" ? "HTML document" : "Markdown note"}
                  </span>
                </span>
                <div>
                  <button
                    className={!editing ? "active" : ""}
                    onClick={() => setEditing(false)}
                  >
                    <BookOpen size={15} /> Read
                  </button>
                  <button
                    className={editing ? "active" : ""}
                    disabled={!note.writable}
                    onClick={() => setEditing(true)}
                  >
                    <PenLine size={15} /> Edit
                  </button>
                  <button
                    aria-label={
                      rail ? "Hide practice panel" : "Show practice panel"
                    }
                    onClick={() => setRail(!rail)}
                  >
                    {rail ? (
                      <PanelRightClose size={16} />
                    ) : (
                      <PanelRightOpen size={16} />
                    )}
                  </button>
                </div>
              </div>
              {external && (
                <div className="knowledge-external">
                  <AlertCircle size={15} />
                  <span>
                    This file changed outside Recall. Your draft is kept.
                  </span>
                  <button onClick={reload}>Load file version</button>
                </div>
              )}
              <div className="knowledge-paper">
                <div className="knowledge-paper-meta">
                  <span>
                    {note.topics.length
                      ? note.topics.slice(0, 3).join(" / ")
                      : "PERSONAL NOTES"}
                  </span>
                  <span>
                    <Clock3 size={12} />{" "}
                    {Math.max(
                      1,
                      Math.ceil(note.body.split(/\s+/).length / 220),
                    )}{" "}
                    min read
                  </span>
                </div>
                {editing ? (
                  <div className="knowledge-editor">
                    {note.format === "markdown" && (
                      <input
                        className="knowledge-entry-title"
                        disabled={busy}
                        aria-label="Note title"
                        value={noteTitle}
                        onChange={(e) => {
                          try {
                            setRaw(
                              titleInSource(raw, e.target.value, noteTitle),
                            );
                            setNoteTitle(e.target.value);
                          } catch (error) {
                            fail(error);
                          }
                        }}
                      />
                    )}
                    <label htmlFor="knowledge-markdown">
                      {note.format === "html"
                        ? "HTML source"
                        : "Write in Markdown"}
                      <span>⌘ S to save · drafts recover automatically</span>
                    </label>
                    {note.format === "markdown" && (
                      <button
                        className="knowledge-source-toggle"
                        onClick={() => setShowSource(!showSource)}
                      >
                        {showSource
                          ? "Hide metadata"
                          : "Edit source & metadata"}
                      </button>
                    )}
                    <textarea
                      id="knowledge-markdown"
                      disabled={busy}
                      ref={editor}
                      value={
                        note.format === "markdown" && !showSource
                          ? splitNote(raw).body
                          : raw
                      }
                      onChange={(e) =>
                        setRaw(
                          note.format === "markdown" && !showSource
                            ? splitNote(raw).prefix + e.target.value
                            : e.target.value,
                        )
                      }
                      onBlur={() => persistDraft().catch(fail)}
                      spellCheck={false}
                    />
                  </div>
                ) : (
                  <KnowledgeDocument
                    cards={cards}
                    active={active && knowledgeView === "notes" && !editing}
                    onEnableVisual={onEnableVisual}
                    onCard={onCard}
                    note={{
                      ...note,
                      body: dirty
                        ? note.format === "html"
                          ? raw
                          : raw.replace(
                              /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
                              "",
                            )
                        : note.body,
                    }}
                    onLink={followLink}
                  />
                )}
                {!editing && !!note.backlinks?.length && (
                  <div className="knowledge-backlinks">
                    <span className="eyebrow">CONNECTED NOTES</span>
                    {note.backlinks.map((n) => (
                      <button key={n.path} onClick={() => open(n)}>
                        <Link2 size={14} />
                        {n.title}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <footer className="knowledge-document-footer">
                <span>
                  <Check size={14} />
                  {dirty
                    ? draftStatus
                    : note.writable
                      ? draftStatus || "Saved in your folder"
                      : "Read-only source"}
                </span>
                <div>
                  {dirty && (
                    <>
                      <button onClick={reload}>Discard draft</button>
                      <button
                        className="primary"
                        onClick={save}
                        disabled={busy || external || !note.writable}
                      >
                        <Save size={14} /> Save note
                      </button>
                    </>
                  )}
                  <button
                    aria-label="Show note in Finder"
                    onClick={() => api.knowledgeReveal(key(note)).catch(fail)}
                  >
                    <FolderOpen size={15} />
                  </button>
                  <button
                    disabled={dirty || !note.writable}
                    onClick={() => {
                      setTarget(note.path);
                      setMoving(true);
                    }}
                  >
                    Move / rename
                  </button>
                </div>
              </footer>
            </div>
          ) : (
            <div className="knowledge-unopened">
              <BookOpen size={40} />
              <h2>Follow your curiosity.</h2>
              <p>Choose a note to read, edit or practice.</p>
            </div>
          )}
          {note && rail && (
            <aside
              className="knowledge-practice"
              aria-label="Practice this note"
            >
              <div className="knowledge-practice-symbol">
                <Layers size={24} />
              </div>
              <span className="eyebrow">FROM NOTES TO KNOWING</span>
              <h2>Make it stick.</h2>
              <p>
                Return to this idea with a question, a problem or a small
                challenge.
              </p>
              <div
                className="knowledge-formats"
                role="group"
                aria-label="Knowledge practice format"
              >
                {formats.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    className={format === id ? "selected" : ""}
                    aria-pressed={format === id}
                    onClick={() => setFormat(id)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
              {practice.needsCheck && (
                <div className="knowledge-stale">
                  This note changed since its cards were linked. Check that they
                  still match.
                </div>
              )}
              {eligible.length ? (
                <>
                  <div className="knowledge-practice-count">
                    <strong>
                      {eligible.length.toString().padStart(2, "0")}
                    </strong>
                    <span>
                      questions
                      <br />
                      ready to revisit
                    </span>
                  </div>
                  <button
                    className="primary knowledge-practice-start"
                    onClick={() =>
                      onPractice(
                        eligible.map((c) => c.id),
                        format,
                      )
                    }
                  >
                    <BookOpen size={15} /> Practice this note{" "}
                    <ArrowUpRight size={15} />
                  </button>
                  <div className="knowledge-linked-cards">
                    {eligible.slice(0, 5).map((c) => (
                      <button key={c.id} onClick={() => onCard(c.id)}>
                        <span>{c.title}</span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="knowledge-practice-empty">
                  <FileText size={21} />
                  <strong>
                    No{" "}
                    {format === "all"
                      ? "ready"
                      : formats
                          .find((f) => f[0] === format)[1]
                          .toLowerCase()}{" "}
                    questions linked yet
                  </strong>
                  <p>
                    Connect an existing card, or ask your assistant to prepare a
                    useful set.
                  </p>
                </div>
              )}
              <button
                className="knowledge-link-button"
                onClick={() => {
                  setLinking(true);
                  setCardQuery(note.title);
                }}
              >
                <Link2 size={15} /> Link existing cards
              </button>
              <button className="knowledge-author-button" onClick={author}>
                <Copy size={14} /> Prepare with assistant
              </button>
              <div className="knowledge-practice-note">
                <Leaf size={15} />
                <p>
                  Your notes stay yours. Reading doesn’t rate a card or change
                  your review schedule.
                </p>
              </div>
            </aside>
          )}
        </div>
      )}
      {discarding && (
        <div className="knowledge-modal-backdrop">
          <section
            className="knowledge-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="knowledge-discard-title"
          >
            <h2 id="knowledge-discard-title">Load the file version?</h2>
            <p>
              This replaces the local draft with the current file. Keep your
              draft if you still want to copy or compare its text.
            </p>
            <div className="knowledge-confirm-actions">
              <button autoFocus onClick={() => setDiscarding(false)}>
                Keep draft
              </button>
              <button className="primary" onClick={() => reload(true)}>
                Discard draft and reload
              </button>
            </div>
          </section>
        </div>
      )}
      {linking && (
        <div
          className="knowledge-modal-backdrop"
          onClick={() => setLinking(false)}
        >
          <section
            className="knowledge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-link-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">CONNECT THE IDEA</span>
                <h2 id="knowledge-link-title">Link a practice card</h2>
              </div>
              <button
                aria-label="Close card linking"
                onClick={() => setLinking(false)}
              >
                <X size={18} />
              </button>
            </header>
            <input
              autoFocus
              aria-label="Find an existing card"
              placeholder="Search your card library…"
              value={cardQuery}
              onChange={(e) => setCardQuery(e.target.value)}
            />
            <div className="knowledge-card-options">
              {cards
                .filter(
                  (c) =>
                    c.status === "ready" &&
                    !c.suspended &&
                    (!cardQuery ||
                      `${c.title} ${c.conceptId}`
                        .toLowerCase()
                        .includes(cardQuery.toLowerCase())),
                )
                .slice(0, 25)
                .map((c) => (
                  <button key={c.id} onClick={() => link(c.id)}>
                    <span>
                      <small>{c.kind === "code" ? "Coding" : c.kind}</small>
                      <strong>{c.title}</strong>
                    </span>
                    <Plus size={16} />
                  </button>
                ))}
            </div>
            <p>
              Links connect your notes and questions. Card content and review
              history stay unchanged.
            </p>
          </section>
        </div>
      )}
      {moving && (
        <div className="knowledge-modal-backdrop">
          <form
            className="knowledge-modal"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const value = await api.knowledgeMove({
                  ...key(note),
                  revision: note.revision,
                  to: target,
                });
                setMoving(false);
                await open(value);
                setEpoch((n) => n + 1);
              } catch (e) {
                fail(e);
              }
            }}
          >
            <header>
              <h2>Move or rename</h2>
              <button
                type="button"
                aria-label="Cancel move"
                onClick={() => setMoving(false)}
              >
                <X size={18} />
              </button>
            </header>
            <label>
              Path within your space
              <input
                autoFocus
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <p>
              Use an existing folder and keep the file extension. Existing files
              are never replaced.
            </p>
            <button className="primary" type="submit">
              <MoveRight size={16} /> Move note
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
