import React from "react";
import { ArrowUpRight, Bookmark, Code2, Search } from "lucide-react";
import {
  catalogInfo,
  catalogDefaults,
  filterCatalog,
  challengeProgress,
} from "./catalog-model";
import { isDue } from "./model";

export function CatalogView({
  data,
  filters,
  setFilters,
  onBrowse,
  onStart,
  onState,
  fail,
}) {
  const info = catalogInfo(data.cards);
  const cards = data.cards.filter((c) => c.catalog?.id === info?.id),
    states = data.challengeStates || {},
    attempts = data.challengeAttemptCounts || {};
  const visible = filterCatalog(cards, filters, states, attempts);
  const patch = (p) => setFilters({ ...filters, ...p });
  const uniques = (key) =>
    [...new Set(cards.flatMap((c) => key(c.catalog)))].sort();
  const stages = [
    ...new Map(
      cards
        .filter((c) => c.catalog.curriculum.inQuantDev50)
        .map((c) => [
          c.catalog.curriculum.stageNumber,
          c.catalog.curriculum.stageName,
        ]),
    ).entries(),
  ].sort(([a], [b]) => a - b);
  const options = (title, key, values) => (
    <label>
      {title}
      <select
        aria-label={title}
        value={filters[key]}
        onChange={(e) => patch({ [key]: e.target.value })}
      >
        <option value="all">All</option>
        {values.map((v) => {
          const [value, label] = Array.isArray(v) ? v : [v, v];
          return (
            <option value={value} key={value}>
              {label}
            </option>
          );
        })}
      </select>
    </label>
  );
  const completed = cards.filter((c) => states[c.id]?.completed).length;
  const path = cards.filter((c) => c.catalog.curriculum.inQuantDev50),
    pathComplete = path.filter((c) => states[c.id]?.completed).length;
  const due = visible.filter((c) => isDue(c));
  const reviewable = visible.filter(
    (c) =>
      !c.suspended &&
      c.status === "ready" &&
      (c.schedule.state === 0 || new Date(c.schedule.due) <= new Date()),
  );
  return (
    <section className="challenge-catalog">
      <div className="catalog-intro">
        <div>
          <span className="eyebrow">A deliberate coding practice</span>
          <h2>Build the skill. Explain the reasoning.</h2>
          <p>
            Work through the recommended path, or choose a challenge for the
            skill you want to sharpen. Your work stays on this Mac.
          </p>
        </div>
        <div className="catalog-progress">
          <strong>
            {completed}
            <small> / {cards.length}</small>
          </strong>
          <span>completed</span>
          <progress
            value={completed}
            max={cards.length || 1}
            aria-label="Challenges completed"
          />
        </div>
      </div>
      <div
        className="catalog-tabs"
        role="tablist"
        aria-label="Challenge collection"
      >
        <button
          role="tab"
          aria-selected={filters.tab === "path"}
          onClick={() => patch({ tab: "path", stage: "all" })}
        >
          {info?.pathLabel}{" "}
          <small>
            {pathComplete}/{path.length}
          </small>
        </button>
        <button
          role="tab"
          aria-selected={filters.tab === "all"}
          onClick={() => patch({ tab: "all", stage: "all" })}
        >
          All challenges <small>{cards.length}</small>
        </button>
      </div>
      <div className="catalog-search">
        <label>
          <Search size={17} />
          <input
            aria-label="Search challenges"
            type="search"
            placeholder="Search a skill, title or tag…"
            value={filters.query}
            onChange={(e) => patch({ query: e.target.value })}
          />
        </label>
        <label className="catalog-sort">
          Sort
          <select
            aria-label="Sort challenges"
            value={filters.sort}
            onChange={(e) => patch({ sort: e.target.value })}
          >
            <option value="rank">Curriculum order</option>
            <option value="category">Category</option>
            <option value="difficulty">Difficulty</option>
            <option value="title">Title</option>
            <option value="confidence">Reconstruction confidence</option>
          </select>
        </label>
      </div>
      <details className="catalog-filters">
        <summary>
          Refine your practice{" "}
          <small>
            {
              Object.entries(filters).filter(
                ([k, v]) =>
                  !["tab", "sort", "query"].includes(k) && v !== "all",
              ).length
            }{" "}
            filters
          </small>
        </summary>
        <div className="catalog-filter-grid">
          {options(
            "Category",
            "category",
            uniques((m) => m.category),
          )}
          {options("Language", "language", [
            ["python", "Python"],
            ["cpp", "C++17"],
          ])}
          {options("Difficulty", "difficulty", ["easy", "medium", "hard"])}
          {options("Source", "provider", [
            info?.provider || "Local collection",
          ])}
          {options("Source access", "access", [
            ["free", "Free · public restatement"],
            ["premium", "Premium · reconstruction"],
          ])}
          {options(
            "Firm",
            "firm",
            uniques((m) => m.firmTags),
          )}
          {options(
            "Curriculum stage",
            "stage",
            stages.map(([n, s]) => [String(n), n + ". " + s]),
          )}
          {options("Confidence", "confidence", ["High", "Medium", "Low"])}
          {options("Progress", "progress", [
            ["not-started", "Not started"],
            ["in-progress", "In progress"],
            ["completed", "Completed"],
            ["bookmarked", "Bookmarked"],
          ])}
        </div>
        <button
          className="text-button"
          onClick={() => setFilters({ ...catalogDefaults, tab: filters.tab })}
        >
          Clear filters
        </button>
      </details>
      <div className="catalog-results-bar">
        <span aria-live="polite">
          {visible.length} challenges · {due.length} due
        </span>
        <div>
          <button
            disabled={!reviewable.length}
            onClick={() => onStart(reviewable, false)}
          >
            Study due & new
          </button>
          <button
            className="primary"
            disabled={
              !visible.some((c) => !c.suspended && c.status === "ready")
            }
            onClick={() => onStart(visible, true)}
          >
            Practice in this order
          </button>
        </div>
      </div>
      <p className="catalog-caption">
        {filters.tab === "path"
          ? "The recommended path follows this collection’s stages and ordering. "
          : "The full catalog includes all saved challenges. "}
        Practice leaves review dates unchanged; Study due & new prioritizes due
        cards and updates your recall schedule.
      </p>
      <div className="challenge-list">
        {visible.map((c) => {
          const m = c.catalog,
            s = states[c.id] || {},
            p = challengeProgress(c, states, attempts);
          return (
            <article className="challenge-row" key={c.id} data-slug={m.slug}>
              <button
                className="challenge-open"
                onClick={() =>
                  onBrowse(
                    c,
                    visible.map((x) => x.id),
                  )
                }
              >
                <span className="challenge-rank">
                  {m.curriculum.rank ? (
                    String(m.curriculum.rank).padStart(2, "0")
                  ) : (
                    <Code2 size={19} />
                  )}
                </span>
                <span className="challenge-name">
                  <strong>{c.title}</strong>
                  <small>
                    {m.category} · {m.language === "cpp" ? "C++17" : "Python"}
                    {m.curriculum.inQuantDev50
                      ? " · Stage " + m.curriculum.stageNumber
                      : ""}
                  </small>
                </span>
                <span className="challenge-row-meta">
                  <span className="badge">{m.sourceDifficulty}</span>
                  <small>
                    {m.accessLevel === "free"
                      ? "Public restatement"
                      : m.reconstruction.confidenceLabel +
                        " confidence · reconstructed"}
                  </small>
                  <small>
                    {p === "completed"
                      ? "Completed"
                      : p === "in-progress"
                        ? "In progress"
                        : "Not started"}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
              <button
                className={
                  "challenge-bookmark " + (s.bookmarked ? "active" : "")
                }
                aria-label={"Bookmark " + c.title}
                aria-pressed={!!s.bookmarked}
                onClick={() =>
                  onState(c.id, { bookmarked: !s.bookmarked }).catch(fail)
                }
              >
                <Bookmark
                  size={17}
                  fill={s.bookmarked ? "currentColor" : "none"}
                />
              </button>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="catalog-empty">
          <h3>No challenges match these filters.</h3>
          <button
            onClick={() => setFilters({ ...catalogDefaults, tab: "all" })}
          >
            Show all challenges
          </button>
        </div>
      )}
      <p className="catalog-caption">
        Source: {info?.provider}. Your work and saved challenges stay on this
        Mac.
      </p>
    </section>
  );
}
