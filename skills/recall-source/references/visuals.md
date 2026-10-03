# Explanatory visuals

Start with the answer and learning objective. Choose actors, quantities, axes or states that make its mechanism visible. Useful interactions change an input and update the actual plotted marks, annotations and interpretation. Compare before/after, trace a sequence, or expose a relationship. Decorative motion, generic arrows, pan/zoom, or a changing number beside an unrelated plot are insufficient.

Use self-contained HTML/SVG in a fenced `widget` block in the answer. Everything is inline. No network requests, storage, host APIs, remote fonts or arbitrary files. Nothing runs until Load interactive. Use theme variables (`--text`, `--muted`, `--accent`, `--accent-soft`, `--border`, `--card`, `--sans`), a viewBox and accessible labels. Avoid viewport-sized heights; the frame measures its content. Native code belongs in the exercise runner, never in a widget.

Use a static SVG when interaction adds no learning value. Mermaid is suitable for small relationship maps; primary ASCII diagrams are not. Keep the main definition concise and exploration optional. In math/code cards, diagrams and worked solutions must not leak the answer before reveal.

Use widget-contract.md and the repository's examples/demo.json (when available) for runnable contracts. Test every distinct control at representative values and boundaries, compare results to independent calculations, and inspect both system themes and narrow widths. Verify state survives a theme change. Confirm visible labels and marks update together. Report any part of the document not covered rather than substituting a sample for a full scan.
