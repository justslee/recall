import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  Suspense,
  lazy,
} from "react";
import {
  ArrowRight,
  ImagePlus,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Rotate3D,
  Undo2,
} from "lucide-react";
import { RichContent, Diagram, CarryLab } from "./RichContent";
import { InteractiveLab } from "./InteractiveLab";
import { SplitWorkspace } from "./SplitWorkspace";
import { plain, formatLabel, spanLabel } from "./model";
import { Kbd } from "./ui";
import { ChallengeContext, ChallengeWork } from "./ChallengeDetail";
import { VoiceAnswer } from "./VoiceAnswer";
const CodeWorkspace = lazy(() => import("./CodeWorkspace"));
const api = window.recall;

const ratingHelp = {
  Again: "Forgot or made a substantive error",
  Hard: "Correct, with substantial effort",
  Good: "Correct recall",
  Easy: "Effortless recall",
};

function MathWork({ card, fail, onExport }) {
  const [numeric, setNumeric] = useState(""),
    [result, setResult] = useState(null),
    [photos, setPhotos] = useState([]);
  useEffect(() => {
    api.attachments(card.id).then(setPhotos).catch(fail);
    api
      .draft("draft:" + card.id + ":numeric")
      .then((v) => setNumeric(v || ""))
      .catch(fail);
  }, [card.id]);
  const check = () => {
    const value = Number(numeric.replaceAll(",", ""));
    if (!numeric.trim() || !Number.isFinite(value))
      return setResult({ tone: "hint", text: "Enter a number to check." });
    const ok = Math.abs(value - card.numeric.value) <= card.numeric.tolerance;
    setResult(
      ok
        ? {
            tone: "match",
            text: "The final value matches. Compare your method with the worked solution.",
          }
        : {
            tone: "miss",
            text: "The final value differs. Check units and method, then reveal the worked solution.",
          },
    );
  };
  const attach = () => api.attach(card.id).then(setPhotos).catch(fail);
  return (
    <section className="math-work">
      <div className="math-answer-input">
        <label>
          Your numerical answer
          {card.numeric?.unit ? " (" + card.numeric.unit + ")" : ""}
          <input
            aria-label="Numerical answer"
            inputMode="decimal"
            value={numeric}
            onChange={(e) => {
              setNumeric(e.target.value);
              setResult(null);
              api
                .setting("draft:" + card.id + ":numeric", e.target.value)
                .catch(fail);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && card.numeric) {
                e.preventDefault();
                check();
              }
            }}
            placeholder="Or solve it on paper"
          />
        </label>
        {card.numeric && <button onClick={check}>Check value</button>}
      </div>
      {result && (
        <p className={"check-result " + result.tone}>
          {result.tone === "match" ? (
            <Check size={15} />
          ) : result.tone === "miss" ? (
            <CircleAlert size={15} />
          ) : null}
          {result.text}
        </p>
      )}
      <div className="paper-actions">
        <button onClick={attach}>
          <ImagePlus size={16} /> Attach paper solution
        </button>
        {photos.length > 0 && (
          <button onClick={() => onExport(card.id)}>
            Export for Codex assessment
          </button>
        )}
        <small>Photos stay on this Mac. No automatic grading yet.</small>
      </div>
      {photos.length > 0 && (
        <div className="photos">
          {photos.map((photo) => (
            <figure key={photo.id}>
              <img src={photo.url} alt={"Paper solution: " + photo.name} />
              <figcaption>{photo.name}</figcaption>
              <button
                onClick={() =>
                  api
                    .removeAttachment(photo.id)
                    .then(() => api.attachments(card.id))
                    .then(setPhotos)
                    .catch(fail)
                }
              >
                Remove
              </button>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

export function ReviewCard({
  card,
  revealed,
  reveal,
  browsing,
  rate,
  busy,
  fail,
  practice,
  challengeState = {},
  onChallengeState,
  intervals = {},
  onExport,
  onOpenVoiceSettings,
  onVoiceBusyChange,
}) {
  const cardElement = useRef(null);
  const previousSide = useRef(revealed);
  const flips = card.kind !== "code";
  useLayoutEffect(() => {
    if (previousSide.current === revealed) return;

    previousSide.current = revealed;
    if (flips && cardElement.current?.getBoundingClientRect().top < 0)
      cardElement.current.scrollIntoView({
        block: "start",
        behavior: "instant",
      });

    if (!flips || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;

    const turn = cardElement.current?.animate(
      [
        {
          transform: `perspective(1400px) rotateY(${revealed ? -85 : 85}deg)`,
          opacity: 0.25,
        },
        { transform: "perspective(1400px) rotateY(0deg)", opacity: 1 },
      ],
      { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
    return () => turn?.cancel();
  }, [revealed, flips]);
  const revealLabel =
    card.kind === "math"
      ? "Reveal worked solution"
      : card.kind === "code"
        ? "Reveal reference & explanation"
        : "Reveal answer";
  const labType =
    card.presentation?.lab ||
    (card.id === "recall-duration-v1"
      ? "duration"
      : card.id === "recall-yen-repayment-v1" ||
          card.id === "recall-yen-quote-v1"
        ? "fx"
        : null);
  const flipControl = (
    <>
      {!revealed && (
        <div className={flips ? "card-flip-actions" : "reveal-zone"}>
          {flips && (
            <small>
              <Kbd>Space</Kbd> to flip
            </small>
          )}
          <button
            className="primary reveal"
            aria-label={revealLabel}
            aria-expanded={false}
            aria-controls={card.kind === "math" ? "worked-solution" : undefined}
            disabled={busy}
            onClick={() => reveal(true)}
          >
            {flips ? "Flip card" : revealLabel}
            {flips ? (
              <Rotate3D size={16} />
            ) : browsing ? (
              <ArrowRight size={16} />
            ) : (
              <Kbd>Space</Kbd>
            )}
          </button>
          {!flips && (
            <small>
              {card.catalog?.answerMode === "explanation"
                ? "Write your reasoning, then compare it with the rubric."
                : card.kind === "code"
                  ? "Run your tests first, then compare with the reference."
                  : card.kind === "math"
                    ? "Work it through before you look."
                    : "Say it in your own words first."}
            </small>
          )}
        </div>
      )}
      {revealed && (
        <button
          className={flips ? "card-back-toggle text-button" : "math-reveal"}
          aria-label={
            card.kind === "math"
              ? "Hide worked solution"
              : card.kind === "concept"
                ? "Hide answer"
                : "Hide reference & explanation"
          }
          aria-expanded={true}
          aria-controls={card.kind === "math" ? "worked-solution" : undefined}
          disabled={busy}
          onClick={() => reveal(false)}
        >
          {flips ? <Undo2 size={15} /> : <EyeOff size={15} />}{" "}
          {flips
            ? "Question"
            : card.kind === "math"
              ? "Hide worked solution"
              : card.kind === "concept"
                ? "Hide answer"
                : "Hide reference & explanation"}
        </button>
      )}
    </>
  );
  const problem = (
    <div className="question-pane">
      <h2>{plain(card.title)}</h2>
      {card.catalog && <ChallengeContext card={card} fail={fail} />}
      {card.prompt && (
        <div className="question-prompt">
          <RichContent html={card.prompt} />
        </div>
      )}
      {card.importWarning && <p className="callout">{card.importWarning}</p>}
      {card.catalog?.analysisCode && !card.code && (
        <pre className="analysis-code">
          <code>{card.catalog.analysisCode}</code>
        </pre>
      )}
      {card.kind === "math" && (
        <MathWork card={card} fail={fail} onExport={onExport} />
      )}
      {card.catalog && (
        <ChallengeWork
          card={card}
          state={challengeState}
          onState={onChallengeState}
          fail={fail}
        />
      )}
      {!flips && flipControl}
    </div>
  );
  return (
    <>
      <article
        ref={cardElement}
        className={
          "review-card kind-" +
          card.kind +
          (revealed ? " is-revealed" : "") +
          (flips ? " flip-card" : "")
        }
      >
        <div className="card-meta">
          <span>
            {card.topic} <span className="meta-divider">/</span>{" "}
            {formatLabel[card.kind]}
          </span>
          <div className="card-side-meta">
            <span className="badge">{card.difficulty}</span>
            {flips && (
              <span className="card-side-label" aria-live="polite">
                {revealed ? "Back" : "Front"}
              </span>
            )}
          </div>
        </div>
        {card.kind === "code" && card.code ? (
          <SplitWorkspace
            problem={problem}
            editor={
              <Suspense fallback={<p className="muted">Opening editor…</p>}>
                <CodeWorkspace card={card} revealed={revealed} onError={fail} />
              </Suspense>
            }
          />
        ) : (
          <div className="card-front" hidden={flips && revealed}>
            {problem}
          </div>
        )}
        {revealed && (
          <section
            className="answer"
            id={card.kind === "math" ? "worked-solution" : undefined}
          >
            {flips && <p className="card-back-context">{plain(card.title)}</p>}
            <span className="eyebrow">
              {card.kind === "math" ? "Worked solution" : "The answer"}
            </span>
            <RichContent
              html={card.presentation?.answer ?? card.answer}
              cardId={card.id}
              widgetsAllowed={card.widgetsAllowed === true}
              revision={card.revision || 0}
            />
            {card.presentation && (
              <section className="visual-explanation">
                <span className="eyebrow">
                  {card.presentation.label === "Answer diagram"
                    ? "Answer diagram"
                    : "Concept map"}
                </span>
                <p className="visual-caption">
                  {plain(card.presentation.label)}
                </p>
                <Diagram source={card.presentation.source} />
              </section>
            )}
            {card.mermaid && <Diagram source={card.mermaid} />}
            {card.lab === "carry" && (
              <details className="explore">
                <summary>Explore the mechanism · exchange-rate risk</summary>
                <CarryLab />
              </details>
            )}
            <InteractiveLab type={labType} />
            {card.presentation?.originalNotes && (
              <details className="original-notes">
                <summary>Original source notes</summary>
                <RichContent html={card.presentation.originalNotes} />
              </details>
            )}
          </section>
        )}
        {flips && (
          <VoiceAnswer
            key={card.id}
            card={card}
            revealed={revealed}
            onOpenSettings={onOpenVoiceSettings}
            onEvaluated={() => reveal(true)}
            onBusyChange={onVoiceBusyChange}
          />
        )}
      </article>
      {flips && flipControl}
      {revealed && !browsing && (
        <div className="ratings">
          <span>
            How well did you recall it?
            <small>
              {practice ? "Practice · schedule unchanged" : "Press 1–4 to rate"}
            </small>
          </span>
          <div>
            {["Again", "Hard", "Good", "Easy"].map((r, i) => (
              <button
                key={r}
                className={r === "Good" ? "good" : ""}
                disabled={busy}
                onClick={() => rate(r)}
                title={ratingHelp[r]}
              >
                <Kbd>{i + 1}</Kbd>
                <strong>{r}</strong>
                <small>
                  {practice
                    ? "Practice"
                    : intervals[r]
                      ? spanLabel(new Date(intervals[r]) - Date.now())
                      : "…"}
                </small>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
