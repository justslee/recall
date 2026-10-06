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
  PenLine,
  RefreshCw,
  X,
} from "lucide-react";
import "./knowledge-bootstrap.css";

const destinations = [
  {
    type: "markdown",
    title: "Local Markdown",
    description: "Plain files you own. Read them in any editor.",
    Icon: FileText,
  },
  {
    type: "obsidian",
    title: "Obsidian",
    description: "A new vault for connected notes and ideas.",
    Icon: BookOpen,
  },
  {
    type: "notion",
    title: "Notion",
    description: "A new concept database in your workspace.",
    Icon: Layers,
  },
];
const info = (type) => destinations.find((item) => item.type === type);
const initialDraft = () => ({
  requestId: crypto.randomUUID(),
  name: "My Knowledge Base",
  primary: "markdown",
  selected: ["markdown"],
  homes: {},
  mirrors: {},
  authoring: false,
});
const roleText = (role) =>
  role === "primary"
    ? "Primary"
    : role === "reference"
      ? "Reference"
      : "Mirror";
const statusText = (item) =>
  item.status === "ready"
    ? "Created & connected"
    : item.status === "blocked" || item.status === "needs-attention"
      ? "Needs attention"
      : item.status === "remote-created"
        ? "Created remotely; needs verification"
        : "Waiting for your assistant";

export function KnowledgeBootstrap({ onClose, onChanged, requestId }) {
  const [draft, setDraft] = useState(initialDraft),
    [step, setStep] = useState(0),
    [preview, setPreview] = useState(null),
    [created, setCreated] = useState(null),
    [requests, setRequests] = useState([]),
    [prompt, setPrompt] = useState(null),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [launcherReady, setLauncherReady] = useState(false),
    [error, setError] = useState("");
  const heading = useRef(null),
    section = useRef(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    section.current?.scrollIntoView({ block: "start" });
  }, [step, created?.id]);
  const refresh = async () => {
    const state = await window.recall.knowledgeBootstrapState();
    setRequests(state.requests || []);
    setLauncherReady(state.launcherReady === true);
    if (!state.launcherReady) setPrompt(null);
    setCreated((current) =>
      current
        ? state.requests.find((item) => item.id === current.id) || current
        : null,
    );
    return state;
  };
  useEffect(() => {
    const update = () => refresh().catch((e) => setError(e.message));
    refresh()
      .then((state) => {
        if (requestId) {
          const current = state.requests.find((item) => item.id === requestId);
          if (current) setCreated(current);
          else
            setError(
              "This setup could not be found. Its record may need attention.",
            );
        }
      })
      .catch((e) => setError(e.message));
    window.addEventListener("focus", update);
    window.addEventListener("recall-connections-changed", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("recall-connections-changed", update);
    };
  }, [requestId]);
  useEffect(() => {
    if (
      !created?.destinations.some(
        (item) =>
          item.type === "notion" &&
          ["needs-assistant", "remote-created"].includes(item.status),
      )
    )
      setPrompt(null);
  }, [created]);
  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (value) => {
    setDraft((old) => ({ ...old, ...value, authoring: false }));
    setPreview(null);
    setError("");
  };
  const toggle = (type) => {
    const selected = draft.selected.includes(type)
      ? draft.selected.filter((item) => item !== type)
      : [...draft.selected, type];
    patch({
      selected,
      primary: selected.includes(draft.primary)
        ? draft.primary
        : selected[0] || "",
    });
  };
  const homePatch = (type, value) =>
    patch({
      homes: { ...draft.homes, [type]: { ...draft.homes[type], ...value } },
    });
  const choose = (type) =>
    run(async () => {
      const choice = await window.recall.knowledgeBootstrapChooseParent(type);
      if (choice) homePatch(type, choice);
    });
  const folderName = (type) =>
    draft.homes[type]?.folderName ??
    `${draft.name.trim()}-${type === "obsidian" ? "Obsidian" : "Markdown"}`;
  const input = () => ({
    requestId: draft.requestId,
    name: draft.name.trim(),
    primary: draft.primary,
    authoring: draft.authoring,
    destinations: draft.selected.map((type) =>
      type === "notion"
        ? {
            type,
            parentScope: draft.homes[type]?.parentScope?.trim() || "",
            ...(type !== draft.primary
              ? { mirror: draft.mirrors[type] !== false }
              : {}),
          }
        : {
            type,
            ...(type !== draft.primary
              ? { mirror: draft.mirrors[type] !== false }
              : {}),
            selectionId: draft.homes[type]?.selectionId,
            folderName: folderName(type).trim(),
          },
    ),
  });
  const homesReady = draft.selected.every((type) =>
    type === "notion"
      ? !!draft.homes[type]?.parentScope?.trim()
      : !!draft.homes[type]?.selectionId && !!folderName(type).trim(),
  );
  const review = () =>
    run(async () => {
      setPreview(
        await window.recall.knowledgeBootstrapPreview({
          ...input(),
          authoring: false,
        }),
      );
      setDraft((old) => ({ ...old, authoring: false }));
      setStep(2);
    });
  const create = () =>
    run(async () => {
      const result = await window.recall.knowledgeBootstrapCreate(
        input(),
        preview.previewId,
      );
      setCreated(result);
      setPrompt(null);
      await refresh();
      await onChanged?.();
    });
  const showPrompt = (id) =>
    run(async () => {
      const result = await window.recall.knowledgeBootstrapPrompt(id);
      setPrompt(result.prompt);
      setCopied(false);
    });
  const retry = (id) =>
    run(async () => {
      setCreated(await window.recall.knowledgeBootstrapRetry(id));
      await refresh();
      await onChanged?.();
    });
  const selected = destinations.filter((item) =>
    draft.selected.includes(item.type),
  );
  const pending = requests.filter(
    (item) => item.status !== "ready" && item.id !== created?.id,
  );
  return (
    <section
      ref={section}
      className="settings-group knowledge-bootstrap"
      aria-label="Create my first knowledge base"
    >
      <div className="kb-bootstrap-top">
        {!created && (
          <ol aria-label="Creation steps">
            {["Destinations", "Homes", "Review"].map((title, index) => (
              <li
                key={title}
                className={index === step ? "active" : ""}
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? <Check size={12} /> : index + 1}</span>
                {title}
              </li>
            ))}
          </ol>
        )}
        {created && <span className="eyebrow">Your knowledge, your home</span>}
        <button
          className="kb-bootstrap-close"
          aria-label="Close knowledge base creation"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      {!created && step === 0 && (
        <>
          <h4 ref={heading} tabIndex={-1}>
            A home for what you learn.
          </h4>
          <p>
            Start with one destination, or choose several. Keep one primary copy
            and choose which other destinations receive mirrors.
          </p>
          <label className="kb-bootstrap-field">
            Knowledge base name
            <input
              value={draft.name}
              maxLength={80}
              disabled={busy}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <div
            className="kb-bootstrap-destinations"
            aria-label="Knowledge base destinations"
          >
            {destinations.map(({ type, title, description, Icon }) => (
              <button
                key={type}
                className={`kb-bootstrap-destination kb-${type}`}
                aria-pressed={draft.selected.includes(type)}
                disabled={busy}
                onClick={() => toggle(type)}
              >
                <span className="kb-destination-top">
                  <Icon size={23} />
                  <span className="kb-selection-check">
                    {draft.selected.includes(type) && <Check size={13} />}
                  </span>
                </span>
                <strong>{title}</strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
          {selected.length > 1 && (
            <fieldset className="kb-bootstrap-primary">
              <legend>Where should the primary copy live?</legend>
              <div>
                {selected.map(({ type, title }) => (
                  <label
                    key={type}
                    className={draft.primary === type ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      disabled={busy}
                      name="kb-primary"
                      value={type}
                      checked={draft.primary === type}
                      onChange={() => patch({ primary: type })}
                    />
                    {title}
                  </label>
                ))}
              </div>
              <small>
                Assistants update the primary first, then its mirrors. Multiple
                destinations don’t create duplicate Recall cards.
              </small>
              <div className="kb-mirror-options">
                {selected
                  .filter((item) => item.type !== draft.primary)
                  .map(({ type, title }) => (
                    <label key={type}>
                      <input
                        type="checkbox"
                        checked={draft.mirrors[type] !== false}
                        onChange={(e) =>
                          patch({
                            mirrors: {
                              ...draft.mirrors,
                              [type]: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>
                        Mirror notes to {title}
                        <small>
                          Turn off to connect as a read-only reference instead.
                        </small>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          )}
          <div className="kb-bootstrap-actions">
            <small>Choose at least one destination.</small>
            <button
              className="primary"
              disabled={busy || !draft.name.trim() || !selected.length}
              onClick={() => setStep(1)}
            >
              Continue <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
      {!created && step === 1 && (
        <>
          <h4 ref={heading} tabIndex={-1}>
            Choose each home.
          </h4>
          <p>
            Local destinations get new folders. For Notion, your connected
            assistant creates a new concept database under the parent page you
            choose.
          </p>
          <div className="kb-bootstrap-homes">
            {selected.map(({ type, title, Icon }) => (
              <div className={`kb-bootstrap-home kb-${type}`} key={type}>
                <div className="kb-home-heading">
                  <Icon size={20} />
                  <strong>{title}</strong>
                  <span>
                    {roleText(
                      draft.primary === type
                        ? "primary"
                        : draft.mirrors[type] === false
                          ? "reference"
                          : "mirror",
                    )}
                  </span>
                </div>
                {type === "notion" ? (
                  <>
                    <label className="kb-bootstrap-field">
                      Notion parent page link
                      <input
                        placeholder="https://www.notion.so/…"
                        value={draft.homes[type]?.parentScope || ""}
                        disabled={busy}
                        onChange={(e) =>
                          homePatch(type, { parentScope: e.target.value })
                        }
                      />
                    </label>
                    <p className="kb-bootstrap-caption">
                      Choose a page shared with your assistant’s Notion
                      connection. Recall will prepare the setup prompt; it won’t
                      claim live access until the database is created and
                      verified.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="kb-bootstrap-parent">
                      <FolderOpen size={18} />
                      <div>
                        <small>Parent folder</small>
                        <span>
                          {draft.homes[type]?.parent ||
                            "Choose where the new folder should live"}
                        </span>
                      </div>
                      <button disabled={busy} onClick={() => choose(type)}>
                        Choose {type === "obsidian" ? "Obsidian" : "Markdown"}{" "}
                        parent
                      </button>
                    </div>
                    <label className="kb-bootstrap-field">
                      {title} folder name
                      <input
                        value={folderName(type)}
                        disabled={busy}
                        maxLength={100}
                        onChange={(e) =>
                          homePatch(type, { folderName: e.target.value })
                        }
                      />
                    </label>
                    <p className="kb-bootstrap-caption">
                      {type === "obsidian"
                        ? "Creates a new vault with a starter index. Open it in Obsidian after setup."
                        : "Creates a starter index and folders for concepts and assets."}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="kb-bootstrap-actions">
            <button disabled={busy} onClick={() => setStep(0)}>
              <ArrowLeft size={16} /> Back
            </button>
            <button
              className="primary"
              disabled={busy || !homesReady}
              onClick={review}
            >
              {busy ? "Checking destinations…" : "Review creation"}
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
      {!created && step === 2 && preview && (
        <>
          <h4 ref={heading} tabIndex={-1}>
            Ready to build your shelf?
          </h4>
          <p>
            Here’s what will be created for <strong>{preview.name}</strong>.
            Your new knowledge base starts empty, ready for the ideas you
            actually learn.
          </p>
          <div className="kb-bootstrap-review">
            {preview.destinations.map((item) => {
              const { title, Icon } = info(item.type);
              return (
                <div className="kb-review-destination" key={item.type}>
                  <Icon size={21} />
                  <div>
                    <strong>{title}</strong>
                    <span>
                      {item.path || `New database under ${item.parentScope}`}
                    </span>
                    <small>
                      {item.type === "notion"
                        ? "Created by your assistant in the next step"
                        : "Created locally when you continue"}
                    </small>
                  </div>
                  <span className="kb-role">{roleText(item.role)}</span>
                </div>
              );
            })}
          </div>
          <div className="kb-bootstrap-review-note">
            <PenLine size={18} />
            <p>
              One primary copy and one set of Recall cards. Assistants update
              linked mirrors; reference-only destinations stay read-only. These
              updates aren’t automatic cloud syncing.
            </p>
          </div>
          <label
            className={`kb-bootstrap-permission ${draft.authoring ? "selected" : ""}`}
          >
            <input
              type="checkbox"
              checked={draft.authoring}
              disabled={busy}
              onChange={(e) => {
                setDraft((old) => ({ ...old, authoring: e.target.checked }));
                setError("");
              }}
            />
            <PenLine size={19} />
            <span>
              <strong>Let my assistants build this knowledge base</strong>
              <small>
                Allow notes to be added and updated only inside the new primary
                and mirror scopes. Reference destinations stay read-only. You
                can adjust access later.
              </small>
            </span>
          </label>
          <div className="kb-bootstrap-actions">
            <button disabled={busy} onClick={() => setStep(1)}>
              <ArrowLeft size={16} /> Back
            </button>
            <button
              className="primary"
              disabled={busy || !draft.authoring}
              onClick={create}
            >
              {busy ? "Creating…" : "Create knowledge base"}
              <Check size={16} />
            </button>
          </div>
        </>
      )}
      {created && (
        <>
          <h4 ref={heading} tabIndex={-1}>
            {created.status === "ready"
              ? "Your knowledge base is ready."
              : created.destinations.some(
                    (item) =>
                      item.status === "blocked" ||
                      item.status === "needs-attention",
                  )
                ? "Your setup needs a little attention."
                : "One more step for Notion."}
          </h4>
          <p>
            {created.status === "ready"
              ? "Your new scopes are connected. Tell Codex or Claude to save useful learning here and mirror it to your other destinations."
              : created.destinations.some(
                    (item) => item.status === "needs-attention",
                  )
                ? "Review the destinations that need attention. Existing notes and source settings are preserved; reconnect or adjust the existing scope explicitly."
                : "Local destinations are connected when marked below. Notion stays pending until your assistant creates the database and verifies access."}
          </p>
          <div className="kb-bootstrap-review">
            {created.destinations.map((item) => {
              const { title, Icon } = info(item.type);
              return (
                <div className="kb-review-destination" key={item.type}>
                  <Icon size={21} />
                  <div>
                    <strong>
                      {title}{" "}
                      <span className="kb-role-inline">
                        {roleText(item.role)}
                      </span>
                    </strong>
                    <span>
                      {item.path || item.remote?.scopeId || item.parentScope}
                    </span>
                    <small className={`kb-status-${item.status}`}>
                      {item.status === "ready" && <CheckCircle2 size={13} />}
                      {item.type === "notion" && item.status === "ready"
                        ? "Connected from assistant receipt"
                        : statusText(item)}
                      {item.error ? ` · ${item.error}` : ""}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
          {!created.primaryReady && (
            <p className="kb-bootstrap-caption kb-primary-pending">
              Your primary copy isn’t ready yet. Finish or review its setup
              before capturing new notes into this knowledge base.
            </p>
          )}
          {!launcherReady &&
            created.destinations.some(
              (item) =>
                item.type === "notion" &&
                ["needs-assistant", "remote-created"].includes(item.status),
            ) && (
              <div className="kb-bootstrap-connect">
                <p>
                  Connect Codex or Claude below to finish Notion setup. Your
                  pending setup and local folders are saved.
                </p>
                <button disabled={busy} onClick={onClose}>
                  Back to learning connections <ArrowRight size={15} />
                </button>
              </div>
            )}
          <div className="kb-bootstrap-actions kb-bootstrap-result-actions">
            {created.destinations.some(
              (item) =>
                item.type === "notion" &&
                ["needs-assistant", "remote-created"].includes(item.status),
            ) && (
              <button
                className="primary"
                disabled={busy || !launcherReady}
                onClick={() => showPrompt(created.id)}
              >
                Finish Notion with assistant <ArrowRight size={16} />
              </button>
            )}
            {created.destinations.some(
              (item) => item.type !== "notion" && item.status === "blocked",
            ) && (
              <button disabled={busy} onClick={() => retry(created.id)}>
                <RefreshCw size={15} /> Retry local setup
              </button>
            )}
            {created.status !== "ready" && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await refresh();
                    await onChanged?.();
                  })
                }
              >
                <RefreshCw size={15} /> Refresh setup
              </button>
            )}
            <button disabled={busy} onClick={onClose}>
              {created.status === "ready" ? "Done" : "Close for now"}
            </button>
          </div>
        </>
      )}
      {prompt && (
        <div className="kb-bootstrap-prompt">
          <div>
            <strong>Finish in a fresh assistant session</strong>
            <button
              className="kb-bootstrap-close"
              aria-label="Close knowledge base prompt"
              onClick={() => setPrompt(null)}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            Use your assistant’s connected Notion tool. The prompt keeps writes
            inside your chosen scope and asks for a verified result.
          </p>
          <textarea
            aria-label="Knowledge base setup prompt"
            readOnly
            value={prompt}
            rows={7}
          />
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await window.recall.copyLearningText(prompt);
                setCopied(true);
              })
            }
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Copied" : "Copy setup prompt"}
          </button>
          <small>
            Return here and refresh after your assistant finishes. No prompt is
            sent automatically.
          </small>
        </div>
      )}
      {!!pending.length && (
        <div className="kb-bootstrap-pending">
          <strong>Unfinished setups</strong>
          {pending.map((item) => (
            <div key={item.id}>
              <span>
                {item.name}
                <small>
                  {item.status === "partial"
                    ? "Some destinations need attention"
                    : "Waiting for your assistant"}
                </small>
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  setCreated(item);
                  setPrompt(null);
                  setError("");
                }}
              >
                Resume setup
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="kb-bootstrap-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
