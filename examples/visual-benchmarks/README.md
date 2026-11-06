# Visual benchmarks

Three original teaching visuals establish a reproducible quality baseline: a yield-curve comparison, a value-weighted duration gap, and an ownership/weak-reference trace.

Each `.html` file is a self-contained **widget fragment**, intended for a fenced Recall widget. It includes its own inline model and controls. It does not access the library, network, storage, scheduling, or personal source files. Surrounding card prose remains separate. `preview-pack.json` uses synthetic cards and can be imported into an isolated test profile.

Build the fragments after editing a template, model, helper or stylesheet:

```sh
node examples/visual-benchmarks/build.cjs
node --test examples/visual-benchmarks/models.test.cjs
```

From the repository root, run `npm run build && npm run test:visuals` for the real sandboxed Electron journey. It uses only a disposable synthetic profile and saves screenshots plus a scenario report under ignored `evidence/visual-benchmarks/`. `npm run preview:visuals` creates an offline `index.html` there for reviewing the three examples. Neither command changes your library or review history.

For a hands-on preview in Recall itself, run `npm run build && npm run preview:visuals:app`. It opens a separate profile containing only these three synthetic cards. Reveal the answer, choose **Load interactive**, and use **Next card** to compare them. Your normal library, credentials and history remain separate. Close this preview when finished; it does not install or replace your Mac app.

`manifest.json` describes baseline/reset controls and each expected interaction. After a step, compare the root section’s `data-result` JSON with `expected`, allowing normal floating-point tolerance. Every scene starts from its `reset` control. These fixtures do not claim that a browser or editorial review ran: those are separate checks in the actual sandboxed Recall frame.

Render at both manifest widths and appearances. Check every control by pointer and keyboard, the quantitative boundaries, state through theme changes, readable labels, no clipping, a reproducible reset, and reduced motion. These visuals contain no automatic playback or timers. Native responsive SVG uses the actual frame width, keeping labels in screen-sized text rather than shrinking an oversized viewBox.

The semantic colors use the versioned visual kit’s `--viz-series-*` tokens with inline light/dark fallbacks. All layout/interaction works without an external charting library. None of these examples includes live card IDs, personal prose, private source paths, or a claim that exposure establishes mastery.
