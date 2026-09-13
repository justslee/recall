import React, { useEffect, useState } from "react";
import { ArrowRight, CalendarCheck, Check, Circle } from "lucide-react";
import "./self-test.css";
export function SelfTestTile({ data, onOpen }) {
  const day = data?.days.find((d) => d.day === data.today);
  return (
    <button className="self-test-tile" onClick={onOpen}>
      <CalendarCheck size={23} />
      <span>
        <strong>Today's self test</strong>
        <small>
          {day?.entries.length
            ? `${day.pending.length} questions ready · ${day.sessions} captured sessions`
            : "Turn today’s learning into something you can recall."}
        </small>
      </span>
      <ArrowRight size={20} />
    </button>
  );
}
export function SelfTest({
  data,
  activeSession,
  busy,
  onStart,
  onResume,
  onFolder,
}) {
  const [chosen, setChosen] = useState(null);
  const [replace, setReplace] = useState(false);
  useEffect(() => setReplace(false), [chosen]);
  if (!data) return <p>Loading your learning log…</p>;
  const day =
    data.days.find((d) => d.day === (chosen || data.today)) || data.days[0];
  const tested = day.cards.filter((c) => c.tested).length;
  const needsWork = day.cards.filter(
    (c) => c.tested && ["Again", "Hard"].includes(c.rating),
  ).length;
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
              : "Your captured learning, revisited."}
        </h2>
        <p>
          Answer from memory, work it out on paper, or solve it in the editor.
          Reveal the explanation when you’re ready, then rate your recall.
        </p>
        <div className="self-test-stats">
          <span>
            <strong>{day.pending.length}</strong> ready to test
          </span>
          <span>
            <strong>{tested}</strong> tested
          </span>
          <span>
            <strong>{needsWork}</strong> need practice
          </span>
          <span>
            <strong>{day.sessions}</strong> sessions captured
          </span>
        </div>
        {!!day.pending.length &&
          (!paused ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => onStart(day.day, false)}
            >
              Start self test <ArrowRight size={17} />
            </button>
          ) : (
            <div className="self-test-actions">
              <button className="primary" onClick={onResume}>
                Resume current session
              </button>
              <button onClick={() => setReplace(!replace)}>
                Start this self test instead
              </button>
              {replace && (
                <div role="alert">
                  <p>
                    This replaces the remaining queue. Your completed reviews
                    stay saved.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => onStart(day.day, true)}
                  >
                    Replace queue and start
                  </button>
                </div>
              )}
            </div>
          ))}
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
              : "All linked questions have been tested. Any difficult cards remain in your spaced review schedule."}
          </p>
        )}
        <small>
          Real reviews update spaced repetition, including cards tested before
          their due date. Skipped questions remain untested.
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
                <span key={id}>
                  {card?.tested ? <Check size={13} /> : <Circle size={13} />}{" "}
                  {card?.kind || "Card"} ·{" "}
                  {card?.tested
                    ? ["Again", "Hard"].includes(card.rating)
                      ? "Needs practice"
                      : "Tested"
                    : card?.available
                      ? "Ready"
                      : "Unavailable"}
                </span>
              );
            })}
          </div>
        </article>
      ))}
      <p className="self-test-footnote">
        Only captured sessions appear here. Discussing a concept is evidence of
        exposure, not mastery. Dates use {data.timeZone}.
      </p>
    </div>
  );
}
