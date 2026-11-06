# Verify without interrupting study

Routine preparation must not open, focus, flip through or restart the reader’s Recall app. Reuse ready, unsuspended objective matches first; these can join the Self Test immediately. Author only genuine gaps, and keep failed checks pending. Do not wait for a whole batch before linking already-ready cards.

Use data/CLI checks for identity, imports, receipts and preservation. For visual checks, use a **hidden disposable profile with the real Electron renderer**. This retains the actual widget origin, CSP and sandbox. Never weaken those boundaries to make a check pass. Native keyboard/focus acceptance is a separate, intentional runtime/release check when hidden automation cannot reproduce it.

From a development checkout with dependencies installed:

```sh
npm run build
node scripts/verify-cards.cjs --pack /path/to/cards.json --scenes /path/to/scenes.json --output /path/to/private-verification
```

The script creates a marked temporary profile, checks hidden answers, loads isolated QA copies, exercises supplied scenarios and saves screenshots in light/dark at narrow/normal widths. Inspect those screenshots. It blocks calls that could rate cards, run arbitrary exercises, use credentials or initiate connections. It never grants permissions to a live card. An unavailable renderer leaves a draft with the missing checks; do not substitute visible automation against the reader’s library.

`--scenes` is required for interactive cards. Keys are exact card IDs; each entry names a zero-based widget, actions and expected visible output. For example:

```json
{
  "example:duration": [
    {
      "widget": 0,
      "steps": [{ "input": "#rate", "value": "2" }],
      "text": [{ "selector": "#interpretation", "includes": "falls" }]
    }
  ]
}
```

Supported actions are `click`, `input` plus `value`, and `select` plus `value`. Text assertions use `equals` or `includes`. Include baseline, meaningful changed states and boundaries. Independently establish expected results. Add bespoke model/mark/keyboard checks when these simple assertions cannot establish correctness; the benchmark and revision scripts support more detailed checks.

Successful renderer reports are cached in the output directory by exact card content, supplied scenarios, renderer/main/shared files, dependency lock and verifier code. Keep this directory private and outside Git. Reuse an unchanged verified result; `--force` reruns it. A cache is local QA evidence, not an authorization token, a semantic accuracy check or execution trust. Editorial review, numerical checks and native exercise validation remain separate.

For widget-only revisions, `scripts/check-visual-revisions.cjs` uses the same invisible mode. For runtime changes, `npm run test:visuals` runs the representative lifecycle suite. Ordinary authoring does not need to repeat the entire host suite for every card.
