import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Check,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  WIDGET_INITIAL_HEIGHT,
  WIDGET_LOAD_TIMEOUT_MS,
  widgetMessage,
} from "./widget-protocol";
import "./WidgetFrame.css";

/** A new card/revision/permission always returns to the explicit Load gate. */
export function WidgetFrame(props) {
  const { cardId, index, allowed, revision = 0 } = props;
  return (
    <WidgetInstance
      key={JSON.stringify([cardId, index, revision, allowed === true])}
      {...props}
      revision={revision}
    />
  );
}

function WidgetInstance({ cardId, index, title, allowed, revision }) {
  const [run, setRun] = useState(null);
  const [status, setStatus] = useState("idle");
  const [failure, setFailure] = useState(null);
  const [height, setHeight] = useState(WIDGET_INITIAL_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const frame = useRef(null);
  const shell = useRef(null);
  const expandControl = useRef(null);
  const loadingStatus = useRef(null);
  const focusAfterLoad = useRef(false);
  const focusReady = useRef(false);
  const statusRef = useRef(status);
  const labelId = useId();
  statusRef.current = status;

  const begin = (moveFocus = false) => {
    focusAfterLoad.current = moveFocus;
    focusReady.current = false;
    statusRef.current = "loading";
    setHeight(WIDGET_INITIAL_HEIGHT);
    setFailure(null);
    setStatus("loading");
    setRun({ instance: crypto.randomUUID() });
  };

  // The same dialog and iframe stay in the same DOM position. Moving the
  // dialog into the native top layer does not recreate the frame or its inputs.
  // Native modal behavior contains focus; the bridge handles Escape from
  // inside the opaque iframe, where key events cannot bubble to this dialog.
  useLayoutEffect(() => {
    const dialog = shell.current;
    if (!expanded) {
      dialog.setAttribute("open", "");
      return;
    }

    const priorFocus = document.activeElement;
    const priorOverflow = document.body.style.overflow;
    dialog.removeAttribute("open");
    dialog.showModal();
    document.body.style.overflow = "hidden";
    expandControl.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      dialog.setAttribute("open", "");
      document.body.style.overflow = priorOverflow;
      if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
    };
  }, [expanded]);

  useEffect(() => {
    if (status !== "loading" || !run) return;
    if (focusAfterLoad.current)
      loadingStatus.current?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => {
      statusRef.current = "error";
      setFailure("timeout");
      setStatus("error");
    }, WIDGET_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [run, status]);

  useLayoutEffect(() => {
    if (status === "ready" && focusReady.current) {
      frame.current?.focus({ preventScroll: true });
      focusReady.current = false;
    }
  }, [status]);

  useLayoutEffect(() => {
    if (!run) return;
    let heightTimer = null;
    let nextHeight = null;
    const queueHeight = (value) => {
      nextHeight = value;
      if (heightTimer !== null) return;
      heightTimer = window.setTimeout(() => {
        heightTimer = null;
        setHeight((previous) =>
          Math.abs(previous - nextHeight) < 3 ? previous : nextHeight,
        );
      }, 80);
    };
    const onMessage = (event) => {
      // sandboxed frames have opaque origins. The exact WindowProxy and fresh
      // instance, not an origin wildcard or a card-supplied identifier, bind it.
      if (event.source !== frame.current?.contentWindow) return;
      const message = widgetMessage(event.data, run.instance);
      if (!message || statusRef.current === "error") return;
      if (message.type === "dismiss") {
        // Escape inside an opaque iframe cannot bubble to the native dialog.
        // This message can only collapse its own expanded visual.
        setExpanded(false);
        return;
      }
      if (message.type === "error") {
        statusRef.current = "error";
        setFailure("runtime");
        setStatus("error");
        return;
      }
      if (message.height !== undefined) queueHeight(message.height);
      if (message.type === "ready" && statusRef.current === "loading") {
        statusRef.current = "ready";
        setStatus("ready");
        if (
          focusAfterLoad.current &&
          document.activeElement === loadingStatus.current
        ) {
          focusReady.current = true;
        }
        focusAfterLoad.current = false;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (heightTimer !== null) window.clearTimeout(heightTimer);
    };
  }, [run]);

  const active = run && (status === "loading" || status === "ready");
  const src = run
    ? `recall://widget/${encodeURIComponent(cardId)}/${index}?rev=${encodeURIComponent(revision)}&instance=${run.instance}`
    : undefined;
  const statusLabel = {
    idle: "Load when you’re ready",
    loading: "Opening visual…",
    ready: "Ready to explore",
    error: "Visual unavailable",
  }[status];

  return (
    <dialog
      ref={shell}
      className={`widget visual-widget${expanded ? " is-expanded" : ""}`}
      data-widget-index={index}
      data-widget-status={status}
      role={expanded ? "dialog" : "group"}
      aria-modal={expanded ? true : undefined}
      aria-labelledby={labelId}
      onCancel={(event) => {
        event.preventDefault();
        setExpanded(false);
      }}
    >
      <div className="widget-bar visual-widget-bar">
        <div className="visual-widget-heading">
          <span className="eyebrow">Interactive exploration</span>
          <strong id={labelId}>{title}</strong>
        </div>
        <div className="visual-widget-actions">
          {status === "ready" && (
            <button
              className="ghost"
              onClick={() => begin(true)}
              title="Restore this visual’s starting values"
            >
              <RotateCcw size={14} aria-hidden="true" /> Reset
            </button>
          )}
          {active && (
            <button
              ref={expandControl}
              className="ghost"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              title={
                expanded
                  ? "Return to the card (Escape)"
                  : "Open a larger workspace"
              }
            >
              {expanded ? (
                <Minimize2 size={14} aria-hidden="true" />
              ) : (
                <Maximize2 size={14} aria-hidden="true" />
              )}
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
          {expanded && !active && (
            <button
              ref={expandControl}
              className="ghost"
              onClick={() => setExpanded(false)}
            >
              <Minimize2 size={14} aria-hidden="true" /> Collapse
            </button>
          )}
        </div>
      </div>
      {!cardId ? (
        <p className="widget-note">
          Save the card to open its interactive visual.
        </p>
      ) : !allowed ? (
        <p className="widget-note">
          Interactive visuals are turned off for this card. Allow them in the
          card editor to explore it.
        </p>
      ) : status === "idle" ? (
        <div className="widget-gate visual-widget-gate">
          <p>Explore the idea by changing its inputs.</p>
          <button className="primary" onClick={() => begin(true)}>
            <Play size={15} aria-hidden="true" /> Load interactive
          </button>
          <small>
            <ShieldCheck size={13} aria-hidden="true" /> Isolated on this Mac ·
            no files, network or library access
          </small>
        </div>
      ) : status === "error" ? (
        <div className="visual-widget-failure" role="alert">
          <AlertCircle size={23} aria-hidden="true" />
          <strong>
            {failure === "timeout"
              ? "This visual didn’t finish opening."
              : "This visual ran into a problem."}
          </strong>
          <p>Your card and review are safe. Retry to start the visual again.</p>
          <button onClick={() => begin(true)}>
            <RotateCcw size={14} aria-hidden="true" /> Retry visual
          </button>
        </div>
      ) : (
        <div
          className="visual-widget-viewport"
          aria-busy={status === "loading"}
        >
          {status === "loading" && (
            <div
              className="visual-widget-loading"
              ref={loadingStatus}
              tabIndex={-1}
              role="status"
            >
              <LoaderCircle size={20} aria-hidden="true" /> Opening your visual…
            </div>
          )}
          <iframe
            // Every run mounts a fresh frame; Expand never changes this key.
            // The main process rejects subsequent navigation in a loaded frame.
            key={run.instance}
            ref={frame}
            sandbox="allow-scripts"
            src={src}
            title={title}
            tabIndex={status === "ready" ? 0 : -1}
            aria-hidden={status !== "ready"}
            style={{
              height,
              visibility: status === "ready" ? "visible" : "hidden",
            }}
          />
        </div>
      )}
      {cardId && allowed && (
        <div className="visual-widget-footer">
          <span
            className={`visual-widget-state state-${status}`}
            role="status"
            aria-live="polite"
          >
            {status === "ready" && <Check size={12} aria-hidden="true" />}
            {statusLabel}
          </span>
          {expanded && <span>Escape to return to the card</span>}
        </div>
      )}
    </dialog>
  );
}
