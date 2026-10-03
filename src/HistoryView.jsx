import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { plain, formatLabel } from "./model";
import { iconFor } from "./ui";

export function HistoryView({ cards, onOpen, onStudy, initialDay }) {
  const [query, setQuery] = useState(""),
    [rating, setRating] = useState("all"),
    [kind, setKind] = useState("all"),
    [days, setDays] = useState(0),
    [day, setDay] = useState(initialDay || ""),
    [offset, setOffset] = useState(0),
    [data, setData] = useState(null),
    [detail, setDetail] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    const timer = setTimeout(
      () => {
        window.recall
          .reviewHistory({ query, rating, kind, day, days, offset })
          .then((value) => {
            if (live) {
              setData(value);
              setError("");
            }
          })
          .catch((e) => {
            if (live) setError(e.message);
          });
      },
      query ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, rating, kind, day, days, offset]);
  const change = (set, value) => {
    set(value);
    setOffset(0);
    setDetail(null);
  };
  const byId = new Map(cards.map((c) => [c.id, c]));
  const date = (at, options) =>
    new Date(at).toLocaleString(undefined, {
      timeZone: data?.timeZone,
      ...options,
    });
  const card = detail && byId.get(detail.card_id);
  let previous = "";
  return (
    <div className="ledger">
      <p className="page-description">
        Inspect a past attempt, revisit a card, or follow the trail of your
        practice.
      </p>
      <div className="ledger-toolbar">
        <label className="ledger-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search review history"
            placeholder="Find a concept, topic or collection…"
            maxLength={200}
            value={query}
            onChange={(e) => change(setQuery, e.target.value)}
          />
        </label>
        <select
          aria-label="History period"
          value={days}
          onChange={(e) => change(setDays, Number(e.target.value))}
        >
          <option value={0}>All history</option>
          <option value={7}>Last 7 days</option>
          <option value={28}>Last 28 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <select
          aria-label="History rating"
          value={rating}
          onChange={(e) => change(setRating, e.target.value)}
        >
          {["all", "Again", "Hard", "Good", "Easy", "Skip"].map((r) => (
            <option key={r} value={r}>
              {r === "all" ? "All ratings" : r}
            </option>
          ))}
        </select>
        <select
          aria-label="History format"
          value={kind}
          onChange={(e) => change(setKind, e.target.value)}
        >
          {Object.entries(formatLabel).map(([k, label]) => (
            <option value={k} key={k}>
              {k === "all" ? "All formats" : label}
            </option>
          ))}
        </select>
        {day && (
          <button className="day-filter" onClick={() => change(setDay, "")}>
            {day}
            <X size={14} />
          </button>
        )}
      </div>
      {error && <p role="alert">Couldn’t load reviews: {error}</p>}
      {!data ? (
        <p role="status">Opening your review ledger…</p>
      ) : (
        <div className={"ledger-layout " + (detail ? "has-detail" : "")}>
          <section className="ledger-entries" aria-label="Review attempts">
            {!data.events.length && (
              <div className="empty-state">
                <h2>No reviews here yet.</h2>
                <p>Try another filter, or return to your study desk.</p>
                <button onClick={onStudy}>Go to study desk</button>
              </div>
            )}
            {data.events.map((event) => {
              const c = byId.get(event.card_id),
                Icon = iconFor[c?.kind] || iconFor.concept;
              const label = date(event.at, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }),
                heading = previous !== label;
              previous = label;
              return (
                <React.Fragment key={event.id}>
                  {heading && <h3 className="ledger-date">{label}</h3>}
                  <button
                    className={
                      "ledger-entry " +
                      (detail?.id === event.id ? "selected " : "") +
                      (event.undone ? "undone" : "")
                    }
                    onClick={() => setDetail(event)}
                    aria-label={`Inspect ${c ? plain(c.title) : "Unavailable card"}, ${event.rating}`}
                  >
                    <time dateTime={event.at}>
                      {date(event.at, { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <span>
                      <strong>
                        {c ? plain(c.title) : "Card no longer in library"}
                      </strong>
                      <small>
                        {c?.topic} ·{" "}
                        {event.practice ? "Extra practice" : "Scheduled review"}
                        {event.undone ? " · Undone" : ""}
                      </small>
                    </span>
                    <span className="ledger-type">
                      <Icon size={14} />
                      {formatLabel[c?.kind]}
                    </span>
                    <span className={"rating-chip " + event.rating}>
                      {event.rating}
                    </span>
                    <ChevronRight size={15} />
                  </button>
                </React.Fragment>
              );
            })}
            <div className="ledger-pagination">
              <span aria-live="polite">
                {data.total} attempts · Page {Math.floor(offset / 30) + 1} of{" "}
                {Math.max(1, Math.ceil(data.total / 30))}
              </span>
              <div>
                <button
                  aria-label="Previous history page"
                  disabled={!offset}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 30));
                    setDetail(null);
                  }}
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  aria-label="Next history page"
                  disabled={offset + 30 >= data.total}
                  onClick={() => {
                    setOffset(offset + 30);
                    setDetail(null);
                  }}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </section>
          {detail && (
            <aside className="ledger-detail">
              <button
                className="ghost close-detail"
                aria-label="Close review details"
                onClick={() => setDetail(null)}
              >
                <X size={16} />
              </button>
              <span className="eyebrow">Review details</span>
              <h2>{card ? plain(card.title) : "Unavailable card"}</h2>
              <span className={"rating-chip " + detail.rating}>
                {detail.rating}
              </span>
              <p className="muted">
                {date(detail.at, { dateStyle: "medium", timeStyle: "short" })}
                {detail.undone ? " · Undone" : ""}
              </p>
              <div className="ledger-detail-section">
                <span className="eyebrow">This attempt</span>
                <p>
                  {detail.practice
                    ? "Extra practice. The schedule was unchanged."
                    : detail.rating === "Skip"
                      ? "Skipped without a rating."
                      : detail.undone
                        ? "This rating was undone."
                        : `You rated this ${detail.rating}.`}
                </p>
                <p className="muted">
                  This review saved a rating, not a snapshot of your written or
                  spoken answer. Current drafts are separate.
                </p>
              </div>
              {detail.nextDue &&
                !detail.practice &&
                !detail.undone &&
                detail.rating !== "Skip" && (
                  <div className="ledger-detail-section">
                    <span className="eyebrow">Next review at the time</span>
                    <p>
                      {date(detail.nextDue, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                )}
              {card && (
                <button className="primary" onClick={() => onOpen(card)}>
                  Revisit this card <ArrowUpRight size={15} />
                </button>
              )}
              <p className="muted">Opening a card does not record a review.</p>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
