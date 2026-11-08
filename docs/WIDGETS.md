# Interactive visuals

[Documentation](README.md) · [Authoring](AUTHORING.md)

A card should answer the question before its optional visual opens. Use interaction when changing an input, comparing scenarios or tracing a state makes the mechanism easier to understand.

| Format             | Best fit                                     | Reader experience                                |
| ------------------ | -------------------------------------------- | ------------------------------------------------ |
| SVG or Mermaid     | A clear relationship or static illustration  | Sanitized image with diagram zoom                |
| Interactive widget | A focused mechanism with meaningful controls | **Load interactive**, then an isolated workspace |

## A small, dependable workspace

Widgets open only after **Load interactive**. The frame shows Loading, Ready or a visible error with Retry. Initial loading times out after eight seconds. A failed frame is removed; Retry starts again.

**Expand** opens a larger workspace without recreating the diagram or resetting its inputs. **Collapse** or Escape returns to the card. **Reset** starts the diagram from its initial values. Changing device appearance retains state. Hiding the answer destroys the frame; reopening requires Load again.

The sandbox has no network, files, storage or library access. It does not receive Recall’s privileged bridge. Enabling permission in the card editor and clicking Load remain separate actions. Learning-inbox imports deliberately leave widget permission off.

## Illustrated diagrams

The public [visual skill](../skills/recall-visuals/SKILL.md) uses a shared [illustrated recipe](../skills/recall-source/references/illustrated-style.md): pastel category surfaces, readable outlines, technical labels and a small active marker. Depth is optional and should explain real layers or ownership; quantitative charts retain their axes and scales. Both appearances and the densest narrow layout are checked. Static Knowledge Base figures use the same visual language within the note sanitizer’s limits. The source build also lets a note reference an existing card widget with a `recall-visual` fence, reusing its exact content, permission and Load gate. It also supports immutable note-owned assets with separate per-note permission when no card matches; note scripts remain inert. See [Knowledge space](KNOWLEDGE_SPACE.md). Updating the skill does not automatically modify existing cards.

## Build with the supported toolkit

The bundled `RecallVisual` **1.0.0** toolkit supplies state, SVG primitives, scales, plots, bars, timelines, native range controls and optional playback. The app and widget share the same light/dark palette, with semantic chart colors for comparisons. Existing self-contained widget HTML remains supported. A new visual using toolkit helpers needs a Recall build that includes them; subsequent compatible card changes do not require another app release.

Read the portable [widget contract](../skills/recall-source/references/widget-contract.md) for APIs, sizing, lifecycle and isolation. Follow the [visual authoring guide](../skills/recall-source/references/visuals.md) for composition and actual acceptance checks. Host message protocol version 2 is a lifecycle/layout boundary, with a bounded Escape request to close its own expanded visual; it is not a general assistant or application API.

The [benchmark sources](../examples/visual-benchmarks) demonstrate three different compositions:

- **Yield-curve steepening:** before/after curves, selected yield shocks and a visible change in the long–short spread.
- **Duration gap:** coordinated asset/liability valuations and surplus sensitivity under an explicitly stated first-order approximation.
- **Weak references:** ownership, caller lifetimes and collection states in a stable reachability diagram.

Build their self-contained fragments and synthetic preview pack with `node examples/visual-benchmarks/build.cjs`. Building examples does not import cards or establish visual QA. Do not use personal cards, screenshots or source documents in public examples.

## Acceptance before import

Check the explanation and calculations separately from rendering. Exercise every control, boundary and Reset; inspect actual baseline and changed states in both themes at normal and narrow widths. Verify readable labels, units, contrast, keyboard controls, state retention through Expand/Collapse and appearance changes, and reduced motion when used. Record expected and observed outcomes with screenshots. Parsing JavaScript or successfully importing a bundle proves neither correctness nor visual quality.

When those checks cannot run, keep the proposed visual as a draft and report the limitation. Show benchmark cards before a larger migration. Existing definitions, worked solutions, stable IDs and review history must survive a visual upgrade.

## Revise an existing visual safely

An authorized widget-only revision replaces one selected fence; it preserves the rest of the answer, card identity, permission and learning history. Use `recall cards inspect CARD_ID` to read its canonical `contentHash`. The request names its card ID, that hash as `expectedContentHash`, widget index and replacement `{title,html}`. Preview it with `recall cards revise FILE`; apply with `--apply`, then check `recall cards revision-status REQUEST_ID`. A queued request is pending until the writer reports it revised. Changed source content blocks the request rather than overwriting a newer edit. The batch commits atomically with one previous version per edited card. Read it with `recall cards inspect CARD_ID --previous` and use the current content hash to submit a new revision with the previous widget.

This does not support arbitrary prose rewrites or grant widget permission. Do not create duplicate cards or edit the live database to get around a conflict. See the [shared quality contract](../skills/recall-source/references/quality.md).

Version 2 requests provide the same narrow preservation and queued-writer guarantees for an existing same-kind SVG or Mermaid figure. They identify `{figureIndex,figure:{kind,source}}` instead of a widget. Figures inside widget/code fences are excluded. See [Scoped static-figure revisions](STATIC_FIGURE_REVISIONS.md) for indexing, safe markup, sequential edits and the request format. The existing widget checker below is version 1 only; static replacements still require actual renderer and editorial QA.

For a revision batch, `node scripts/check-visual-revisions.cjs --data PROFILE --request REVISION.json --scenes SCENARIOS.json --output PRIVATE_QA_FOLDER` reads the source library without writing to it, copies the selected cards into a disposable profile, and exercises their rendered visuals. The scene manifest supplies independently checked expected values and visible text or mark assertions for each scenario. Keep the output private: it contains card content and screenshots. The report records the exact request, scenario inputs, results and screenshots; it does not apply the revisions or certify their factual accuracy. Review the screenshots and models before applying the checked request.

Use `--compatibility` only to check an unchanged older widget's loading and layout. That narrower report does not establish interaction or editorial acceptance for a new visual.

## Noninteractive figures

SVG and Mermaid output render as image documents; their styles cannot affect study controls. App colors are resolved into the image for both appearances. Provide a viewBox and an accessible description. A figure that cannot render gets a short fallback note, and the rest of the answer stays usable. Interactive behavior belongs in a loaded widget.

Continue with [authoring and content packs](AUTHORING.md) or the [privacy and execution boundaries](PRIVACY.md).
