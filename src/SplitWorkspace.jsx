import React, { useRef, useState } from "react";

/** A resize changes space, never the editor's identity or draft. */
export function SplitWorkspace({ problem, editor }) {
  const root = useRef();
  const [share, setShare] = useState(34);
  const clamp = (value) => Math.min(50, Math.max(28, value));
  return (
    <div
      ref={root}
      className="challenge-split"
      style={{ "--problem-share": share + "%" }}
    >
      {problem}
      <div
        className="pane-divider"
        role="separator"
        aria-label="Problem pane width"
        aria-orientation="vertical"
        aria-valuemin={28}
        aria-valuemax={50}
        aria-valuenow={share}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const rect = root.current.getBoundingClientRect();
          setShare(
            clamp(Math.round(((e.clientX - rect.left) / rect.width) * 100)),
          );
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onDoubleClick={() => setShare(34)}
        onKeyDown={(e) => {
          const next = {
            ArrowLeft: share - 2,
            ArrowRight: share + 2,
            Home: 28,
            End: 50,
          }[e.key];
          if (next !== undefined) {
            e.preventDefault();
            setShare(clamp(next));
          }
        }}
      />
      <div className="editor-pane">{editor}</div>
    </div>
  );
}
