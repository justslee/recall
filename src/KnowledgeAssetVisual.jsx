import React, { useEffect, useState } from "react";
import { WidgetFrame } from "./WidgetFrame";
export function KnowledgeAssetVisual({ reference, note, active, assetApi }) {
  const [visual, setVisual] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const input = {
    sourceId: note.sourceId,
    path: note.path,
    asset: reference.asset,
  };
  useEffect(() => {
    let cancelled = false;
    setVisual(null);
    setError("");
    if (!active) return;
    assetApi
      .inspect(input)
      .then((v) => {
        if (!cancelled) setVisual(v);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "This visual is unavailable. The note and original explanation remain saved.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [active, note.sourceId, note.path, note.revision, reference.asset]);
  async function enable() {
    setBusy(true);
    setError("");
    try {
      setVisual(
        await assetApi.enable({
          ...input,
          expectedDigest: visual.digest,
          expectedNoteRevision: visual.noteRevision,
          allowed: true,
        }),
      );
    } catch (e) {
      setError(e.message || "Could not enable this visual.");
    } finally {
      setBusy(false);
    }
  }
  if (!active) return null;
  return (
    <section
      className="knowledge-visual"
      aria-label={visual?.title || "Note visual"}
    >
      {visual?.allowed ? (
        <WidgetFrame
          cardId={visual.id}
          index={0}
          title={visual.title}
          revision={visual.digest}
          allowed={true}
        />
      ) : (
        visual && (
          <div className="widget visual-widget">
            <div className="visual-widget-heading">
              <span className="eyebrow">Interactive exploration</span>
              <strong>{visual.title}</strong>
            </div>
            <div className="widget-gate visual-widget-gate">
              <p>
                Enable this note’s visual, then choose Load when you’re ready.
              </p>
              <button disabled={busy} onClick={enable}>
                {busy ? "Enabling…" : "Enable this visual"}
              </button>
              <small>
                Isolated on this Mac · no files, network or library access
              </small>
            </div>
          </div>
        )
      )}
      {!visual && !error && <p role="status">Preparing visual…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
