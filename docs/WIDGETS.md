# Interactive widget contract

See the canonical [widget contract](../skills/recall-source/references/widget-contract.md), included in the portable skill kit.

For diagram design, follow the [visual authoring guide](../skills/recall-source/references/visuals.md): meaningful composition, coordinated interaction, readable card-sized layouts and checks in both themes. A polished reference should be adapted into a focused exploration, with its calculations and assumptions checked separately.

## Frame rules

A widget frame is created when the reader clicks Load and is replaced, not navigated, on Reset or when the card changes. The main process refuses any navigation a loaded widget attempts, including to another card's widget. Widget numbering uses the same fence grammar in the renderer and the main process, so the frame the reader opened is the widget the app serves.

Frames measure content up to the current 1400 px height limit. Learning-inbox imports leave widgets disabled until the reader enables the card's widget permission in the editor; Load remains an explicit second step.

## Noninteractive figures

Sanitized SVG and Mermaid output render as SVG image documents, not nodes in the main app DOM. Their styles cannot affect the study controls. App colors are resolved into the image so light/dark appearance and diagram zoom still work. Interactive behavior belongs in an explicitly loaded sandboxed widget. Authored figures may omit `xmlns` and may use HTML entities such as `&nbsp;`: Recall reads sanitized SVG with the same HTML rules its sanitizer used. A figure that still cannot render is replaced by a short note, and the rest of the card keeps working.
