import React, { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { matches, formatLabel, scopeText } from "./model";
import { iconFor, CardRow, Progress } from "./ui";

export function TopicOptions({ selection, changeSelection, topics }) {
  return (
    <>
      <button
        className={!selection.topics.length ? "active" : ""}
        aria-pressed={!selection.topics.length}
        onClick={() => changeSelection({ topics: [] })}
      >
        All topics
      </button>
      {[...new Set([...topics, ...selection.topics])].sort().map((t) => {
        const on = selection.topics.includes(t);
        return (
          <button
            key={t}
            className={on ? "active" : ""}
            aria-pressed={on}
            onClick={() =>
              changeSelection({
                topics: on
                  ? selection.topics.filter((x) => x !== t)
                  : [...selection.topics, t],
              })
            }
          >
            {t}
          </button>
        );
      })}
    </>
  );
}

/** Deck-scoped topic, format and difficulty filters shared by Study and Library. */
export function Filters({ data, selection, changeSelection, topics }) {
  const root = useRef();
  useEffect(() => {
    const close = (event) => {
      root.current
        ?.querySelectorAll(".scope-popover[open]")
        .forEach((popover) => {
          if (
            event.key === "Escape" ||
            (event.type === "pointerdown" && !popover.contains(event.target))
          ) {
            popover.open = false;
            if (event.key === "Escape")
              popover.querySelector("summary").focus();
          }
        });
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <section ref={root} className="filters" aria-label="Filters">
      <div className="formats" role="group" aria-label="Question format">
        {Object.keys(formatLabel).map((f) => {
          const Icon = iconFor[f];
          const n = data.cards.filter(
            (c) =>
              matches(c, selection, true) &&
              (f === "all" || c.kind === f) &&
              c.status === "ready" &&
              !c.suspended,
          ).length;
          return (
            <button
              key={f}
              className={selection.format === f ? "active" : ""}
              aria-pressed={selection.format === f}
              onClick={() => changeSelection({ format: f })}
            >
              <Icon size={16} />
              <span>{formatLabel[f]}</span>
              <span className="count">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="scope-controls">
        <select
          aria-label="Collection"
          value={selection.deck}
          onChange={(e) => changeSelection({ deck: e.target.value })}
        >
          <option value="all">All collections</option>
          {data.decks.map((deck) => (
            <option key={deck} value={deck}>
              {deck}
            </option>
          ))}
        </select>
        <details className="scope-popover">
          <summary>
            {selection.topics.length
              ? selection.topics.join(", ")
              : "All topics"}
          </summary>
          <div className="scope-popover-content">
            <TopicOptions
              selection={selection}
              changeSelection={changeSelection}
              topics={topics}
            />
          </div>
        </details>
        <details className="more-filters scope-popover">
          <summary>
            {selection.difficulty === "all"
              ? "Difficulty"
              : selection.difficulty}
          </summary>
          <div className="scope-popover-content">
            <select
              aria-label="Difficulty"
              value={selection.difficulty}
              onChange={(e) => changeSelection({ difficulty: e.target.value })}
            >
              {["all", "Foundation", "Application", "Challenge"].map((d) => (
                <option key={d} value={d}>
                  {d === "all" ? "All difficulties" : d}
                </option>
              ))}
            </select>
          </div>
        </details>
      </div>
    </section>
  );
}

export function StudyDesk({
  selection,
  changeSelection,
  eligible,
  matching,
  activeSession,
  reviewedToday,
  busy,
  now,
  onStart,
  onResume,
  onBrowse,
  onLibrary,
}) {
  const paused =
    activeSession && activeSession.index < activeSession.ids.length;
  const newCount = eligible.filter((c) => c.schedule.state === 0).length;
  return (
    <>
      {paused && (
        <div className="paused">
          <div>
            <strong>Your session is saved</strong>
            <small>
              {scopeText(activeSession.selection)} · {activeSession.index} of{" "}
              {activeSession.ids.length} done
            </small>
            <Progress
              value={activeSession.index}
              max={activeSession.ids.length}
              label="Saved session progress"
            />
          </div>
          <button className="primary" onClick={onResume}>
            Resume session <ArrowRight size={15} />
          </button>
        </div>
      )}
      <section className="session-card">
        <div>
          <span className="eyebrow">Your next session</span>
          <h2>
            {eligible.length
              ? selection.format === "code"
                ? "A little deeper in the code."
                : selection.format === "math"
                  ? "Work it through, one step at a time."
                  : "Make a little room for recall."
              : "Nothing due in this selection."}
          </h2>
          <p className="scope">{scopeText(selection)}</p>
          <div className="session-count">
            <strong>{eligible.length}</strong>
            <span>
              {eligible.length === 1 ? "card" : "cards"} in this session
              <small>
                {eligible.length - newCount} review · {newCount} new
              </small>
            </span>
          </div>
          <p className="session-today">
            {reviewedToday
              ? `${reviewedToday} ${reviewedToday === 1 ? "review" : "reviews"} recorded today.`
              : "No reviews recorded yet today."}
          </p>
        </div>
        <div className="session-controls">
          <label>
            Study queue
            <select
              value={selection.practice ? "practice" : "review"}
              onChange={(e) =>
                changeSelection({ practice: e.target.value === "practice" })
              }
            >
              <option value="review">Due + new cards</option>
              <option value="practice">Practice without rescheduling</option>
            </select>
          </label>
          <label>
            Session size
            <select
              value={selection.limit}
              onChange={(e) =>
                changeSelection({ limit: Number(e.target.value) })
              }
            >
              {[5, 10, 20, 50].map((n) => (
                <option value={n} key={n}>
                  Up to {n} cards
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={!eligible.length || busy}
            onClick={onStart}
          >
            {selection.practice ? "Start practice" : "Start review"}
            <ArrowRight size={17} />
          </button>
        </div>
        {!eligible.length && (
          <p className="empty-note">
            Try another topic, broaden the deck, or choose Practice to review
            cards before they are due. Draft and suspended cards are excluded.
          </p>
        )}
      </section>
      <div className="section-heading">
        <span className="eyebrow">In this selection</span>
        <button className="text-button" onClick={onLibrary}>
          Browse all {matching.length} cards <ArrowRight size={14} />
        </button>
      </div>
      <div className="card-list">
        {matching.slice(0, 5).map((c) => (
          <CardRow key={c.id} card={c} now={now} onClick={() => onBrowse(c)} />
        ))}
      </div>
    </>
  );
}
