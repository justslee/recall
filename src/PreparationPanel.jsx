import React, { useEffect, useState } from "react";
import { ArrowRight, Pause, LoaderCircle } from "lucide-react";
export function PreparationInline({ onOpen }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      window.recall
        .learningConnections()
        .then((v) => {
          if (live) {
            setData(v);
            setError("");
          }
        })
        .catch(() => {
          if (live)
            setError(
              "Preparation status unavailable. Your ready cards remain available.",
            );
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const items =
    data?.inbox?.items.filter(
      (i) => !["ready", "dismissed"].includes(i.status),
    ) || [];
  if (!items.length && !error && !data?.preparation?.running) return null;
  return (
    <div className="preparation-inline">
      <span>
        {error ||
          `${data.preparation?.running ? "Preparing quietly" : "Background queue"} · ${items.filter((i) => i.status !== "blocked").length} waiting · ${items.filter((i) => i.status === "blocked").length} need attention. Study ready cards below.`}
      </span>
      <button onClick={onOpen}>
        View queue <ArrowRight size={14} />
      </button>
    </div>
  );
}
export function PreparationPanel({ data, onRefresh }) {
  const [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const batch = data.preparation || {},
    items = batch.items || [];
  const done = items.filter((i) =>
    ["ready", "dismissed"].includes(i.status),
  ).length;
  const blocked = items.filter((i) => i.status === "blocked").length;
  const waiting = data.inbox.items.filter(
    (i) => i.type !== "notebook" && i.status === "pending",
  ).length;
  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="preparation-panel" aria-label="Background preparation">
      <div>
        <span className="eyebrow">YOUR NEXT SELF TEST</span>
        <h3>Ready when you are.</h3>
        <p>
          Study ready cards now. Missing objectives are prepared quietly in
          batches of up to eight.
        </p>
      </div>
      {items.length > 0 && (
        <div className="preparation-progress" role="status">
          <progress
            value={
              items.filter((i) => !["waiting", "preparing"].includes(i.status))
                .length
            }
            max={items.length}
          />
          <span>
            {done} resolved · {blocked} need attention
            {batch.running
              ? " · Preparing in background"
              : ` · ${batch.status}`}
          </span>
        </div>
      )}
      {batch.message && <p role="status">{batch.message}</p>}
      {batch.running ? (
        <button
          disabled={busy}
          onClick={() => act(() => window.recall.stopPreparation())}
        >
          <Pause size={15} /> Stop preparation
        </button>
      ) : (
        <button
          className="primary"
          disabled={busy || !waiting || !data.captureEnabled}
          onClick={() =>
            act(async () =>
              setPreview(await window.recall.previewPreparation()),
            )
          }
        >
          {busy ? <LoaderCircle size={15} /> : <ArrowRight size={15} />} Prepare{" "}
          {Math.min(waiting, 8)} in background
        </button>
      )}
      {preview && (
        <div className="connection-preview">
          <h4>
            {preview.items.length} captures ·{" "}
            {preview.agent === "claude" ? "Claude" : "Codex"}
          </h4>
          <p>
            The selected questions, matching card excerpts and prior objectives
            go to your assistant account. This uses your plan’s allowance. No
            shell or browsing tools. Matching card excerpts refresh as earlier
            results arrive. You can leave this screen while it runs.
          </p>
          <details>
            <summary>Review selected context</summary>
            <pre>
              {JSON.stringify(
                preview.items.map((i) => ({ title: i.title, ...i.payload })),
                null,
                2,
              )}
            </pre>
          </details>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await window.recall.startPreparation(preview.digest);
                setPreview(null);
              })
            }
          >
            Start background preparation
          </button>
          <button onClick={() => setPreview(null)}>Cancel</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <small>
        Visual checks stay invisible. Items needing independent checks stay in
        the inbox; this never rates cards.
      </small>
    </section>
  );
}
