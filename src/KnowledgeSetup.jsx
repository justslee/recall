import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  FolderOpen,
  Layers,
  LockKeyhole,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import "./knowledge-setup.css";
import { KnowledgeBootstrap } from "./KnowledgeBootstrap";

const providers = [
  {
    type: "markdown",
    title: "Markdown",
    description: "A folder of notes",
    Icon: FileText,
  },
  {
    type: "obsidian",
    title: "Obsidian",
    description: "Your vault or a subfolder",
    Icon: BookOpen,
  },
  {
    type: "notion",
    title: "Notion",
    description: "A page or database",
    Icon: Layers,
  },
];
const provider = (type) => providers.find((item) => item.type === type);
const blank = () => ({ name: "", type: "", write: false });

export function KnowledgeSetup({ onChanged }) {
  const [sources, setSources] = useState([]),
    [launcherReady, setLauncherReady] = useState(false),
    [loaded, setLoaded] = useState(false),
    [draft, setDraft] = useState(null),
    [step, setStep] = useState(0),
    [result, setResult] = useState(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [removeId, setRemoveId] = useState(null),
    [prompt, setPrompt] = useState(null),
    [copied, setCopied] = useState(false),
    [bootstrapOpen, setBootstrapOpen] = useState(false),
    [bootstrapRequestId, setBootstrapRequestId] = useState(null),
    [pendingSetups, setPendingSetups] = useState([]),
    [setupIssues, setSetupIssues] = useState([]);
  const wizardTitle = useRef(null),
    addButton = useRef(null),
    editButtons = useRef(new Map()),
    createButton = useRef(null),
    returnFocus = useRef(null),
    wizardOpen = !!draft;
  useEffect(() => {
    if (wizardOpen) {
      wizardTitle.current?.focus({ preventScroll: true });
      wizardTitle.current?.scrollIntoView({ block: "nearest" });
    } else if (returnFocus.current) {
      const target =
        editButtons.current.get(returnFocus.current.id) || addButton.current;
      target?.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [wizardOpen, step]);
  const refresh = async () => {
    const [value, setups] = await Promise.all([
      window.recall.knowledgeSources(),
      window.recall.knowledgeBootstrapState(),
    ]);
    setSources(value.sources);
    setPendingSetups(setups.requests.filter((item) => item.status !== "ready"));
    setSetupIssues(setups.issues || []);
    setLauncherReady(value.launcherReady === true);
    if (!value.launcherReady) setPrompt(null);
    setLoaded(true);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const update = () => refresh().catch((e) => setError(e.message));
    window.addEventListener("focus", update);
    window.addEventListener("recall-connections-changed", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("recall-connections-changed", update);
    };
  }, []);
  const run = async (action) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (value) => {
    setDraft((old) => ({ ...old, ...value }));
    setResult(null);
    setError("");
  };
  const open = (source) => {
    returnFocus.current = { id: source?.id };
    setDraft(source ? { ...source, write: !!source.write } : blank());
    setStep(source ? 1 : 0);
    setError("");
    setMessage("");
    setResult(null);
    setPrompt(null);
    setRemoveId(null);
  };
  const close = () => {
    setDraft(null);
    setResult(null);
    setError("");
  };
  const chooseFolder = () =>
    run(async () => {
      const selected = await window.recall.knowledgeChooseFolder();
      if (selected) patch(selected);
    });
  const test = () =>
    run(async () => {
      setResult(await window.recall.knowledgeTestSource(draft));
    });
  const save = () =>
    run(async () => {
      const saved = await window.recall.knowledgeSaveSource(
        draft,
        result.testId,
      );
      await refresh();
      close();
      setMessage(
        saved.source.type === "notion"
          ? "Notion scope saved. Verify live access with your connected assistant."
          : "Knowledge source saved. Your existing notes stay in place.",
      );
      await onChanged?.();
    });
  const copy = () =>
    run(async () => {
      await window.recall.copyLearningText(prompt.prompt);
      setCopied(true);
    });
  const selected = draft && provider(draft.type),
    scopeComplete =
      !!draft?.name.trim() &&
      (draft.type === "notion" ? !!draft.scopeId?.trim() : !!draft.root);
  if (bootstrapOpen)
    return (
      <KnowledgeBootstrap
        onChanged={onChanged}
        requestId={bootstrapRequestId}
        onClose={() =>
          run(async () => {
            await refresh();
            setBootstrapOpen(false);
            requestAnimationFrame(() => createButton.current?.focus());
          })
        }
      />
    );

  return (
    <section
      className="settings-group knowledge-setup"
      aria-labelledby="knowledge-title"
    >
      <div className="knowledge-heading">
        <div>
          <span className="eyebrow">Your reference shelf</span>
          <h3 id="knowledge-title">Knowledge sources</h3>
          <p>Give Recall a place to find the ideas you’re learning.</p>
        </div>
        {!draft && (
          <div className="knowledge-heading-actions">
            <button
              ref={createButton}
              className="primary"
              disabled={busy || !loaded}
              onClick={() => {
                setError("");
                setMessage("");
                setPrompt(null);
                setBootstrapRequestId(null);
                setBootstrapOpen(true);
              }}
            >
              <Plus size={16} />
              {sources.length
                ? "Create knowledge base"
                : "Create my first knowledge base"}
            </button>
            <button ref={addButton} disabled={busy} onClick={() => open()}>
              Add knowledge source
            </button>
          </div>
        )}
      </div>
      {!loaded && !error && <p role="status">Loading your sources…</p>}
      {!draft &&
        pendingSetups.map((item) => (
          <div className="knowledge-pending-setup" key={item.id}>
            <BookOpen size={20} aria-hidden="true" />
            <div>
              <strong>{item.name}</strong>
              <p>
                {item.status === "partial"
                  ? "A destination needs attention."
                  : "Finish setup with your connected assistant."}
                {!item.primaryReady
                  ? " Your primary home is still pending."
                  : ""}
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setBootstrapRequestId(item.id);
                setBootstrapOpen(true);
              }}
            >
              Continue setup <ArrowRight size={15} />
            </button>
          </div>
        ))}
      {!draft && setupIssues.length > 0 && (
        <p className="knowledge-error" role="alert">
          {setupIssues.length} setup record{setupIssues.length === 1 ? "" : "s"}{" "}
          could not be read. Your sources and notes are preserved; inspect them
          with your assistant.
        </p>
      )}
      {loaded && !sources.length && !draft && (
        <div className="knowledge-empty">
          <BookOpen size={26} aria-hidden="true" />
          <div>
            <strong>A home for your knowledge</strong>
            <p>
              Start with a new knowledge base, or connect the notes you already
              keep. Choose Markdown, Obsidian or Notion, including more than
              one.
            </p>
          </div>
        </div>
      )}
      {!!sources.length && !draft && (
        <div className="knowledge-source-list">
          {sources.map((source) => {
            const info = provider(source.type),
              Icon = info.Icon;
            return (
              <div className="knowledge-source" key={source.id}>
                <span
                  className={`knowledge-source-icon knowledge-${source.type}`}
                >
                  <Icon size={20} aria-hidden="true" />
                </span>
                <div className="knowledge-source-detail">
                  <strong>{source.name}</strong>
                  <span>
                    {info.title} ·{" "}
                    {source.write ? "Scoped authoring" : "Read-only"}
                  </span>
                  <small>{source.root || source.scopeId}</small>
                  {source.setupGroup && (
                    <small className="knowledge-source-role">
                      {source.setupGroup.role === "primary"
                        ? "Primary home"
                        : source.setupGroup.role === "mirror"
                          ? "Mirror of primary home"
                          : "Reference only"}
                    </small>
                  )}
                  {source.type === "notion" && (
                    <small className="knowledge-assistant-note">
                      {!launcherReady
                        ? "Connect Codex or Claude below first."
                        : source.snapshotCount
                          ? `${source.snapshotCount} cached note${source.snapshotCount === 1 ? "" : "s"} · verify live access in your assistant`
                          : "Needs assistant verification"}
                    </small>
                  )}
                </div>
                <div className="knowledge-source-actions">
                  {source.type === "notion" && launcherReady && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          setPrompt({
                            ...(await window.recall.knowledgeSourcePrompt(
                              source.id,
                            )),
                            name: source.name,
                          });
                          setCopied(false);
                        })
                      }
                    >
                      Verify with assistant
                    </button>
                  )}
                  {source.type === "notion" && !launcherReady && (
                    <button disabled={busy} onClick={() => run(refresh)}>
                      Refresh connection
                    </button>
                  )}
                  <button
                    ref={(node) => {
                      if (node) editButtons.current.set(source.id, node);
                      else editButtons.current.delete(source.id);
                    }}
                    disabled={busy}
                    onClick={() => open(source)}
                  >
                    Edit access
                  </button>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => setRemoveId(source.id)}
                  >
                    Remove
                  </button>
                </div>
                {removeId === source.id && (
                  <div className="knowledge-remove">
                    <p>
                      Disconnect this source? Notes, saved cards and history are
                      kept.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await window.recall.knowledgeRemoveSource(source.id);
                          setRemoveId(null);
                          await refresh();
                          setMessage(
                            "Source disconnected. Your notes and Recall library are kept.",
                          );
                          await onChanged?.();
                        })
                      }
                    >
                      Disconnect source
                    </button>
                    <button disabled={busy} onClick={() => setRemoveId(null)}>
                      Keep source
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {draft && (
        <div className="knowledge-wizard">
          <div className="knowledge-wizard-top">
            <ol aria-label="Setup steps">
              {["Source", "Scope", "Access & check"].map((label, index) => (
                <li
                  key={label}
                  aria-current={step === index ? "step" : undefined}
                  className={index <= step ? "active" : ""}
                >
                  <span>
                    {index < step ? (
                      <Check size={12} aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
            <button
              className="knowledge-close"
              aria-label="Cancel knowledge setup"
              disabled={busy}
              onClick={close}
            >
              <X size={17} />
            </button>
          </div>
          {step === 0 && (
            <>
              <h4 ref={wizardTitle} tabIndex={-1}>
                Where do your notes live?
              </h4>
              <p>Start with one source. You can add others later.</p>
              <div className="knowledge-providers">
                {providers.map(({ type, title, description, Icon }) => (
                  <button
                    key={type}
                    className={`knowledge-provider knowledge-${type}`}
                    aria-pressed={draft.type === type}
                    onClick={() =>
                      patch({
                        type,
                        name:
                          title === "Markdown"
                            ? "My notes"
                            : `${title} knowledge`,
                        root: undefined,
                        selectionId: undefined,
                        scopeId: undefined,
                      })
                    }
                  >
                    <Icon size={25} aria-hidden="true" />
                    <strong>{title}</strong>
                    <span>{description}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h4 ref={wizardTitle} tabIndex={-1}>
                {draft.id
                  ? "Your source, your scope"
                  : `Choose your ${selected.title} scope`}
              </h4>
              <p>
                {draft.type === "notion"
                  ? "Use one page or database you want your assistant to read."
                  : "Choose a dedicated knowledge folder, or a focused part of your vault."}
              </p>
              <label className="knowledge-field">
                Source name
                <input
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              {draft.type === "notion" ? (
                <>
                  <label className="knowledge-field">
                    Notion page or database link
                    <input
                      readOnly={!!draft.id}
                      maxLength={1200}
                      placeholder="Paste a Notion link or page/database ID"
                      value={draft.scopeId || ""}
                      onChange={(e) => patch({ scopeId: e.target.value })}
                    />
                  </label>
                  <div className="knowledge-note">
                    <Layers size={18} aria-hidden="true" />
                    <p>
                      Notion works through your assistant’s connected tools.
                      Recall keeps scoped snapshots locally; there’s no Notion
                      sign-in or token to enter here.
                    </p>
                  </div>
                </>
              ) : (
                <div className="knowledge-folder">
                  <FolderOpen size={22} aria-hidden="true" />
                  <div>
                    <strong>
                      {draft.root
                        ? "Selected folder"
                        : "Choose a knowledge folder"}
                    </strong>
                    <small>
                      {draft.root ||
                        "Only this folder and its non-hidden subfolders will be in scope."}
                    </small>
                  </div>
                  {!draft.id && (
                    <button disabled={busy} onClick={chooseFolder}>
                      {draft.root ? "Change folder" : "Choose folder"}
                    </button>
                  )}
                </div>
              )}
              {draft.id && (
                <small className="knowledge-scope-fixed">
                  To change the provider or scope, add a new source. This keeps
                  existing note identities stable.
                </small>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <h4 ref={wizardTitle} tabIndex={-1}>
                How may your assistant use it?
              </h4>
              <p>
                Reading is enough to ground cards and explanations in your
                notes.
              </p>
              <fieldset className="knowledge-access">
                <legend className="sr-only">Knowledge source access</legend>
                {[
                  {
                    write: false,
                    title: "Read-only",
                    description:
                      "Find and reuse concepts. Leave your notes untouched.",
                    Icon: LockKeyhole,
                  },
                  {
                    write: true,
                    title: "Scoped authoring",
                    description:
                      "Also create or update knowledge notes in this scope.",
                    Icon: ShieldCheck,
                  },
                ].map(({ write, title, description, Icon }) => (
                  <label
                    key={title}
                    className={draft.write === write ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name="knowledge-access"
                      checked={draft.write === write}
                      onChange={() => patch({ write })}
                    />
                    <Icon size={21} aria-hidden="true" />
                    <span>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="knowledge-preflight">
                Testing reads a bounded sample and checks folder permissions. It
                never creates or edits a note. Notion’s live permissions must be
                verified by your connected assistant.
              </p>
              <button disabled={busy} onClick={test}>
                <CheckCircle2 size={16} />
                {busy ? "Checking…" : "Test connection"}
              </button>
              {result && (
                <div
                  className={`knowledge-test ${result.ok ? "success" : "attention"}`}
                  role="status"
                >
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <div>
                    <strong>
                      {result.ok
                        ? result.transport === "assistant"
                          ? "Scope ready for your assistant"
                          : "Local connection checked"
                        : "Needs attention"}
                    </strong>
                    <p>{result.message}</p>
                    {result.limited && (
                      <small>
                        This is a bounded sample, not a complete knowledge-base
                        audit.
                      </small>
                    )}
                    {!!result.issues.length && (
                      <ul>
                        {result.issues.map((issue, i) => (
                          <li key={i}>
                            {issue.path}: {issue.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          <div className="knowledge-wizard-actions">
            {step > (draft.id ? 1 : 0) ? (
              <button disabled={busy} onClick={() => setStep(step - 1)}>
                <ArrowLeft size={15} /> Back
              </button>
            ) : (
              <button disabled={busy} onClick={close}>
                Cancel
              </button>
            )}
            {step < 2 ? (
              <button
                className="primary"
                disabled={busy || (step === 0 ? !draft.type : !scopeComplete)}
                onClick={() => {
                  setError("");
                  setStep(step + 1);
                }}
              >
                Continue <ArrowRight size={15} />
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !result?.ok}
                onClick={save}
              >
                Save source <Check size={15} />
              </button>
            )}
          </div>
        </div>
      )}
      {prompt && !draft && (
        <div className="knowledge-prompt">
          <div>
            <strong>Verify {prompt.name}</strong>
            <button
              className="knowledge-close"
              aria-label="Close verification prompt"
              onClick={() => setPrompt(null)}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            Start a fresh assistant session with Notion connected. This prompt
            checks a real scoped note and brings its snapshot into Recall.
          </p>
          <textarea
            aria-label="Notion verification prompt"
            readOnly
            value={prompt.prompt}
            rows={5}
          />
          <button disabled={busy} onClick={copy}>
            <Copy size={15} />
            {copied ? "Copied" : "Copy verification prompt"}
          </button>
          <button disabled={busy} onClick={() => run(refresh)}>
            Refresh snapshots
          </button>
        </div>
      )}
      {error && (
        <p className="knowledge-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="knowledge-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
