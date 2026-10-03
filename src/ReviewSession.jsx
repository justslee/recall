import React from "react";
import {
  Pause,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  RotateCcw,
  Check,
} from "lucide-react";
import { scopeText } from "./model";
import { Kbd, Progress } from "./ui";

/** Compact toolbar above the active question: pause, scope, progress. */
export function ReviewToolbar({ session, card, wide, onPause, onToggleWide }) {
  return (
    <>
      <div className="review-toolbar">
        <button className="text-button" onClick={onPause}>
          <Pause size={14} /> Pause session
        </button>
        <span className="scope">{scopeText(session.selection)}</span>
        {card?.kind === "code" && (
          <button className="ghost" onClick={onToggleWide}>
            {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {wide ? "Standard width" : "Full width"}
          </button>
        )}
        <span className="count">
          {session.index + 1} of {session.ids.length}
        </span>
      </div>
      <Progress
        value={session.index}
        max={session.ids.length}
        label="Session progress"
      />
    </>
  );
}

export function ReviewFooter({ busy, onUndo, onSkip }) {
  return (
    <div className="review-footer">
      <span className="keys" aria-hidden="true">
        <span>
          <Kbd>Space</Kbd> reveal
        </span>
        <span>
          <Kbd>1</Kbd>–<Kbd>4</Kbd> rate
        </span>
        <span>
          <Kbd>S</Kbd> skip
        </span>
        <span>
          <Kbd>⌘Z</Kbd> undo
        </span>
        <span>
          <Kbd>Esc</Kbd> pause
        </span>
      </span>
      <button onClick={onUndo} disabled={busy}>
        <RotateCcw size={14} /> Undo last action
      </button>
      <button onClick={onSkip} disabled={busy}>
        Skip without rating <ArrowRight size={14} />
      </button>
    </div>
  );
}

/** Toolbar for browsing a card from the library: back, position, prev/next. */
export function DetailToolbar({
  card,
  wide,
  onToggleWide,
  index,
  total,
  onBack,
  onPrev,
  onNext,
  backLabel = "Back to library",
}) {
  return (
    <div className="review-toolbar">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={14} /> {backLabel}
      </button>
      <span className="scope">Browsing does not record a review</span>
      {card?.kind === "code" && card.code && (
        <button className="ghost" onClick={onToggleWide}>
          {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {wide ? "Standard width" : "Full width"}
        </button>
      )}
      {index >= 0 && (
        <div className="detail-nav">
          <button
            className="ghost"
            aria-label="Previous card"
            disabled={index <= 0}
            onClick={onPrev}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {index + 1} of {total}
          </span>
          <button
            className="ghost"
            aria-label="Next card"
            disabled={index >= total - 1}
            onClick={onNext}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export function DetailFooter({ card, onEdit, onSuspend, onCopyLink }) {
  return (
    <div className="review-footer">
      <button onClick={onEdit}>Edit card</button>
      <button onClick={onCopyLink}>Copy card link</button>
      <button onClick={onSuspend}>
        {card.suspended ? "Resume card" : "Suspend from review"}
      </button>
      <span className="source">{card.source}</span>
    </div>
  );
}

export function Completion({
  session,
  events,
  onBack,
  onUndo,
  onSelfTest,
  busy,
}) {
  const counts = { Again: 0, Hard: 0, Good: 0, Easy: 0 };
  for (const e of events) if (e.rating in counts) counts[e.rating]++;
  const rated = session?.rated || 0,
    skipped = session?.skipped || 0;
  const isSelfTest = !!session?.selection?.selfTestDay;
  const needsPractice = counts.Again + counts.Hard;
  return (
    <div className="completion">
      <Check size={36} />
      <h2>{isSelfTest ? "This pass is finished." : "Session complete."}</h2>
      <p>
        {rated} {rated === 1 ? "card" : "cards"} reviewed
        {skipped ? ` · ${skipped} skipped` : ""}
      </p>
      {rated > 0 && (
        <div className="rating-summary" aria-label="Ratings in this session">
          {Object.entries(counts).map(([name, n]) => (
            <span key={name}>
              <strong>{n}</strong>
              {name}
            </span>
          ))}
        </div>
      )}
      <p className="muted">
        {session?.selection?.practice
          ? "Practice left review dates unchanged."
          : "Your ratings and next review dates are saved on this Mac."}
      </p>
      {isSelfTest && (
        <p className="muted">
          {needsPractice
            ? `${needsPractice} ${needsPractice === 1 ? "card still needs" : "cards still need"} practice. Finishing a pass does not mean you have mastered them.`
            : "You can revisit this learning day anytime. A completed pass is one checkpoint, not proof of lasting recall."}{" "}
          Due cards return in Study Desk; you can also review this day's cards
          again.
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={isSelfTest ? onSelfTest : onBack}>
          {isSelfTest ? "Back to this learning day" : "Back to study desk"}
        </button>
        {isSelfTest && <button onClick={onBack}>Study desk</button>}
        <button onClick={onUndo} disabled={busy || !rated}>
          <RotateCcw size={14} /> Undo last action
        </button>
      </div>
    </div>
  );
}
