import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  Circle,
  RotateCcw,
} from "lucide-react";
import "./self-test.css";
import { FormatPicker } from "./StudyDesk";
import { formatLabel } from "./model";
export function SelfTestTile({ data, onOpen }) {
  const day = data?.days.find((d) => d.day === data.today);
  const needsPractice =
    day?.cards.filter(
      (c) => c.available && ["Again", "Hard"].includes(c.rating),
    ).length || 0;
  return (
    <aside className="self-test-tile">
      <span className="eyebrow">Today’s Self Test</span>
      <h2>
        Bring today’s
        <br />
        learning back.
      </h2>
      <p>
        {day?.entries.length
          ? `${day.pending.length} not yet attempted · ${needsPractice} need practice`
          : "Return to what you learned today, one question at a time."}
      </p>
      <button onClick={onOpen}>
        Open self test <ArrowRight size={16} />
      </button>
    </aside>
  );
}
export function SelfTest({
  data,
  format = "all",
  onFormat,
  activeSession,
  busy,
  onStart,
  onResume,
  onFolder,
  onStudy,
  onBrowse,
}) {
  const [chosen, setChosen] = useState(
    activeSession?.selection?.selfTestDay || null,
  );
  const [replacementMode, setReplacementMode] = useState(null);
  useEffect(() => setReplacementMode(null), [chosen, format]);
  if (!data) return <p>Loading your learning log…</p>;
  const day =
    data.days.find((d) => d.day === (chosen || data.today)) || data.days[0];
  const tested = day.cards.filter((c) => c.tested).length;
  const needsWork = day.cards.filter(
    (c) => c.tested && ["Again", "Hard"].includes(c.rating),
  ).length;
  const available = day.cards.filter(
    (c) => c.available && (format === "all" || c.kind === format),
  );
  const pending = available.filter((c) => day.pending.includes(c.id));
  const reviewableNeedsWork = available.filter(
    (c) => c.tested && ["Again", "Hard"].includes(c.rating),
  ).length;
  const dueNow = day.cards.filter((c) => c.available && c.dueNow).length;
  const launch = (mode) =>
    paused ? setReplacementMode(mode) : onStart(day.day, false, mode, format);
  const paused =
    activeSession && activeSession.index < activeSession.ids.length;
  return (
    <div className="self-test-page">
      <div className="self-test-heading">
        <p>What stayed with you?</p>
        <label>
          Learning day{" "}
          <select
            aria-label="Learning day"
            value={day.day}
            onChange={(e) => setChosen(e.target.value)}
          >
            {data.days.map((d) => (
              <option key={d.day} value={d.day}>
                {d.day === data.today ? "Today" : d.day} · {d.entries.length}{" "}
                objectives
              </option>
            ))}
          </select>
        </label>
      </div>
      <section className="self-test-hero">
        <span className="self-test-kicker">FROM YOUR LEARNING SESSIONS</span>
        <h2>
          {!day.entries.length
            ? "A little learning. A lasting memory."
            : day.pending.length
              ? "See what you can recall."
              : needsWork
                ? "Attempted. Still worth practicing."
                : "Your captured learning, revisited."}
        </h2>
        <p>
          Answer from memory, work it out on paper, or solve it in the editor.
          Reveal the explanation when you’re ready, then rate your recall.
        </p>
        <p className="muted">This learning day · all formats</p>
        <div className="self-test-stats">
          <span>
            <strong>{day.pending.length}</strong> not yet attempted
          </span>
          <span>
            <strong>{tested}</strong> attempted
          </span>
          <span>
            <strong>{needsWork}</strong> need practice
          </span>
          <span>
            <strong>{dueNow}</strong> due now
          </span>
        </div>
        <section
          className="daily-format-choice"
          aria-label="Choose self test format"
        >
          <h3>What fits this session?</h3>
          <FormatPicker
            value={format}
            onChange={onFormat}
            counts={Object.fromEntries(
              Object.keys(formatLabel).map((kind) => [
                kind,
                day.cards.filter(
                  (c) => c.available && (kind === "all" || c.kind === kind),
                ).length,
              ]),
            )}
          />
          <p>
            {formatLabel[format]} · {available.length} available ·{" "}
            {pending.length} not yet attempted
          </p>
          {!available.length && !!day.cards.length && (
            <p role="status">
              No available{" "}
              {format === "all"
                ? "cards"
                : formatLabel[format].toLowerCase() + " cards"}{" "}
              in this day. Choose another format or return to Study Desk.
            </p>
          )}
        </section>
        <div className="self-test-actions">
          {!!pending.length && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => launch("untested")}
            >
              Start self test <ArrowRight size={17} />
            </button>
          )}
          {!!reviewableNeedsWork && (
            <button
              className={pending.length ? "" : "primary"}
              disabled={busy}
              onClick={() => launch("needs-practice")}
            >
              <RotateCcw size={17} /> Review needs practice (
              {reviewableNeedsWork})
            </button>
          )}
          {!!available.length && (
            <button
              className={
                !pending.length && !reviewableNeedsWork ? "primary" : ""
              }
              disabled={busy}
              onClick={() => launch("all")}
            >
              Review{" "}
              {format === "all"
                ? "all cards"
                : formatLabel[format].toLowerCase()}{" "}
              ({available.length})
            </button>
          )}
          {paused && (
            <button disabled={busy} onClick={onResume}>
              Resume current session
            </button>
          )}
          {replacementMode && paused && (
            <div role="alert">
              <p>
                This replaces the remaining queue. Your completed reviews stay
                saved.
              </p>
              <button
                disabled={busy}
                onClick={() => onStart(day.day, true, replacementMode, format)}
              >
                Replace queue and start
              </button>
              <button disabled={busy} onClick={() => setReplacementMode(null)}>
                Keep current session
              </button>
            </div>
          )}
        </div>
        {!day.entries.length && (
          <p className="self-test-empty">
            No learning has been logged for this day yet. After a learning
            discussion, ask Codex: <strong>“Log this for my self test.”</strong>
          </p>
        )}
        {!!day.entries.length && !day.pending.length && (
          <p>
            {day.gaps || day.cards.some((c) => !c.available && !c.tested)
              ? "Some objectives still need an available card."
              : needsWork
                ? "You have attempted every available question. Again and Hard ratings mean there is more to practice; they do not mark a card as mastered."
                : "You have attempted every available question. Revisit this day anytime, or follow the next review dates in Study Desk."}
          </p>
        )}
        <small>
          Every review here updates the existing card’s spaced repetition
          schedule, even before its due date. Skipped cards keep their previous
          result. Ratings shown are the latest since this learning day. New
          daily Self Tests cover new captures; older due cards return in Study
          Desk.{" "}
          <button className="text-button" onClick={onStudy}>
            Open Study Desk
          </button>
        </small>
      </section>
      {!!data.issues.length && (
        <p role="alert">
          Some learning records could not be read. Coverage may be incomplete.
          Open the learning log to inspect them.
        </p>
      )}
      <div className="self-test-heading">
        <h3>What you touched on</h3>
        <button className="text-button" onClick={onFolder}>
          Open learning log
        </button>
      </div>
      {day.entries.map((entry) => (
        <article key={entry.id} className="self-test-objective">
          <div>
            <span className="self-test-kicker">
              {entry.evidence} ·{" "}
              {new Date(entry.at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                timeZone: data.timeZone,
              })}
            </span>
            <h3>{entry.title}</h3>
            <p>{entry.objective}</p>
            <p className="self-test-context">{entry.context}</p>
            <small>Session: {entry.sessionId}</small>
          </div>
          <div className="self-test-badges">
            {!entry.cardIds.length && <span>Needs a card</span>}
            {entry.cardIds.map((id) => {
              const card = day.cards.find((c) => c.id === id);
              return (
                <button
                  key={id}
                  className="text-button"
                  disabled={!card?.available}
                  onClick={() => onBrowse(id)}
                  aria-label={`Open card: ${card?.title || id}`}
                >
                  {card?.tested ? (
                    ["Again", "Hard"].includes(card.rating) ? (
                      <RotateCcw size={13} />
                    ) : (
                      <Check size={13} />
                    )
                  ) : (
                    <Circle size={13} />
                  )}{" "}
                  {card?.title || card?.kind || "Card"} ·{" "}
                  {!card?.available
                    ? "Unavailable"
                    : card?.tested
                      ? ["Again", "Hard"].includes(card.rating)
                        ? "Needs practice"
                        : "Recalled this time"
                      : card?.available
                        ? "Ready"
                        : "Unavailable"}
                </button>
              );
            })}
          </div>
        </article>
      ))}
      <p className="self-test-footnote">
        Only captured sessions appear here. Discussing a concept is evidence of
        exposure, not mastery. Choose a learning day above to revisit its cards.
        Dates use {data.timeZone}.
      </p>
    </div>
  );
}
