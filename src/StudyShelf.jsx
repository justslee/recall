import React, { useId, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { inDeck, isDue } from "./model";

export function StudyShelf({
  data,
  topics = [],
  onDeck,
  onNewDeck,
  compact = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const shelfId = useId();
  const decks = data.decks
    .map((name) => {
      const cards = data.cards.filter(
        (c) => inDeck(c, name) && (!topics.length || topics.includes(c.topic)),
      );
      const domains = [...new Set(cards.map((c) => c.topic))];
      return {
        name,
        cards,
        domain: !domains.length
          ? "Your collection"
          : domains.length === 1
            ? domains[0]
            : `${domains.length} topics`,
      };
    })
    .filter((d) => d.cards.length || !topics.length);
  return (
    <section className="study-shelf" aria-label="Your collections">
      <div className="section-heading">
        <h2>Your study shelf</h2>
        <div className="shelf-actions">
          {compact && decks.length > 4 && (
            <button
              className="text-button"
              aria-expanded={expanded}
              aria-controls={shelfId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show fewer collections" : "View all collections"}
              <span aria-hidden="true"> · {decks.length}</span>
            </button>
          )}
          {onNewDeck && (
            <button className="text-button" onClick={onNewDeck}>
              <Plus size={15} /> New collection
            </button>
          )}
        </div>
      </div>
      <div className="shelf-books" id={shelfId}>
        {(compact && !expanded ? decks.slice(0, 4) : decks).map((d, i) => (
          <button
            className={`shelf-book cover-${i % 3}`}
            key={d.name}
            onClick={() => onDeck(d.name)}
            aria-label={`Open collection ${d.name}`}
          >
            <span className="book-cover">
              <small>{d.domain}</small>
              <strong>{d.name.replaceAll("::", " / ")}</strong>
              <span className={`book-art art-${i % 3}`} aria-hidden="true">
                {i % 3 === 2 ? "∑" : ""}
              </span>
              <span className="book-folio">
                RECALL / {String(i + 1).padStart(2, "0")}
              </span>
            </span>
            <span className="book-caption">
              <span>
                {d.cards.length} cards ·{" "}
                {d.cards.filter((c) => isDue(c)).length} due
              </span>
              <ArrowUpRight size={14} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
