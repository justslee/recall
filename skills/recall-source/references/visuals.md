# Explanatory visuals

Start with the answer and learning objective. Choose actors, quantities, axes or states that make its mechanism visible. Useful interactions change an input and update the actual plotted marks, annotations and interpretation. Compare before/after, trace a sequence, or expose a relationship. Decorative motion, generic arrows, pan/zoom, or a changing number beside an unrelated plot are insufficient.

## Composition and interaction

Build a composed explanation rather than a generic box map. Choose a spatial structure that teaches the relationship: ownership lanes for a process, layers for memory or durability, a timeline for cash flows, capacity gauges for a queue, or aligned plots for comparisons. Keep positions stable across states. Use grouped regions, whitespace, readable labels and restrained semantic accents; pair color with text, shape or position. Give the main mechanism more emphasis than supporting detail and adapt the composition to the current app theme.

A selected state should update all affected marks, highlights, labels, quantities and the short interpretation together. Use moving tokens or animation only when they depict an actual transition. Put optional detail beside its object in a persistent panel instead of hiding essential information in hover tooltips. Where helpful, let the learner predict, manipulate, observe and explain; this is a design option, not a compulsory quiz template.

For a sequence, offer manual steps and a reproducible reset, with optional Play/Pause. For a quantitative view, expose relevant inputs with units and a baseline comparison. Include a meaningful boundary or counterexample when it advances the objective. Distinguish measured data, illustrative geometry, simulation assumptions and proposed behavior. An animated trajectory is not measured evidence just because its endpoint comes from a measurement.

When adapting a reference, inspect its figure, caption, handlers, calculations and dependencies. Transfer the explanatory structure, not the entire page or unverified claims. Split a long article into focused card-sized mechanisms. Do not distribute personal source files, paths, private configuration values or private examples with public guidance.

## Runtime and accessibility

Use self-contained HTML/SVG in a fenced `widget` block in the answer. Everything is inline. No network requests, storage, host APIs, remote fonts or arbitrary files. Nothing runs until Load interactive. Use theme variables (`--text`, `--muted`, `--accent`, `--accent-soft`, `--border`, `--card`, `--sans`), a viewBox and accessible labels. Avoid viewport-sized heights; the frame measures its content. Native code belongs in the exercise runner, never in a widget.

Use the supplied fonts or system fallbacks. Recompose diagrams or move detail into HTML on narrow cards; a large SVG viewBox that shrinks tiny labels is not sufficient. The current frame height is capped at 1400 px, so keep an exploration compact. Prefer native buttons and labeled inputs. Custom SVG controls require keyboard activation, a visible focus indicator and an accessible name; color and hover cannot carry essential meaning alone.

Start motion only through explicit action. Respect `prefers-reduced-motion` in JavaScript and CSS, retaining manual steps without automatic playback. Pause/Reset must cancel pending timers and animation frames; a reset during playback must not allow stale callbacks to restore the old state. Keep comparisons reproducible or clearly label randomness.

Use a static SVG when interaction adds no learning value. Mermaid is suitable for small relationship maps; primary ASCII diagrams are not. Keep the main definition concise and exploration optional. In math/code cards, diagrams and worked solutions must not leak the answer before reveal.

Inbox imports leave widgets disabled regardless of a submitted permission flag. Explain the handoff: the reader enables Allow this card's interactive widgets in the card editor, then chooses Load interactive. Do not bypass permission through settings or database writes; a validation report does not grant execution trust.

## Inspect before delivery

Use [widget-contract.md](widget-contract.md) for the runnable contract. When working from a repository checkout, `examples/demo.json` contains a complete card example; it is not bundled into the installed connection kit. Test every distinct control at representative values and boundaries, compare results to independent calculations, and inspect the actual rendered card in both system themes and at normal and narrow widths. Verify state survives a theme change, labels remain readable, and marks and interpretation update together. Check keyboard controls, reduced motion and Pause/Reset during playback when present. Confirm every advertised state is reachable. Keep factual/model checks, rendering/interaction checks and import validation distinct; report any incomplete check. Report any part of a requested document not covered rather than substituting a sample for a full scan. Updating this guidance does not automatically revise existing cards.
