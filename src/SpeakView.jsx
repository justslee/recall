import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  FileText,
  Mic,
  RotateCcw,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { VoiceRecorder } from "./voice-recorder";
import "./speak.css";

const api = window.recall;
const COMPOSER_KEY = "draft:speak-composer";
const targets = [30, 60, 120, 180, 300, 600, 900];
const audiences = [
  [
    "general",
    "Curious beginner",
    "Make it clear without assuming background knowledge.",
  ],
  [
    "junior",
    "Junior colleague",
    "Teach the mechanism and show a useful example.",
  ],
  [
    "peer",
    "Technical peer",
    "Be precise about assumptions, limitations and trade-offs.",
  ],
  [
    "investor",
    "Investor",
    "Connect the mechanism to decisions, risks and implications.",
  ],
  [
    "podcast",
    "Podcast listener",
    "Build an engaging explanation someone can follow by ear.",
  ],
];
const levels = {
  strong: "Strong",
  developing: "Developing",
  needs_work: "Needs attention",
  unassessable: "Not assessed",
};
const outcomes = {
  grounded: "Well supported",
  partial: "Room to strengthen",
  unclear: "Needs clarification",
  insufficient_reference: "Reference is limited",
};
const coachingFocuses = {
  main_point: "Lead with the main point",
  organization: "Make the structure easy to follow",
  precision: "Choose more precise words",
  audience_fit: "Meet your listener where they are",
  mechanism: "Connect the how and why",
  example: "Make the idea concrete",
  concision: "Keep what your listener needs",
  accuracy: "Repair the central claim",
  limits: "Make the limits clear",
};
const coachingDrills = {
  main_point_first: "Main point first",
  explain_with_example: "Explain with an example",
  audience_switch: "Try a different listener",
  compress: "Say it more simply",
  repair_gap: "Connect the missing piece",
};
const time = (seconds = 0) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const date = (at) =>
  new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function Reference({ config }) {
  if (!config.reference?.text || config.grounding === "none")
    return (
      <div className="speak-open-practice">
        <FileText size={17} aria-hidden="true" />
        <div>
          <strong>Open practice</strong>
          <p>
            Feedback covers your explanation and delivery. Factual accuracy
            isn’t verified without reference notes.
          </p>
        </div>
      </div>
    );
  const supplied = config.grounding === "user_reference";
  return (
    <details className="speak-reference">
      <summary>
        <BookOpen size={15} />{" "}
        {supplied ? "Your reference notes" : "Reference for this explanation"}{" "}
        <span>Show excerpt</span>
      </summary>
      <p className="speak-small">
        Only this excerpt, your explanation and practice context are sent for
        feedback. Open it before practicing if you need a refresher.
        {supplied &&
          " These are your supplied notes, not a verified knowledge-base source."}
      </p>
      <strong>{config.reference.title}</strong>
      <pre>{config.reference.text}</pre>
      {config.reference.truncated && (
        <p className="speak-small">
          This is a shortened excerpt. Feedback is limited to the text shown
          here.
        </p>
      )}
    </details>
  );
}

function Delivery({ metrics, originalTranscript }) {
  if (!metrics) return null;
  const recorded = metrics.method === "local_energy";
  const definite = (metrics.fillers || []).filter(
    (item) => !item.ambiguous && item.count,
  );
  const possible = (metrics.fillers || []).filter(
    (item) => item.ambiguous && item.count,
  );
  return (
    <section
      className="speak-paper speak-delivery"
      aria-label="Delivery observations"
    >
      <div className="speak-section-head">
        <div>
          <span className="eyebrow">DELIVERY</span>
          <h3>The shape of your explanation</h3>
        </div>
        <span className="speak-badge">
          {recorded ? "Estimated from recording" : "Text only"}
        </span>
      </div>
      <div className="speak-metrics">
        <div>
          <strong>
            {recorded
              ? metrics.durationSeconds < 1
                ? "<1s"
                : time(metrics.durationSeconds)
              : "—"}
          </strong>
          <span>Recorded time</span>
        </div>
        <div>
          <strong>
            {recorded && metrics.wordsPerMinute != null
              ? Math.round(metrics.wordsPerMinute)
              : "—"}
          </strong>
          <span>Words / minute</span>
        </div>
        <div>
          <strong>{recorded ? metrics.pauseCount : "—"}</strong>
          <span>Pauses ≥ 0.8s</span>
        </div>
        <div>
          <strong>{metrics.fillerCount ?? 0}</strong>
          <span>Observed fillers</span>
        </div>
      </div>
      {recorded && (
        <div className="speak-timing">
          <div
            className="speak-pause-track"
            role="img"
            aria-label={`${metrics.pauseCount} estimated pauses during ${Math.round(metrics.durationSeconds)} seconds`}
          >
            {(metrics.pauses || []).map((pause, i) => (
              <span
                key={i}
                style={{
                  left: `${(pause.startSeconds / Math.max(1, metrics.durationSeconds)) * 100}%`,
                  width: `${(pause.durationSeconds / Math.max(1, metrics.durationSeconds)) * 100}%`,
                }}
                title={`Pause at ${time(pause.startSeconds)} · ${pause.durationSeconds.toFixed(1)} seconds`}
              />
            ))}
          </div>
          <div className="speak-track-labels">
            <span>0:00</span>
            <span>
              Quiet intervals · longest{" "}
              {(metrics.longestPauseSeconds || 0).toFixed(1)}s
            </span>
            <span>{time(metrics.durationSeconds)}</span>
          </div>
          {!!metrics.pauses?.length && (
            <details>
              <summary>Pause timings</summary>
              <ul>
                {metrics.pauses.map((pause, i) => (
                  <li key={i}>
                    {time(pause.startSeconds)} ·{" "}
                    {pause.durationSeconds.toFixed(1)} seconds
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <p className="speak-small">
        {metrics.caveat ||
          "Pauses are estimates of quiet audio, not a judgment of hesitation. Transcription may omit fillers."}
      </p>
      {metrics.signalNote && (
        <p className="speak-signal-note">{metrics.signalNote}</p>
      )}
      <div className="speak-filler-line">
        <strong>Observed fillers</strong>
        <span>
          {definite.length
            ? definite.map((item) => `${item.term} × ${item.count}`).join(" · ")
            : "None in the transcript"}
          {metrics.fillerPer100Words != null
            ? ` · ${Number(metrics.fillerPer100Words).toFixed(1)} per 100 words`
            : ""}
        </span>
      </div>
      {!!possible.length && (
        <div className="speak-filler-line">
          <strong>Words to notice</strong>
          <span>
            {possible.map((item) => `${item.term} × ${item.count}`).join(" · ")}
            . These can be meaningful words; they aren’t automatically fillers.
          </span>
        </div>
      )}
      {originalTranscript && (
        <details className="speak-original">
          <summary>Original transcript used for delivery counts</summary>
          <p>{originalTranscript}</p>
          <small>
            Editing your answer does not rewrite the recording measurements.
          </small>
        </details>
      )}
    </section>
  );
}

function Feedback({ attempt, onAgain }) {
  const { feedback, config } = attempt;
  const ungrounded = config.grounding === "none";
  const coaching = feedback.coaching;
  return (
    <div
      className="speak-feedback"
      role="region"
      aria-label="Speaking feedback"
    >
      <section className="speak-paper speak-verdict">
        <span className="eyebrow">EXPLANATION FEEDBACK</span>
        <div className="speak-section-head">
          <h2>
            {ungrounded
              ? "Communication feedback"
              : outcomes[feedback.outcome] || "Your feedback"}
          </h2>
          <span className="speak-badge">{config.audienceLabel}</span>
        </div>
        <p className="speak-summary">{feedback.summary}</p>
        {feedback.sourceCaveat && (
          <p className="speak-small">{feedback.sourceCaveat}</p>
        )}
        <div className="speak-rubric">
          {feedback.dimensions.map((dimension) => (
            <article key={dimension.id}>
              <div className="speak-section-head">
                <h3>{dimension.label}</h3>
                <span className={`speak-level ${dimension.level}`}>
                  {levels[dimension.level] || dimension.level}
                </span>
              </div>
              {dimension.evidence && (
                <blockquote>“{dimension.evidence}”</blockquote>
              )}
              <p>{dimension.feedback}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="speak-feedback-columns">
        <section className="speak-paper">
          <span className="eyebrow">KEEP DOING</span>
          <h3>What came through</h3>
          <ul className="speak-strengths">
            {feedback.strengths.map((item, i) => (
              <li key={i}>
                <Check size={15} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="speak-paper">
          <span className="eyebrow">NEXT TIME</span>
          <h3>Make it more precise</h3>
          {feedback.improvements.map((item, i) => (
            <div className="speak-improvement" key={i}>
              {item.quote && <blockquote>“{item.quote}”</blockquote>}
              <p>{item.advice}</p>
              {!!item.referenceIds?.length && (
                <small>Based on: {config.reference.title}</small>
              )}
            </div>
          ))}
        </section>
      </div>
      <Delivery
        metrics={attempt.metrics}
        originalTranscript={attempt.originalTranscript}
      />
      <section className="speak-next" aria-label="Next practice rep">
        <span className="eyebrow">ONE MORE REP</span>
        {coaching ? (
          <>
            <h3>
              {coachingFocuses[coaching.focus] || "Your next practice focus"}
            </h3>
            <p className="speak-coaching-rationale">{coaching.rationale}</p>
            <div className="speak-coaching-drill">
              <strong>
                {coachingDrills[coaching.drill.kind] || "Focused practice"}
              </strong>
              <p>{coaching.drill.instructions}</p>
              <ul className="speak-success-checks" aria-label="What to aim for">
                {coaching.drill.successChecks.map((check, i) => (
                  <li key={i}>
                    <Check size={14} aria-hidden="true" />
                    <span>{check}</span>
                  </li>
                ))}
              </ul>
            </div>
            {(coaching.quote || coaching.revision) && (
              <details className="speak-coaching-revision">
                <summary>See the wording change</summary>
                {coaching.quote && (
                  <div>
                    <small>YOUR WORDING</small>
                    <blockquote>“{coaching.quote}”</blockquote>
                  </div>
                )}
                {coaching.revision && (
                  <div>
                    <small>TRY THIS</small>
                    <p>{coaching.revision}</p>
                  </div>
                )}
                {!!coaching.referenceIds?.length && (
                  <small>Based on: {config.reference.title}</small>
                )}
                {ungrounded && (
                  <small>A wording suggestion, not a fact check.</small>
                )}
              </details>
            )}
          </>
        ) : (
          <>
            <h3>{feedback.followUp}</h3>
            <p>
              Try the explanation again with this question in mind. Each attempt
              stands on its own.
            </p>
          </>
        )}
        <button className="primary" onClick={onAgain}>
          <RotateCcw size={16} /> Practice again
        </button>
      </section>
      <details className="speak-paper speak-sample">
        <summary>
          {ungrounded ? "One possible rewrite" : "A possible way to explain it"}
        </summary>
        <p>{feedback.sampleExplanation}</p>
        <small>
          {ungrounded
            ? "A rewrite of your explanation to illustrate clearer communication. It is not a fact check."
            : "An example based on the selected reference, not the only valid explanation."}
        </small>
      </details>
      <details className="speak-paper speak-sample">
        <summary>Your evaluated explanation</summary>
        <p>{attempt.transcript}</p>
      </details>
      <Reference config={config} />
    </div>
  );
}

export function SpeakView({ onSettings }) {
  const [tab, setTab] = useState("practice");
  const [topicMode, setTopicMode] = useState("library"),
    [customTitle, setCustomTitle] = useState(""),
    [customBrief, setCustomBrief] = useState(""),
    [customReference, setCustomReference] = useState("");
  const [sources, setSources] = useState([]),
    [issues, setIssues] = useState([]),
    [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState(""),
    [audience, setAudience] = useState("general"),
    [target, setTarget] = useState(120),
    [drill, setDrill] = useState("explain");
  const [config, setConfig] = useState(null),
    [transcript, setTranscript] = useState(""),
    [receipt, setReceipt] = useState(null);
  const [status, setStatus] = useState(null),
    [phase, setPhase] = useState("loading"),
    [error, setError] = useState("");
  const [draftState, setDraftState] = useState("saved");
  const [history, setHistory] = useState([]),
    [attempt, setAttempt] = useState(null),
    [deleting, setDeleting] = useState(false);
  const [retryCoaching, setRetryCoaching] = useState(null),
    [retryAttemptId, setRetryAttemptId] = useState(null);
  const [elapsed, setElapsed] = useState(0),
    [level, setLevel] = useState(0),
    [searching, setSearching] = useState(true);
  const recorder = useRef(null),
    evaluationToken = useRef(null),
    alive = useRef(true),
    draft = useRef(null),
    hydrated = useRef(false),
    composer = useRef(null),
    stopRef = useRef(null);
  const working = [
    "starting",
    "recording",
    "stopping",
    "evaluating",
    "preparing",
  ].includes(phase);
  const displayError = (e) => {
    if (!alive.current) return;
    const text =
      e.name === "NotAllowedError"
        ? "Microphone access was denied. Allow Recall in macOS System Settings → Privacy & Security → Microphone, or type your explanation."
        : (e.message || "Something went wrong. Please try again.").replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            "",
          );
    setError(text);
  };
  const loadHistory = async () => {
    const rows = await api.speakHistory();
    if (alive.current) setHistory(rows);
  };
  draft.current = config
    ? { config, transcript, recordingToken: receipt?.recordingToken || null }
    : null;
  composer.current = {
    topicMode,
    sourceId,
    customTitle,
    customBrief,
    customReference,
    audience,
    targetSeconds: target,
    drill,
  };
  const restoreComposer = (value) => {
    if (!value || typeof value !== "object") return;
    const custom = value.topicMode === "custom" || value.sourceId === "custom";
    setTopicMode(custom ? "custom" : "library");
    setSourceId(typeof value.sourceId === "string" ? value.sourceId : "");
    setCustomTitle(
      typeof value.customTitle === "string"
        ? value.customTitle.slice(0, 300)
        : "",
    );
    setCustomBrief(
      typeof value.customBrief === "string"
        ? value.customBrief.slice(0, 2000)
        : "",
    );
    setCustomReference(
      typeof value.customReference === "string"
        ? value.customReference.slice(0, 24000)
        : "",
    );
    if (audiences.some(([id]) => id === value.audience))
      setAudience(value.audience);
    if (targets.includes(value.targetSeconds)) setTarget(value.targetSeconds);
    if (
      ["explain", "mechanism", "example", "presentation"].includes(value.drill)
    )
      setDrill(value.drill);
  };
  useEffect(() => {
    alive.current = true;
    Promise.all([
      api.voiceStatus(),
      api.speakDraft(),
      api.speakHistory(),
      api.draft(COMPOSER_KEY),
    ])
      .then(([voice, saved, rows, savedComposer]) => {
        if (!alive.current) return;
        setStatus(voice);
        setHistory(rows);
        restoreComposer(savedComposer);
        if (saved?.config) {
          setConfig(saved.config);
          setTranscript(saved.transcript || "");
          setReceipt(saved.recordingToken ? saved : null);
          restoreComposer(saved.config);
        }
        hydrated.current = true;
        setPhase("idle");
      })
      .catch((e) => {
        displayError(e);
        setPhase("idle");
      });
    const hidden = () => {
      if (document.hidden) {
        recorder.current?.cancel();
        recorder.current = null;
        if (evaluationToken.current)
          api.voiceCancel(evaluationToken.current).catch(() => {});
        evaluationToken.current = null;
        setPhase((p) =>
          ["recording", "starting", "stopping", "evaluating"].includes(p)
            ? "idle"
            : p,
        );
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false;
      recorder.current?.cancel();
      if (evaluationToken.current)
        api.voiceCancel(evaluationToken.current).catch(() => {});
      if (hydrated.current) {
        api.speakSaveDraft(draft.current).catch(() => {});
        api.setting(COMPOSER_KEY, composer.current).catch(() => {});
      }
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    if (!hydrated.current || phase === "loading") return;
    const timeout = setTimeout(
      () => api.setting(COMPOSER_KEY, composer.current).catch(displayError),
      450,
    );
    return () => clearTimeout(timeout);
  }, [
    topicMode,
    sourceId,
    customTitle,
    customBrief,
    customReference,
    audience,
    target,
    drill,
    phase,
  ]);
  useEffect(() => {
    if (!hydrated.current || phase === "loading") return;
    setDraftState("saving");
    const timeout = setTimeout(
      () =>
        api
          .speakSaveDraft(draft.current)
          .then(() => {
            if (alive.current) setDraftState("saved");
          })
          .catch((e) => {
            if (alive.current) setDraftState("error");
            displayError(e);
          }),
      450,
    );
    return () => clearTimeout(timeout);
  }, [config, transcript, receipt, phase]);
  useEffect(() => {
    if (topicMode !== "library") return;
    let live = true;
    const timeout = setTimeout(() => {
      setSearching(true);
      api
        .speakSources(query)
        .then((result) => {
          if (live) {
            setSources(result.sources);
            setIssues(result.issues || []);
          }
        })
        .catch(displayError)
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [query, topicMode]);
  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const interval = setInterval(() => {
      const seconds = (Date.now() - started) / 1000;
      setElapsed(seconds);
      if (
        seconds >=
        (config?.maxSeconds || Math.max(180, config?.targetSeconds || 180)) - 2
      )
        stopRef.current?.();
    }, 200);
    return () => clearInterval(interval);
  }, [phase, config?.maxSeconds, config?.targetSeconds]);
  const prepare = async () => {
    setError("");
    setPhase("preparing");
    try {
      const next = await api.speakPreview({
        sourceId: topicMode === "custom" ? "custom" : sourceId,
        ...(topicMode === "custom"
          ? { customTitle, customBrief, customReference }
          : {}),
        audience,
        targetSeconds: target,
        drill,
      });
      if (!alive.current) return;
      setConfig(next);
      setTranscript("");
      setReceipt(null);
      setAttempt(null);
      setRetryCoaching(null);
      setRetryAttemptId(null);
      setElapsed(0);
      await api.speakSaveDraft({
        config: next,
        transcript: "",
        recordingToken: null,
      });
    } catch (e) {
      displayError(e);
    } finally {
      if (alive.current) setPhase("idle");
    }
  };
  const start = async () => {
    setError("");
    setPhase("starting");
    setReceipt(null);
    setTranscript("");
    setElapsed(0);
    const adapter = {
      ...api,
      voicePrepare: (value) => api.speakPrepare(value),
      voiceStart: (value, token) => api.speakStart(value, token),
    };
    const capture = new VoiceRecorder(adapter, config, {
      onText: (text) => {
        if (alive.current && recorder.current === capture) setTranscript(text);
      },
      onLevel: (value) => {
        if (alive.current && recorder.current === capture) setLevel(value);
      },
      onError: (e) => {
        if (!alive.current || recorder.current !== capture) return;
        displayError(e);
        setPhase("idle");
        recorder.current = null;
      },
    });
    recorder.current = capture;
    try {
      await capture.start();
      if (alive.current && recorder.current === capture && !capture.closed)
        setPhase("recording");
    } catch (e) {
      if (!alive.current || recorder.current !== capture) return;
      displayError(e);
      setPhase("idle");
      recorder.current = null;
    }
  };
  const stop = async () => {
    const capture = recorder.current;
    if (!capture || capture.finishing) return;
    setPhase("stopping");
    try {
      const result = await capture.finish();
      if (alive.current && recorder.current === capture) {
        setTranscript(result.text);
        setReceipt({
          ...result,
          originalTranscript: result.text,
          recordingToken: capture.token,
        });
      }
    } catch (e) {
      if (recorder.current === capture) displayError(e);
    } finally {
      if (recorder.current === capture) {
        recorder.current = null;
        if (alive.current) {
          setPhase("idle");
          setLevel(0);
        }
      }
    }
  };
  stopRef.current = stop;
  const cancel = () => {
    recorder.current?.cancel();
    recorder.current = null;
    if (evaluationToken.current)
      api.voiceCancel(evaluationToken.current).catch(displayError);
    evaluationToken.current = null;
    setPhase("idle");
    setLevel(0);
  };
  const evaluate = async () => {
    setError("");
    setPhase("evaluating");
    const token = crypto.randomUUID();
    evaluationToken.current = token;
    try {
      await api.speakSaveDraft(draft.current);
      if (!alive.current || evaluationToken.current !== token) return;
      const result = await api.speakEvaluate(
        {
          config,
          transcript,
          recordingToken: receipt?.recordingToken || null,
          practiceAttemptId: retryAttemptId || undefined,
        },
        token,
      );
      if (!alive.current || evaluationToken.current !== token) return;
      setAttempt(result);
      setDeleting(false);
      await loadHistory();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      if (evaluationToken.current === token) displayError(e);
    } finally {
      if (evaluationToken.current === token) {
        evaluationToken.current = null;
        if (alive.current) setPhase("idle");
      }
    }
  };
  const again = async () => {
    setError("");
    let next = attempt.config;
    const coaching = attempt.feedback.coaching;
    try {
      if (coaching?.drill.kind === "audience_switch")
        next = await api.speakPreview({
          ...next,
          audience: coaching.drill.audience,
        });
      else if (next.sourceId === "custom") next = await api.speakPreview(next);
    } catch (error) {
      displayError(error);
      return;
    }
    if (!alive.current) return;
    setConfig(next);
    restoreComposer(next);
    setRetryCoaching(coaching || null);
    setRetryAttemptId(coaching ? attempt.id : null);
    setTranscript("");
    setReceipt(null);
    setAttempt(null);
    setTab("practice");
    setElapsed(0);
    setDeleting(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const remove = async () => {
    try {
      await api.speakDelete(attempt.id);
      setAttempt(null);
      setDeleting(false);
      await loadHistory();
    } catch (e) {
      displayError(e);
    }
  };
  const openAttempt = async (id) => {
    setError("");
    try {
      const row = await api.speakAttempt(id);
      if (alive.current) {
        setAttempt(row);
        setDeleting(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      displayError(e);
    }
  };
  return (
    <div className="speak-page">
      <div className="speak-intro">
        <p>
          Practice explaining an idea, then see where it lands. A little more
          clarity with every attempt.
        </p>
        <div className="speak-tabs" aria-label="Speaking views">
          <button
            aria-pressed={tab === "practice"}
            disabled={working}
            onClick={() => {
              setTab("practice");
              setAttempt(null);
            }}
          >
            Practice
          </button>
          <button
            aria-pressed={tab === "history"}
            disabled={working}
            onClick={() => {
              setTab("history");
              setAttempt(null);
              loadHistory().catch(displayError);
            }}
          >
            Past attempts <span>{history.length}</span>
          </button>
        </div>
      </div>
      {error && (
        <div className="speak-error" role="alert">
          {error}
        </div>
      )}
      {phase === "loading" ? (
        <p role="status">Opening your speaking notebook…</p>
      ) : attempt ? (
        <>
          <div className="speak-attempt-heading">
            <button className="ghost" onClick={() => setAttempt(null)}>
              <ArrowLeft size={15} /> Back
            </button>
            <span>
              {attempt.config.title} · {date(attempt.at)}
            </span>
            <button
              className="ghost"
              aria-label="Delete attempt"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={15} />
            </button>
          </div>
          {deleting && (
            <div className="speak-delete">
              Remove this attempt from local practice history?
              <button onClick={remove}>Delete this attempt</button>
              <button onClick={() => setDeleting(false)}>Keep it</button>
            </div>
          )}
          <Feedback attempt={attempt} onAgain={again} />
        </>
      ) : tab === "history" ? (
        <section className="speak-paper speak-history">
          <span className="eyebrow">YOUR SPEAKING NOTEBOOK</span>
          <h2>Explanations, revisited.</h2>
          <p>
            Each entry keeps the audience, source excerpt, transcript and
            feedback from that attempt.
          </p>
          {history.length === 100 && (
            <p className="speak-small">
              Showing your most recent 100 attempts.
            </p>
          )}
          {history.length ? (
            <div className="speak-history-list">
              {history.map((row) => (
                <button key={row.id} onClick={() => openAttempt(row.id)}>
                  <div>
                    <small>
                      {date(row.at)} · {row.audienceLabel}
                    </small>
                    <strong>{row.title}</strong>
                    <span>{row.summary}</span>
                  </div>
                  <span className="speak-badge">
                    {outcomes[row.outcome] || "Feedback"}
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <div className="speak-empty">
              <BookOpen size={28} />
              <h3>Your first explanation belongs here.</h3>
              <p>
                Choose something you’ve learned and explain it in your own
                words.
              </p>
              <button onClick={() => setTab("practice")}>
                Start practicing
              </button>
            </div>
          )}
        </section>
      ) : !config ? (
        <div className="speak-setup">
          <section className="speak-paper speak-topic">
            <span className="eyebrow">01 / THE IDEA</span>
            <h2>What will you explain?</h2>
            <p>
              A concept you’re learning, or a bigger idea you want to make
              clear.
            </p>
            <div className="speak-topic-modes" aria-label="Topic source">
              <button
                aria-pressed={topicMode === "library"}
                onClick={() => setTopicMode("library")}
              >
                <BookOpen size={16} aria-hidden="true" /> From library
              </button>
              <button
                aria-pressed={topicMode === "custom"}
                onClick={() => setTopicMode("custom")}
              >
                <FileText size={16} aria-hidden="true" /> Your own topic
              </button>
            </div>
            {topicMode === "custom" ? (
              <div className="speak-custom-topic">
                <label>
                  Topic or presentation title
                  <input
                    aria-label="Topic or presentation title"
                    placeholder="e.g. How our data platform works"
                    maxLength={300}
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                  />
                </label>
                <label>
                  What should your listener understand?{" "}
                  <span className="speak-optional">Optional</span>
                  <textarea
                    aria-label="What should your listener understand?"
                    placeholder="The big picture, how the pieces connect, and why we made these choices…"
                    maxLength={2000}
                    rows={4}
                    value={customBrief}
                    onChange={(e) => setCustomBrief(e.target.value)}
                  />
                </label>
                <details className="speak-reference-input">
                  <summary>
                    <BookOpen size={15} aria-hidden="true" /> Add reference
                    notes <span className="speak-optional">Optional</span>
                  </summary>
                  <p className="speak-small">
                    Paste an architecture overview, study notes or an outline of
                    the correct explanation. Feedback can check your talk
                    against these notes.
                  </p>
                  <label>
                    Reference notes
                    <textarea
                      aria-label="Reference notes"
                      placeholder="Paste the material you want your explanation checked against…"
                      maxLength={24000}
                      rows={7}
                      value={customReference}
                      onChange={(e) => setCustomReference(e.target.value)}
                    />
                  </label>
                </details>
                <p className="speak-custom-note">
                  {customReference.trim()
                    ? "Your notes provide the reference. They stay separate from your cards and knowledge base."
                    : "No notes needed to practice. Without a reference, feedback focuses on communication; factual accuracy isn’t verified."}
                </p>
              </div>
            ) : (
              <>
                <label className="speak-search">
                  <Search size={17} />
                  <input
                    aria-label="Search speaking topics"
                    placeholder="Search a concept, mechanism or topic…"
                    value={query}
                    maxLength={160}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div
                  className="speak-sources"
                  aria-label="Speaking topics"
                  aria-busy={searching}
                >
                  {sources.map((source) => (
                    <button
                      key={source.id}
                      aria-pressed={sourceId === source.id}
                      onClick={() => setSourceId(source.id)}
                    >
                      <span className="speak-source-icon">
                        <BookOpen size={18} />
                      </span>
                      <span>
                        <small>
                          {source.topic ||
                            (source.kind === "card"
                              ? "Recall library"
                              : "Knowledge base")}{" "}
                          · {source.kind === "card" ? "Card" : "KB note"}
                        </small>
                        <strong>{source.title}</strong>
                        {source.detail && <span>{source.detail}</span>}
                      </span>
                      {sourceId === source.id && <Check size={17} />}
                    </button>
                  ))}
                </div>
                {!sources.length && searching && (
                  <p className="speak-small" role="status">
                    Finding topics in your library…
                  </p>
                )}
                {!sources.length && !searching && (
                  <div className="speak-empty">
                    <h3>
                      {query
                        ? "No matching topics yet."
                        : "Start with an idea in your library."}
                    </h3>
                    <p>
                      {query
                        ? "Try a different term, or bring your own topic."
                        : "Choose your own topic now, or add cards and connect knowledge sources in Settings."}
                    </p>
                    <button
                      onClick={() => {
                        setTopicMode("custom");
                        if (!customTitle) setCustomTitle(query);
                      }}
                    >
                      Use a custom topic <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                {!!issues.length && (
                  <details className="speak-small">
                    <summary>Some knowledge sources need attention</summary>
                    {issues.map((issue, i) => (
                      <p key={i}>
                        {typeof issue === "string"
                          ? issue
                          : issue.message ||
                            issue.error ||
                            "A configured source could not be read."}
                      </p>
                    ))}
                  </details>
                )}
              </>
            )}
          </section>
          <aside className="speak-paper speak-composer">
            <span className="eyebrow">02 / YOUR LISTENER</span>
            <h2>Make it land.</h2>
            <label>
              Audience
              <select
                aria-label="Audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              >
                {audiences.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="speak-audience-note">
              {audiences.find(([id]) => id === audience)[2]}
            </p>
            <label>
              Practice focus
              <select
                aria-label="Practice focus"
                value={drill}
                onChange={(e) => setDrill(e.target.value)}
              >
                <option value="explain">Explain the idea</option>
                <option value="mechanism">Walk through the mechanism</option>
                <option value="example">
                  Make it concrete with an example
                </option>
                <option value="presentation">Walk through a system</option>
              </select>
            </label>
            <label>
              Target length
              <select
                aria-label="Target length"
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              >
                <optgroup label="Quick explanation">
                  {targets
                    .filter((seconds) => seconds <= 180)
                    .map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds === 30
                          ? "30 seconds"
                          : `${seconds / 60} minute${seconds > 60 ? "s" : ""}`}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Presentation">
                  {targets
                    .filter((seconds) => seconds > 180)
                    .map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds / 60} minutes
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
            <p className="speak-small">
              A guide, not a quota. A complete, concise explanation counts.
            </p>
            <button
              className="primary"
              disabled={
                (topicMode === "custom" ? !customTitle.trim() : !sourceId) ||
                working
              }
              onClick={prepare}
            >
              Prepare explanation <ArrowRight size={16} />
            </button>
            <p className="speak-small">
              Practice feedback stays separate from your flashcard review
              schedule.
            </p>
          </aside>
        </div>
      ) : (
        <div className="speak-practice">
          <section className="speak-paper speak-prompt">
            <div className="speak-section-head">
              <span className="eyebrow">YOUR EXPLANATION</span>
              <button
                className="ghost"
                disabled={working}
                onClick={() => {
                  setConfig(null);
                  setTranscript("");
                  setReceipt(null);
                  setRetryCoaching(null);
                  setRetryAttemptId(null);
                  setError("");
                }}
              >
                Change topic
              </button>
            </div>
            <h2>{config.title}</h2>
            <div className="speak-context">
              <span>{config.audienceLabel}</span>
              <span>
                <Clock3 size={13} /> {time(config.targetSeconds)} target
              </span>
            </div>
            <p className="speak-prompt-text">{config.prompt}</p>
            {retryCoaching && (
              <details className="speak-retry-focus">
                <summary>
                  Practice focus:{" "}
                  {coachingFocuses[retryCoaching.focus] || "Your next rep"}
                </summary>
                <p>{retryCoaching.drill.instructions}</p>
                <ul>
                  {retryCoaching.drill.successChecks.map((check, i) => (
                    <li key={i}>{check}</li>
                  ))}
                </ul>
              </details>
            )}
            {config.customBrief && (
              <div className="speak-listener-brief">
                <small>WHAT YOUR LISTENER SHOULD UNDERSTAND</small>
                <p>{config.customBrief}</p>
              </div>
            )}
            <Reference config={config} />
          </section>
          <section className="speak-paper speak-record">
            <div className="speak-section-head">
              <div>
                <span className="eyebrow">IN YOUR OWN WORDS</span>
                <h3>
                  {phase === "recording"
                    ? "You have the floor."
                    : transcript
                      ? "Read it back. Make it yours."
                      : "Take a breath. Start with the idea."}
                </h3>
              </div>
              <span className="speak-badge">
                {phase === "recording"
                  ? "Recording"
                  : `Up to ${(config.maxSeconds || Math.max(180, config.targetSeconds)) / 60} minutes`}
              </span>
            </div>
            {!status?.configured && (
              <div className="speak-key-note">
                <p>
                  Connect your OpenAI API account in Settings to record and get
                  feedback.
                </p>
                <button onClick={onSettings}>Open voice settings</button>
              </div>
            )}
            <div
              className={`speak-microphone ${phase === "recording" ? "is-recording" : ""}`}
            >
              <div
                className="speak-mic-symbol"
                style={{ "--mic-level": level }}
              >
                <Mic size={28} />
              </div>
              <div>
                <strong>{time(elapsed)}</strong>
                <span>
                  {phase === "recording"
                    ? elapsed >= config.targetSeconds
                      ? "Target reached · finish your thought"
                      : "Speak naturally. Pauses are welcome."
                    : phase === "starting"
                      ? "Connecting microphone…"
                      : phase === "stopping"
                        ? "Finishing your transcript…"
                        : "Audio is sent only while recording."}
                </span>
              </div>
            </div>
            <div className="speak-record-actions">
              {phase === "recording" ? (
                <button className="primary" onClick={stop}>
                  <Square size={15} /> Stop & review
                </button>
              ) : ["starting", "stopping"].includes(phase) ? (
                <button onClick={cancel}>Cancel recording</button>
              ) : (
                <button
                  disabled={
                    working || !status?.configured || !!transcript.trim()
                  }
                  onClick={start}
                >
                  <Mic size={16} /> Start recording
                </button>
              )}
              {transcript && !working && (
                <button
                  className="ghost"
                  onClick={() => {
                    setTranscript("");
                    setReceipt(null);
                    setElapsed(0);
                  }}
                >
                  Clear draft
                </button>
              )}
            </div>
            <label className="speak-transcript-label">
              Your explanation
              <textarea
                aria-label="Your explanation"
                value={transcript}
                maxLength={config.maxText || 40000}
                rows={config.targetSeconds > 180 ? 12 : 8}
                readOnly={working}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Your transcript will appear here. You can also type an explanation."
              />
            </label>
            <p className="speak-small">
              Correct transcription errors before asking for feedback. Delivery
              counts use the original transcript; understanding feedback uses
              your edited explanation.
            </p>
            <div className="speak-evaluate">
              <button
                className="primary"
                disabled={working || !status?.configured || !transcript.trim()}
                onClick={evaluate}
              >
                {phase === "evaluating"
                  ? "Reading your explanation…"
                  : "Get feedback"}
                <ArrowRight size={16} />
              </button>
              {phase === "evaluating" && (
                <button onClick={cancel}>Cancel feedback</button>
              )}
              <small>
                {draftState === "saved"
                  ? "Draft saved on this Mac."
                  : draftState === "saving"
                    ? "Saving draft…"
                    : "Draft could not be saved."}
              </small>
            </div>
          </section>
          {receipt?.metrics && (
            <Delivery
              metrics={receipt.metrics}
              originalTranscript={receipt.originalTranscript}
            />
          )}
        </div>
      )}
      <p className="speak-privacy">
        OpenAI API account and internet required for recording and feedback.
        Recall keeps transcripts and feedback locally, and stores no audio. AI
        feedback can be mistaken. Accuracy checks are limited to the reference
        you provide or select.
      </p>
    </div>
  );
}
