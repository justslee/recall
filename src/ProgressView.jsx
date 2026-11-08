import React, { useEffect, useId, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCheck,
  Flame,
  History,
  Layers,
  TrendingUp,
} from "lucide-react";
import { plain, formatLabel } from "./model";
import { iconFor } from "./ui";
import "./progress.css";

const RATINGS = ["Again", "Hard", "Good", "Easy"];
const count = (value) => value.toLocaleString();
const dateLabel = (day) =>
  new Date(day + "T12:00:00Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function ProgressView({ onStudy, onHistory, onOpen, onTopic }) {
  const [days, setDays] = useState(28);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [breakdown, setBreakdown] = useState("ratings");
  useEffect(() => {
    let live = true;
    let request = 0;
    setData(null);
    setError(null);
    setSelected(null);
    const load = async () => {
      const current = ++request;
      try {
        const next = await window.recall.progress({ days });
        if (live && request === current) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (live && request === current) setError(e.message);
      }
    };
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [days]);

  const chosen = data?.daily.find((day) => day.day === selected);
  const topicMax =
    data?.topics.reduce((max, topic) => Math.max(max, topic.reviews), 1) ?? 1;
  return (
    <div className="progress-page">
      <header className="progress-intro">
        <div>
          <span className="eyebrow">YOUR LEARNING, OVER TIME</span>
          <h2>Review journal</h2>
          <p>Small sessions. A clearer picture of what stays with you.</p>
        </div>
        <div className="journal-actions">
          <button onClick={() => onHistory()}>
            <History size={15} /> Review history
          </button>
          <label className="progress-range">
            Time period
            <select
              aria-label="Progress period"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={28}>Last 28 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        </div>
      </header>
      {error && (
        <p className="journal-error" role="alert">
          Couldn’t refresh progress: {error}
          {data && " Showing the last successful update."}
        </p>
      )}
      {!data ? (
        !error && <p role="status">Loading your learning journal…</p>
      ) : (
        <>
          <div className="journal-period">
            <span>
              {dateLabel(data.start)} — {dateLabel(data.today)}{" "}
              <span className="journal-zone">· {data.timeZone}</span>
            </span>
            <span className="progress-streak">
              <Flame size={15} /> {data.streak} day streak
            </span>
          </div>
          <div className="progress-stats">
            <Metric
              label="Reviews"
              value={count(data.reviews)}
              note={`${count(data.uniqueCards)} different cards`}
              icon={Layers}
              tone="blue"
            />
            <Metric
              label="Recalled"
              value={data.recallRate === null ? "—" : `${data.recallRate}%`}
              note={
                data.reviews
                  ? `${count(data.recalled)} of ${count(data.reviews)} ratings`
                  : "Your first rating starts the picture"
              }
              icon={CheckCheck}
              tone="mint"
            />
            <Metric
              label="Study days"
              value={data.activeDays}
              note={`out of the last ${data.days} days`}
              icon={CalendarDays}
              tone="lavender"
            />
            <Metric
              label="Due now"
              value={count(data.due)}
              note="Previously studied cards · all dates"
              icon={BookOpen}
              tone="peach"
            />
          </div>

          <div className="progress-columns journal-overview">
            <section className="progress-panel journal-activity">
              <PanelHeading
                eyebrow="THE EVERYDAY WORK"
                title="Your study rhythm"
              />
              <div className="journal-chart-toolbar">
                <span className="progress-muted">Reviews per day</span>
                <div
                  className="journal-segmented"
                  role="group"
                  aria-label="Activity breakdown"
                >
                  <button
                    aria-pressed={breakdown === "ratings"}
                    onClick={() => setBreakdown("ratings")}
                  >
                    Ratings
                  </button>
                  <button
                    aria-pressed={breakdown === "visits"}
                    onClick={() => setBreakdown("visits")}
                  >
                    First & repeat
                  </button>
                </div>
              </div>
              <ActivityChart
                daily={data.daily}
                selected={selected}
                onSelect={setSelected}
                breakdown={breakdown}
              />
              <div className="journal-legend">
                {(breakdown === "ratings"
                  ? RATINGS.map((rating) => [rating.toLowerCase(), rating])
                  : [
                      ["first", "First review"],
                      ["repeat", "Repeat review"],
                    ]
                ).map(([tone, label]) => (
                  <span key={tone}>
                    <i className={`journal-swatch tone-${tone}`} />
                    {label}
                  </span>
                ))}
              </div>
              <div className="journal-day-inspector">
                <p className="progress-day-detail" aria-live="polite">
                  {chosen
                    ? `${dateLabel(chosen.day)} · ${count(chosen.reviews)} reviews · ${count(chosen.recalled)} recalled`
                    : "Choose a day to explore its reviews."}
                </p>
                {chosen && (
                  <span className="progress-muted">
                    {chosen.firstReviews} first · {chosen.repeatReviews} repeat
                  </span>
                )}
                {chosen && (
                  <button
                    className="text-button"
                    onClick={() => onHistory(chosen.day)}
                  >
                    Open this day’s history <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
              {breakdown === "visits" && (
                <p className="progress-note">
                  First means a card’s first recorded scored review. Repeat
                  includes later reviews, even on the same day.
                </p>
              )}
              {!data.reviews && (
                <div className="progress-empty">
                  <BookOpen size={20} />
                  <p>
                    No scored reviews in this period. A short self-test is a
                    good place to begin.
                  </p>
                  <button onClick={onStudy}>
                    Go to study desk <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
            </section>
            <section className="progress-panel journal-results">
              <PanelHeading eyebrow="HOW IT FELT" title="Your recall results" />
              <OutcomeRing data={data} />
              <div className="progress-outcomes">
                {RATINGS.map((rating) => (
                  <div className="progress-outcome" key={rating}>
                    <span>
                      <i
                        className={`journal-swatch tone-${rating.toLowerCase()}`}
                      />
                      {rating}
                    </span>
                    <span className="journal-outcome-percent">
                      {data.reviews
                        ? Math.round(
                            (100 * data.ratings[rating]) / data.reviews,
                          )
                        : 0}
                      %
                    </span>
                    <strong>{count(data.ratings[rating])}</strong>
                  </div>
                ))}
              </div>
              <p className="progress-note">
                Recalled means Hard, Good or Easy. Hard still deserves practice.
                Self-ratings describe these reviews, not permanent mastery.
              </p>
            </section>
          </div>

          <div className="progress-columns">
            <section className="progress-panel journal-trend-panel">
              <PanelHeading
                eyebrow="THE LONGER VIEW"
                title="Recall over time"
                icon={TrendingUp}
              />
              <RecallTrend
                daily={data.daily}
                selected={selected}
                onSelect={setSelected}
              />
              <p className="progress-note">
                Each point includes that day and the six preceding calendar
                days, weighted by review count. Blank stretches mean no reviews;
                changing cards and sample sizes can move the line.
              </p>
            </section>
            <section className="progress-panel journal-forecast">
              <PanelHeading
                eyebrow="A LITTLE LOOK AHEAD"
                title="Coming up for review"
              />
              <Forecast data={data.forecast} />
              <p className="progress-note">
                Current schedules, including overdue cards separately. New cards
                and future rescheduling are not predicted. This view always
                starts today.
              </p>
            </section>
          </div>

          <section className="progress-panel">
            <PanelHeading
              eyebrow="DIFFERENT WAYS TO PRACTICE"
              title="Concepts, math & code"
              aside="Reviews in this period"
            />
            <div className="progress-formats">
              {data.formats.map((format) => {
                const Icon = iconFor[format.kind] || BookOpen;
                return (
                  <div
                    className={`journal-format format-${format.kind}`}
                    key={format.kind}
                  >
                    <div className="journal-format-heading">
                      <Icon size={19} />
                      <strong>{formatLabel[format.kind] || "Other"}</strong>
                      <b>{count(format.reviews)}</b>
                    </div>
                    <div className="journal-format-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${data.reviews ? (100 * format.reviews) / data.reviews : 0}%`,
                        }}
                      />
                    </div>
                    <small>
                      {count(format.reviews)} reviews ·{" "}
                      {format.reviews
                        ? Math.round((100 * format.recalled) / format.reviews) +
                          "% recalled"
                        : "No ratings yet"}
                    </small>
                  </div>
                );
              })}
            </div>
            <p className="progress-note">
              Bar lengths show each format’s share of reviews, not proficiency.
            </p>
          </section>

          <div className="progress-columns">
            <section className="progress-panel">
              <PanelHeading
                eyebrow="YOUR NEXT SESSION"
                title="Worth another look"
                aside={`${data.needsPractice.length} cards`}
              />
              <p className="progress-note">
                Available cards whose latest scored review was Again or Hard,
                across all dates.
              </p>
              {data.needsPractice.length ? (
                <div className="progress-revisit">
                  {data.needsPractice.slice(0, 6).map((card) => (
                    <button key={card.id} onClick={() => onOpen(card.id)}>
                      <span>
                        <strong>{plain(card.title)}</strong>
                        <small>
                          {card.topic} · {card.rating}
                          {card.due ? " · Due now" : ""}
                        </small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                  {data.needsPractice.length > 6 && (
                    <p className="progress-note">
                      Showing 6 of {data.needsPractice.length}. Due cards appear
                      first.
                    </p>
                  )}
                </div>
              ) : (
                <p className="progress-empty-text">
                  {data.library.reviewed
                    ? "No available cards currently have an Again or Hard rating as their latest result."
                    : "After your first reviews, difficult cards will appear here."}
                </p>
              )}
              <button className="primary" onClick={onStudy}>
                Continue studying <ArrowUpRight size={14} />
              </button>
            </section>
            <section className="progress-panel">
              <PanelHeading
                eyebrow="WHERE YOUR ATTENTION GOES"
                title="Across your topics"
              />
              <p className="progress-note">
                Bars compare review counts in this period. Practice and due
                counts reflect current cards.
              </p>
              {data.topics.length ? (
                <div className="progress-topics">
                  {[...data.topics]
                    .sort(
                      (a, b) =>
                        b.reviews - a.reviews || a.topic.localeCompare(b.topic),
                    )
                    .map((topic) => (
                      <button
                        key={topic.topic}
                        onClick={() => onTopic(topic.topic)}
                      >
                        <span className="journal-topic-body">
                          <strong>
                            {topic.topic}
                            <b>{count(topic.reviews)}</b>
                          </strong>
                          <span
                            className="journal-topic-track"
                            aria-hidden="true"
                          >
                            <i
                              style={{
                                width: `${(100 * topic.reviews) / topicMax}%`,
                              }}
                            />
                          </span>
                          <small>
                            {count(topic.reviews)} reviews ·{" "}
                            {topic.needsPractice} need practice · {topic.due}{" "}
                            due
                          </small>
                        </span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                </div>
              ) : (
                <p className="progress-empty-text">
                  Your topics will appear as you begin reviewing.
                </p>
              )}
            </section>
          </div>
          <footer className="progress-method">
            <CalendarDays size={15} />
            <p>
              Dates follow {data.timeZone}. Skips, undone ratings and practice
              runs are excluded above. {data.practice} practice ratings in this
              period. Your streak continues from yesterday until you study
              today. Opening this page or a card does not record a review.
            </p>
          </footer>
        </>
      )}
    </div>
  );
}

function PanelHeading({ eyebrow, title, aside, icon: Icon }) {
  return (
    <div className="progress-panel-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
      </div>
      {aside && <span className="progress-muted">{aside}</span>}
      {Icon && <Icon className="journal-heading-icon" size={20} />}
    </div>
  );
}
function Metric({ label, value, note, icon: Icon, tone }) {
  return (
    <div className={`progress-stat metric-${tone}`}>
      <span>
        <i>
          <Icon size={16} />
        </i>
        {label}
      </span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function ActivityChart({ daily, selected, onSelect, breakdown }) {
  const max = Math.max(1, ...daily.map((day) => day.reviews));
  const keyboard = (event, index) => {
    const offset = {
      ArrowRight: 1,
      ArrowLeft: -1,
      Home: -index,
      End: daily.length - 1 - index,
    }[event.key];
    if (offset === undefined) return;

    event.preventDefault();
    const next = Math.max(0, Math.min(daily.length - 1, index + offset));
    event.currentTarget.parentElement.children[next].focus();
    onSelect(daily[next].day);
  };
  return (
    <div className="journal-activity-chart">
      <div className="journal-y-axis" aria-hidden="true">
        <span>{count(max)}</span>
        <span>{max > 1 ? count(Math.round(max / 2)) : ""}</span>
        <span>0</span>
      </div>
      <div className="journal-plot-grid" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div
        className="journal-bars"
        role="group"
        aria-label="Daily review activity"
        style={{ "--days": daily.length }}
      >
        {daily.map((day, index) => {
          const parts =
            breakdown === "ratings"
              ? RATINGS.map((rating) => [
                  rating.toLowerCase(),
                  day.ratings[rating],
                ])
              : [
                  ["first", day.firstReviews],
                  ["repeat", day.repeatReviews],
                ];
          const description = `${dateLabel(day.day)}: ${count(day.reviews)} reviews; ${parts.map(([name, n]) => `${n} ${name}`).join(", ")}`;
          return (
            <button
              key={day.day}
              className="progress-day"
              aria-label={description}
              aria-pressed={selected === day.day}
              tabIndex={(selected || daily.at(-1).day) === day.day ? 0 : -1}
              title={description}
              onClick={() => onSelect(day.day)}
              onKeyDown={(event) => keyboard(event, index)}
            >
              <span
                className="journal-bar-stack"
                style={{ height: `${(100 * day.reviews) / max}%` }}
              >
                {parts.map(([tone, n]) => (
                  <i
                    key={tone}
                    className={`tone-${tone}`}
                    style={{
                      height: `${day.reviews ? (100 * n) / day.reviews : 0}%`,
                    }}
                  />
                ))}
              </span>
              {!day.reviews && <span className="journal-zero" />}
            </button>
          );
        })}
      </div>
      <div className="journal-x-axis" aria-hidden="true">
        <span>{dateLabel(daily[0].day)}</span>
        <span>{dateLabel(daily[Math.floor((daily.length - 1) / 2)].day)}</span>
        <span>{dateLabel(daily.at(-1).day)}</span>
      </div>
    </div>
  );
}
function OutcomeRing({ data }) {
  let offset = 0;
  return (
    <figure
      className="journal-ring"
      aria-label={`Recall results: ${data.recalled} of ${data.reviews} reviews recalled`}
    >
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle className="journal-ring-track" cx="80" cy="80" r="64" />
        {RATINGS.map((rating) => {
          const share = data.reviews
            ? (100 * data.ratings[rating]) / data.reviews
            : 0;
          const start = offset;
          offset += share;
          return share ? (
            <circle
              key={rating}
              className={`ring-${rating.toLowerCase()}`}
              cx="80"
              cy="80"
              r="64"
              pathLength="100"
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-start}
              transform="rotate(-90 80 80)"
            />
          ) : null;
        })}
      </svg>
      <figcaption>
        <strong>
          {data.recallRate === null ? "—" : `${data.recallRate}%`}
        </strong>
        <span>recalled</span>
      </figcaption>
    </figure>
  );
}
function RecallTrend({ daily, selected, onSelect }) {
  const id = useId();
  const index = Math.max(
    0,
    selected
      ? daily.findIndex((day) => day.day === selected)
      : daily.length - 1,
  );
  const day = daily[index];
  const x = (i) => 34 + i * (546 / Math.max(1, daily.length - 1));
  const y = (value) => 146 - value * 1.3;
  const groups = [];
  for (let i = 0; i < daily.length; i++) {
    if (daily[i].rollingRecallRate === null) continue;

    if (!i || daily[i - 1].rollingRecallRate === null) groups.push([]);
    groups.at(-1).push([x(i), y(daily[i].rollingRecallRate)]);
  }
  return (
    <figure className="journal-trend" aria-label="Seven-day recall trend">
      <svg
        viewBox="0 0 600 164"
        role="img"
        aria-label="Trailing seven-day recalled percentage, from zero to 100 percent. Use the slider below for daily values."
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--journal-blue)"
              stopOpacity=".24"
            />
            <stop
              offset="100%"
              stopColor="var(--journal-blue)"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((value) => (
          <g key={value}>
            <line
              x1="34"
              x2="580"
              y1={y(value)}
              y2={y(value)}
              className="journal-grid-line"
            />
            <text
              x="26"
              y={y(value) + 4}
              textAnchor="end"
              className="journal-axis-label"
            >
              {value}
            </text>
          </g>
        ))}
        {groups.map((points, i) => (
          <g key={i}>
            <path
              d={`M${points.map((p) => p.join(",")).join(" L")} L${points.at(-1)[0]},146 L${points[0][0]},146 Z`}
              fill={`url(#${id})`}
            />
            <polyline
              points={points.map((p) => p.join(",")).join(" ")}
              className="journal-trend-line"
            />
            {points.length === 1 && (
              <circle
                cx={points[0][0]}
                cy={points[0][1]}
                r="3"
                className="journal-trend-dot"
              />
            )}
          </g>
        ))}
        <line
          x1={x(index)}
          x2={x(index)}
          y1="12"
          y2="146"
          className="journal-cursor"
        />
        {day.rollingRecallRate !== null && (
          <circle
            cx={x(index)}
            cy={y(day.rollingRecallRate)}
            r="5"
            className="journal-trend-dot"
          />
        )}
      </svg>
      <div className="journal-trend-dates" aria-hidden="true">
        <span>{dateLabel(daily[0].day)}</span>
        <span>{dateLabel(daily.at(-1).day)}</span>
      </div>
      <input
        type="range"
        aria-label="Inspect recall trend"
        aria-valuetext={`${dateLabel(day.day)}: ${day.rollingRecallRate === null ? "no reviews in trailing seven days" : `${day.rollingRecallRate}% recalled from ${day.rollingReviews} reviews in trailing seven days`}`}
        min="0"
        max={daily.length - 1}
        value={index}
        onChange={(event) => onSelect(daily[Number(event.target.value)].day)}
      />
      <figcaption className="trend-detail" aria-live="polite">
        <strong>
          {day.rollingRecallRate === null
            ? "No reviews"
            : `${day.rollingRecallRate}% recalled`}
        </strong>
        <span>
          {dateLabel(day.day)} · {count(day.rollingReviews)} reviews in trailing
          7 days
        </span>
      </figcaption>
    </figure>
  );
}
function Forecast({ data }) {
  const max = Math.max(1, ...data.days.map((day) => day.due));
  return (
    <figure
      className="journal-forecast-chart"
      aria-label="Scheduled reviews for the next seven days"
    >
      <div className="forecast-overdue">
        <span>Overdue before today</span>
        <strong>{count(data.overdue)}</strong>
      </div>
      <div className="journal-forecast-bars">
        {data.days.map((day, index) => (
          <div
            className="forecast-day"
            role="group"
            key={day.day}
            aria-label={`${index === 0 ? "Today" : dateLabel(day.day)}: ${count(day.due)} scheduled reviews`}
          >
            <strong>{count(day.due)}</strong>
            <span className="forecast-column">
              <i style={{ height: `${(100 * day.due) / max}%` }} />
            </span>
            <small>{index === 0 ? "Today" : dateLabel(day.day)}</small>
          </div>
        ))}
      </div>
      <figcaption>
        {count(data.days.reduce((sum, day) => sum + day.due, 0))} scheduled
        today through {dateLabel(data.days.at(-1).day)}
      </figcaption>
    </figure>
  );
}
