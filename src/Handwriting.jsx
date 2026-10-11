import React, { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileImage,
  ImagePlus,
  Link,
  Monitor,
  PencilLine,
  QrCode,
  ShieldCheck,
  Sparkles,
  Square,
  Tablet,
  Unplug,
  X,
} from "lucide-react";
import "./handwriting.css";
import renderMath from "katex/contrib/auto-render";
import { useAppearance } from "./appearance";

const api = window.recall;
const readableError = (error) =>
  (error?.message || String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
const when = (at) =>
  at
    ? new Date(at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not yet connected";
const verdicts = {
  solid: "Well worked through",
  partial: "A useful start",
  needs_work: "Let’s work on this",
  unclear: "Let’s clarify the writing",
};
const categories = {
  arithmetic: "Arithmetic",
  method: "Method",
  concept: "Concept",
  unclear: "Needs clarification",
};
const attemptStates = {
  received: "Received on Mac",
  evaluating: "Evaluating",
  assessed: "Feedback ready",
  completed: "Feedback ready",
  feedback_ready: "Feedback ready",
  interrupted: "Evaluation interrupted · retry when ready",
  cancelled: "Evaluation stopped · work saved",
  failed: "Evaluation needs attention",
  staged: "Earlier chat attachment",
  staged_in_chat: "Earlier chat attachment",
  pasted_unverified: "Earlier paste · completion unverified",
  archived: "Saved on Mac",
  needs_resume: "Saved on Mac",
  copied: "Copied · paste wherever you’re learning",
  manual_page_tray: "Pages ready · attach in order",
  pasting: "Earlier handoff · pages saved",
  queued: "Waiting for evaluation",
  waiting: "Waiting for Mac",
};
function usePadStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const refresh = async () => {
    if (!api?.padStatus) return null;

    const next = await api.padStatus();
    if (mounted.current) setStatus(next);
    return next;
  };
  useEffect(() => {
    mounted.current = true;
    if (!api?.padStatus)
      return () => {
        mounted.current = false;
      };

    const load = () =>
      refresh().catch((e) => {
        if (mounted.current) setError(readableError(e));
      });
    load();
    const unsubscribe = api.onPadEvent?.(load);
    window.addEventListener("focus", load);
    return () => {
      mounted.current = false;
      unsubscribe?.();
      window.removeEventListener("focus", load);
    };
  }, []);
  return { status, setStatus, error, setError, refresh };
}

function ConnectionState({ status }) {
  const connected = status?.devices?.filter((device) => device.connected) || [];
  const text = !status
    ? "Checking iPad connection…"
    : !status.enabled
      ? "Companion off"
      : connected.length
        ? connected.map((device) => device.name).join(", ")
        : status.devices?.length
          ? "Waiting for iPad"
          : "Pair your iPad";
  return (
    <span
      className={
        "handwriting-state" + (connected.length ? " is-connected" : "")
      }
      role="status"
    >
      <span className="handwriting-state-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

export function HandwritingSettings({ onOpenVoiceSettings }) {
  const { status, setStatus, error, setError, refresh } = usePadStatus();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [pairing, setPairing] = useState(null),
    [model, setModel] = useState(""),
    [modelEdited, setModelEdited] = useState(false),
    [removeId, setRemoveId] = useState(null),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status && !modelEdited) setModel(status.model || "gpt-6-astra");
  }, [status, modelEdited]);
  useEffect(() => {
    if (!pairing) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);
  const run = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };
  const configure = (patch) =>
    run(async () => {
      const previous = status;
      setStatus({ ...status, ...patch });
      try {
        setStatus(await api.padConfigure(patch));
      } catch (error) {
        setStatus(previous);
        throw error;
      }
    });
  const seconds = pairing
    ? Math.max(
        0,
        Math.ceil((new Date(pairing.expiresAt).getTime() - now) / 1000),
      )
    : 0;
  const available = !!api?.padStatus;
  return (
    <>
      <section
        className="settings-group handwriting-settings"
        aria-labelledby="handwriting-settings-title"
      >
        <div className="handwriting-heading">
          <div>
            <Tablet size={24} aria-hidden="true" />
            <div>
              <span className="eyebrow">Paper, without the handoff</span>
              <h3 id="handwriting-settings-title">iPad & handwriting</h3>
              <p>
                Write naturally. Keep every attempt. Send it when you’re ready.
              </p>
            </div>
          </div>
          {available && <ConnectionState status={status} />}
        </div>
        {!available && (
          <p className="handwriting-description">
            This build does not include the handwriting bridge.
          </p>
        )}
        {available && (
          <>
            <div className="handwriting-setting-row">
              <div>
                <strong>Connect Recall Pad</strong>
                <p>
                  A local connection between this Mac and your iPad. Pair once;
                  reconnect automatically on the same network.
                </p>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={status?.enabled === true}
                  disabled={busy || !status}
                  onChange={(e) => configure({ enabled: e.target.checked })}
                />
                Enable companion
              </label>
            </div>
            {status?.enabled && (
              <div className="handwriting-setting-row">
                <div>
                  <strong>Pair your iPad</strong>
                  <p>
                    Open Recall Pad on your iPad and scan the code. Confirm the
                    device here before it can connect.
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setPairing(await api.padPairing());
                      setNow(Date.now());
                    })
                  }
                >
                  <QrCode size={16} />{" "}
                  {pairing ? "New pairing code" : "Pair an iPad"}
                </button>
              </div>
            )}
            {pairing && status?.enabled && (
              <div className="handwriting-pairing">
                <div className="handwriting-pair-heading">
                  <h4>Scan with Recall Pad</h4>
                  <button
                    aria-label="Close pairing code"
                    onClick={() => setPairing(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {seconds > 0 ? (
                  <div className="handwriting-pair-grid">
                    <img
                      className="handwriting-qr"
                      src={pairing.qrDataUrl}
                      alt="Recall Pad pairing QR code"
                    />
                    <div>
                      <ol>
                        <li>
                          Connect your iPad to the same network as this Mac.
                        </li>
                        <li>Open Recall Pad and choose Pair with Mac.</li>
                        <li>Scan this code, then confirm your iPad below.</li>
                      </ol>
                      <small>
                        <Clock3 size={12} /> Expires in{" "}
                        {Math.floor(seconds / 60)}:
                        {String(seconds % 60).padStart(2, "0")}. The code is
                        private and can only be used once.
                      </small>
                    </div>
                  </div>
                ) : (
                  <p role="status">
                    This code expired. Generate a new pairing code to continue.
                  </p>
                )}
              </div>
            )}
            {status?.pendingPairings?.map((request) => (
              <div className="handwriting-request" key={request.id}>
                <p>
                  <strong>{request.name}</strong> wants to pair with this Mac.
                  Approve only if this is your iPad.
                </p>
                <div className="handwriting-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.padConfirmPairing({
                          id: request.id,
                          allow: true,
                        });
                        await refresh();
                        setPairing(null);
                        setNotice(
                          "iPad paired. This device will reconnect automatically.",
                        );
                      })
                    }
                  >
                    <Check size={15} /> Pair this iPad
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.padConfirmPairing({
                          id: request.id,
                          allow: false,
                        });
                        await refresh();
                      })
                    }
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
            {!!status?.devices?.length && (
              <div className="handwriting-devices">
                <h4>Your devices</h4>
                {status.devices.map((device) => (
                  <div className="handwriting-device" key={device.id}>
                    <div>
                      <Tablet size={20} />
                      <div>
                        <strong>{device.name}</strong>
                        <p>
                          {device.connected
                            ? "Connected now"
                            : "Last connected " + when(device.lastSeen)}
                        </p>
                      </div>
                    </div>
                    {removeId === device.id ? (
                      <div className="handwriting-remove-confirm">
                        <span>Disconnect this iPad?</span>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api.padRevokeDevice(device.id);
                              setRemoveId(null);
                              await refresh();
                              setNotice(
                                "Device removed. Its saved iPad work stays on the iPad; reconnecting requires pairing again.",
                              );
                            })
                          }
                        >
                          Remove device
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setRemoveId(null)}
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setRemoveId(device.id)}>
                        <Unplug size={14} /> Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="handwriting-setting-row">
              <div>
                <strong>Keep the receiver ready</strong>
                <p>
                  When the companion is enabled, closing Recall’s window keeps
                  the receiver running. Quit Recall to stop it.
                </p>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={status?.loginAtStartup === true}
                  disabled={busy || !status}
                  onChange={(e) =>
                    configure({ loginAtStartup: e.target.checked })
                  }
                />{" "}
                Open at login
              </label>
            </div>
            <PaperAssistantConnections />
            <div className="handwriting-setting-row">
              <div>
                <strong>Handwriting feedback</strong>
                <p>
                  Your selected pages, question and reference go to OpenAI only
                  when you send for feedback. Your review rating stays yours.
                </p>
              </div>
              {onOpenVoiceSettings && (
                <button onClick={onOpenVoiceSettings}>OpenAI settings</button>
              )}
            </div>
            <form
              className="handwriting-model-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  setStatus(await api.padConfigure({ model: model.trim() }));
                  setModelEdited(false);
                  setNotice(
                    "Handwriting model saved. Recall does not silently substitute another model.",
                  );
                });
              }}
            >
              <label>
                Handwriting assessment model
                <input
                  aria-label="Handwriting assessment model"
                  value={model}
                  disabled={!status || busy}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setModelEdited(true);
                  }}
                  spellCheck={false}
                />
              </label>
              <button
                type="submit"
                disabled={busy || !model.trim() || !modelEdited}
              >
                Save model
              </button>
            </form>
            <div className="handwriting-setting-row">
              <label>
                <input
                  type="checkbox"
                  checked={status?.assessmentConsent === true}
                  disabled={busy || !status}
                  onChange={(e) =>
                    configure({ assessmentConsent: e.target.checked })
                  }
                />{" "}
                Allow explicit handwriting submissions to OpenAI
              </label>
            </div>
            <details className="handwriting-privacy">
              <summary>
                <ShieldCheck size={14} /> Privacy & connection
              </summary>
              <p>
                Questions and your drawings travel over an authenticated local
                connection. Solutions and API credentials stay on this Mac. Your
                iPad can write and save offline; it transfers when the apps
                reconnect.
              </p>
              <p>
                Assessment requires internet and an OpenAI API account with
                billing. Your ChatGPT subscription is separate. Recall backups
                include work and feedback, but exclude pairing credentials and
                API keys.
              </p>
              <p>
                The native iPad app needs a separate installation. Its source
                and setup instructions are included with Recall; a real-device
                test is required before relying on the companion.
              </p>
            </details>
          </>
        )}
        {notice && (
          <p className="handwriting-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="handwriting-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {available && <TutorPadSettings />}
    </>
  );
}

function WorkPage({
  attemptId,
  index,
  copy = false,
  onPreview,
  onError,
  onCopied,
}) {
  const [page, setPage] = useState(null);
  useEffect(() => {
    let live = true;
    api
      .paperPage(attemptId, index)
      .then((next) => {
        if (live) setPage(next);
      })
      .catch((error) => {
        if (live) onError?.(readableError(error));
      });
    return () => {
      live = false;
    };
  }, [attemptId, index]);
  return (
    <figure>
      {page ? (
        <button
          className="handwriting-page-preview"
          aria-label={"Preview page " + (index + 1)}
          onClick={() => onPreview(page)}
        >
          <img src={page.url} alt={"Handwritten work, page " + (index + 1)} />
        </button>
      ) : (
        <div className="handwriting-page-loading">
          Loading page {index + 1}…
        </div>
      )}
      <figcaption>
        Page {index + 1}
        {page?.name ? " · " + page.name : ""}
      </figcaption>
      {copy && (
        <button
          onClick={async () => {
            try {
              await api.tutorCopyPage({ attemptId, index });
              onCopied?.(
                "Page " +
                  (index + 1) +
                  " copied. Paste it into any chat or app.",
              );
            } catch (error) {
              onError?.(readableError(error));
            }
          }}
        >
          <Copy size={12} /> Copy page
        </button>
      )}
    </figure>
  );
}

function FeedbackText({ text }) {
  const element = useRef(null);
  useEffect(() => {
    element.current.replaceChildren(
      document.createTextNode(String(text || "")),
    );
    renderMath(element.current, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
      trust: false,
    });
  }, [text]);
  return <span ref={element} />;
}

function Feedback({ value, onPage }) {
  return (
    <div className="handwriting-feedback">
      <div className="handwriting-feedback-heading">
        <Sparkles size={17} />
        <h4>{verdicts[value.verdict] || "Your feedback"}</h4>
      </div>
      <p>
        <FeedbackText text={value.summary} />
      </p>
      {!!value.strengths?.length && (
        <>
          <h5>What you demonstrated</h5>
          <ul>
            {value.strengths.map((item, index) => (
              <li key={index}>
                <FeedbackText text={item} />
              </li>
            ))}
          </ul>
        </>
      )}
      {value.firstMistake && (
        <>
          <h5>First step to revisit</h5>
          <p>
            <button
              className="text-button handwriting-page-link"
              onClick={() => onPage(value.firstMistake.page)}
            >
              Page {value.firstMistake.page}
            </button>
            {value.firstMistake.expression && (
              <>
                <strong>
                  <FeedbackText text={value.firstMistake.expression} />
                </strong>
                {" — "}
              </>
            )}
            <FeedbackText text={value.firstMistake.explanation} />
          </p>
        </>
      )}
      {!!value.findings?.length && (
        <>
          <h5>Look a little closer</h5>
          <ul>
            {value.findings.map((item, index) => (
              <li key={index}>
                <button
                  className="text-button handwriting-page-link"
                  onClick={() => onPage(item.page)}
                >
                  Page {item.page}
                </button>
                <strong>{categories[item.category] || "Review"}</strong>
                {item.expression && (
                  <>
                    <span> · </span>
                    <FeedbackText text={item.expression} />
                  </>
                )}
                {" — "}
                <FeedbackText text={item.explanation} />
              </li>
            ))}
          </ul>
        </>
      )}
      {value.followUp && (
        <div className="handwriting-hint">
          <h5>Try this next</h5>
          <p>
            <FeedbackText text={value.followUp} />
          </p>
        </div>
      )}
      <p className="handwriting-assessment-state">
        Feedback helps you practice. Reveal the worked solution and choose your
        review rating when you’re ready.
      </p>
    </div>
  );
}

function PagePreview({ value, onClose }) {
  const closeButton = useRef(null);
  const previousFocus = useRef(null);
  useEffect(() => {
    if (!value) return;

    previousFocus.current = document.activeElement;
    closeButton.current?.focus();
    const handle = (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handle, true);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", handle, true);
      previousFocus.current?.focus?.();
    };
  }, [!!value]);
  if (!value) return null;

  return (
    <div
      className="handwriting-preview"
      role="dialog"
      aria-modal="true"
      aria-label="Handwritten page preview"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="handwriting-preview-heading">
        <strong>{value.name || "Your handwritten work"}</strong>
        <button
          ref={closeButton}
          onClick={onClose}
          aria-label="Close page preview"
        >
          <X size={17} /> Close
        </button>
      </div>
      <img src={value.url} alt="Full handwritten page" />
    </div>
  );
}

function Attempt({
  value,
  number,
  canEvaluate,
  busy,
  onEvaluate,
  onCancel,
  onPreview,
  onError,
  tutor,
  onCopied,
}) {
  const evaluating = value.status === "evaluating";
  const pageCount = Math.min(20, value.pageCount || 0);
  const page = async (oneBased) => {
    try {
      onPreview(await api.paperPage(value.id, oneBased - 1));
    } catch (error) {
      onError(readableError(error));
    }
  };
  return (
    <section
      className="handwriting-attempt"
      aria-label={"Paper attempt " + number}
    >
      <div className="handwriting-attempt-heading">
        <div>
          <strong>{tutor ? "Tutor sheet" : "Attempt " + number}</strong>
          <p>
            {when(value.createdAt)} · {pageCount}{" "}
            {pageCount === 1 ? "page" : "pages"} ·{" "}
            {value.feedback
              ? "Feedback ready"
              : attemptStates[value.status] || "Work saved"}
          </p>
        </div>
        <div className="handwriting-actions">
          {!tutor &&
            (evaluating ? (
              <button onClick={onCancel}>
                <Square size={13} /> Stop evaluation
              </button>
            ) : (
              <button
                disabled={busy || !canEvaluate}
                onClick={() => onEvaluate(value.id)}
              >
                <Sparkles size={14} />{" "}
                {value.feedback ||
                ["failed", "interrupted", "cancelled"].includes(value.status)
                  ? "Evaluate again"
                  : "Evaluate my work"}
              </button>
            ))}
        </div>
      </div>
      <div className="handwriting-pages">
        {Array.from({ length: pageCount }, (_, index) => (
          <WorkPage
            key={index}
            attemptId={value.id}
            index={index}
            onPreview={onPreview}
            onError={onError}
            copy={tutor}
            onCopied={onCopied}
          />
        ))}
      </div>
      {value.error && (
        <p className="handwriting-error" role="alert">
          {typeof value.error === "string"
            ? value.error
            : value.error.message ||
              "Assessment could not finish. Your work is saved; retry when ready."}
        </p>
      )}
      {value.feedback && !tutor && (
        <Feedback value={value.feedback} onPage={page} />
      )}
      {!tutor && value.assessments?.length > 1 && (
        <details className="handwriting-assessment-history">
          <summary>Earlier feedback · {value.assessments.length - 1}</summary>
          {value.assessments.slice(1).map((assessment) => (
            <section key={assessment.id}>
              <p className="handwriting-assessment-state">
                {when(assessment.createdAt)} · {assessment.model} ·{" "}
                {attemptStates[assessment.status] || "Saved feedback"}
              </p>
              {assessment.feedback && (
                <Feedback value={assessment.feedback} onPage={page} />
              )}
              {assessment.error && (
                <p className="handwriting-error">{assessment.error}</p>
              )}
            </section>
          ))}
        </details>
      )}
    </section>
  );
}

function SavedAttempt({ value, number, initiallyOpen = false, ...props }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      className="handwriting-saved-attempt"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {value.mode === "tutor" ? "Tutor sheet" : "Attempt " + number} ·{" "}
        {when(value.createdAt)} · {value.pageCount}{" "}
        {value.pageCount === 1 ? "page" : "pages"}
      </summary>
      {open && <Attempt value={value} number={number} {...props} />}
    </details>
  );
}

export function HandwritingAnswer({
  card,
  studyContext,
  onOpenSettings,
  children,
}) {
  const { status, setStatus, refresh } = usePadStatus();
  const [attempts, setAttempts] = useState([]),
    [expanded, setExpanded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState(null),
    [consentAttempt, setConsentAttempt] = useState(null),
    [dragging, setDragging] = useState(false),
    [olderOpen, setOlderOpen] = useState(false);
  const inputId = useId();
  const alive = useRef(true);
  const cardId = card.id;
  const load = async () => {
    const next = await api.paperAttempts(cardId);
    if (alive.current) setAttempts(next);
  };
  useEffect(() => {
    alive.current = true;
    if (!api?.paperAttempts)
      return () => {
        alive.current = false;
      };

    const update = () =>
      load().catch((e) => {
        if (alive.current) setError(readableError(e));
      });
    update();
    const unsubscribe = api.onPadEvent?.((event) => {
      if (event?.type === "attempt" || event?.type === "status") update();
    });
    return () => {
      alive.current = false;
      unsubscribe?.();
    };
  }, [cardId]);
  if (!api?.paperAttempts || !["math", "concept"].includes(card.kind))
    return children ? children({ tools: null, content: null }) : null;

  const run = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(readableError(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const importFiles = (items) =>
    run(async () => {
      const files = Array.from(items).filter((file) =>
        ["image/png", "image/jpeg", "image/webp"].includes(file.type),
      );
      if (!files.length)
        throw new Error("Add a PNG, JPEG or WebP image of your work.");
      if (files.length > 20)
        throw new Error(
          "One attempt can include up to 20 pages. Send long work in smaller parts.",
        );
      if (
        files.some((file) => file.size > 12 * 1024 * 1024) ||
        files.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024
      )
        throw new Error(
          "Each page can be up to 12 MB, with 64 MB per attempt. Your files have not been changed.",
        );

      await api.paperImport({
        cardId,
        pages: await Promise.all(
          files.map(async (file) => ({
            name: file.name || "Pasted page.png",
            mime: file.type,
            bytes: await file.arrayBuffer(),
          })),
        ),
      });
      if (!alive.current) return;

      setExpanded(true);
      await load();
      setNotice(
        "Attempt saved on this Mac. Choose Evaluate my work when you’re ready.",
      );
    });
  const evaluate = (attemptId) => {
    if (!status?.assessmentConsent) {
      setConsentAttempt(attemptId);
      return;
    }

    run(async () => {
      await api.paperEvaluate({ attemptId });
      await load();
      await refresh();
    });
  };
  const consent = () =>
    run(async () => {
      const attemptId = consentAttempt;
      setStatus(await api.padConfigure({ assessmentConsent: true }));
      setConsentAttempt(null);
      await api.paperEvaluate({ attemptId });
      await load();
      await refresh();
    });
  const sorted = [...attempts].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  const attemptProps = {
    canEvaluate: !status?.assessmentBusy,
    busy,
    onEvaluate: evaluate,
    onPreview: setPreview,
    onError: setError,
    onCancel: () =>
      run(async () => {
        await api.paperCancelAssessment();
        await load();
        await refresh();
      }),
  };
  const openPad = () => {
    if (!status?.enabled) {
      onOpenSettings?.();
      return;
    }

    run(async () => {
      await api.padStartStudy({
        cardId,
        sessionId: studyContext?.sessionId,
        cardIds: studyContext?.cardIds || [cardId],
      });
      await refresh();
      setNotice(
        status.devices?.length
          ? "This question is ready on your iPad. Your earlier work stays saved."
          : "Session ready. Pair your iPad in Settings to continue.",
      );
      setExpanded(true);
    });
  };
  const tools = (
    <>
      <button onClick={openPad} disabled={busy}>
        <Tablet size={14} /> Write on iPad
      </button>
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            const attempt = await api.paperAttach(cardId);
            if (attempt && alive.current) {
              setExpanded(true);
              await load();
              setNotice("Attempt saved. Evaluate it when you’re ready.");
            }
          })
        }
      >
        <ImagePlus size={14} /> Attach work
      </button>
      <button
        className="handwriting-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <PencilLine size={14} />{" "}
        {attempts.length ? "Your work · " + attempts.length : "Paper workspace"}
        <ChevronDown size={12} />
      </button>
    </>
  );
  const content = (
    <>
      {expanded && (
        <div className="handwriting-panel">
          {notice && (
            <p className="handwriting-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="handwriting-error" role="alert">
              {error}
            </p>
          )}
          {consentAttempt && (
            <div
              className="handwriting-consent"
              role="region"
              aria-label="Allow handwriting feedback"
            >
              <h4>Send this work for feedback?</h4>
              <p>
                OpenAI receives these pages, this question and its reference.
                Work and feedback stay saved on your Mac. Internet and API
                billing are required; nothing rates or reveals your card.
              </p>
              <div className="handwriting-actions">
                <button className="primary" disabled={busy} onClick={consent}>
                  Allow & evaluate
                </button>
                <button disabled={busy} onClick={() => setConsentAttempt(null)}>
                  Keep local
                </button>
                {onOpenSettings && (
                  <button disabled={busy} onClick={onOpenSettings}>
                    Settings
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="handwriting-upload">
            <label htmlFor={inputId}>
              <FileImage size={15} /> Add pages from this Mac
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={busy}
              onChange={(event) => {
                if (event.target.files.length) importFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <p>
              Drop images here or click this area and paste with ⌘V. Up to 20
              pages per attempt. Images stay local until you choose evaluation.
            </p>
          </div>
          {!sorted.length ? (
            <p className="handwriting-empty">
              A sheet for your reasoning, diagrams or a handwritten explanation.
              Start on your iPad, or add a photo of work you’ve already done.
            </p>
          ) : (
            <div className="handwriting-attempts">
              <Attempt
                value={sorted[0]}
                number={sorted.length}
                {...attemptProps}
              />
              {sorted.length > 1 && (
                <details
                  onToggle={(event) => setOlderOpen(event.currentTarget.open)}
                >
                  <summary>Previous attempts · {sorted.length - 1}</summary>
                  {olderOpen &&
                    sorted
                      .slice(1)
                      .map((attempt, index) => (
                        <SavedAttempt
                          key={attempt.id}
                          value={attempt}
                          number={sorted.length - index - 1}
                          {...attemptProps}
                        />
                      ))}
                </details>
              )}
            </div>
          )}
          {!status?.enabled && onOpenSettings && (
            <p className="handwriting-description">
              <button className="text-button" onClick={onOpenSettings}>
                Connect an iPad
              </button>{" "}
              to send work directly. Local photos and evaluation work
              independently.
            </p>
          )}
        </div>
      )}
      {!expanded && error && (
        <p className="handwriting-error" role="alert">
          {error}
        </p>
      )}
      <PagePreview value={preview} onClose={() => setPreview(null)} />
    </>
  );
  return (
    <section
      className={
        "handwriting-answer" +
        (children ? " handwriting-combined" : "") +
        (expanded ? " is-open" : "") +
        (dragging ? " is-dragging" : "")
      }
      aria-label="Handwritten answer"
      tabIndex={0}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setDragging(false);
      }}
      onDrop={(event) => {
        setDragging(false);
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          importFiles(event.dataTransfer.files);
        }
      }}
      onPaste={(event) => {
        if (event.clipboardData.files.length) {
          event.preventDefault();
          importFiles(event.clipboardData.files);
        }
      }}
    >
      {children ? (
        children({ tools, content })
      ) : (
        <>
          <div className="handwriting-strip-row">
            <div className="handwriting-strip-tools">
              <span className="handwriting-strip-label">Work it out</span>
              {tools}
            </div>
            <ConnectionState status={status} />
          </div>
          {content}
        </>
      )}
    </section>
  );
}

export function TutorPadWorkspace() {
  const appearance = useAppearance();
  useEffect(() => {
    document.title = "Tutor Pad";
  }, []);
  return (
    <div className="app study-index view-tutor-pad">
      <div className="titlebar">
        <span className="titlebar-caption">A little space to think.</span>
        <span className="local">
          <Monitor size={13} /> On your Mac
        </span>
      </div>
      <header className="index-header">
        <div className="index-brand">
          <span>p.</span> Tutor Pad
        </div>
        <div className="index-tools">
          <span className="system-appearance">System · {appearance}</span>
        </div>
      </header>
      <main className="main" style={{ maxWidth: 1020 }}>
        <div className="page-header">
          <div>
            <span className="eyebrow">Your tutor. Your conversation.</span>
            <h1>
              Think on paper.
              <br />
              Keep the conversation.
            </h1>
            <p className="muted" style={{ maxWidth: "66ch", marginTop: 15 }}>
              Work through a problem on your iPad, send the pages to this Mac,
              then copy them into whichever chat or app you’re learning in.
            </p>
          </div>
        </div>
        <TutorPadSettings workspace />
        <footer className="index-footer">
          <span>Tutor Pad · Your writing stays saved.</span>
          <span>Feedback stays in your chat. You press Send.</span>
        </footer>
      </main>
    </div>
  );
}

export function TutorPadSettings({ workspace = false }) {
  const [status, setStatus] = useState(null),
    [attempts, setAttempts] = useState([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null);
  const alive = useRef(true);
  const refresh = async () => {
    const [next, work] = await Promise.all([
      api.tutorStatus(),
      api.paperAttempts(null, "tutor"),
    ]);
    if (alive.current) {
      setStatus(next);
      setAttempts(work.filter((item) => item.mode === "tutor"));
    }
  };
  useEffect(() => {
    alive.current = true;
    if (!api?.tutorStatus)
      return () => {
        alive.current = false;
      };

    const load = () =>
      refresh().catch((e) => {
        if (alive.current) setError(readableError(e));
      });
    load();
    const unsubscribe = api.onPadEvent?.((event) => {
      if (["tutor", "attempt", "status"].includes(event?.type)) load();
    });
    return () => {
      alive.current = false;
      unsubscribe?.();
    };
  }, []);
  const run = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(readableError(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  if (!api?.tutorStatus) return null;

  return (
    <section
      className="settings-group tutor-pad-settings"
      aria-labelledby="tutor-pad-title"
    >
      <span className="eyebrow">
        {workspace
          ? "Your pages, ready to share"
          : "Write here. Learn anywhere."}
      </span>
      <h3 id="tutor-pad-title">
        <PencilLine size={21} />{" "}
        {workspace ? "Your page receiver" : "Tutor Pad"}
      </h3>
      <p className="handwriting-description">
        {workspace
          ? "Choose Send to Mac on your iPad. Copy each page from the tray, paste it into any chat or app, and send when you’re ready."
          : "A simple bridge from your iPad sheet to any conversation. Pages stay saved; the problem and feedback stay wherever you’re learning."}
      </p>
      {!workspace && (
        <div className="handwriting-actions" style={{ marginTop: 14 }}>
          <button
            className="primary"
            onClick={() => run(() => api.tutorOpen())}
            disabled={busy}
          >
            <PencilLine size={15} /> Open Tutor Pad
          </button>
        </div>
      )}
      <div className="handwriting-tutor-status" role="status">
        <strong>
          {!status
            ? "Checking your Mac…"
            : status.manualReady
              ? "Page receiver ready"
              : status.enabled
                ? "Ready to receive your pages"
                : "Local companion is off"}
        </strong>
        <p className="handwriting-description">
          {status?.enabled
            ? "Send your work from the iPad, then use Copy page below. Receiving a sheet leaves your clipboard untouched."
            : "Enable the companion in iPad & handwriting to receive pages. Previously received work stays available here."}
        </p>
      </div>
      {status?.enabled && (
        <div className="handwriting-actions">
          <button
            className="primary"
            disabled={busy || status.manualReady}
            onClick={() =>
              run(async () => {
                setStatus(await api.tutorStart());
                await refresh();
                setNotice(
                  "Page receiver ready. Send your sheet from the iPad; your pages will appear here for copying.",
                );
              })
            }
          >
            {status.manualReady ? <Check size={15} /> : <Link size={15} />}{" "}
            {status.manualReady ? "Receiving pages" : "Start receiving pages"}
          </button>
        </div>
      )}
      {workspace && !attempts.length && (
        <div className="handwriting-upload" style={{ marginTop: 22 }}>
          <strong>Your pages will arrive here</strong>
          <p style={{ marginTop: 8 }}>
            Open Tutor Pad on your iPad and write. Send to Mac keeps each
            submission here, with its pages in order.
          </p>
        </div>
      )}
      {workspace && !!attempts.length && (
        <div className="handwriting-tutor-attempts">
          <h4>Your page tray</h4>
          <div className="handwriting-attempts">
            {attempts.slice(0, 10).map((attempt, index) => (
              <SavedAttempt
                key={attempt.id}
                value={attempt}
                number={index + 1}
                initiallyOpen={index === 0}
                tutor
                busy={busy}
                onPreview={setPreview}
                onError={setError}
                onCopied={setNotice}
              />
            ))}
          </div>
        </div>
      )}
      {notice && (
        <p className="handwriting-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="handwriting-error" role="alert">
          {error}
        </p>
      )}
      <PagePreview value={preview} onClose={() => setPreview(null)} />
    </section>
  );
}

// The active Mac question is authoritative only during an explicit handoff.
// Following a question never reads or changes the card’s reveal/rating state.
function PaperAssistantConnections() {
  const [connection, setConnection] = useState(null),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!api?.paperConnections) return;
    let alive = true;
    api
      .paperConnections()
      .then((value) => {
        if (alive) setConnection(value);
      })
      .catch((error) => {
        if (alive) setMessage(readableError(error));
      });
    return () => {
      alive = false;
    };
  }, []);
  if (!api?.paperConnections) return null;

  const connect = async (host) => {
    setBusy(host);
    setMessage("");
    try {
      await api.paperConnect(host);
      setConnection(await api.paperConnections());
      setMessage(
        "Tools installed. Start a fresh chat and say: Let’s start a paper learning session.",
      );
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="handwriting-setting-row">
      <div>
        <strong>Learn on paper with your tutor</strong>
        <p>
          Start in your chat. Its writing prompt appears on Recall Pad;
          submitted pages return through the tools in that conversation.
          Discussion and hints stay in the chat.
        </p>
        <div className="handwriting-actions">
          {[
            ["codex", "Codex"],
            ["claude", "Claude Code"],
          ].map(([host, label]) => {
            const installed =
              connection?.hosts?.[host]?.registered &&
              connection?.hosts?.[host]?.skillInstalled;
            return (
              <button
                key={host}
                disabled={!!busy}
                onClick={() => connect(host)}
              >
                {installed ? <Check size={14} /> : <Link size={14} />}{" "}
                {busy === host
                  ? "Connecting…"
                  : installed
                    ? `Refresh ${label} tools`
                    : connection?.hosts?.[host]?.disabled
                      ? `Review ${label} setup`
                      : `Connect ${label}`}
              </button>
            );
          })}
        </div>
        <p>
          ChatGPT desktop can reuse the Codex tools on a supported local host.
          Start a fresh chat and check its MCP server list; web chats need a
          separate connection.
        </p>
        {connection && (
          <p className="handwriting-notice">
            {connection.available
              ? "Local connection ready"
              : "Open Recall to receive work"}{" "}
            · first submission verifies the chat connection.
          </p>
        )}
        {(connection?.error || message) && (
          <p role="status">{message || connection.error}</p>
        )}
      </div>
    </div>
  );
}

export function PadStudyFollower({ card, sessionId, cardIds }) {
  const previous = useRef("");
  useEffect(() => {
    if (!api?.padFollowStudy) return;

    const identity = JSON.stringify([card?.id ?? null, sessionId, cardIds]);
    if (previous.current === identity) return;

    previous.current = identity;
    api
      .padFollowStudy({
        cardId: card?.id ?? null,
        sessionId,
        cardIds: cardIds || (card ? [card.id] : []),
      })
      .catch(() => {
        // A receiver failure must never interrupt the Mac study session.
        previous.current = "";
      });
  }, [card?.id, card?.kind, sessionId, JSON.stringify(cardIds)]);
  return null;
}
