import React, { useEffect, useState } from "react";
import "./learning-connections.css";
export function LearningConnections() {
  const [data, setData] = useState(null),
    [draft, setDraft] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null),
    [learningPreview, setLearningPreview] = useState(null);
  const refresh = async () => {
    const v = await window.recall.learningConnections();
    setData(v);
    setDraft((d) => d || { agent: v.agent, catchUp: v.catchUp });
  };
  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
    const t = setInterval(
      () => refresh().catch((e) => setMessage(e.message)),
      5000,
    );
    return () => clearInterval(t);
  }, []);
  const run = async (fn) => {
    setBusy(true);
    setMessage("");
    try {
      const r = await fn();
      setMessage(r?.error || "Updated.");
      await refresh();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!data || !draft)
    return <p role="status">{message || "Loading connections…"}</p>;
  const scope = draft.catchUp,
    patch = (p) => setDraft({ ...draft, catchUp: { ...scope, ...p } }),
    pending = data.inbox.items.filter(
      (i) => !["ready", "dismissed"].includes(i.status),
    );
  return (
    <section className="settings-group learning-connections">
      <span className="eyebrow">Across your projects</span>
      <h3>Keep the learning. Keep your flow.</h3>
      <p>
        Connect once. Meaningful questions can join your daily Self Test from
        any local project. Existing cards are reused; missing work waits here
        for preparation.
      </p>
      <div className="connection-hosts">
        {["codex", "claude"].map((host) => (
          <div className="setting" key={host}>
            <div>
              <h3>{host === "codex" ? "Codex" : "Claude"}</h3>
              <p>
                {data.hosts[host].connected
                  ? "Connected across projects"
                  : "Not connected"}
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  data.hosts[host].connected
                    ? window.recall.disconnectLearning(host)
                    : setPreview(
                        await window.recall.connectLearning(host, false),
                      ),
                )
              }
            >
              {data.hosts[host].connected ? "Disconnect" : "Connect"}
            </button>
          </div>
        ))}
      </div>
      {preview && (
        <div className="connection-preview">
          <strong>Connect {preview.host}</strong>
          <p>
            Adds a managed instruction and bridge skill, preserving your other
            instructions. Changes are backed up.
          </p>
          <code>{preview.instructions}</code>
          <code>{preview.skill}</code>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await window.recall.connectLearning(preview.host, true);
                setPreview(null);
              })
            }
          >
            Install connection
          </button>{" "}
          <button onClick={() => setPreview(null)}>Cancel</button>
        </div>
      )}
      <label>
        <input
          type="checkbox"
          checked={scope.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />{" "}
        Catch up from local session records
      </label>
      <p>
        Optional. Scan while Recall is open, every five minutes. Only user
        questions and assistant responses enter the inbox; tool output is
        excluded. Preparation sends selected context to your assistant’s
        configured provider.
      </p>
      {scope.enabled && (
        <div className="catchup-scope">
          <label>
            <input
              type="checkbox"
              checked={scope.allProjects}
              onChange={(e) => patch({ allProjects: e.target.checked })}
            />{" "}
            All local projects
          </label>
          {!scope.allProjects && (
            <div>
              <button
                onClick={() =>
                  run(async () => {
                    const p = await window.recall.chooseLearningProject();
                    if (p)
                      patch({ projects: [...new Set([...scope.projects, p])] });
                  })
                }
              >
                Add project
              </button>
              {scope.projects.map((p) => (
                <p key={p}>
                  {p}{" "}
                  <button
                    aria-label={`Remove ${p}`}
                    onClick={() =>
                      patch({ projects: scope.projects.filter((x) => x !== p) })
                    }
                  >
                    Remove
                  </button>
                </p>
              ))}
            </div>
          )}
          <label>
            Starting at (ISO timestamp with timezone)
            <input
              aria-label="Catch-up start"
              value={scope.since}
              onChange={(e) => patch({ since: e.target.value })}
            />
          </label>
          <button
            onClick={() =>
              run(async () => {
                const p = await window.recall.chooseLearningProject();
                if (p) patch({ exclude: [...new Set([...scope.exclude, p])] });
              })
            }
          >
            Exclude a project
          </button>
          {scope.exclude.map((p) => (
            <p key={p}>
              {p}{" "}
              <button
                aria-label={`Include ${p}`}
                onClick={() =>
                  patch({ exclude: scope.exclude.filter((x) => x !== p) })
                }
              >
                Include again
              </button>
            </p>
          ))}
        </div>
      )}
      <label>
        Prepare with{" "}
        <select
          aria-label="Preparation assistant"
          value={draft.agent}
          onChange={(e) => setDraft({ ...draft, agent: e.target.value })}
        >
          <option value="codex">Codex</option>
          <option value="claude">Claude</option>
        </select>
      </label>
      <div className="connection-actions">
        <button
          disabled={busy}
          onClick={() => run(() => window.recall.configureConnections(draft))}
        >
          Save connection settings
        </button>
        <button
          disabled={busy || !data.captureEnabled || !data.catchUp.enabled}
          onClick={() => run(() => window.recall.scanLearning())}
        >
          Check now
        </button>
      </div>
      <div className="learning-inbox">
        <h3>
          Learning inbox <small>{pending.length} waiting</small>
        </h3>
        <p>
          {data.captureEnabled ? "Capture enabled" : "Capture paused"} ·{" "}
          {data.inbox.lastCheckedAt
            ? `Last checked ${new Date(data.inbox.lastCheckedAt).toLocaleString()}`
            : "No catch-up scan yet"}
        </p>
        {data.inbox.remainingFiles > 0 && (
          <p>{data.inbox.remainingFiles} session files still being scanned.</p>
        )}
        {data.inbox.pendingTurns > 0 && (
          <p>
            {data.inbox.pendingTurns} unfinished conversations waiting for a
            final response.
          </p>
        )}
        <p>
          Prepare one item at a time using your signed-in CLI. It may use your
          plan’s usage. Required checks that cannot finish stay visible as
          blocked.
        </p>
        <button
          disabled={
            busy ||
            !data.captureEnabled ||
            !pending.some((i) => i.status === "pending")
          }
          onClick={() =>
            run(async () =>
              setLearningPreview(await window.recall.previewLearning()),
            )
          }
        >
          {busy ? "Working…" : "Prepare next"}
        </button>
        {learningPreview && (
          <div className="connection-preview">
            <strong>{learningPreview.title}</strong>
            <p>
              This sends one captured item, {learningPreview.candidateCount}{" "}
              matching card excerpts and {learningPreview.captureCount}{" "}
              objectives from the same session to your selected assistant.
              Preparation has no shell, browsing or connector tools. New coding
              exercises stay locked until local review.
            </p>
            <details>
              <summary>See the exact learning context</summary>
              <pre
                style={{
                  maxHeight: 300,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {JSON.stringify(learningPreview.payload, null, 2)}
              </pre>
            </details>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await window.recall.prepareLearning(
                    learningPreview.digest,
                  );
                  setLearningPreview(null);
                  return result;
                })
              }
            >
              Prepare this context
            </button>{" "}
            <button disabled={busy} onClick={() => setLearningPreview(null)}>
              Cancel
            </button>
          </div>
        )}
        {pending.length === 0 ? (
          <p>No pending learning.</p>
        ) : (
          <ul>
            {pending.slice(0, 30).map((i) => (
              <li key={i.id}>
                <div>
                  <strong>{i.title}</strong>
                  <span>{i.status}</span>
                </div>
                {i.error && <p>{i.error}</p>}
                {i.status === "blocked" && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => window.recall.retryLearning(i.id))}
                  >
                    Retry
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {pending.length > 30 && (
          <p>
            Showing 30 of {pending.length}. Preparing items clears the queue.
          </p>
        )}
        <p>
          {data.inbox.items.filter((i) => i.status === "ready").length} ready ·{" "}
          {data.inbox.items.filter((i) => i.status === "dismissed").length}{" "}
          checked with no new learning
        </p>
        {data.inbox.issues.map((i, n) => (
          <p role="alert" key={n}>
            {i.source || i.file}: {i.error}
          </p>
        ))}
      </div>
      {(message || data.error) && <p role="status">{message || data.error}</p>}
    </section>
  );
}
