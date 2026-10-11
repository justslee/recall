import React, { useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import "./notebooks.css";

const when = (value) => (value ? new Date(value).toLocaleString() : "");
const names = {
  pending: "Received · awaiting assistant",
  processing: "Preparing",
  submitted: "Result waiting to apply",
  ready: "Added to Recall",
  dismissed: "Reviewed · no cards needed",
  blocked: "Needs attention",
  received: "Received on Mac",
  added: "Added to Recall",
  reviewed: "Reviewed · no cards needed",
  awaiting_assistant: "Received · awaiting assistant",
  needs_attention: "Needs attention",
  paused: "Capture paused · pages saved",
};
const knowledgeNames = {
  verified: "Verified",
  read_only: "Read-only access",
  blocked: "Needs attention",
  not_needed: "No update needed",
};

export function NotebookIntake({
  items = [],
  issues = [],
  agent,
  hosts,
  captureEnabled,
  busy,
  run,
  onPrompt,
}) {
  const [preview, setPreview] = useState(null);
  const [page, setPage] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const trigger = useRef(null);
  const close = () => {
    requestId.current++;
    setPreview(null);
    setPage(null);
    setLoading(false);
    trigger.current?.focus();
  };
  const showPage = async (item, index) => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const next = await window.recall.notebookPage(
        item.attemptId || item.id,
        index,
      );
      if (current !== requestId.current) return;
      setPreview(item);
      setPage(next);
      setPageIndex(index);
    } catch (e) {
      if (current === requestId.current) setError(e.message);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  };
  if (!items.length && !issues.length) return null;

  return (
    <section
      className="notebook-intake"
      aria-labelledby="notebook-intake-title"
    >
      <div className="notebook-intake-heading">
        <BookOpen size={22} aria-hidden="true" />
        <div>
          <span className="eyebrow">Chosen pages, useful learning</span>
          <h3 id="notebook-intake-title">From your notebooks</h3>
        </div>
      </div>
      <p>
        These are snapshots you chose to send. Your private notebook stays on
        your iPad; later edits are not sent automatically.
      </p>
      {!!issues.length && (
        <p role="alert" className="notebook-intake-error">
          {issues.length} saved notebook snapshots need recovery. Their files
          are preserved; inspect the affected submissions before retrying
          preparation.
        </p>
      )}
      <div className="notebook-intake-list">
        {items.map((item) => {
          const notebook = item.notebook || {};
          const receipt = item.receipt?.notebook || {};
          const status =
            receipt.status || item.status || item.state || "received";
          const finishable = [
            "pending",
            "blocked",
            "received",
            "awaiting_assistant",
            "needs_attention",
            "paused",
          ].includes(status);
          return (
            <article
              key={item.attemptId || item.id}
              className="notebook-intake-row"
            >
              <div>
                <small>
                  {notebook.title || item.notebookTitle || "Notebook"}
                </small>
                <h4>
                  {notebook.noteTitle ||
                    item.noteTitle ||
                    item.title ||
                    "Selected pages"}
                </h4>
                <p>
                  {item.pageCount || item.pages?.length || 0} exported pages ·
                  received {when(item.receivedAt)}
                </p>
                <span className="notebook-receipt" role="status">
                  {names[status] || status}
                  {receipt.processedAt ? ` · ${when(receipt.processedAt)}` : ""}
                </span>
                {item.error && (
                  <p className="notebook-intake-error">{item.error}</p>
                )}
                {!!receipt.knowledge?.length && (
                  <ul className="notebook-knowledge-receipts">
                    {receipt.knowledge.map((receipt, i) => (
                      <li key={i}>
                        {receipt.sourceId || "Knowledge base"}:{" "}
                        {knowledgeNames[receipt.status] || receipt.status}
                        {receipt.reason ? ` — ${receipt.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="connection-actions">
                <button
                  disabled={busy || loading || !item.pageCount}
                  onClick={(event) => {
                    trigger.current = event.currentTarget;
                    showPage(item, 0);
                  }}
                >
                  View pages
                </button>
                {finishable && (
                  <button
                    disabled={
                      busy ||
                      item.unreadable ||
                      !captureEnabled ||
                      !hosts?.[agent]?.connected
                    }
                    onClick={() =>
                      run(async () => {
                        onPrompt(
                          await window.recall.finishLearningWithAssistant(
                            receipt.inboxId ||
                              item.inboxId ||
                              `notebook/${item.attemptId || item.id}`,
                            agent,
                          ),
                        );
                        return {
                          message:
                            "Notebook prompt ready. Copy it into your assistant to review the pages and update your selected knowledge base and cards.",
                        };
                      })
                    }
                  >
                    <ArrowUpRight size={15} aria-hidden="true" /> Finish with
                    assistant
                  </button>
                )}
                {!!(receipt.cardIds || item.cardIds)?.length && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        window.recall.openLearningCard(
                          (receipt.cardIds || item.cardIds)[0],
                        ),
                      )
                    }
                  >
                    Open a card · {(receipt.cardIds || item.cardIds).length}{" "}
                    ready
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="notebook-intake-hint">
        The assistant checks existing concepts and cards first. Knowledge-base
        writes use your configured authoring access. “Received” confirms
        storage; it does not confirm that cards or notes were updated.
      </p>
      {!captureEnabled && (
        <p role="status">
          Learning capture is paused. Your pages are saved; resume capture when
          you want to prepare them.
        </p>
      )}
      {!hosts?.[agent]?.connected && (
        <p role="status">
          Connect {agent === "claude" ? "Claude" : "Codex"} above to finish
          these pages. Your received snapshots stay saved.
        </p>
      )}
      {error && (
        <p role="alert" className="notebook-intake-error">
          {error}
        </p>
      )}
      {preview && (
        <div className="notebook-preview-backdrop" onClick={close}>
          <section
            className="notebook-preview"
            role="dialog"
            aria-modal="true"
            aria-label="Notebook page preview"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "Tab") {
                const buttons = [
                  ...e.currentTarget.querySelectorAll("button:not(:disabled)"),
                ];
                const index = buttons.indexOf(document.activeElement);
                if (
                  buttons.length &&
                  ((e.shiftKey && index <= 0) ||
                    (!e.shiftKey && index === buttons.length - 1))
                ) {
                  e.preventDefault();
                  buttons[e.shiftKey ? buttons.length - 1 : 0].focus();
                }
              }
            }}
          >
            <header>
              <strong>
                {preview.notebook?.noteTitle ||
                  preview.title ||
                  "Notebook pages"}
              </strong>
              <button autoFocus aria-label="Close page preview" onClick={close}>
                <X size={18} />
              </button>
            </header>
            <nav aria-label="Page navigation">
              <button
                disabled={loading || pageIndex === 0}
                onClick={() => showPage(preview, pageIndex - 1)}
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span>
                Page {pageIndex + 1} of{" "}
                {preview.pageCount || preview.pages?.length}
              </span>
              <button
                disabled={
                  loading ||
                  pageIndex + 1 >= (preview.pageCount || preview.pages?.length)
                }
                onClick={() => showPage(preview, pageIndex + 1)}
              >
                Next <ChevronRight size={16} />
              </button>
            </nav>
            {page && (
              <img
                src={page.url}
                alt={`Selected handwritten page ${pageIndex + 1}`}
              />
            )}
            {loading && <p role="status">Loading page…</p>}
          </section>
        </div>
      )}
    </section>
  );
}
