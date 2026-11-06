import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  CircleHelp,
  Search,
  History,
  GitBranch,
  Sprout,
} from "lucide-react";
import { FormatPicker } from "./StudyDesk";
import { plain, formatLabel } from "./model";
import {
  lanes,
  stateLabels,
  stateOf,
  evidence,
  summarize,
  filterConcepts,
  rank,
  practiceIds,
  connections,
} from "./atlas-model";
import "./learning-map.css";

const dateLabel = (value, zone) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: zone,
  });
const marks = { needs_practice: "?", unclear: "…", partial: "·" };
function Dot({ state }) {
  return (
    <span className={`atlas-dot ${state}`} aria-hidden="true">
      {state === "recalled_later" ? <Check size={14} /> : marks[state] || ""}
    </span>
  );
}
function Constellation({
  rows,
  momentRows,
  selected,
  select,
  links,
  expanded,
}) {
  const ref = useRef(null),
    [paths, setPaths] = useState([]);
  useEffect(() => {
    const element = ref.current;
    const draw = () => {
      const outer = element.getBoundingClientRect();
      const points = new Map(
        [...element.querySelectorAll("[data-concept]")].map((node) => {
          const dot = node.querySelector(".atlas-dot").getBoundingClientRect();
          return [
            node.dataset.concept,
            {
              x: dot.x - outer.x + dot.width / 2,
              y: dot.y - outer.y + dot.height / 2,
            },
          ];
        }),
      );
      setPaths(
        links
          .filter((l) => points.has(l.a) && points.has(l.b))
          .map((l) => {
            const a = points.get(l.a),
              b = points.get(l.b);
            return { ...l, d: `M ${a.x} ${a.y} Q ${a.x} ${b.y} ${b.x} ${b.y}` };
          }),
      );
    };
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    draw();
    return () => observer.disconnect();
  }, [rows, links, expanded]);
  return (
    <div
      className={`atlas-constellation ${expanded ? "expanded" : ""}`}
      ref={ref}
    >
      <svg className="atlas-paths" aria-hidden="true">
        {paths.map((p) => (
          <path
            key={p.a + p.b}
            d={p.d}
            className={p.demonstrated ? "demonstrated" : ""}
          />
        ))}
      </svg>
      {rows.map((current) => {
        const row = momentRows.get(current.id) || current,
          state = stateOf(row);
        return (
          <button
            key={row.id}
            data-concept={row.id}
            className="atlas-node"
            aria-pressed={selected === row.id}
            aria-label={`${plain(row.title)}: ${stateLabels[state]}`}
            onClick={() => select(row.id)}
            title={plain(row.title)}
          >
            <Dot state={state} />
            <span className="atlas-node-title">{plain(row.title)}</span>
            {expanded && (
              <small>
                {row.cards.length} {row.cards.length === 1 ? "card" : "cards"}
              </small>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function LearningMap({
  selection,
  onSelection,
  onOpen,
  onPractice,
  onExplain,
  onHistory,
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null);
  const [region, setRegion] = useState(null),
    [page, setPage] = useState(0),
    [moment, setMoment] = useState("now");
  const [evidenceLimit, setEvidenceLimit] = useState(6);
  const detailRef = useRef(null);
  useEffect(() => {
    let live = true,
      request = 0;
    const load = async () => {
      const id = ++request;
      try {
        const next = await window.recall.learningMap();
        if (live && id === request) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (live && id === request) setError(e.message);
      }
    };
    load();
    const unsubscribe = window.recall.onLibraryChanged(load);
    const timer = setInterval(load, 60000);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);
  const concepts = data?.concepts || [];
  const currentRows = useMemo(
    () => filterConcepts(concepts, selection, search, plain),
    [data, selection, search],
  );
  const pastRows = useMemo(
    () =>
      filterConcepts(data?.previous?.concepts || [], selection, search, plain),
    [data, selection, search],
  );
  const rows = moment === "then" ? pastRows : currentRows;
  const momentRows = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const topicNames = [...new Set(concepts.map((c) => c.topic))].sort();
  const collections = [...new Set(concepts.flatMap((c) => c.decks))].sort();
  const regions = [...new Set(currentRows.map((r) => r.topic))].sort();
  const focused = regions.includes(region) ? region : null;
  const visibleScope = focused ? rows.filter((r) => r.topic === focused) : rows;
  const currentScope = focused
    ? currentRows.filter((r) => r.topic === focused)
    : currentRows;
  const counts = summarize(visibleScope),
    nowCounts = summarize(currentScope);
  const previousCounts = summarize(
    focused ? pastRows.filter((r) => r.topic === focused) : pastRows,
  );
  const links = useMemo(() => connections(rows), [rows]);
  const next = rank(currentScope)[0];
  const selectedRow = rows.find(
    (r) => r.id === selected && (!focused || r.topic === focused),
  );
  const detail = selectedRow || (next && momentRows.get(next.id));
  const ordered = useMemo(() => rank(currentScope), [currentRows, focused]);
  const pageSize = focused ? 12 : 6;
  const pageCount = Math.max(
    1,
    Math.ceil((focused ? ordered.length : regions.length) / pageSize),
  );
  const activePage = Math.min(page, pageCount - 1);
  const topicPage = focused
    ? [focused]
    : regions.slice(activePage * pageSize, (activePage + 1) * pageSize);
  const choose = (patch) => {
    onSelection(patch);
    setPage(0);
    setSelected(null);
    setEvidenceLimit(6);
  };
  const chooseRegion = (topic) => {
    setRegion(topic);
    setPage(0);
    setSelected(null);
    setEvidenceLimit(6);
  };
  const select = (id) => {
    setSelected(id);
    setEvidenceLimit(6);
    // Only an explicit selection scrolls the narrow layout; data refreshes do not.
    if (window.matchMedia("(max-width: 1100px)").matches)
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        }),
      );
  };
  const formatCounts = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(formatLabel).map((format) => [
          format,
          filterConcepts(concepts, { ...selection, format }, search, plain)
            .filter((r) => !focused || r.topic === focused)
            .reduce((n, r) => n + r.cards.length, 0),
        ]),
      ),
    [data, selection, search, focused],
  );
  const date = (at) => dateLabel(at, data?.timeZone);
  const detailItems = detail
    ? lanes.flatMap((lane) =>
        detail[lane]
          .filter((item) => lane !== "explain" || item.at)
          .map((item) => ({ ...item, lane })),
      )
    : [];
  const connectionItems = detail
    ? links.filter((l) => l.a === detail.id || l.b === detail.id)
    : [];
  return (
    <section className="learning-atlas" aria-labelledby="atlas-title">
      <header className="atlas-heading">
        <span className="eyebrow">YOUR KNOWLEDGE, TAKING SHAPE</span>
        <h1 id="atlas-title">See the ground you’ve gained.</h1>
        <p>Explore your topics. Find one gap. Build on what you can do.</p>
      </header>
      <FormatPicker
        value={selection.format}
        counts={formatCounts}
        onChange={(format) => choose({ format })}
        expanded={false}
      />
      <div className="atlas-filters">
        <label>
          Topic
          <select
            aria-label="Atlas topic"
            value={selection.topics.length === 1 ? selection.topics[0] : "all"}
            onChange={(e) => {
              choose({
                topics: e.target.value === "all" ? [] : [e.target.value],
              });
              chooseRegion(null);
            }}
          >
            <option value="all">
              {selection.topics.length > 1 ? "Selected topics" : "All topics"}
            </option>
            {topicNames.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Collection
          <select
            aria-label="Atlas collection"
            value={selection.deck}
            onChange={(e) => choose({ deck: e.target.value })}
          >
            <option value="all">All collections</option>
            {collections.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="atlas-search">
          <span>
            <Search size={13} /> Find an idea
          </span>
          <input
            aria-label="Find a concept in Atlas"
            placeholder="Search your learning…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
              setSelected(null);
            }}
          />
        </label>
        {selection.difficulty !== "all" && (
          <button
            className="text-button"
            onClick={() => choose({ difficulty: "all" })}
          >
            {selection.difficulty} only · Clear
          </button>
        )}
      </div>
      {error && <p role="alert">Couldn’t refresh Atlas: {error}</p>}
      {!data ? (
        <p role="status">Reading your practice history…</p>
      ) : (
        <>
          <div className="atlas-mapbar">
            <div>
              {focused ? (
                <button
                  className="text-button"
                  onClick={() => chooseRegion(null)}
                >
                  <ArrowLeft size={14} /> All regions
                </button>
              ) : (
                <span className="eyebrow">
                  {regions.length} {regions.length === 1 ? "TOPIC" : "TOPICS"}
                </span>
              )}
              <p aria-live="polite">
                <strong>{counts.successful}</strong> of {counts.total} ideas
                with a successful attempt
              </p>
            </div>
            <div className="atlas-time" role="group" aria-label="Atlas history">
              <button
                aria-pressed={moment === "then"}
                onClick={() => setMoment("then")}
              >
                A week ago
              </button>
              <button
                aria-pressed={moment === "now"}
                onClick={() => setMoment("now")}
              >
                Now
              </button>
            </div>
          </div>
          <div className="atlas-workspace">
            <div className="atlas-landscape">
              {focused && <h3 className="atlas-region-title">{focused}</h3>}
              {!rows.length && (
                <div className="atlas-empty">
                  <Sprout size={25} />
                  <h3>A new part of your atlas.</h3>
                  <p>
                    {concepts.length
                      ? "No cards match these filters. Try another format, topic or collection."
                      : "Your ready cards will form topic regions here. Practice adds the evidence."}
                  </p>
                </div>
              )}
              <div className={`atlas-regions ${focused ? "focused" : ""}`}>
                {topicPage.map((topic) => {
                  const current = currentRows.filter((r) => r.topic === topic),
                    topicRows = rows.filter((r) => r.topic === topic),
                    total = summarize(topicRows);
                  const shown = focused
                    ? ordered.slice(
                        activePage * pageSize,
                        (activePage + 1) * pageSize,
                      )
                    : rank(current).slice(0, 4);
                  return (
                    <section
                      className="atlas-region"
                      key={topic}
                      aria-label={`${topic} region`}
                    >
                      {!focused && (
                        <header>
                          <button
                            className="atlas-region-open"
                            onClick={() => chooseRegion(topic)}
                          >
                            {topic}
                            <ArrowRight size={15} />
                          </button>
                          <span>
                            {total.total} {total.total === 1 ? "idea" : "ideas"}
                          </span>
                        </header>
                      )}
                      <Constellation
                        rows={shown}
                        momentRows={momentRows}
                        selected={detail?.id}
                        select={select}
                        links={links}
                        expanded={!!focused}
                      />
                      {!focused && (
                        <footer>
                          <span>
                            {total.needs_practice
                              ? `${total.needs_practice} to revisit`
                              : total.tried
                                ? `${total.tried} with evidence`
                                : "Ready for a first attempt"}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => chooseRegion(topic)}
                            aria-label={`Explore all ${current.length} ideas in ${topic}`}
                          >
                            Explore {current.length} <ArrowRight size={13} />
                          </button>
                        </footer>
                      )}
                    </section>
                  );
                })}
              </div>
              {pageCount > 1 && (
                <nav className="atlas-pagination" aria-label="Atlas pages">
                  <button
                    aria-label="Previous atlas page"
                    disabled={!activePage}
                    onClick={() => setPage(activePage - 1)}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <span>
                    {focused ? "Ideas" : "Regions"} {activePage * pageSize + 1}–
                    {Math.min(
                      (activePage + 1) * pageSize,
                      focused ? ordered.length : regions.length,
                    )}{" "}
                    of {focused ? ordered.length : regions.length}
                  </span>
                  <button
                    aria-label="Next atlas page"
                    disabled={activePage === pageCount - 1}
                    onClick={() => setPage(activePage + 1)}
                  >
                    <ArrowRight size={16} />
                  </button>
                </nav>
              )}
              <div className="atlas-legend">
                {Object.entries(stateLabels).map(([state, label]) => (
                  <span key={state}>
                    <Dot state={state} />
                    {label}
                  </span>
                ))}
              </div>
              <p className="atlas-note">
                Each point is an idea; its cards keep separate evidence. “Some
                evidence” leaves an applicable format untried. Lines appear only
                for explicit card relationships.
              </p>
            </div>
            <aside
              className="atlas-detail"
              ref={detailRef}
              aria-label="Selected concept evidence"
            >
              {detail ? (
                <>
                  <span className="eyebrow">
                    {moment === "then"
                      ? `EVIDENCE AS OF ${date(data.previous.at)}`
                      : "YOUR NEXT USEFUL WIN"}
                  </span>
                  <h3>{plain(detail.title)}</h3>
                  <p className="atlas-detail-topic">
                    {detail.topic} · {formatLabel[selection.format]}
                  </p>
                  <div className="atlas-evidence">
                    {detailItems.slice(0, evidenceLimit).map((e) => (
                      <div
                        className="atlas-evidence-row"
                        key={e.cardId + e.lane}
                      >
                        <Dot state={e.state} />
                        <div>
                          <strong>
                            {e.lane === "explain"
                              ? "Explain · Speak"
                              : formatLabel[e.kind]}
                          </strong>
                          <span>{e.label}</span>
                          <small>
                            {e.at
                              ? `${e.source} · ${date(e.at)} · ${e.detail}`
                              : "No recorded attempt"}
                          </small>
                          {detail.cards.filter((c) => c.kind === e.kind)
                            .length > 1 && (
                            <small>
                              {plain(
                                detail.cards.find((c) => c.id === e.cardId)
                                  ?.title,
                              )}
                            </small>
                          )}
                          <button
                            className="text-button"
                            onClick={() =>
                              e.lane === "explain"
                                ? onExplain(e.cardId)
                                : onOpen(e.cardId)
                            }
                          >
                            {e.lane === "explain"
                              ? "Explain this idea"
                              : "Open card"}
                            <ArrowRight size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {detailItems.length > evidenceLimit && (
                      <button
                        className="text-button"
                        onClick={() => setEvidenceLimit(evidenceLimit + 6)}
                      >
                        Show more evidence ({detailItems.length - evidenceLimit}
                        )
                      </button>
                    )}
                  </div>
                  {detail.explain.some((e) => !e.at) && (
                    <button
                      className="text-button atlas-speak"
                      onClick={() =>
                        onExplain(detail.explain.find((e) => !e.at).cardId)
                      }
                    >
                      Try explaining this idea <ArrowRight size={13} />
                    </button>
                  )}
                  <div className="atlas-challenge">
                    <span className="eyebrow">
                      {stateOf(detail) === "needs_practice"
                        ? "REPAIR A GAP"
                        : evidence(detail).some((e) => e.at)
                          ? "RETURN TO THE IDEA"
                          : "MAKE A FIRST ATTEMPT"}
                    </span>
                    <p>
                      {stateOf(detail) === "needs_practice"
                        ? "Work through this idea again. Your next attempt becomes part of its history."
                        : "Try the cards in your chosen format. Your rating stays yours."}
                    </p>
                    <button
                      className="primary"
                      onClick={() =>
                        onPractice(practiceIds(currentScope, detail.id))
                      }
                    >
                      Practice this idea <ArrowRight size={15} />
                    </button>
                    <small>
                      {moment === "then"
                        ? "Practice uses the current card. "
                        : ""}
                      Answers start hidden. Up to three matching cards.
                    </small>
                  </div>
                  {connectionItems.length > 0 && (
                    <details className="atlas-related">
                      <summary>
                        <GitBranch size={14} /> Connected ideas (
                        {connectionItems.length})
                      </summary>
                      {connectionItems.slice(0, 8).map((link) => {
                        const other = rows.find(
                          (r) =>
                            r.id === (link.a === detail.id ? link.b : link.a),
                        );
                        return (
                          <div key={link.a + link.b}>
                            <button
                              className="text-button"
                              onClick={() => {
                                chooseRegion(null);
                                select(other.id);
                              }}
                            >
                              {plain(other.title)}
                            </button>
                            <small>
                              {link.demonstrated
                                ? "Successful shared exercise"
                                : "Linked by the source card"}
                            </small>
                            <button
                              className="text-button"
                              onClick={() => onOpen(link.sourceCardId)}
                            >
                              Open supporting card
                            </button>
                          </div>
                        );
                      })}
                    </details>
                  )}
                  {!!detail.events?.length && (
                    <details className="atlas-attempts">
                      <summary>
                        <History size={14} /> Recorded attempts (
                        {detail.events.length})
                      </summary>
                      {detail.events.slice(0, 8).map((e, i) => (
                        <div key={`${e.source}-${e.eventId}-${i}`}>
                          <strong>{e.detail}</strong>
                          <span>
                            {date(e.at)} · {formatLabel[e.kind]} · {e.source}
                          </span>
                          {e.source === "Self-rated" && (
                            <button
                              className="text-button"
                              onClick={() =>
                                onHistory?.(
                                  new Intl.DateTimeFormat("en-CA", {
                                    timeZone: data.timeZone,
                                  }).format(new Date(e.at)),
                                )
                              }
                            >
                              View review day
                            </button>
                          )}
                        </div>
                      ))}
                      <p className="atlas-note">
                        Ratings plus the latest linked Speak/test/handwriting
                        result. No answer text is inferred from a rating.
                      </p>
                    </details>
                  )}
                </>
              ) : (
                <>
                  <CircleHelp size={22} />
                  <h3>Your next useful win</h3>
                  <p>
                    Select an idea to see what you’ve tried and what could use
                    another look.
                  </p>
                </>
              )}
            </aside>
          </div>
          {!!rows.length && (
            <div className="atlas-next">
              <div>
                <span className="eyebrow">ONE SMALL STEP</span>
                <strong>
                  {nowCounts.needs_practice
                    ? `${nowCounts.needs_practice} ${nowCounts.needs_practice === 1 ? "idea deserves" : "ideas deserve"} another look.`
                    : "Build the picture one answer at a time."}
                </strong>
                <p>
                  Up to three cards in your selected format
                  {focused ? `, from ${focused}` : " and collection"}.
                </p>
              </div>
              <button
                className="primary"
                onClick={() => onPractice(practiceIds(currentScope))}
              >
                Review a small set <ArrowRight size={15} />
              </button>
            </div>
          )}
          <div className="atlas-growth">
            <History size={19} />
            <div>
              <strong>
                {nowCounts.successful > previousCounts.successful
                  ? `${nowCounts.successful - previousCounts.successful} more ideas with successful evidence than a week ago.`
                  : "Your learning has a history."}
              </strong>
              <p>
                {moment === "then"
                  ? `Showing evidence recorded by ${date(data.previous.at)}. `
                  : "Switch to a week ago to see how the evidence has changed. "}
                The comparison uses today’s available cards and relationships,
                not a historical library snapshot.
              </p>
            </div>
          </div>
          <details className="atlas-method">
            <summary>What counts as progress?</summary>
            <p>
              Concepts use scored ratings and card-linked Speak feedback. Math
              and Coding use scored ratings, exact-revision local tests or saved
              handwriting feedback. Again and Hard deserve another look; Good
              and Easy are successful self-ratings. A delayed ring requires a
              successful rating at least 24 hours after the previous scored
              attempt for every displayed card in that idea.
            </p>
            <p>
              Opening, importing or capturing a card is not a successful
              attempt. Practice-only, undone and future ratings are excluded. AI
              feedback uses its saved reference. Connections become demonstrated
              only when an explicitly shared exercise has a successful result.
              These are evidence labels, not permanent mastery; all schedules
              and ratings remain unchanged until you study and rate a card.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
