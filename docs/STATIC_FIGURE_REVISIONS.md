# Scoped static-figure revisions

`cards revise` accepts a version 2 request to restyle one existing SVG or Mermaid figure in each named card answer. Version 1 widget requests retain their existing format and behavior. Neither version edits the prompt, explanatory prose outside the selected visual, card identity, numeric grading, code exercises, widget permissions, schedules, reviews, attempts or drafts.

```json
{
  "schemaVersion": 2,
  "cards": [
    {
      "id": "example-card",
      "expectedContentHash": "COPY_THE_64_CHARACTER_HASH_FROM_CARDS_INSPECT",
      "figureIndex": 0,
      "figure": {
        "kind": "mermaid",
        "source": "flowchart LR\n A[Input] --> B[Output]"
      }
    }
  ]
}
```

Read the current card and canonical hash with `recall cards inspect CARD_ID`. Preview with `recall cards revise FILE`, submit with `--apply`, then read `recall cards revision-status REQUEST_ID`. Preview and receipts identify the scope as `static-figure-only`. Only a `revised` receipt proves that the writer committed the change. A queued request remains pending.

The writer handling a request must support version 2. Running a new source CLI while an older installed app remains open does not upgrade that app's writer: the CLI can enqueue a request that the old writer then blocks. Do not submit version 2 to an older running writer. After the authorized migration and its QA are prepared, a graceful app quit can release the writer lease; the compatible source CLI can then apply the scoped request as the sole writer. Confirm its revised receipt before reopening the app. This write handoff does not require replacing the installed app, changing widget permissions, or resetting the reader's saved session. Routine visual QA still uses hidden disposable profiles and never quits the live reader.

`figureIndex` is zero-based across SVG and Mermaid figures in answer order. It excludes figures inside widgets, other Markdown code fences, inline code spans, HTML code/raw-text blocks and comments. Mermaid fences and `<pre class="mermaid">` are recognized; inline SVG uses its outer element. The replacement must keep the selected kind and pass a presentation-only equivalence proof. SVG text, geometry, node order, structural attributes, and marker/clip references remain unchanged. Structural attributes or retained CSS cannot depend on CSS custom variables or environment functions, because changing a style token must not move or hide geometry. Mermaid text and topology remain unchanged; the bounded proof accepts ordinary flowcharts and requires class assignments to reference known original nodes; only strictly parsed appearance class definitions and assignments can differ. Both the original and replacement must pass the inert authoring gate. Changes to a label, plotted coordinate, arrow direction, or other semantic content are rejected. Supply the full SVG element for `svg`, or unfenced diagram source for `mermaid`. Existing Mermaid fence or pre wrappers are preserved; pre contents are escaped as text. No figures are added to the prompt or answer, and no figure can be converted into executable widget code by this request.

A batch contains 1–20 distinct card IDs and commits atomically. Each card permits one selected visual per request. Revising another visual in that card, or a widget and a static figure in the same card, requires a fresh `cards inspect` hash after the first revision. Stale hashes, duplicate IDs, wrong kinds or missing figures block the whole batch. Re-submitting an identical request recovers its existing receipt; recovery after a queue-receipt failure does not edit the card twice.

One previous card version is retained using the same internal receipt/previous-version storage as version 1. `recall cards inspect CARD_ID --previous` therefore works for both visual kinds. Restore a previous visual by submitting a new scoped request against the current hash; this is not an unrestricted whole-card restore API.

The authoring gate accepts a conservative, inert SVG subset: ordinary shape and text elements, local marker/gradient/clip references, presentation attributes, presentation-only CSS and light/dark `prefers-color-scheme` rules. It rejects scripts, events, embedded HTML, images, links, animation, document declarations, external URLs, CSS imports, font loading and unknown attributes or CSS properties. Mermaid rejects configuration overrides, raw HTML, callbacks, interactive links and resource URLs. These checks do not execute or render the source. The existing strict Mermaid configuration, SVG-profile sanitizer and isolated SVG-image display remain in place.

Validation is intentionally narrower than every SVG or Mermaid feature. Unsupported authoring markup must be revised into the supported inert subset; do not relax the gate merely to make a request pass. Syntax, calculation correctness, diagram labels, geometry, theme contrast and narrow-layout acceptance still require independent review and actual renderer QA. Successful request validation is not visual acceptance or an execution permission grant.

Presentation revisions preserve review evidence without changing the library-wide objective hash. Inside the same writer transaction, version 2 restores the exact pre-update expertise epoch row (including its absence), retaining any cutoff established by an earlier semantic edit. The normal dirty marker remains, and normal expertise refresh replays existing reviews from that cutoff under the new content hash. Cached confidence and statistics are not directly modified; no mastery is granted. The unchanged expertise code can therefore refresh the projection after the installed app reopens. Subsequent reviews, undo, and ordinary semantic edits retain their normal behavior.
