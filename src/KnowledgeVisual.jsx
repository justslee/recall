import React, { useState } from "react";
import { KnowledgeAssetVisual } from "./KnowledgeAssetVisual";
import { WidgetFrame } from "./WidgetFrame";
import { resolveKnowledgeVisual } from "./knowledge-visual-model";

export function KnowledgeVisual({
  reference,
  note,
  assetApi,
  cards,
  active,
  onEnable,
  onCard,
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (reference?.asset)
    return (
      <KnowledgeAssetVisual
        key={JSON.stringify([note.sourceId, note.path, reference.asset])}
        reference={reference}
        note={note}
        active={active}
        assetApi={assetApi}
      />
    );
  const visual = reference && resolveKnowledgeVisual(reference, cards);
  if (!visual)
    return (
      <p role="status">
        This interactive visual is unavailable. Its linked card or visual may
        have been removed.
      </p>
    );

  const { card, title } = visual;
  const enable = async () => {
    setBusy(true);
    setError("");
    try {
      await onEnable(card);
    } catch (e) {
      setError(e.message || "Could not enable this visual.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="knowledge-visual" aria-label={title}>
      {active && card.widgetsAllowed === true && (
        <WidgetFrame
          cardId={card.id}
          index={reference.widgetIndex}
          title={title}
          allowed={card.widgetsAllowed === true}
          revision={card.revision || 0}
        />
      )}
      {card.widgetsAllowed !== true && (
        <div className="widget visual-widget">
          <div className="visual-widget-heading">
            <span className="eyebrow">Interactive exploration</span>
            <strong>{title}</strong>
          </div>
          <div className="widget-gate visual-widget-gate">
            <p>
              Enable this linked card’s visuals, then choose Load when you’re
              ready.
            </p>
            {onEnable && (
              <button disabled={busy} onClick={enable}>
                {busy
                  ? "Enabling…"
                  : "Enable interactive visuals for this card"}
              </button>
            )}
            <small>
              Isolated on this Mac · no files, network or library access
            </small>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {onCard && (
        <button className="text-button" onClick={() => onCard(card.id)}>
          Open linked card
        </button>
      )}
    </section>
  );
}
