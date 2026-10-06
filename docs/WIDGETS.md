# Interactive widget contract

[Documentation](README.md) · [Authoring](AUTHORING.md)

Use an interactive widget when manipulating the diagram helps explain the concept. Use a static
figure when a clear illustration is enough.

| Format             | Best fit                            | Reader interaction                                           |
| ------------------ | ----------------------------------- | ------------------------------------------------------------ |
| SVG or Mermaid     | A diagram the reader can inspect    | Rendered as a sanitized SVG image; diagram zoom is supported |
| Interactive widget | A focused exploration with controls | Explicit **Load**, then interaction inside a sandboxed frame |

## Before authoring

1. Read the canonical [widget contract](../skills/recall-source/references/widget-contract.md),
   included in the portable skill kit.
2. Follow the [visual authoring guide](../skills/recall-source/references/visuals.md): meaningful
   composition, coordinated interaction and a readable card-sized layout.
3. Check both themes. Adapt a polished reference into a focused exploration, and check its
   calculations and assumptions separately.

> Learning-inbox imports leave widgets disabled. The reader enables permission for the card,
> then explicitly clicks **Load**.

## Frame rules

A widget frame is created when the reader clicks Load and is replaced, not navigated, on Reset or
when the card changes. The main process refuses any navigation a loaded widget attempts, including
to another card's widget. Widget numbering uses the same fence grammar in the renderer and the main
process, so the frame the reader opened is the widget the app serves.

Frames measure content up to the current 1400 px height limit. Widget permission is enabled in the
card editor; **Load** remains an explicit second step.

## Noninteractive figures

Sanitized SVG and Mermaid output render as SVG image documents, not nodes in the main app DOM. Their
styles cannot affect the study controls. App colors are resolved into the image so light/dark
appearance and diagram zoom still work. Interactive behavior belongs in an explicitly loaded
sandboxed widget. Authored figures may omit `xmlns` and may use HTML entities such as `&nbsp;`:
Recall reads sanitized SVG with the same HTML rules its sanitizer used. A figure that still cannot
render is replaced by a short note, and the rest of the card keeps working.

Continue with [authoring and content packs](AUTHORING.md), or review the [privacy and execution
boundaries](PRIVACY.md).
