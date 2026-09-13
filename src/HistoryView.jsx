import React from "react";
import { History } from "lucide-react";
import { plain, sameDay, dayLabel } from "./model";
import { iconFor, EmptyState } from "./ui";

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

export function HistoryView({ history, cards, now, onOpen, onStudy }) {
  if (!history.length)
    return (
      <EmptyState
        icon={History}
        title="Your first review will appear here."
        actions={
          <button className="primary" onClick={onStudy}>
            Go to the study desk
          </button>
        }
      >
        Every rating is recorded with its date, whether it was scheduled or
        practice, and whether it was undone.
      </EmptyState>
    );
  const byId = new Map(cards.map((c) => [c.id, c]));
  const live = history.filter((e) => !e.undone);
  const today = live.filter((e) => sameDay(e.at, now)).length;
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const week = live.filter((e) => new Date(e.at) >= weekAgo).length;
  const scheduled = live.filter(
    (e) => !e.practice && e.rating !== "Skip",
  ).length;
  const groups = [];
  for (const event of history) {
    const label = dayLabel(event.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }
  return (
    <>
      <div className="history-summary">
        <div>
          <strong>{today}</strong>
          today
        </div>
        <div>
          <strong>{week}</strong>
          last 7 days
        </div>
        <div>
          <strong>{scheduled}</strong>
          scheduled ratings
        </div>
        {history.length >= 100 && (
          <span className="note">Showing the most recent 100 reviews.</span>
        )}
      </div>
      {groups.map((group) => (
        <section className="history-day" key={group.label}>
          <h3>
            {group.label}
            <small>
              {group.events.filter((e) => !e.undone).length}{" "}
              {group.events.length === 1 ? "review" : "reviews"}
            </small>
          </h3>
          {group.events.map((event) => {
            const card = byId.get(event.card_id);
            const Icon = iconFor[card?.kind] || iconFor.concept;
            return (
              <button
                className={"history-row " + (event.undone ? "undone" : "")}
                key={event.id}
                disabled={!card}
                onClick={() => card && onOpen(card)}
              >
                <span className="row-icon">
                  <Icon size={15} />
                </span>
                <span className="row-body">
                  <strong>
                    {card ? plain(card.title) : "Card no longer in library"}
                  </strong>
                  <small>
                    {event.practice
                      ? "Practice · schedule unchanged"
                      : "Scheduled review"}
                    {event.undone ? " · undone" : ""}
                    {card ? " · " + card.topic : ""}
                  </small>
                </span>
                <span className={"rating-chip " + event.rating}>
                  {event.rating}
                </span>
                <time dateTime={event.at}>{timeOf(event.at)}</time>
              </button>
            );
          })}
        </section>
      ))}
    </>
  );
}
