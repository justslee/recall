import { catalogInfo, displayCatalog } from "./catalog-model";
import React, { useState } from "react";
import { Bookmark, Check, ExternalLink } from "lucide-react";

export function ChallengeContext({ card, fail }) {
  const m = displayCatalog(card).catalog,
    r = m.reconstruction;
  return (
    <div className="challenge-context">
      <div className="challenge-labels">
        <span className="badge">
          {m.accessLevel === "premium"
            ? "Independent premium reconstruction"
            : m.accessLevel === "original"
              ? "Original exercise"
              : "Public problem restatement"}
        </span>
        <span className="badge">{m.classification}</span>
        <span>
          {m.language === "cpp" ? "C++17" : "Python"} · {m.sourceDifficulty}
        </span>
        {m.curriculum.inQuantDev50 && (
          <span>
            Quant Dev 50 · #{m.curriculum.rank} · {m.curriculum.stageName}
          </span>
        )}
      </div>
      <p className="challenge-attribution">{m.attribution}</p>
      <details className="challenge-provenance">
        <summary>
          Source, assumptions &{" "}
          {r.isReconstructed
            ? r.confidenceLabel.toLowerCase() + " confidence"
            : "validation"}
        </summary>
        <p>
          Source: {catalogInfo([card])?.provider}. Captured{" "}
          {m.fetchedAt
            ? new Date(m.fetchedAt).toLocaleString()
            : "local collection"}
          .{" "}
          {m.firmTags.length
            ? "Associated firms: " + m.firmTags.join(", ") + "."
            : ""}
        </p>
        <button
          onClick={() => window.recall.challengeSource(card.id).catch(fail)}
        >
          <ExternalLink size={14} /> Open public source
        </button>
        {m.assumptions.length > 0 && (
          <>
            <h4>Explicit local assumptions</h4>
            <ul>
              {m.assumptions.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </>
        )}
        {r.isReconstructed && (
          <>
            <h4>
              {r.confidenceLabel} · {r.overallEducationalEquivalenceConfidence}
              /100
            </h4>
            <p>{r.confidenceMeaning}</p>
            <dl className="confidence-grid">
              {[
                ["Learning objective", "learningObjectiveConfidence"],
                ["Interface", "interfaceConfidence"],
                ["Behavior", "behavioralContractConfidence"],
                ["Edge cases", "edgeCaseConfidence"],
                ["Complexity", "complexityConfidence"],
              ].map(([label, key]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{r[key]}/100</dd>
                </div>
              ))}
            </dl>
            <h4>Direct evidence</h4>
            <ul>
              {r.directEvidence.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <h4>Inferred learning objective</h4>
            <ul>
              {r.inferences.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <p>{r.evidenceReinspection}</p>
            <details>
              <summary>Alternative interpretations considered</summary>
              <ol>
                {r.alternativesConsidered.map((x, i) => (
                  <li key={i}>
                    <p>{x.contract}</p>
                    <small>
                      Evidence fit {x.weightedFit}/100 · {x.rationale}
                    </small>
                  </li>
                ))}
              </ol>
            </details>
          </>
        )}
        <p>Reference checked against: {m.tests.join("; ")}.</p>
        {m.validationNotes.map((x, i) => (
          <p key={i}>{x}</p>
        ))}
      </details>
    </div>
  );
}
export function ChallengeWork({ card, state = {}, onState, fail }) {
  const [attempts, setAttempts] = useState(null),
    [saved, setSaved] = useState("");
  const save = (patch) =>
    onState(card.id, patch)
      .then(() => setSaved("Saved on this Mac"))
      .catch(fail);
  const reload = () =>
    window.recall.challengeAttempts(card.id).then(setAttempts).catch(fail);
  return (
    <section className="challenge-work">
      <div className="challenge-personal-actions">
        <button
          className={state.bookmarked ? "active" : ""}
          aria-pressed={!!state.bookmarked}
          onClick={() => save({ bookmarked: !state.bookmarked })}
        >
          <Bookmark size={15} />
          {state.bookmarked ? "Bookmarked" : "Bookmark"}
        </button>
        <button
          className={state.completed ? "active" : ""}
          aria-pressed={!!state.completed}
          onClick={() => save({ completed: !state.completed })}
        >
          <Check size={15} />
          {state.completed ? "Completed" : "Mark complete"}
        </button>
        <small>
          Completion is your decision; it does not change review dates.
        </small>
      </div>
      {["mixed", "explanation"].includes(card.catalog.answerMode) && (
        <label className="challenge-reasoning">
          Your reasoning
          <textarea
            aria-label="Your reasoning"
            value={state.explanation || ""}
            onChange={(e) => save({ explanation: e.target.value })}
            placeholder="State the invariant, assumptions, and why the approach is correct."
            rows={6}
          />
          <small>
            Compare your argument with the revealed rubric. Passing tests alone
            does not establish correctness.
          </small>
        </label>
      )}
      <details className="challenge-notes">
        <summary>Notes & personal tags</summary>
        <label>
          Notes
          <textarea
            aria-label="Challenge notes"
            rows={4}
            value={state.notes || ""}
            onChange={(e) => save({ notes: e.target.value })}
            placeholder="What clicked? What needs another attempt?"
          />
        </label>
        <label>
          Personal tags
          <input
            aria-label="Personal challenge tags"
            defaultValue={(state.customTags || []).join(", ")}
            onBlur={(e) =>
              save({
                customTags: [
                  ...new Set(
                    e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  ),
                ],
              })
            }
            placeholder="Separate with commas"
          />
        </label>
        <small role="status">{saved}</small>
      </details>
      <details
        className="challenge-attempts"
        onToggle={(e) => {
          if (e.currentTarget.open) reload();
        }}
      >
        <summary>Saved attempts</summary>
        <p>
          Each Run saves the submitted code and observed result against that
          challenge revision. For mixed tasks, assess the reasoning separately.
        </p>
        <button onClick={reload}>Refresh attempts</button>
        {attempts?.length === 0 && <p>No runs yet.</p>}
        {attempts?.map((a) => (
          <details key={a.id}>
            <summary>
              {new Date(a.at).toLocaleString()} ·{" "}
              {a.language === "cpp" ? "C++17" : "Python"} · {a.result.status}
            </summary>
            <pre>{a.result.output}</pre>
            <pre>{a.code}</pre>
          </details>
        ))}
      </details>
    </section>
  );
}
