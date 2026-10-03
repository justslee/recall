import React, { useEffect, useId, useRef, useState } from "react";
import {
  Mic,
  Square,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  TextCursorInput,
  MessageSquareText,
  Info,
  Minus,
  ChevronDown,
} from "lucide-react";
import { VoiceRecorder } from "./voice-recorder";
import "./voice.css";

const api = window.recall;
const labels = {
  solid: "Well explained",
  partial: "Almost there",
  needs_work: "A little more work",
  unclear: "Let’s clarify",
};
const feedbackOnly = ({ verdict, summary, strengths, gaps, followUp }) => ({
  verdict,
  summary,
  strengths,
  gaps,
  followUp,
});
const message = (error) => {
  if (["NotAllowedError", "PermissionDeniedError"].includes(error.name))
    return "Microphone access was denied. Allow Recall in macOS System Settings → Privacy & Security → Microphone, then try again. You can also type your answer.";
  if (error.name === "NotFoundError")
    return "No microphone found. Connect one or type your answer.";
  return error.message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
};

export function VoiceSettings({
  focus = false,
  onBack,
  backLabel = "Back to your answer",
}) {
  const [status, setStatus] = useState(null),
    [key, setKey] = useState(""),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const section = useRef(null);
  useEffect(() => {
    api
      .voiceStatus()
      .then(setStatus)
      .catch((e) => setNotice(message(e)));
  }, []);
  useEffect(() => {
    if (focus) {
      section.current?.scrollIntoView({ block: "start" });
      section.current?.focus({ preventScroll: true });
    }
  }, [focus]);
  const save = async (remove = false) => {
    setBusy(true);
    setNotice("");
    try {
      const next = await api.voiceConfigure(remove ? "" : key);
      setKey("");
      setEditing(false);
      setStatus(next);
      setNotice(
        (remove ? "Saved key removed." : "Key saved on this Mac.") +
          (next.legacyCleanupPending
            ? " The old encrypted copy could not be removed. Recall will not use it."
            : ""),
      );
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="Voice & feedback"
      className="settings-group voice-settings"
    >
      {onBack && (
        <button className="text-button voice-back" onClick={onBack}>
          <ArrowLeft size={15} /> {backLabel}
        </button>
      )}
      <span className="eyebrow">Voice & feedback</span>
      <h3>Speak, reflect, remember.</h3>
      <p className="voice-description">
        Dictate a card answer or practice an explanation in Speak. Edit the
        transcript, then get feedback against your selected reference.
      </p>
      <div className="voice-connection">
        <div>
          <strong>OpenAI</strong>
          <p
            className={status?.configured ? "voice-connected" : "voice-privacy"}
            role="status"
          >
            {!status
              ? "Checking connection settings…"
              : status.configured
                ? status.source === "environment"
                  ? "Using a key from this app’s environment"
                  : "Key saved on this Mac"
                : status.needsKeyReentry
                  ? "Re-enter key once · local storage update"
                  : "Not set up · optional"}
          </p>
        </div>
        {(status?.configured || status?.hasLegacyKey) && !editing && (
          <div className="voice-key-actions">
            {status.configured && (
              <button
                onClick={() => {
                  setEditing(true);
                  setNotice("");
                }}
              >
                Replace key
              </button>
            )}
            {(status.source === "saved" || status.hasLegacyKey) && (
              <button disabled={busy} onClick={() => save(true)}>
                Remove key
              </button>
            )}
          </div>
        )}
      </div>
      {status?.needsKeyReentry && (
        <p className="voice-privacy" role="status">
          Recall now saves keys locally without Keychain prompts. Re-enter your
          key once below. Your old encrypted copy stays untouched until the new
          key is saved.
        </p>
      )}
      {status && (!status.configured || editing) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="voice-key-form"
        >
          <label>
            OpenAI API key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={status.configured ? "Enter replacement key" : "sk-…"}
              aria-label="OpenAI API key"
              autoFocus={editing}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !key.trim() || !status.canSave}
          >
            {busy ? "Saving…" : "Save key"}
          </button>
          {editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setKey("");
              }}
            >
              Cancel
            </button>
          )}
        </form>
      )}
      <p className="voice-privacy">
        {status?.source === "environment"
          ? "Provided at launch through OPENAI_API_KEY; Recall has not saved this key."
          : "Saved only on this device. Kept across restarts; excluded from Recall backups and exports. No Keychain prompts."}
      </p>
      <details className="voice-disclosure">
        <summary>Privacy & billing</summary>
        <p>
          While recording, audio goes to OpenAI. Evaluation sends the card’s
          question, text reference, your response and any follow-up context.
          Recall stores no audio; transcripts and feedback stay in your local
          drafts.
        </p>
        <p>
          Internet and OpenAI API billing are required. Your ChatGPT
          subscription is separate. Saving a key does not verify API access or
          incur a charge.
        </p>
        <p>
          The key is stored in a private local file accessible to your macOS
          account, without separate encryption. Software running as your account
          can read it. Recall never displays the saved key or sends it to a card
          or diagram.
        </p>
      </details>
      {status && !status.canSave && (
        <p role="alert">
          Local storage is unavailable. A key cannot be saved on this device.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export function VoiceAnswer({
  card,
  revealed,
  onOpenSettings,
  onEvaluated,
  onBusyChange,
}) {
  const [expanded, setExpanded] = useState(false),
    [status, setStatus] = useState(null),
    [feedbackOpen, setFeedbackOpen] = useState(false),
    [infoOpen, setInfoOpen] = useState(false);
  const editorId = useId(),
    feedbackId = useId(),
    infoId = useId();
  const textarea = useRef(null);
  const [text, setText] = useState(""),
    [feedback, setFeedback] = useState(null),
    [history, setHistory] = useState([]);
  const [phase, setPhase] = useState("idle"),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [seconds, setSeconds] = useState(0);
  const recorder = useRef(null),
    alive = useRef(true),
    evaluation = useRef(null);
  const draft = useRef({ text: "", feedback: null, history: [] });
  const key = "draft:" + card.id + ":spoken";
  const save = (patch) => {
    draft.current = { ...draft.current, ...patch };
    api.setting(key, draft.current).catch((e) => {
      if (alive.current) setError(message(e));
    });
  };
  useEffect(() => {
    alive.current = true;
    Promise.all([api.voiceStatus(), api.draft(key)])
      .then(([s, value]) => {
        if (!alive.current) return;
        setStatus(s);
        if (value && typeof value.text === "string") {
          const previous = {
            text: value.text.slice(0, 12000),
            feedback: value.feedback || null,
            history: Array.isArray(value.history)
              ? value.history.slice(-4)
              : [],
          };
          draft.current = previous;
          setText(previous.text);
          setFeedback(previous.feedback);
          setHistory(previous.history);
        }
        setReady(true);
      })
      .catch((e) => {
        if (alive.current) {
          setError(message(e));
          setReady(true);
        }
      });
    const hidden = () => {
      if (document.hidden && recorder.current) {
        recorder.current.cancel();
        recorder.current = null;
        setPhase("idle");
        setError(
          "Dictation stopped when Recall left the screen. Check the partial transcript before assessment.",
        );
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false;
      recorder.current?.cancel();
      if (evaluation.current)
        api.voiceCancel(evaluation.current).catch(() => {});
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [key]);
  useEffect(() => {
    if (phase !== "recording") return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    onBusyChange?.(phase !== "idle");
    return () => onBusyChange?.(false);
  }, [phase, onBusyChange]);
  useEffect(() => {
    setExpanded(false);
    setFeedbackOpen(false);
  }, [revealed]);
  useEffect(() => {
    if (!expanded || !textarea.current) return;

    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(240, Math.max(72, textarea.current.scrollHeight))}px`;
  }, [text, expanded]);
  const openEditor = () => {
    setExpanded(true);
    requestAnimationFrame(() => textarea.current?.focus());
  };
  const changeText = (value) => {
    setText(value);
    setFeedback(null);
    save({ text: value, feedback: null });
  };
  const start = async () => {
    setExpanded(true);
    setError("");
    if (!status?.configured) return;
    setPhase("connecting");
    const prefix = draft.current.text.trim();
    const r = new VoiceRecorder(api, card.id, {
      onText: (value) => {
        if (alive.current && recorder.current === r)
          changeText([prefix, value].filter(Boolean).join("\n\n"));
      },
      onError: (e) => {
        if (alive.current && recorder.current === r) {
          setError(message(e));
          setPhase("idle");
        }
      },
    });
    recorder.current = r;
    try {
      await r.start();
      if (alive.current && !r.closed) setPhase("recording");
    } catch (e) {
      r.cancel();
      if (alive.current && recorder.current === r) {
        setError(message(e));
        setPhase("idle");
      }
    }
  };
  const stop = async () => {
    const r = recorder.current;
    setPhase("finishing");
    try {
      await r?.finish();
    } catch (e) {
      if (alive.current && recorder.current === r) setError(message(e));
    } finally {
      if (recorder.current === r) {
        recorder.current = null;
        if (alive.current) setPhase("idle");
      }
    }
  };
  const cancel = () => {
    recorder.current?.cancel();
    recorder.current = null;
    if (evaluation.current) api.voiceCancel(evaluation.current).catch(() => {});
    evaluation.current = null;
    setPhase("idle");
  };
  const evaluate = async () => {
    setPhase("evaluating");
    setError("");
    const token = crypto.randomUUID();
    evaluation.current = token;
    try {
      const result = await api.voiceEvaluate(card.id, text, history, token);
      if (alive.current && evaluation.current === token) {
        setFeedback(result);
        save({ feedback: result });
        setExpanded(false);
        setFeedbackOpen(false);
        onEvaluated?.();
      }
    } catch (e) {
      if (alive.current && evaluation.current === token) setError(message(e));
    } finally {
      if (evaluation.current === token) {
        evaluation.current = null;
        if (alive.current) setPhase("idle");
      }
    }
  };
  const followUp = () => {
    const next = [
      ...history,
      { answer: text, feedback: feedbackOnly(feedback) },
    ];
    setHistory(next);
    setText("");
    setFeedback(null);
    save({ history: next, text: "", feedback: null });
    setFeedbackOpen(false);
    openEditor();
  };
  const reset = () => {
    cancel();
    setText("");
    setFeedback(null);
    setHistory([]);
    setError("");
    save({ text: "", feedback: null, history: [] });
  };
  const working = phase !== "idle";
  return (
    <section
      className={"voice-answer answer-strip" + (expanded ? " is-open" : "")}
      aria-label="Your answer"
      aria-busy={working}
    >
      <div className="answer-strip-row">
        <div className="answer-strip-tools">
          {text || history.length ? (
            <button
              className="text-button answer-draft"
              onClick={openEditor}
              disabled={working}
              aria-expanded={expanded}
              aria-controls={editorId}
            >
              <MessageSquareText size={15} /> Your answer
              <span>· {feedback ? "feedback saved" : "draft"}</span>
            </button>
          ) : (
            <>
              <span className="answer-strip-hint">Answer your way</span>
              {status && !status.configured ? (
                <button className="text-button" onClick={onOpenSettings}>
                  <Mic size={15} /> Set up voice
                </button>
              ) : (
                <button
                  className="text-button"
                  onClick={start}
                  disabled={working || !ready || !status}
                  aria-label="Speak answer"
                >
                  <Mic size={15} /> Speak
                </button>
              )}
              <button
                className="text-button"
                onClick={openEditor}
                disabled={working || !ready}
                aria-label="Type answer"
                aria-expanded={expanded}
                aria-controls={editorId}
              >
                <TextCursorInput size={15} /> Type
              </button>
            </>
          )}
        </div>
        <button
          className="text-button answer-info"
          onClick={() => setInfoOpen(!infoOpen)}
          aria-label="About voice and feedback"
          aria-expanded={infoOpen}
          aria-controls={infoId}
        >
          <Info size={15} />
        </button>
      </div>
      {infoOpen && (
        <div className="answer-strip-info" id={infoId}>
          <p>
            Dictation streams audio to OpenAI. Evaluation sends this card’s
            question, text reference and your response. Recall saves no audio.
            Transcripts stay in local drafts. Internet and API billing are
            required.
          </p>
          <button
            className="text-button voice-settings-link"
            disabled={working}
            onClick={onOpenSettings}
          >
            Voice settings
          </button>
        </div>
      )}
      {expanded && (
        <div className="answer-strip-editor" id={editorId}>
          <div className="answer-editor-heading">
            <span className="voice-status" role="status">
              {phase === "recording"
                ? `● Listening · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                : phase === "connecting"
                  ? "Connecting microphone…"
                  : phase === "finishing"
                    ? "Finishing transcript…"
                    : phase === "evaluating"
                      ? "Reading your reasoning…"
                      : "Your response"}
            </span>
            <button
              className="text-button"
              aria-label="Collapse response"
              disabled={working}
              onClick={() => setExpanded(false)}
            >
              <Minus size={15} />
            </button>
          </div>
          {history.length > 0 && (
            <div className="voice-followup">
              <span className="eyebrow">Follow-up · {history.length}</span>
              <p>{history.at(-1).feedback.followUp}</p>
              <small>
                This is assisted practice. Rate your original recall honestly.
              </small>
            </div>
          )}
          <label className="voice-transcript-label">
            <textarea
              ref={textarea}
              aria-label="Your spoken answer"
              value={text}
              onChange={(e) => changeText(e.target.value)}
              maxLength={12000}
              disabled={working || !ready}
              rows={2}
              placeholder={
                card.kind === "math"
                  ? "Explain your approach, calculation and units…"
                  : "Start with the main idea, then give an example…"
              }
            />
          </label>
          <div className="voice-actions">
            {phase === "recording" ? (
              <button className="voice-stop" onClick={stop}>
                <Square size={14} /> Stop recording
              </button>
            ) : (
              <button
                disabled={working || !status?.configured || !ready}
                onClick={start}
              >
                <Mic size={15} />
                {text ? "Continue dictating" : "Start dictation"}
              </button>
            )}
            <button
              className="primary"
              aria-label="Evaluate answer"
              disabled={
                working || !text.trim() || !status?.configured || !ready
              }
              onClick={evaluate}
            >
              <Sparkles size={15} />
              {phase === "evaluating"
                ? "Evaluating…"
                : revealed
                  ? "Evaluate answer"
                  : "Evaluate & flip"}
            </button>
            {working && phase !== "recording" && (
              <button onClick={cancel}>Cancel</button>
            )}
            {!working && (text || history.length > 0) && (
              <button className="text-button" onClick={reset}>
                <RotateCcw size={14} /> New attempt
              </button>
            )}
          </div>
          <p className="voice-note">
            {revealed || history.length
              ? "Reference seen · assisted practice. "
              : ""}
            {working ? "Audio goes to OpenAI · no audio saved. " : ""}3 min per
            recording · you choose the rating.
          </p>
          {!status?.configured && (
            <button
              className="text-button voice-settings-link"
              onClick={onOpenSettings}
            >
              Connect OpenAI for dictation & feedback
            </button>
          )}
        </div>
      )}
      {feedback && revealed && (
        <div
          className={"voice-feedback verdict-" + feedback.verdict}
          aria-live="polite"
        >
          <button
            className="voice-feedback-summary"
            onClick={() => setFeedbackOpen(!feedbackOpen)}
            aria-expanded={feedbackOpen}
            aria-controls={feedbackId}
          >
            <span>
              <Sparkles size={15} /> {labels[feedback.verdict] || "Feedback"}
            </span>
            <span>
              AI feedback <ChevronDown size={14} />
            </span>
          </button>
          {feedbackOpen && (
            <div className="voice-feedback-body" id={feedbackId}>
              <span className="eyebrow">
                AI feedback · check against the reference
              </span>
              <h3>{labels[feedback.verdict] || "Feedback"}</h3>
              <p>{feedback.summary}</p>
              {feedback.strengths?.length > 0 && (
                <div>
                  <h4>What you got</h4>
                  <ul>
                    {feedback.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {feedback.gaps?.length > 0 && (
                <div>
                  <h4>What to revisit</h4>
                  <ul>
                    {feedback.gaps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {feedback.followUp && history.length < 4 && (
                <button onClick={followUp} disabled={working}>
                  Try a follow-up <ArrowRight size={15} />
                </button>
              )}
              <small>
                Compare with the reference. You choose the recall rating.
              </small>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
