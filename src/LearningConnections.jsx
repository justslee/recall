import React, { useEffect, useState } from "react";
import {
  Check,
  Circle,
  Copy,
  Link2,
  Terminal,
  ArrowUpRight,
} from "lucide-react";
import "./learning-connections.css";
const hostName = (host) => (host === "codex" ? "Codex" : "Claude");
function ReadinessRow({ label, text, complete = false, attention = false }) {
  return (
    <li className={attention ? "needs-attention" : ""}>
      {complete ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Circle size={12} aria-hidden="true" />
      )}
      <span>{label}</span>
      <strong>{text}</strong>
    </li>
  );
}
export function LearningConnections() {
  const [data, setData] = useState(null),
    [draft, setDraft] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null),
    [learningPreview, setLearningPreview] = useState(null),
    [verificationHost, setVerificationHost] = useState(null),
    [verificationTopic, setVerificationTopic] = useState(""),
    [assistantPrompt, setAssistantPrompt] = useState(null);
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
      setMessage(r?.error || r?.message || "Updated.");
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
        {["codex", "claude"].map((host) => {
          const readiness = data.hosts[host],
            installed = readiness.installed ?? readiness.connected,
            cli = readiness.cli || {},
            auth = readiness.authentication || { state: "unchecked" },
            learning = readiness.learning || { state: "unchecked" };
          const receiptReady = learning.state === "verified";
          return (
            <article
              className="assistant-connection"
              key={host}
              aria-label={`${hostName(host)} connection`}
            >
              <header>
                <span className="assistant-connection-mark" aria-hidden="true">
                  <Link2 size={18} />
                </span>
                <h4>{hostName(host)}</h4>
                <span
                  className={`connection-badge ${receiptReady ? "is-verified" : ""}`}
                >
                  {receiptReady
                    ? "Learning verified"
                    : installed
                      ? "Skills installed"
                      : "Not installed"}
                </span>
              </header>
              <ul
                className="assistant-readiness"
                aria-label={`${hostName(host)} readiness checks`}
              >
                <ReadinessRow
                  label="Instructions"
                  text={
                    installed
                      ? "Installed for this library"
                      : "Ready to install"
                  }
                  complete={installed}
                />
                <ReadinessRow
                  label="Local CLI"
                  text={
                    !cli.available
                      ? "Not found"
                      : cli.compatible === false
                        ? "Update needed"
                        : cli.version
                          ? `v${cli.version}`
                          : "Found · not checked"
                  }
                  complete={cli.available && cli.compatible === true}
                  attention={cli.compatible === false}
                />
                <ReadinessRow
                  label="CLI sign-in"
                  text={
                    auth.state === "signed-in"
                      ? "CLI reports signed in"
                      : auth.state === "signed-out"
                        ? "Sign-in needed"
                        : auth.state === "unknown"
                          ? "Couldn’t verify"
                          : "Not checked"
                  }
                  complete={auth.state === "signed-in"}
                  attention={auth.state === "signed-out"}
                />
                <ReadinessRow
                  label="Learning receipt"
                  text={
                    receiptReady
                      ? "Received in Recall"
                      : learning.state === "waiting"
                        ? "Waiting for your session"
                        : learning.state === "blocked"
                          ? "Needs attention"
                          : "Not tested"
                  }
                  complete={receiptReady}
                  attention={learning.state === "blocked"}
                />
              </ul>
              {receiptReady && (
                <div className="connection-receipt">
                  {learning.cards.map((card) => (
                    <a
                      key={card.id}
                      href={card.url}
                      onClick={(event) => {
                        event.preventDefault();
                        run(() => window.recall.openLearningCard(card.id));
                      }}
                    >
                      {card.title}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </a>
                  ))}
                </div>
              )}
              {learning.error && (
                <p className="connection-note">{learning.error}</p>
              )}
              <div className="connection-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (installed) {
                        const result =
                          await window.recall.disconnectLearning(host);
                        window.dispatchEvent(
                          new Event("recall-connections-changed"),
                        );
                        return result;
                      }

                      setPreview(
                        await window.recall.connectLearning(host, false),
                      );
                    })
                  }
                >
                  {installed ? "Disconnect" : "Connect"}
                </button>
                {installed && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(() => window.recall.checkLearningReadiness(host))
                      }
                    >
                      <Terminal size={14} aria-hidden="true" /> Check readiness
                    </button>
                    <button
                      disabled={busy || !data.captureEnabled}
                      onClick={() => {
                        setVerificationHost(host);
                        setAssistantPrompt(null);
                        setMessage("");
                      }}
                    >
                      Verify learning
                    </button>
                  </>
                )}
              </div>
              {installed && (
                <p className="connection-note">
                  Start a fresh {hostName(host)} session to load these
                  instructions.
                  {cli.checkedAt && (
                    <>
                      {" "}
                      Last CLI check {new Date(cli.checkedAt).toLocaleString()}.
                    </>
                  )}
                </p>
              )}
            </article>
          );
        })}
      </div>
      <p className="connection-note">
        Installing skills does not prove a session can capture learning. CLI
        sign-in checks make no model request; only a matching card and Self Test
        receipt verify the learning path.
      </p>
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
                window.dispatchEvent(new Event("recall-connections-changed"));
              })
            }
          >
            Install connection
          </button>{" "}
          <button onClick={() => setPreview(null)}>Cancel</button>
        </div>
      )}
      {verificationHost && !assistantPrompt && (
        <div className="connection-preview connection-verification">
          <span className="eyebrow">One small learning check</span>
          <h4>Try it in a fresh {hostName(verificationHost)} session</h4>
          <p>
            Choose something you want to understand. We’ll give you a prompt,
            then watch for its real card and Self Test receipt.
          </p>
          <label>
            A concept to learn{" "}
            <span className="connection-note">(optional)</span>
            <input
              value={verificationTopic}
              maxLength={300}
              placeholder="e.g. When should I use a weighted average?"
              onChange={(e) => setVerificationTopic(e.target.value)}
            />
          </label>
          <div className="connection-actions">
            <button
              disabled={busy || !data.captureEnabled}
              onClick={() =>
                run(async () => {
                  setAssistantPrompt(
                    await window.recall.learningVerificationPrompt(
                      verificationHost,
                      verificationTopic,
                    ),
                  );
                  setVerificationHost(null);
                  return {
                    message:
                      "Prompt ready. Paste it into a fresh assistant session.",
                  };
                })
              }
            >
              Create verification prompt
            </button>
            <button disabled={busy} onClick={() => setVerificationHost(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {assistantPrompt && (
        <div className="connection-preview assistant-handoff">
          <span className="eyebrow">
            Continue with {hostName(assistantPrompt.host)}
          </span>
          <h4>{assistantPrompt.title}</h4>
          <p>
            Copy this into a fresh {hostName(assistantPrompt.host)} session. You
            choose when to send it; Recall keeps the item here until the
            assistant’s validated result arrives.
          </p>
          <details>
            <summary>Review the prompt and selected context</summary>
            <textarea
              aria-label="Assistant handoff prompt"
              value={assistantPrompt.prompt}
              readOnly
              rows={10}
            />
          </details>
          <div className="connection-actions">
            <button
              disabled={busy || !data.captureEnabled}
              onClick={() =>
                run(async () => {
                  await window.recall.copyLearningText(assistantPrompt.prompt);
                  return {
                    message: `Copied. Paste into a fresh ${hostName(assistantPrompt.host)} session.`,
                  };
                })
              }
            >
              <Copy size={15} aria-hidden="true" /> Copy prompt
            </button>
            <button disabled={busy} onClick={() => setAssistantPrompt(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      <details className="connection-catchup">
        <summary>
          Optional catch-up <span>{data.catchUp.enabled ? "On" : "Off"}</span>
        </summary>
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
                        patch({
                          projects: [...new Set([...scope.projects, p])],
                        });
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
                        patch({
                          projects: scope.projects.filter((x) => x !== p),
                        })
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
                  if (p)
                    patch({ exclude: [...new Set([...scope.exclude, p])] });
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
      </details>
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
        <label className="inbox-assistant">
          Prepare or finish with{" "}
          <select
            aria-label="Inbox assistant"
            value={draft.agent}
            disabled={busy}
            onChange={(e) => {
              const agent = e.target.value;
              setDraft({ ...draft, agent });
              run(() => window.recall.configureConnections({ agent }));
            }}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
          <span className="connection-note">
            You can finish blocked checks in a full assistant session.
          </span>
        </label>
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
                  <div className="connection-actions">
                    <button
                      disabled={busy || !data.captureEnabled}
                      onClick={() =>
                        run(() => window.recall.retryLearning(i.id))
                      }
                    >
                      Retry
                    </button>
                    <button
                      disabled={
                        busy ||
                        !data.captureEnabled ||
                        !data.hosts[draft.agent].connected
                      }
                      onClick={() =>
                        run(async () => {
                          setAssistantPrompt(
                            await window.recall.finishLearningWithAssistant(
                              i.id,
                              draft.agent,
                            ),
                          );
                          setVerificationHost(null);
                          return {
                            message:
                              "Assistant prompt ready. No context has been sent.",
                          };
                        })
                      }
                    >
                      <ArrowUpRight size={15} aria-hidden="true" /> Finish with
                      assistant
                    </button>
                  </div>
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
