import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  CalendarCheck,
  Library,
  History,
  Settings,
  Layers,
  Plus,
  HardDrive,
  Search,
  ChartNoAxesCombined,
  Mic,
} from "lucide-react";
import {
  defaultSelection,
  matches,
  queue,
  plain,
  isDue,
  inDeck,
  sameDay,
  spanLabel,
} from "./model";
import { Toast } from "./ui";
import { SelfTest, SelfTestTile } from "./SelfTest";
import { Filters, StudyDesk, TopicOptions } from "./StudyDesk";
import { LibraryView } from "./LibraryView";
import { ReviewCard } from "./ReviewCard";
import {
  ReviewToolbar,
  ReviewFooter,
  DetailToolbar,
  DetailFooter,
  Completion,
} from "./ReviewSession";
import { HistoryView } from "./HistoryView";
import { ProgressView } from "./ProgressView";
import { SpeakView } from "./SpeakView";
import { SettingsView } from "./SettingsView";
import { WelcomeGuide } from "./WelcomeGuide";
import { AuthorForm, NewDeck } from "./AuthorForm";
import "./styles.css";
import { CatalogView } from "./CatalogView";
import "./catalog.css";
import "./forest.css";
import "./study-index.css";
import { StudyShelf } from "./StudyShelf";
import { useAppearance } from "./appearance";
import { catalogDefaults, catalogInfo, displayCatalog } from "./catalog-model";

const api = window.recall;
const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const ratingKeys = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
const eyebrows = {
  study: "Study desk",
  selftest: "Daily learning",
  library: "Your knowledge",
  history: "Your progress",
  progress: "Your learning journal",
  speak: "Speaking practice",
  settings: "On this Mac",
  author: "Authoring",
  newDeck: "Authoring",
  detail: "Card details",
  catalog: "Coding practice",
};

function App() {
  const appearance = useAppearance();
  const [historyDay, setHistoryDay] = useState(null);
  const [data, setData] = useState(null),
    [selection, setSelection] = useState(defaultSelection),
    [view, setView] = useState("study"),
    [activeSession, setActiveSession] = useState(null),
    [detail, setDetail] = useState(null),
    [detailIds, setDetailIds] = useState(null),
    [catalogFilters, setCatalogFilters] = useState(catalogDefaults),
    [detailRevealed, setDetailRevealed] = useState(false),
    [toast, setToast] = useState(null),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [wide, setWide] = useState(null),
    [editing, setEditing] = useState(null),
    [intervals, setIntervals] = useState({});
  const [voiceReturn, setVoiceReturn] = useState(null);
  const [settingsSection, setSettingsSection] = useState("general");
  const [answerBusy, setAnswerBusy] = useState(false);
  const [learning, setLearning] = useState(null);
  useEffect(() => {
    if (!api) return;
    let mounted = true;
    const load = () =>
      api
        .selfTests()
        .then((value) => {
          if (mounted) setLearning(value);
        })
        .catch(fail);
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener("focus", load);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [view]);
  const startSelfTest = async (
    day,
    replace,
    mode = "untested",
    format = selection.format,
  ) => {
    setBusy(true);
    try {
      const session = await api.startSelfTest({ day, replace, mode, format });
      setActiveSession(session);
      setView("review");
      setWide(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const [activeCatalog, setActiveCatalog] = useState(null);
  const selectedCatalog = catalogInfo(
    (data?.cards || []).filter(
      (c) => !activeCatalog || c.catalog?.id === activeCatalog,
    ),
  );
  const catalogTitle = selectedCatalog?.title || "Coding challenges";
  const searchRef = useRef();
  const now = Date.now();

  // ----- notifications -----
  const notify = (message) => {
    if (!message) return;
    const body = typeof message === "string" ? { text: message } : message;
    setToast({ id: crypto.randomUUID(), tone: "notice", ...body });
  };
  const fail = (e) => {
    setToast({
      id: crypto.randomUUID(),
      tone: "error",
      text: e?.message || String(e),
    });
    setBusy(false);
  };
  useEffect(() => {
    if (!toast || toast.tone === "error") return;
    const timer = setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      toast.action ? 7000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  // ----- data -----
  const refresh = async () => {
    const next = await api.snapshot();
    setData(next);
    setActiveSession(next.session);
    return next;
  };
  useEffect(() => {
    if (!api) {
      setToast({
        id: "bridge",
        tone: "error",
        text: "Open Recall through its Mac app. The desktop bridge is required for local storage.",
      });
      return;
    }
    api
      .snapshot()
      .then((next) => {
        setData(next);
        setSelection(next.selection || defaultSelection);
        setActiveSession(next.session);
      })
      .catch(fail);
  }, []);
  const mutate = async (fn, message) => {
    setBusy(true);
    try {
      const result = await fn();
      await refresh();
      if (message)
        notify(typeof message === "function" ? message(result) : message);
      return result;
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const changeSelection = (patch) => {
    const next = { ...selection, ...patch };
    setSelection(next);
    api.setting("selection", next).catch(fail);
  };

  // ----- navigation -----
  const current =
    view === "review"
      ? data?.cards.find(
          (c) => c.id === activeSession?.ids[activeSession.index],
        )
      : detail;
  const go = (where) => {
    setVoiceReturn(null);
    if (where === "settings") setSettingsSection("general");
    if (where === "catalog") refresh().catch(fail);
    if (where === "review" && activeSession) {
      const card = data.cards.find(
        (c) => c.id === activeSession.ids[activeSession.index],
      );
      if (card?.kind === "math" && activeSession.revealed) {
        const next = { ...activeSession, revealed: false };
        setActiveSession(next);
        api.setting("session", next).catch(fail);
      }
    }
    setView(where);
    setDetail(null);
    setWide(null);
    // An "Undo" offer belongs to the review it came from; drop it on navigation.
    setToast((t) => (t?.action ? null : t));
    window.scrollTo(0, 0);
  };
  const openVoiceSettings = () => {
    const origin = { view, detail, wide, scroll: window.scrollY };
    go("settings");
    setVoiceReturn(origin);
  };
  const openLearningSettings = () => {
    go("settings");
    setSettingsSection("connections");
  };
  const returnFromVoiceSettings = () => {
    if (!voiceReturn) return;
    setView(voiceReturn.view);
    setDetail(voiceReturn.detail);
    setWide(voiceReturn.wide);
    window.requestAnimationFrame(() => window.scrollTo(0, voiceReturn.scroll));
    setVoiceReturn(null);
  };
  const browse = (card, ids = null) => {
    setWide(null);
    setDetailIds(ids);
    setDetailRevealed(false);
    setDetail(displayCatalog(card));
    setView("detail");
    window.scrollTo(0, 0);
  };
  const cardLinkSequence = useRef(0);
  useEffect(() => {
    if (!data || !api?.onCardLink) return;
    let live = true;
    const openLink = async () => {
      try {
        const link = await api.consumeCardLink();
        if (!link || !live) return;
        const sequence = ++cardLinkSequence.current;
        if (link.error) return fail(new Error(link.error));
        const next = await api.snapshot();
        if (!live || sequence !== cardLinkSequence.current) return;
        const card = next.cards.find((c) => c.id === link.id);
        if (!card)
          return fail(
            new Error(
              "This card isn't in this Recall library. Search the library or ask for an updated link.",
            ),
          );
        setData(next);
        setActiveSession(next.session);
        setToast(null);
        browse(card);
      } catch (error) {
        if (live) fail(error);
      }
    };
    const unsubscribe = api.onCardLink(openLink);
    openLink();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [!!data]);
  const author = (card = null) => {
    setEditing(card);
    setView("author");
    setDetail(null);
    setWide(null);
    window.scrollTo(0, 0);
  };

  const updateChallengeState = async (id, patch) => {
    // Keep typing responsive; the main process validates and persists each patch.
    setData((d) => ({
      ...d,
      challengeStates: {
        ...d.challengeStates,
        [id]: { ...(d.challengeStates?.[id] || {}), ...patch },
      },
    }));
    try {
      return await api.challengeState(id, patch);
    } catch (error) {
      refresh().catch(fail);
      throw error;
    }
  };
  const startCatalog = async (cards, practice) => {
    const scoped = {
      ...defaultSelection,
      deck: catalogTitle,
      format: "code",
      practice,
      limit: practice ? cards.length : 10,
    };
    const chosen = practice
      ? cards.filter((c) => !c.suspended && c.status === "ready")
      : queue(cards, scoped);
    if (!chosen.length) return;
    try {
      await saveSession({
        id: crypto.randomUUID(),
        ids: chosen.map((c) => c.id),
        index: 0,
        selection: scoped,
        revealed: false,
        rated: 0,
        skipped: 0,
        startedAt: new Date().toISOString(),
      });
      setView("review");
      setWide(null);
      window.scrollTo(0, 0);
    } catch (e) {
      fail(e);
    }
  };
  const openDeck = (deck) => {
    changeSelection({ deck });
    const info = catalogInfo(data.cards.filter((c) => c.decks.includes(deck)));
    if (info) {
      setActiveCatalog(info.id);
      setCatalogFilters({ ...catalogDefaults, tab: "all" });
    }
    go(info ? "catalog" : "study");
  };
  // ----- sessions -----
  const saveSession = async (next) => {
    await api.setting("session", next);
    setActiveSession(next);
  };
  const start = async () => {
    const cards = queue(data.cards, selection);
    if (!cards.length) return;
    const session = {
      id: crypto.randomUUID(),
      ids: cards.map((c) => c.id),
      index: 0,
      selection: structuredClone(selection),
      revealed: false,
      rated: 0,
      skipped: 0,
      startedAt: new Date().toISOString(),
    };
    try {
      await saveSession(session);
      setView("review");
      setWide(null);
      window.scrollTo(0, 0);
    } catch (e) {
      fail(e);
    }
  };
  const reveal = (visible = true) =>
    view === "detail"
      ? setDetailRevealed(visible)
      : saveSession({ ...activeSession, revealed: visible }).catch(fail);
  const undo = () =>
    mutate(
      () => api.undo(),
      (r) => (r ? "Last rating undone." : "Nothing to undo in this session."),
    );
  const rate = async (rating) => {
    if (busy || answerBusy || !activeSession) return;
    const id = activeSession.ids[activeSession.index];
    const practice = !!activeSession.selection.practice;
    const next = intervals[rating];
    await mutate(
      () => api.rate({ id, rating, practice, sessionId: activeSession.id }),
      rating === "Skip"
        ? "Skipped · schedule unchanged"
        : practice
          ? `${rating} · practice, schedule unchanged`
          : {
              text: `${rating} · next review ${
                next
                  ? "in " + spanLabel(new Date(next) - Date.now())
                  : "scheduled"
              }`,
              action: { label: "Undo", onClick: undo },
            },
    );
  };
  useEffect(() => {
    if (view !== "review" || !current) {
      setIntervals({});
      return;
    }
    let live = true;
    api
      .intervals(current.id)
      .then((r) => live && setIntervals(r))
      .catch(fail);
    return () => {
      live = false;
    };
  }, [view, current?.id]);

  useEffect(() => {
    if (view === "review") window.scrollTo(0, 0);
  }, [view, current?.id]);

  // ----- derived lists -----
  const matching = useMemo(
    () => (data ? data.cards.filter((c) => matches(c, selection)) : []),
    [data, selection],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return matching;
    return matching.filter((c) =>
      (plain(c.title) + " " + c.topic + " " + c.tags.join(" "))
        .toLowerCase()
        .includes(q),
    );
  }, [matching, search]);
  const detailCards = detailIds
    ? detailIds
        .map((id) => data?.cards.find((c) => c.id === id))
        .filter(Boolean)
    : visible;
  const detailIndex =
    view === "detail" && detail
      ? detailCards.findIndex((c) => c.id === detail.id)
      : -1;
  const step = (dir) => {
    const next = detailCards[detailIndex + dir];
    if (next) browse(next, detailIds);
  };

  // ----- keyboard -----
  const keys = useRef();
  keys.current = (e) => {
    const target = e.target;
    const inEditor = !!target.closest?.(".monaco-editor");
    const inField =
      inEditor ||
      !!target.closest?.("input,textarea,select,[contenteditable=true]");
    const onControl = !!target.closest?.("button,summary,a,[role=button]");
    const mod = e.metaKey || e.ctrlKey;
    if (
      mod &&
      !e.altKey &&
      !e.shiftKey &&
      ["f", "k"].includes(e.key.toLowerCase())
    ) {
      if (inEditor || !data) return;
      e.preventDefault();
      if (view !== "library") go("library");
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    if (view === "review" && activeSession && current) {
      if (mod && !e.shiftKey && e.key.toLowerCase() === "z" && !inField) {
        e.preventDefault();
        if (!busy && !answerBusy) undo();
        return;
      }
      if (e.key === "Escape") {
        if (inEditor) return;
        if (inField) return target.blur();
        e.preventDefault();
        return go("study");
      }
      if (inField || mod || e.altKey || e.repeat || answerBusy) return;
      if (
        (e.key === " " || e.key === "Enter") &&
        (!activeSession.revealed || current.kind !== "code")
      ) {
        if (onControl) return;
        e.preventDefault();
        return reveal(!activeSession.revealed);
      }
      if (activeSession.revealed && ratingKeys[e.key]) {
        e.preventDefault();
        return rate(ratingKeys[e.key]);
      }
      if (e.key.toLowerCase() === "s" && !onControl) {
        e.preventDefault();
        return rate("Skip");
      }
      return;
    }
    if (view === "detail" && detail) {
      if (inField || mod || e.altKey) return;
      if (e.key === "ArrowLeft") return step(-1);
      if (e.key === "ArrowRight") return step(1);
      if (e.key === "Escape") return go(detailIds ? "catalog" : "library");
      if (
        (e.key === " " || e.key === "Enter") &&
        (!detailRevealed || detail.kind !== "code") &&
        !answerBusy &&
        !onControl
      ) {
        e.preventDefault();
        setDetailRevealed(!detailRevealed);
      }
    }
  };
  useEffect(() => {
    const listener = (e) => keys.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (!data)
    return (
      <div className="loading">
        <Layers size={32} />
        <h1>Recall</h1>
        <p>
          {toast?.tone === "error" ? toast.text : "Opening your study desk…"}
        </p>
      </div>
    );

  const scopeCards = data.cards.filter((c) => inDeck(c, selection.deck));
  const topics = [...new Set(data.cards.map((c) => c.topic))].sort();
  const expanded =
    ["review", "detail"].includes(view) &&
    current?.kind === "code" &&
    !!current.code &&
    wide !== false;
  const eligible = queue(data.cards, selection, now);
  const reviewedToday = data.history.filter(
    (e) => !e.undone && sameDay(e.at),
  ).length;
  const sessionEvents = activeSession?.startedAt
    ? data.history.filter((e) => !e.undone && e.at >= activeSession.startedAt)
    : [];
  const importAnki = () =>
    mutate(
      () => api.importAnki(),
      (r) =>
        r
          ? `${r.inserted} imported · ${r.unchanged} already present${
              r.drafts ? " · " + r.drafts + " require draft review" : ""
            }`
          : "Import cancelled",
    );
  const title =
    view === "study"
      ? data.cards.length === 0
        ? "A fresh page."
        : selection.deck === "all"
          ? "Make a little room to remember."
          : selection.deck
      : {
          selftest: "Your self test",
          library: "A library that stays with you.",
          catalog: catalogTitle,
          history: "Every attempt has a place.",
          progress: "What’s staying with you?",
          speak: "Know it. Say it. Make it clear.",
          settings: "Make it yours.",
          author: editing ? "Edit card" : "Create a card",
          newDeck: "A new collection",
          detail: "A closer look.",
        }[view];

  return (
    <div
      className={
        "app study-index view-" +
        view +
        " " +
        (expanded ? "expanded" : "") +
        (["review", "detail"].includes(view) && current?.kind === "code"
          ? " coding-view"
          : "")
      }
    >
      <div className="titlebar">
        <span className="brand">
          <Layers size={17} /> Recall
        </span>
        <span className="titlebar-caption">One question at a time.</span>
        <span className="local">
          <HardDrive size={13} /> On your Mac
        </span>
      </div>
      <header className="index-header">
        <button
          className="index-brand"
          onClick={() => go("study")}
          aria-label="Recall study desk"
        >
          <span>r.</span> recall
        </button>
        <nav className="index-nav" aria-label="Main">
          {[
            ["study", "Study desk", BookOpen],
            ["library", "Library", Library],
            ["selftest", "Self test", CalendarCheck],
            ["speak", "Speak", Mic],
            ["progress", "Progress", ChartNoAxesCombined],
            ["history", "Review history", History],
          ].map(([id, label, Icon]) => (
            <button
              key={id}
              className={
                view === id ||
                (id === "study" && view === "review") ||
                (id === "library" &&
                  ["detail", "author", "catalog", "newDeck"].includes(view))
                  ? "selected"
                  : ""
              }
              aria-current={view === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="index-tools">
          <span className="system-appearance">System · {appearance}</span>
          <button
            className="ghost"
            aria-label="Settings & backups"
            onClick={() => go("settings")}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>
      <main className="main">
        {view !== "review" && (
          <header className="page-header">
            <div>
              <span className="eyebrow">{eyebrows[view]}</span>
              <h1>{title}</h1>
            </div>
            <div className="header-actions">
              <button
                className="ghost"
                aria-label="Search Recall"
                onClick={() => {
                  go("library");
                  requestAnimationFrame(() => searchRef.current?.focus());
                }}
              >
                <Search size={17} />
              </button>
              <button onClick={() => author(null)}>
                <Plus size={16} /> New card
              </button>
            </div>
          </header>
        )}
        {["study", "library"].includes(view) &&
          (view === "library" || data.cards.length > 0) && (
            <Filters
              data={data}
              selection={selection}
              changeSelection={changeSelection}
              topics={topics}
              study={view === "study"}
            />
          )}
        {view === "selftest" && (
          <SelfTest
            data={learning}
            format={selection.format}
            onFormat={(format) => changeSelection({ format })}
            activeSession={activeSession}
            busy={busy}
            onStart={startSelfTest}
            onBrowse={(id) => {
              const card = data.cards.find((c) => c.id === id);
              if (card) browse(card);
            }}
            onResume={() => go("review")}
            onStudy={() => go("study")}
            onFolder={() => api.showLearningLog().catch(fail)}
          />
        )}
        {view === "study" && data.cards.length === 0 && (
          <WelcomeGuide
            busy={busy}
            onDemo={() => mutate(() => api.demo(), "Demo ready.")}
            onImport={() => {
              go("library");
              importAnki();
            }}
            onConnect={openLearningSettings}
          />
        )}
        {view === "study" && data.cards.length > 0 && (
          <StudyDesk
            selfTest={
              <SelfTestTile data={learning} onOpen={() => go("selftest")} />
            }
            selection={selection}
            changeSelection={changeSelection}
            eligible={eligible}
            matching={matching}
            activeSession={activeSession}
            reviewedToday={reviewedToday}
            busy={busy}
            now={now}
            onStart={start}
            onResume={() => go("review")}
            onBrowse={browse}
            onLibrary={() => go("library")}
          />
        )}
        {view === "study" && data.cards.length > 0 && (
          <StudyShelf
            data={data}
            topics={selection.topics}
            compact
            onDeck={openDeck}
            onNewDeck={() => go("newDeck")}
          />
        )}
        {view === "library" && !search && selection.deck === "all" && (
          <StudyShelf
            data={data}
            topics={selection.topics}
            onDeck={openDeck}
            onNewDeck={() => go("newDeck")}
          />
        )}
        {view === "catalog" && (
          <CatalogView
            data={{
              ...data,
              cards: data.cards
                .filter((c) => c.catalog?.id === selectedCatalog?.id)
                .map(displayCatalog),
            }}
            filters={catalogFilters}
            setFilters={setCatalogFilters}
            onBrowse={browse}
            onStart={startCatalog}
            onState={updateChallengeState}
            fail={fail}
          />
        )}
        {view === "library" && (
          <LibraryView
            visible={visible}
            matching={matching}
            search={search}
            setSearch={setSearch}
            searchRef={searchRef}
            busy={busy}
            now={now}
            onImport={importAnki}
            onBrowse={browse}
            onNewCard={() => author(null)}
          />
        )}
        {view === "review" && !current && (
          <Completion
            session={activeSession}
            events={sessionEvents}
            busy={busy}
            onBack={() => go("study")}
            onUndo={undo}
            onSelfTest={() => go("selftest")}
          />
        )}
        {view === "review" && current && (
          <div className="review-shell">
            <ReviewToolbar
              session={activeSession}
              card={current}
              wide={expanded}
              onPause={() => go("study")}
              onToggleWide={() => setWide(!expanded)}
            />
            <div
              className={
                "review-layout " +
                (current.kind === "code" ? "code-layout" : "")
              }
            >
              <div className="review-leaf">
                <ReviewCard
                  key={"review:" + current.id}
                  card={current}
                  revealed={activeSession.revealed}
                  reveal={reveal}
                  browsing={false}
                  rate={rate}
                  busy={busy || answerBusy}
                  onVoiceBusyChange={setAnswerBusy}
                  fail={fail}
                  onOpenVoiceSettings={openVoiceSettings}
                  challengeState={data.challengeStates?.[current.id]}
                  onChallengeState={updateChallengeState}
                  practice={activeSession.selection.practice}
                  intervals={intervals}
                  onExport={(id) =>
                    mutate(
                      () => api.exportAttempt(id),
                      (r) =>
                        r
                          ? "Assessment packet saved. Open it with Codex to review your paper solution."
                          : "Export cancelled",
                    )
                  }
                />
              </div>
              {current.kind !== "code" && (
                <aside className="session-index">
                  <span className="eyebrow">This session</span>
                  <ol>
                    {activeSession.ids.map((id, index) => {
                      const card = data.cards.find((c) => c.id === id);
                      return (
                        <li
                          key={id}
                          className={
                            index === activeSession.index
                              ? "current"
                              : index < activeSession.index
                                ? "done"
                                : ""
                          }
                        >
                          <span>
                            {index < activeSession.index
                              ? "✓"
                              : String(index + 1).padStart(2, "0")}
                          </span>
                          <div>
                            <strong>
                              {card ? plain(card.title) : "Unavailable card"}
                            </strong>
                            <small>
                              {card?.kind === "code"
                                ? "Coding"
                                : card?.kind === "math"
                                  ? "Math"
                                  : "Concept"}
                            </small>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </aside>
              )}
            </div>
            <ReviewFooter
              busy={busy || answerBusy}
              onUndo={undo}
              onSkip={() => rate("Skip")}
            />
          </div>
        )}
        {view === "detail" && current && (
          <div className="review-shell">
            <DetailToolbar
              card={current}
              wide={expanded}
              onToggleWide={() => setWide(!expanded)}
              index={detailIndex}
              total={detailCards.length}
              backLabel={detailIds ? "Back to challenges" : "Back to library"}
              onBack={() => go(detailIds ? "catalog" : "library")}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
            />
            <ReviewCard
              key={"detail:" + current.id}
              card={current}
              revealed={detailRevealed}
              reveal={reveal}
              browsing={true}
              rate={rate}
              busy={busy || answerBusy}
              onVoiceBusyChange={setAnswerBusy}
              fail={fail}
              onOpenVoiceSettings={openVoiceSettings}
              challengeState={data.challengeStates?.[current.id]}
              onChallengeState={updateChallengeState}
              onExport={(id) =>
                mutate(
                  () => api.exportAttempt(id),
                  (r) =>
                    r
                      ? "Assessment packet saved. Open it with Codex to review your paper solution."
                      : "Export cancelled",
                )
              }
            />
            <DetailFooter
              card={current}
              onCopyLink={() =>
                api
                  .copyCardLink(current.id)
                  .then(() => notify("Card link copied."))
                  .catch(fail)
              }
              onEdit={() => author(current)}
              onSuspend={() =>
                mutate(
                  () => api.suspend(current.id, !current.suspended),
                  current.suspended ? "Card resumed." : "Card suspended.",
                ).then(() => go("library"))
              }
            />
          </div>
        )}
        {view === "speak" && <SpeakView onSettings={openVoiceSettings} />}
        {view === "progress" && (
          <ProgressView
            onStudy={() => go("study")}
            onHistory={(day = null) => {
              setHistoryDay(day);
              go("history");
            }}
            onOpen={(id) => {
              const card = data.cards.find((c) => c.id === id);
              if (card) browse(card);
            }}
            onTopic={(topic) => {
              changeSelection({ ...defaultSelection, topics: [topic] });
              go("study");
            }}
          />
        )}
        {view === "history" && (
          <HistoryView
            history={data.history}
            initialDay={historyDay}
            timeZone={learning?.timeZone}
            cards={data.cards}
            now={new Date(now)}
            onOpen={browse}
            onStudy={() => go("study")}
          />
        )}
        {view === "settings" && (
          <SettingsView
            voiceFocus={!!voiceReturn}
            initialSection={settingsSection}
            voiceBackLabel={
              voiceReturn?.view === "speak" ? "Back to Speak" : undefined
            }
            onBackToAnswer={voiceReturn ? returnFromVoiceSettings : undefined}
            folder={data.folder}
            version={VERSION}
            onOpenFolder={() => api.showData()}
            onBackup={() =>
              mutate(
                () => api.backup(),
                (file) => "Backup saved: " + file,
              )
            }
            onExport={() =>
              mutate(
                () => api.export(),
                (file) => (file ? "Exported: " + file : "Export cancelled"),
              )
            }
          />
        )}
        {view === "author" && (
          <AuthorForm
            key={editing?.id || "new"}
            card={editing}
            decks={data.decks}
            defaultDeck={
              selection.deck === "all" ? data.decks[0] : selection.deck
            }
            topics={[...new Set(data.cards.map((c) => c.topic))].sort()}
            defaultTopic={selection.topics[0] || topics[0]}
            onCancel={() => go("library")}
            onSave={async (card) => {
              const id = await mutate(() => api.saveCard(card), "Card saved.");
              if (id) go("library");
            }}
          />
        )}
        {view === "newDeck" && (
          <NewDeck
            onSave={async (name) => {
              const result = await mutate(async () => {
                await api.newDeck(name);
                return true;
              }, "Deck created.");
              if (result) {
                changeSelection({ deck: name, topics: [] });
                go("study");
              }
            }}
            onCancel={() => go("study")}
          />
        )}
        <footer className="index-footer">
          <span>Recall · A little practice, every day.</span>
          <span>
            {data.cards.length} cards · On your Mac · {VERSION}
          </span>
        </footer>
      </main>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
