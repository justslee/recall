import React, { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, ShieldCheck } from "lucide-react";

/**
 * One interactive widget from a ```widget fence. The script never runs in the
 * app page: it loads on an explicit click, inside an iframe with only
 * `allow-scripts`, served from recall://widget with its own strict CSP. The only
 * message the host accepts from the frame is its content height.
 */
export function WidgetFrame({ cardId, index, title, allowed, revision = 0 }) {
  const [loaded, setLoaded] = useState(false),
    [height, setHeight] = useState(200),
    [nonce, setNonce] = useState(0);
  const frame = useRef();
  useEffect(() => {
    if (!loaded) return;
    const onMessage = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      const h = Number(e.data?.recallWidget?.height);
      if (Number.isFinite(h) && h > 0)
        setHeight(Math.min(1400, Math.max(96, Math.ceil(h))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loaded]);
  const src = `recall://widget/${encodeURIComponent(cardId)}/${index}?rev=${revision}&n=${nonce}`;
  return (
    <section className="widget" data-widget-index={index}>
      <div className="widget-bar">
        <span className="eyebrow">Interactive</span>
        <strong>{title}</strong>
        {loaded && (
          <button
            className="ghost"
            onClick={() => {
              setHeight(200);
              setNonce(nonce + 1);
            }}
          >
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>
      {!cardId ? (
        <p className="widget-note">
          Interactive widget · save the card, then load it from the card view.
        </p>
      ) : !allowed ? (
        <p className="widget-note">
          Interactive widgets are turned off for this card. Edit the card and
          allow them to run it here.
        </p>
      ) : !loaded ? (
        <div className="widget-gate">
          <button className="primary" onClick={() => setLoaded(true)}>
            <Play size={15} /> Load interactive
          </button>
          <small>
            <ShieldCheck size={13} /> Runs in an isolated sandbox with no file,
            network or library access.
          </small>
        </div>
      ) : (
        <iframe
          // Reset and revisions mount a fresh frame: a loaded frame is never
          // navigated again, and the main process refuses if one tries.
          key={revision + ":" + nonce}
          ref={frame}
          sandbox="allow-scripts"
          src={src}
          title={title}
          style={{ height }}
        />
      )}
    </section>
  );
}
