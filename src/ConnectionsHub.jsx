import React, { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { ConnectionIcon } from "./ConnectionIcon";
import { LearningConnections } from "./LearningConnections";
import { KnowledgeSetup } from "./KnowledgeSetup";
import { HandwritingSettings, PaperAssistantConnections } from "./Handwriting";
import { VoiceSettings } from "./VoiceAnswer";
import "./connections-hub.css";
const names = {
  codex: "Codex",
  claude: "Claude",
  knowledge: "Knowledge base",
  paper: "iPad & paper",
  voice: "Speech & feedback",
  queue: "Captured learning",
};
export function ConnectionsHub({
  initialDetail = null,
  voiceFocus,
  onBackToAnswer,
  voiceBackLabel,
  preferences,
}) {
  const [detail, setDetail] = useState(initialDetail),
    [preferencesOpen, setPreferencesOpen] = useState(false),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => setDetail(initialDetail), [initialDetail]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [learning, knowledge, pad, voice] = await Promise.all([
          window.recall.learningConnections(),
          window.recall.knowledgeSources(),
          window.recall.padStatus(),
          window.recall.voiceStatus(),
        ]);
        if (live) {
          setData({ learning, knowledge, pad, voice });
          setError("");
        }
      } catch (e) {
        if (live) setError(e.message);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [detail]);
  const cards = [
    {
      id: "codex",
      title: "Codex",
      text: "Bring learning from any project.",
      status: assistantStatus(data?.learning?.hosts.codex),
    },
    {
      id: "claude",
      title: "Claude",
      text: "Capture questions as you go.",
      status: assistantStatus(data?.learning?.hosts.claude),
    },
    {
      id: "knowledge",
      title: "Your knowledge base",
      text: "Notion, Obsidian, Markdown. One or several.",
      status: data
        ? `${data.knowledge.sources?.length || 0} sources configured`
        : "Checking…",
    },
    {
      id: "paper",
      title: "Write on iPad",
      text: "Pair once. Keep writing, send when ready.",
      status: data
        ? data.pad.devices?.some((d) => d.connected)
          ? "iPad connected"
          : data.pad.devices?.length
            ? "Paired · waiting for iPad"
            : "Set up Recall Pad"
        : "Checking…",
    },
    {
      id: "voice",
      title: "Think out loud",
      text: "One setup for spoken answers and Speak.",
      status: data
        ? data.voice.configured
          ? "API key saved"
          : "Set up speech"
        : "Checking…",
    },
  ];
  return (
    <div className="connections-hub">
      {detail ? (
        <>
          <button
            className="text-button connection-back"
            onClick={() => setDetail(null)}
          >
            <ArrowLeft size={16} /> All connections
          </button>
          <div className="connection-detail-title">
            <span className="eyebrow">ONE STEP AT A TIME</span>
            <h2>{names[detail]}</h2>
          </div>
          {["codex", "claude"].includes(detail) && (
            <>
              {data?.learning?.captureEnabled === false && (
                <div className="preparation-inline">
                  <span>
                    Learning capture is paused. Enable it before verifying a
                    learning receipt.
                  </span>
                  <button
                    onClick={() => {
                      setPreferencesOpen(true);
                      setDetail(null);
                    }}
                  >
                    Capture preferences
                  </button>
                </div>
              )}
              <LearningConnections key={detail} hostFilter={detail} />
              <button
                className="text-button"
                onClick={() => setDetail("queue")}
              >
                View captured learning <ArrowUpRight size={14} />
              </button>
              <details className="connection-preferences">
                <summary>Use {names[detail]} with Recall Pad</summary>
                <p>
                  Paper sessions use the same assistant, with a separate
                  connection for returning your handwritten pages. Installing
                  tools and receiving a page are separate checks.
                </p>
                <PaperAssistantConnections key={detail} hostFilter={detail} />
                <button onClick={() => setDetail("paper")}>
                  Pair or manage your iPad
                </button>
              </details>
            </>
          )}
          {detail === "knowledge" && <KnowledgeSetup />}
          {detail === "queue" && <LearningConnections hideHosts />}
          {detail === "paper" && (
            <HandwritingSettings
              onOpenVoiceSettings={() => setDetail("voice")}
            />
          )}
          {detail === "voice" && (
            <VoiceSettings
              focus={voiceFocus}
              onBack={onBackToAnswer}
              backLabel={voiceBackLabel}
            />
          )}
        </>
      ) : (
        <>
          <div className="connection-hub-heading">
            <span className="eyebrow">MAKE YOURSELF AT HOME</span>
            <h2>Your learning, connected.</h2>
            <p>
              Start with what you use. Everything here is optional; your cards
              work on their own.
            </p>
          </div>
          <div className="connection-hub-grid">
            {cards.map((card) => (
              <button
                key={card.id}
                className={`connection-hub-card connection-${card.id}`}
                onClick={() => setDetail(card.id)}
              >
                <span className="connection-hub-icons">
                  {card.id === "knowledge" ? (
                    ["notion", "obsidian", "markdown"].map((name) => (
                      <ConnectionIcon key={name} name={name} />
                    ))
                  ) : (
                    <ConnectionIcon name={card.id} />
                  )}
                </span>
                <strong>
                  {card.title}
                  <ArrowUpRight size={17} />
                </strong>
                <span>{card.text}</span>
                <small>{card.status}</small>
              </button>
            ))}
          </div>
          <div className="preparation-inline">
            <span>
              <strong>Captured learning</strong> ·{" "}
              {data?.learning?.inbox?.items.filter(
                (i) => !["ready", "dismissed"].includes(i.status),
              ).length || 0}{" "}
              waiting or needing attention
            </span>
            <button onClick={() => setDetail("queue")}>
              Open preparation queue <ArrowUpRight size={14} />
            </button>
          </div>
          <details
            className="connection-preferences"
            open={preferencesOpen}
            onToggle={(e) => setPreferencesOpen(e.currentTarget.open)}
          >
            <summary>Capture preferences & privacy</summary>
            {preferences}
          </details>
          <p className="connection-hub-footnote">
            Connect an assistant for daily capture. Add a knowledge base to keep
            your notes. Paper and speech are ready whenever they fit the way you
            learn.
          </p>
        </>
      )}
      {error && <p role="alert">Couldn’t check all connections: {error}</p>}
    </div>
  );
}
function assistantStatus(host) {
  if (!host) return "Checking…";
  if (host.learning?.state === "verified") return "Learning verified";
  return host.installed || host.connected
    ? "Skills installed · verify learning"
    : "Connect assistant";
}
