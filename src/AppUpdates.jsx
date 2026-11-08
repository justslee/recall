import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import "./app-updates.css";

function useUpdateStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let current = true;
    const refresh = () =>
      window.recall
        .updateStatus()
        .then((v) => {
          if (current) setStatus(v);
        })
        .catch(() => {});
    refresh();
    const stop = window.recall.onUpdateEvent((v) => {
      if (current) setStatus(v);
    });
    return () => {
      current = false;
      stop();
    };
  }, []);
  useEffect(() => {
    if (!status?.busy) return;
    let current = true;
    // The replacement starts a fresh process while its detached worker finishes.
    const timer = setInterval(
      () =>
        window.recall
          .updateStatus()
          .then((v) => {
            if (current) setStatus(v);
          })
          .catch(() => {}),
      2000,
    );
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [status?.busy]);
  return [status, setStatus];
}
const phaseLabel = {
  starting: "Getting ready…",
  checking: "Checking the latest release…",
  updating_source: "Updating your selected repository…",
  downloading: "Downloading Recall…",
  verifying: "Verifying the download…",
  ready_to_restart: "Saving and restarting…",
  installing: "Installing in the same location…",
  restarting: "Opening your updated Recall…",
};
function summary(status) {
  const state = status?.state;
  if (!state) return "Get the latest Recall, right here.";
  if (state.error) return state.error;
  if (status.busy) return phaseLabel[state.phase] || "Updating Recall…";
  switch (state.result?.status) {
    case "update_available":
      return `Recall ${state.result.availableVersion} is ready.`;
    case "artifact_check_required":
      return "Your version matches the latest release. Verify it to check the exact build.";
    case "up_to_date":
      return "You’re on the latest verified release.";
    case "upgraded":
      return `You’re now using Recall ${state.result.installedVersion}.`;
    case "newer_local_build":
      return "Your local build is newer. We’ll keep it in place.";
    case "recovery_required":
      return "An earlier update was interrupted. Resume it safely.";
    case "cleanup_pending":
      return "The update is installed. Close the older app, then retry cleanup.";
    default:
      return "Check for the latest Recall.";
  }
}
export function UpdateSettings({ version }) {
  const [status, setStatus] = useUpdateStatus();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const run = async (method) => {
    setError("");
    setPending(true);
    try {
      setStatus(await window.recall[method]());
    } catch (e) {
      setError(
        e.message.replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    } finally {
      setPending(false);
    }
  };
  const result = status?.state?.result?.status;
  const canInstall =
    [
      "update_available",
      "artifact_check_required",
      "recovery_required",
      "cleanup_pending",
    ].includes(result) || !!status?.state?.error;
  const locked = pending || status?.busy;
  const refreshed = status?.connections?.outcomes || [];
  return (
    <section
      className="settings-group recall-updates"
      aria-labelledby="updates-heading"
    >
      <div className="update-heading">
        <span className="update-icon">
          <ArrowDownToLine size={23} />
        </span>
        <div>
          <span className="eyebrow">Always moving forward</span>
          <h3 id="updates-heading">Recall updates</h3>
        </div>
        <span className="update-version">{version}</span>
      </div>
      <p role="status" aria-live="polite">
        {error || summary(status)}
      </p>
      {status?.supported === false ? (
        <p className="update-detail">
          In-app updates work in the signed Mac app. Install the published
          release to use this button; source checkouts keep their build
          workflow.
        </p>
      ) : (
        <div className="update-actions">
          {canInstall && (
            <button
              className="primary"
              disabled={locked}
              onClick={() => run("installUpdate")}
            >
              <ArrowDownToLine size={16} />
              {result === "artifact_check_required"
                ? "Verify & update"
                : "Update & restart"}
            </button>
          )}
          {!canInstall && status?.sourceFolder && (
            <button disabled={locked} onClick={() => run("installUpdate")}>
              Update code & app
            </button>
          )}
          <button
            disabled={locked || !status}
            onClick={() => run("checkUpdate")}
          >
            <RefreshCw size={16} />
            {locked ? "Working…" : "Check for updates"}
          </button>
        </div>
      )}
      <p className="update-detail">
        <ShieldCheck size={15} />
        Your library stays yours. Verified downloads, the same app location, one
        previous version for recovery.
      </p>
      {canInstall && (
        <p className="update-detail">
          Finish recordings, evaluations and paper transfers first. Recall
          reopens when the update is ready.
        </p>
      )}
      {status?.state?.source && (
        <p className="update-detail" role="status">
          {status.state.source.status === "attention"
            ? status.state.source.message
            : "Selected source repository is up to date."}
        </p>
      )}
      {refreshed.length > 0 && (
        <p className="update-detail">
          {refreshed.some((v) => v.status === "attention")
            ? "Some assistant connections need attention in Connections."
            : "Assistant instructions refreshed. Start a fresh Codex or Claude chat."}
        </p>
      )}
      {status?.refreshError && (
        <p className="update-detail" role="status">
          {status.refreshError}
        </p>
      )}
      {status?.state?.result?.cleanupPending && (
        <p className="update-detail">
          An older app is still in use. Close it, then check again to finish
          cleanup.
        </p>
      )}
      <details className="update-source">
        <summary>
          Also update my source code <span>Optional</span>
        </summary>
        <p>
          Choose your existing Recall Git repository once. Updates pull the
          latest main branch without discarding edits or local commits. No
          source build is needed for the downloaded app.
        </p>
        {status?.sourceFolder && (
          <p className="update-path">{status.sourceFolder}</p>
        )}
        <div className="update-actions">
          <button
            disabled={locked || !status?.supported}
            onClick={() => run("chooseUpdateSource")}
          >
            <FolderOpen size={15} />
            {status?.sourceFolder ? "Change repository" : "Choose repository"}
          </button>
          {status?.sourceFolder && (
            <button disabled={locked} onClick={() => run("clearUpdateSource")}>
              Remove
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
export function UpdateProgress({ onOpenSettings }) {
  const [status] = useUpdateStatus(),
    dialog = useRef(null);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem("recall:update-notice"),
  );
  const busy = !!(status?.busy && status?.state?.apply);
  const finished =
    status?.state?.id &&
    status.state.id !== dismissed &&
    status.state.apply &&
    !status.busy;
  useEffect(() => {
    if (busy && !dialog.current.open) dialog.current.showModal();
    else if (!busy && dialog.current.open) dialog.current.close();
  }, [busy]);
  return (
    <>
      <dialog
        ref={dialog}
        className="update-progress"
        aria-labelledby="update-progress-title"
        onCancel={(e) => e.preventDefault()}
      >
        <span className="update-icon">
          <ArrowDownToLine size={27} />
        </span>
        <span className="eyebrow">A fresh chapter</span>
        <h2 id="update-progress-title">Updating Recall</h2>
        <p role="status">
          {phaseLabel[status?.state?.phase] || "Finishing the update…"}
        </p>
        <progress
          max="100"
          value={
            status?.state?.phase === "downloading"
              ? status.state.percent
              : undefined
          }
          aria-label="Update progress"
        />
        <p className="update-detail">
          <Check size={15} />
          Your cards and review history stay in place.
        </p>
        <small>Recall will reopen automatically.</small>
        {["starting", "checking", "downloading", "verifying"].includes(
          status?.state?.phase,
        ) && (
          <button
            className="update-cancel"
            onClick={() =>
              window.recall.cancelUpdate().catch((e) => setError(e.message))
            }
          >
            Cancel update
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </dialog>
      {finished && (
        <aside className="update-notice" role="status">
          <ShieldCheck size={19} />
          <div>
            <strong>
              {status.state.result?.status === "upgraded"
                ? "Recall is updated"
                : "Recall update"}
            </strong>
            <p>{summary(status)}</p>
            {status.state.source?.status === "attention" && (
              <p>
                Your source repository needs attention; your local edits were
                preserved.
              </p>
            )}
            <button onClick={onOpenSettings}>View details</button>
          </div>
          <button
            aria-label="Dismiss update notice"
            onClick={() => {
              localStorage.setItem("recall:update-notice", status.state.id);
              setDismissed(status.state.id);
            }}
          >
            ×
          </button>
        </aside>
      )}
    </>
  );
}
