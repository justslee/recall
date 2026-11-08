---
name: recall-visuals
description: "Create concept-specific interactive HTML/SVG diagrams or clear static figures for Recall cards and Knowledge Base notes. Use when visual explanation clarifies a learning objective."
---

# Visuals

Read [quality.md](../recall-source/references/quality.md), [visuals.md](../recall-source/references/visuals.md) and the current [widget contract](../recall-source/references/widget-contract.md). Check the installed runtime before using `RecallVisual` helpers; toolkit 1.0.0 and host protocol 2 are different versions.

For technical diagrams, use the illustrated style by default unless the user specifies another style or an existing convention carries meaning. Read [illustrated-style.md](../recall-source/references/illustrated-style.md). Its scoped light/dark diagram palette supplements the app tokens; preserve app chrome and the widget runtime boundary.

Compose one explanatory scene around what the learner should notice. Use a coherent state model to drive inputs, graphical marks, annotations and the interpretation together. Use the bundled plot/state/SVG primitives or native HTML/SVG for concept-specific layouts; a shared toolkit is not a reason to turn every answer into the same dashboard. Prefer a clear static figure when interaction adds no learning value.

Validate the mechanism independently, exercise every control and Reset, and inspect actual baseline and changed states in both themes at normal and narrow widths. Verify errors/timeouts, Expand/Collapse state preservation, keyboard access and reduced motion where relevant. Keep a compact scenario/screenshot record with expected and observed outcomes. Successful syntax or import validation is not visual acceptance. If rendering or interaction QA is unavailable, preserve the existing card and deliver a draft with the missing check, rather than claiming it is ready.

Preserve explicit Load and answer reveal. Use the supported scoped visual revision workflow for an authorized replacement under existing card IDs (version 1 widgets; version 2 presentation-only SVG/Mermaid edits, when the installed writer supports it); do not change prose, permissions, reviews or schedules. Show the requested benchmark visuals before proposing a wider migration. Repository examples provide yield-curve, duration-gap and weak-reference compositions; read their pure models and assumptions before adapting them.


## Quiet preparation and verification

Reuse existing ready objectives immediately; prepare only genuine gaps. Routine card QA must never open, focus, flip through or restart the reader’s Recall window. Follow [invisible-verification.md](../recall-source/references/invisible-verification.md) for hidden actual-renderer checks, exact-content caching and the separate editorial/math/code requirements. Keep pending checks visible; never turn a generated report into execution trust.
