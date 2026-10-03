import React, { useEffect, useState } from "react";
import { ArrowUpRight, BookOpen, CalendarDays, Flame } from "lucide-react";
import { plain, formatLabel } from "./model";
import { iconFor } from "./ui";
import "./progress.css";

const dateLabel = (day) =>
  new Date(day + "T12:00:00Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
export function ProgressView({ onStudy, onHistory, onOpen, onTopic }) {
  const [days, setDays] = useState(28),
    [data, setData] = useState(null),
    [error, setError] = useState(null),
    [selected, setSelected] = useState(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setSelected(null);
    const load = () =>
      window.recall
        .progress({ days })
        .then((next) => {
          if (live) {
            setData(next);
            setError(null);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [days]);
  const chosen = data?.daily.find((d) => d.day === selected);
  const max = Math.max(1, ...(data?.daily.map((d) => d.reviews) || []));
  return (
    <div className="progress-page">
      <div className="progress-intro">
        <div>
          <span className="eyebrow">YOUR LEARNING JOURNAL</span>
          <h2>Small sessions. Lasting progress.</h2>
          <p>See what you’ve practiced, and what deserves another look.</p>
        </div>
        <label className="progress-range">
          Show
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
      {error && <p role="alert">Couldn’t load progress: {error}</p>}
      {!data ? (
        <p role="status">Loading your learning journal…</p>
      ) : (
        <>
          <div className="progress-stats">
            <Metric
              label="Reviews"
              value={data.reviews}
              note={`${data.uniqueCards} different cards`}
            />
            <Metric
              label="Recalled"
              value={data.recallRate === null ? "—" : `${data.recallRate}%`}
              note={
                data.reviews
                  ? `${data.recalled} of ${data.reviews} ratings`
                  : "Your first rating starts the picture"
              }
            />
            <Metric
              label="Study days"
              value={data.activeDays}
              note={`out of the last ${data.days} days`}
            />
            <Metric
              label="Due now"
              value={data.due}
              note="Previously studied cards"
            />
          </div>
          <div className="progress-columns">
            <section className="progress-panel progress-calendar">
              <div className="progress-panel-heading">
                <div>
                  <span className="eyebrow">SHOWING UP</span>
                  <h3>Your study rhythm</h3>
                </div>
                <span className="progress-streak">
                  <Flame size={16} /> {data.streak} day streak
                </span>
              </div>
              <div className="rhythm-axis">
                <span>Reviews per day</span>
                <span>0–{max}</span>
              </div>
              <div
                className={"rhythm-bars " + (days > 28 ? "dense" : "")}
                role="group"
                aria-label="Daily review activity"
                style={{ "--days": days }}
              >
                {data.daily.map((day, index) => (
                  <button
                    key={day.day}
                    className="progress-day rhythm-day"
                    aria-label={`${dateLabel(day.day)}: ${day.reviews} reviews`}
                    aria-pressed={selected === day.day}
                    title={`${dateLabel(day.day)} · ${day.reviews} reviews`}
                    onClick={() => setSelected(day.day)}
                  >
                    <span className="rhythm-column">
                      {["Good", "Easy", "Hard", "Again"].map((r) => (
                        <i
                          key={r}
                          className={r.toLowerCase()}
                          style={{
                            height: `${((day.ratings?.[r] || 0) / max) * 132}px`,
                          }}
                        />
                      ))}
                    </span>
                    <small>
                      {days === 7
                        ? dateLabel(day.day)
                        : index % (days === 28 ? 7 : 30) === 0
                          ? dateLabel(day.day)
                          : ""}
                    </small>
                  </button>
                ))}
              </div>
              <div className="rhythm-legend">
                <span>
                  <i />
                  Good / Easy
                </span>
                <span className="hard">
                  <i />
                  Hard
                </span>
                <span className="again">
                  <i />
                  Again
                </span>
              </div>
              <div className="progress-calendar-caption">
                <span>
                  {dateLabel(data.start)} — {dateLabel(data.today)}
                </span>
              </div>
              <p className="progress-day-detail" aria-live="polite">
                {chosen
                  ? `${dateLabel(chosen.day)} · ${chosen.reviews} reviews · ${chosen.recalled} recalled`
                  : "Choose a day to inspect its review activity."}
              </p>
              {chosen && (
                <button
                  className="text-button"
                  onClick={() => onHistory(chosen.day)}
                >
                  Open this day’s history <ArrowUpRight size={14} />
                </button>
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
            <section className="progress-panel">
              <div className="progress-panel-heading">
                <div>
                  <span className="eyebrow">HOW IT FELT</span>
                  <h3>Your recall results</h3>
                </div>
              </div>
              <div className="progress-outcomes">
                {Object.entries(data.ratings).map(([rating, count]) => (
                  <div className="progress-outcome" key={rating}>
                    <span>{rating}</span>
                    <div
                      className={`progress-meter outcome-${rating.toLowerCase()}`}
                    >
                      <i
                        style={{
                          width: `${data.reviews ? (count / data.reviews) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
              <p className="progress-note">
                Recalled means Hard, Good or Easy. Hard still deserves practice.
                These are your own ratings, not an estimate of permanent
                mastery.
              </p>
              <button className="text-button" onClick={() => onHistory()}>
                See review history <ArrowUpRight size={14} />
              </button>
            </section>
          </div>
          <section className="progress-panel">
            <div className="progress-panel-heading">
              <div>
                <span className="eyebrow">PRACTICE IN DIFFERENT FORMS</span>
                <h3>Concepts, math & code</h3>
              </div>
              <span className="progress-muted">Reviews in this period</span>
            </div>
            <div className="progress-formats">
              {data.formats.map((f) => {
                const Icon = iconFor[f.kind] || BookOpen;
                return (
                  <div key={f.kind}>
                    <Icon size={19} />
                    <span>
                      <strong>{formatLabel[f.kind] || "Other"}</strong>
                      <small>
                        {f.reviews} reviews ·{" "}
                        {f.reviews
                          ? Math.round((f.recalled / f.reviews) * 100) +
                            "% recalled"
                          : "No ratings yet"}
                      </small>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
          <div className="progress-columns">
            <section className="progress-panel">
              <div className="progress-panel-heading">
                <div>
                  <span className="eyebrow">YOUR NEXT PAGE</span>
                  <h3>
                    Worth another look{" "}
                    <small>{data.needsPractice.length}</small>
                  </h3>
                </div>
              </div>
              <p className="progress-note">
                Available cards whose latest scored review was Again or Hard,
                across all dates.
              </p>
              {data.needsPractice.length ? (
                <div className="progress-revisit">
                  {data.needsPractice.slice(0, 6).map((c) => (
                    <button key={c.id} onClick={() => onOpen(c.id)}>
                      <span>
                        <strong>{plain(c.title)}</strong>
                        <small>
                          {c.topic} · {c.rating}
                          {c.due ? " · Due now" : ""}
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
              <div className="progress-panel-heading">
                <div>
                  <span className="eyebrow">SUBJECT NOTES</span>
                  <h3>Across your topics</h3>
                </div>
              </div>
              <p className="progress-note">
                Review counts use this period; needs practice reflects the
                latest result across all dates.
              </p>
              {data.topics.length ? (
                <div className="progress-topics">
                  {data.topics.map((t) => (
                    <button key={t.topic} onClick={() => onTopic(t.topic)}>
                      <span>
                        <strong>{t.topic}</strong>
                        <small>
                          {t.reviews} reviews · {t.needsPractice} need practice
                          · {t.due} due
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
function Metric({ label, value, note }) {
  return (
    <div className="progress-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
