import React from "react";
import { Layers, Brain, Sigma, Code2, ChevronRight } from "lucide-react";
import { plain, formatLabel, dueInfo } from "./model";

export const iconFor = {
  all: Layers,
  concept: Brain,
  math: Sigma,
  code: Code2,
};

/** Keyboard hint. Hidden from the accessible name so button labels stay exact. */
export function Kbd({ children }) {
  return <kbd aria-hidden="true">{children}</kbd>;
}

export function StatusChip({ card, now }) {
  const d = dueInfo(card, now);
  return <span className={"chip " + d.key}>{d.label}</span>;
}

export function Progress({ value, max, label }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span style={{ width: pct + "%" }} />
    </div>
  );
}

export function CardRow({ card, onClick, now }) {
  const Icon = iconFor[card.kind];
  const meta = [card.topic, card.difficulty];
  if (card.tags?.length)
    meta.push(
      card.tags.slice(0, 3).join(", ") + (card.tags.length > 3 ? "…" : ""),
    );
  return (
    <button className="card-row" data-card-id={card.id} onClick={onClick}>
      <span className="row-icon">
        <Icon size={17} />
      </span>
      <span className="row-body">
        <strong>{plain(card.title)}</strong>
        <small>{meta.join(" · ")}</small>
      </span>
      <StatusChip card={card} now={now} />
      <span className="row-format">{formatLabel[card.kind]}</span>
      <ChevronRight size={16} />
    </button>
  );
}

export function EmptyState({ icon: Icon, title, children, actions }) {
  return (
    <div className="empty">
      {Icon && <Icon size={28} />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Toast({ toast, onDismiss }) {
  return (
    <div className="toasts">
      {toast && (
        <div
          className={"toast " + (toast.tone || "notice")}
          role={toast.tone === "error" ? "alert" : "status"}
          key={toast.id}
        >
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                onDismiss();
                toast.action.onClick();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            className="close"
            aria-label="Dismiss notification"
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
