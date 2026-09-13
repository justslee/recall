import React from "react";
import { Search, Upload, Library, SearchX } from "lucide-react";
import { CardRow, EmptyState, Kbd } from "./ui";

export function LibraryView({
  visible,
  matching,
  search,
  setSearch,
  searchRef,
  busy,
  now,
  onImport,
  onBrowse,
  onNewCard,
}) {
  return (
    <>
      <div className="library-toolbar">
        <div className="search">
          <Search size={16} />
          <input
            ref={searchRef}
            aria-label="Search cards"
            placeholder="Search questions, topics or tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button
              className="text-button"
              style={{ marginRight: 8 }}
              onClick={() => setSearch("")}
            >
              Clear
            </button>
          ) : (
            <Kbd>⌘F</Kbd>
          )}
        </div>
        <span className="result-count">
          {visible.length === matching.length
            ? `${matching.length} ${matching.length === 1 ? "card" : "cards"}`
            : `${visible.length} of ${matching.length}`}
        </span>
        <button onClick={onImport} disabled={busy}>
          <Upload size={16} /> Import Anki
        </button>
      </div>
      <div className="card-list">
        {visible.map((c) => (
          <CardRow key={c.id} card={c} now={now} onClick={() => onBrowse(c)} />
        ))}
      </div>
      {!matching.length && (
        <EmptyState icon={Library} title="No cards match these filters.">
          Widen the deck, clear a topic, or switch the format to Mixed. New
          cards you author appear here immediately.
        </EmptyState>
      )}
      {matching.length > 0 && !visible.length && (
        <EmptyState
          icon={SearchX}
          title={`Nothing found for “${search}”.`}
          actions={
            <>
              <button onClick={() => setSearch("")}>Clear search</button>
              <button className="primary" onClick={onNewCard}>
                Create a card
              </button>
            </>
          }
        >
          Search looks at question text, topics and tags within the current deck
          and filters.
        </EmptyState>
      )}
    </>
  );
}
