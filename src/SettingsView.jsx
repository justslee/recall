import React, { useEffect, useState } from "react";
import { FolderOpen, DatabaseBackup, Download } from "lucide-react";
import { LearningConnections } from "./LearningConnections";
import { KnowledgeSetup } from "./KnowledgeSetup";
import { useAppearance } from "./appearance";
import { VoiceSettings } from "./VoiceAnswer";

function Setting({ title, description, value, action }) {
  return (
    <div className="setting">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="setting-actions">{action || <small>{value}</small>}</div>
    </div>
  );
}

export function SettingsView({
  folder,
  version,
  onOpenFolder,
  onBackup,
  onExport,
  voiceFocus = false,
  initialSection = "general",
  onBackToAnswer,
  voiceBackLabel,
}) {
  const appearance = useAppearance();
  const [section, setSection] = useState(voiceFocus ? "voice" : initialSection);
  useEffect(() => {
    setSection(voiceFocus ? "voice" : initialSection);
  }, [voiceFocus, initialSection]);
  return (
    <>
      <nav className="settings-tabs" aria-label="Settings sections">
        {[
          ["general", "General"],
          ["voice", "Voice & feedback"],
          ["connections", "Learning connections"],
          ["library", "Library & backups"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div hidden={section !== "voice"}>
        <VoiceSettings
          focus={voiceFocus}
          onBack={onBackToAnswer}
          backLabel={voiceBackLabel}
        />
      </div>
      <div hidden={section !== "connections"}>
        <LearningSettings />
        <KnowledgeSetup />
        <LearningConnections />
      </div>
      <div hidden={section !== "general"}>
        <section className="settings-group">
          <span className="eyebrow">Appearance</span>
          <Setting
            title="Follow your Mac"
            description="Recall switches automatically with macOS. Dark reading surfaces at night, warm paper and sage in the light. Your editor and diagrams follow along."
            value={appearance === "dark" ? "System · Dark" : "System · Light"}
          />
        </section>
      </div>
      <div hidden={section !== "library"}>
        <section className="settings-group">
          <span className="eyebrow">Your library</span>
          <Setting
            title="Local storage"
            description={folder}
            action={
              <button onClick={onOpenFolder}>
                <FolderOpen size={16} /> Open folder
              </button>
            }
          />
          <Setting
            title="Backups & export"
            description="A complete profile backup includes cards, photos, drafts, reviews, learning logs and configuration. External knowledge-base folders and installed language runtimes remain separate."
            action={
              <>
                <button onClick={onBackup}>
                  <DatabaseBackup size={16} /> Back up now
                </button>
                <button onClick={onExport}>
                  <Download size={16} /> Export library
                </button>
              </>
            }
          />
        </section>
      </div>
      <div hidden={section !== "general"}>
        <section className="settings-group">
          <span className="eyebrow">How study works</span>
          <Setting
            title="Spaced repetition"
            description="FSRS with a 90% desired retention target. Each card keeps its own memory history; difficulty labels describe the exercise, not your memory."
            value="Active"
          />
          <Setting
            title="Paper solution assessment"
            description="Attach photos to a math card, compare with its worked solution, or export the assessment packet for Codex. Automatic grading and grade import are upcoming."
            value="Self-review + export"
          />
          <Setting
            title="Interactive widgets"
            description="A card answer can include ```widget blocks and inline SVG figures. Widgets load only when you click, inside a sandboxed frame with no file, network or library access. Cards from imports keep widgets off until you edit the card and allow them."
            value="Sandboxed"
          />
          <Setting
            title="Coding workspace"
            description="Python and C++17 run locally for validated exercises, only when you press Run. Tests, compiler errors, output, stop and time limits are active."
            value="Native execution"
          />
          <Setting
            title="Scientific Python"
            description="Some quant challenges use NumPy in an optional local Python environment. Use recall doctor to check the configured Python runtime. No downloads happen when you open a card."
            value="Optional local runtime"
          />
        </section>
        <section className="settings-group">
          <span className="eyebrow">About</span>
          <Setting
            title="Study Index"
            description="Warm paper, quiet book covers, layered index cards and a matching editor."
            value="Appearance"
          />
          <Setting
            title="Keyboard"
            description="During review: Space or Enter reveals, 1–4 rates, S skips, ⌘Z undoes, Esc pauses. In the library: ⌘F searches; in card details, ← and → move between cards."
            value="Always on"
          />
          <Setting
            title="Release"
            description="Your concepts, math problems and coding challenges stay in one local library."
            value={version}
          />
        </section>
      </div>
    </>
  );
}

function LearningSettings() {
  const [value, setValue] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    window.recall
      .profileInfo()
      .then(setValue)
      .catch((e) => setError(e.message));
  }, []);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await window.recall.configureLearning(value);
      setError("Saved. Captures keep their original learning dates.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-group learning-preferences">
      <div className="learning-preferences-header">
        <span className="eyebrow">Your learning loop</span>
        <h3>Keep what you’re learning.</h3>
        <p>
          Choose where your knowledge lives, then connect an assistant.
          Meaningful learning can join your daily Self Test.
        </p>
      </div>
      {value && (
        <>
          <label>
            <input
              type="checkbox"
              checked={value.captureEnabled}
              onChange={(e) =>
                setValue({ ...value, captureEnabled: e.target.checked })
              }
            />{" "}
            Allow learning capture from my configured skills
          </label>
          <details className="learning-preferences-details">
            <summary>Learning date & privacy</summary>
            <label className="learning-timezone">
              Learning timezone
              <input
                aria-label="Learning timezone"
                value={value.timeZone}
                onChange={(e) =>
                  setValue({ ...value, timeZone: e.target.value })
                }
              />
            </label>
            <p>
              Capture records exposure, not mastery. It never rates a card or
              changes its review schedule. AI preparation uses your chosen
              assistant account; study and storage remain local.
            </p>
          </details>
          <button className="learning-save" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save learning settings"}
          </button>
        </>
      )}
      {error && <p role="status">{error}</p>}
    </section>
  );
}
