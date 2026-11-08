# Illustrated diagrams

Use this recipe for pastel, outlined technical illustrations. Preserve the concept's model, assumptions, quantities and original controls when revising a visual. Choose its composition from the mechanism rather than from a prior diagram.

Define scoped diagram tokens with both appearances. These are surfaces and inks, separate from the app's controls and global theme:

| Role | Light | Dark |
| --- | --- | --- |
| Paper | `#FFFFFF` | `#182023` |
| Ink | `#30343B` | `#E6E8EC` |
| Secondary text | `#606873` | `#B5BFC8` |
| Blue surface | `#D8E6FC` | `#2B4565` |
| Lavender surface | `#E5DEF6` | `#453B61` |
| Mint surface | `#D8F0E5` | `#294E43` |
| Butter surface | `#FAEDC8` | `#584C2E` |
| Peach surface | `#FAE1CE` | `#5D4032` |
| Active marker | `#DF751E` | `#FFAD65` |

Use two to four persistent, labeled categories per scene. Pair color with text, position, shape or line style. Reserve a small orange marker for the current item, read head or stop position; do not use it as a decorative accent everywhere.

Use crisp 1.5–2 px structural outlines, monospaced technical labels, restrained corners and open whitespace. Put readable ink on pastel surfaces. A dark-mode figure should use the corresponding dark surfaces and light text, not a white rectangle inside the app.

Use shallow isometric depth when layers, shared buffers or memory structures become easier to distinguish. Keep timelines, byte streams and quantitative charts in 2D when perspective would distort order or scale. Draw solid and dashed connectors only when they express different relationships; label them where needed. Mark schematic geometry when it is not proportional to bytes or time.

For quantitative charts, keep axes and values accurate and readable. Pastel regions may distinguish regimes or comparisons; use contrasting darker strokes in light mode and lighter strokes in dark mode for quantitative series. Do not turn categorical pastel colors into implied extra measurements.

Make every control update marks and interpretation through the same state. Preserve meaningful boundaries and counterexamples. At narrow widths, reflow groups or recompute geometry; never shrink a large SVG until its labels become unreadable. Keep visible diagram labels at least 12 screen pixels where practical. Honor reduced motion and preserve keyboard use.

Static Knowledge Base figures are sanitized SVG/Mermaid. Use SVG presentation attributes such as fill, stroke and font-size, plus direct geometry. Do not depend on scripts, controls, style blocks, style/id attributes or ID-based markers/gradients surviving note sanitization. Interactive controls run in a card widget sandbox; capable Knowledge Note renderers can reference that same widget with a `recall-visual` fence. A static snapshot may accompany an interactive diagram but should say which state it depicts.

Compare the old and proposed model results, inspect baseline and changed states at normal/narrow widths in both appearances, and keep the source unchanged until an authorized revision is applied. Preview rendering is not proof that the installed app accepted a revision.

For a bulk revision, inventory all visual-bearing cards before choosing batches, including static SVG and Mermaid as well as widgets. Record a disposition for every visual; do not describe a sample as a completed library migration. Preserve the existing geometry when it already teaches the mechanism well. Recompose only when the structure becomes clearer. Check the densest reachable state against the runtime height cap at narrow width, not only the default.

For an approved redesign, compare the rendered destination with the approved composition and changed states. A colored transcription of ASCII art does not fulfill an illustrated redesign. Bulk acceptance must track destination, approved reference, semantic/interaction checks and observed visual comparison separately from render-only coverage.
