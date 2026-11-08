# Interactive widgets and static figures

Use a static SVG when inspection is enough. Use a fenced `widget` when changing an input, tracing a state or comparing scenarios teaches the objective. The core answer must remain useful without loading it.

## Runtime versions and boundary

The current document supplies **`window.RecallVisual.version === "1.0.0"`**, an offline SVG/state toolkit. This is separate from **host message protocol version 2**, which reports lifecycle, layout and a bounded request to close its own expanded workspace. Older self-contained HTML widgets remain supported; new toolkit widgets need an app containing that toolkit. Check the installed app before promising compatibility. Prefer a readable initial explanation or static figure when the toolkit is unavailable; do not claim an untested fallback works.

The card stores plain inline HTML, CSS and JavaScript inside this fence:

````text
```widget Explore the mechanism
<!-- focused HTML/SVG, labeled controls and inline script -->
```
````

Nothing executes until the reader chooses **Load interactive**. The iframe has `sandbox="allow-scripts"`, an opaque origin, no preload and its own restrictive CSP. No network requests, remote scripts/fonts, storage, arbitrary files, host APIs, navigation or popups. Do not add `allow-same-origin`, author a custom parent bridge, or send commands through `postMessage`. The trusted Escape handler only requests dismissal of its own expanded visual. Bundled helpers do not add permissions. Canvas authors should redraw on appearance changes; SVG using CSS tokens updates in place.

Inbox imports leave widgets disabled. The reader must enable **Allow this card’s interactive widgets** in the editor, then choose **Load interactive**. A validation report does not grant that permission.

## Theme and composition

The app and widget use the packaged canonical palette in `shared/visual-theme.css`. Use `--text`, `--muted`, `--faint`, `--card`, `--sunken`, `--raised`, `--border`, `--accent`, `--accent-soft`, `--accent-ink`, `--warm`, `--sans`, `--serif` and `--mono`. For graphical marks use `--viz-series-1` through `--viz-series-6`, `--viz-grid`, `--viz-axis`, `--viz-label` and `--viz-focus`. Pair color with a label, position or line pattern.

Compatibility aliases include `--foreground`, `--primary`, `--background`, `--muted-foreground`, `--color-background`, `--color-text-primary`, `--color-text-secondary`, `--color-border`, `--color-accent` and `--font-sans`. Define any custom diagram tokens locally with both light and dark values. The approved [illustrated palette](illustrated-style.md) supplements the shared app tokens; it must not recolor app chrome or force one appearance. Native labels, inputs, buttons, `.grid`, `.metric`, `.panel` and `.row` have baseline styling; these are primitives, not a mandatory dashboard layout.

Content determines frame height, bounded at **96–1400 px**. Never give `html` or `body` a viewport-sized height. Recompose at narrow widths instead of shrinking SVG labels until unreadable. Avoid host-height feedback loops, oversized articles and decorative panels. Use one dominant explanatory scene, a few relevant controls and a short interpretation derived from the same state.

## Bundled toolkit 1.0.0

All methods run inside the sandbox and use native DOM/SVG. They are optional; a composed hand-authored scene is appropriate when it explains the concept better.

| Helper                                    | Contract                                                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state(initial, render)`                  | Returns `get()`, `set(patchOrUpdater)` and `reset()`. Values are cloned. Calls `render(snapshot)` immediately and after each update; the first render must not read an uninitialized controller variable.             |
| `svg(tag, attrs, text?)`                  | Builds a supported SVG primitive. Text uses `textContent`; event/resource-loading attributes are rejected. Add actual interactions through native event listeners.                                                    |
| `linear([d0,d1], [r0,r1], {clamp:false})` | Creates a finite linear scale. A zero-width domain is rejected.                                                                                                                                                       |
| `pointsPath(points, xScale?, yScale?)`    | Builds a path from numeric `[x,y]` points.                                                                                                                                                                            |
| `plot(svg, options)`                      | Options: `domain`, `range`, `series:[{points,color?,label?}]`, optional `width`, `height`, `xLabel`, `yLabel`, `label`. Returns `{x,y}` scales for annotations. Label units and assumptions yourself.                 |
| `bars(svg, options)`                      | Options: `items:[{label,value,color?}]`, optional `width`, `height`, `max`, `label`. Signed values are supported.                                                                                                     |
| `timeline(svg, options)`                  | Options: `steps:[{label,detail?}]`, optional `active`, `width`, `height`, `label`. Stable stages with an active index.                                                                                                |
| `createRange(options)`                    | `label,min,max,step?,value,unit?,onChange`. Returns `{element,input,output,set}`. `set(value)` updates the control without invoking its change callback.                                                              |
| `playback(options)`                       | `frames,render,interval?` returns `play,pause,next,reset,destroy,isPlaying,current`. No automatic start; Play declines while reduced motion is enabled or the document is hidden. Reset/Pause cancel stale callbacks. |

State helpers coordinate rendering; they do not verify mathematics or choose a useful composition. Keep domain calculations as pure functions that can be checked independently. Playback does not supply Back or arbitrary stage selection; implement those explicitly if advertised.

## Lifecycle and diagnostics

The trusted document bridge installs before authored scripts, reports initial readiness after DOM parsing, catches script errors, rejected promises and blocked-resource errors, and coalesces content-height measurements. The host validates the exact iframe window, fresh opaque instance, protocol version, message type and bounded fields. An Escape key inside the frame can request dismissal of that same expanded visual; it cannot navigate, reveal, rate, access data or operate another frame. There is no host command channel.

The host shows Loading, Ready or a visible error with **Retry**; missing readiness times out after eight seconds. An error removes the failing frame. **Reset** and Retry create fresh instances and reset parameters. **Expand/Collapse** keeps the same iframe and current inputs; Escape returns to the card. Appearance changes retain state. Hiding the card answer destroys its frame; reopening requires Load again and does not promise parameter restoration.

Do not copy or fake lifecycle messages in authored scripts. Syntax validation is only a structural check: a script may parse yet still fail, calculate incorrectly or render unreadable labels.

## Runnable benchmark sources

The repository’s [visual benchmarks](../../../examples/visual-benchmarks) contain three full, synthetic teaching compositions and independent models:

- `yield-curve.template.html`: before/after curves with units, yield changes, spread classification and scenario controls.
- `duration-gap.template.html`: assets and liabilities respond together; first-order valuation and surplus changes expose the hedge boundary.
- `weak-reference.template.html`: stable ownership regions, strong/weak reachability and explicit caller/collection states.

`node examples/visual-benchmarks/build.cjs` assembles inline widget fragments and a synthetic preview pack. This is a local build, not a live-library import or a QA certificate. Adapt the explanatory structure to the objective; do not mechanically copy every panel or control. The examples are in the checkout, not guaranteed to exist in an installed assistant kit.

## Static SVG

Knowledge Base figures use direct SVG presentation attributes such as `fill`, `stroke`, `font-size` and `font-family`. Note sanitization removes scripts, controls, style blocks and style/id attributes; do not depend on CSS classes or ID-based markers and gradients. Keep interactive controls in the card widget sandbox, including when a Knowledge Note references that widget.

Provide a `viewBox`, readable labels, theme-token colors and an accessible description of what the figure shows. SVG and Mermaid render as sanitized image documents in the zoomable viewer; their CSS cannot style app controls. Scripts, event handlers and `foreignObject` do not provide interaction. Do not include external resources. A failed figure shows a fallback note while the rest of the card remains readable.

For the composition and actual acceptance checks, read [visuals.md](visuals.md). Changes to this contract do not revise existing cards.


## Static figure revisions

A compatible `cards revise` writer accepts `schemaVersion: 2` with 1–20 entries shaped as `{id, expectedContentHash, figureIndex, figure: {kind, source}}`. Use `cards inspect` for the current hash. The index counts existing SVG/Mermaid answer figures outside widget/code blocks. Version 2 is limited to presentation changes: validated palette, font and outline edits must retain text, geometry and topology. The writer preserves the prior expertise cutoff and lets normal review replay refresh its cache; it does not assign confidence. Keep the kind; supply a full SVG element or unfenced Mermaid source. Preview, apply and verify a `revised` receipt as for widgets. A second visual in the same card needs a fresh hash. Presentation-only replacements preserve surrounding prose, grading, permissions and learning records.

Check writer compatibility before submitting. A newer source CLI must not queue version 2 to an older open app. A separately authorized writer handoff can apply it while the app is closed; routine rendering QA still uses a hidden disposable profile and never restarts the live reader. Request validation does not replace actual rendering or editorial review.

## Interactive visuals in Knowledge Notes

A supporting source build recognizes this Markdown reference to an existing library card's zero-based widget index:

````markdown
```recall-visual
{"cardId":"example:bounded-batches","widgetIndex":0}
```
````

The note contains an identity, not executable HTML. The renderer resolves the library card and uses the existing `recall://widget` sandbox, permission check and explicit Load gate. The reader can enable that card's widgets from the note; authoring a reference never changes its permission. Missing cards/widgets show an unavailable message. Navigating away unloads the frame; returning requires Load again. Expand/Collapse and appearance changes preserve active inputs.

Check runtime support before saving this fence to a live note: older apps display it as code. Verify the selected widget's exact source and destination rendering against the approved example, including meaningful changed states. Keep IDs, surrounding note prose and learning records intact. If an illustrated static fallback is needed, preserve the explanatory scene and state rather than replacing it with a colored text transcription.


### Note-owned visuals

When no existing card widget matches, a supporting runtime can store a visual with the configured local Markdown/Obsidian source. Do not create a flashcard just to host a note diagram. Save a JSON asset with exactly `schemaVersion: 1`, `title` (up to 200 characters), and `html` (the widget fragment). The complete asset is limited to 2 MB and follows the same sandbox/CSP and widget syntax contract.

```sh
recall kb visual save SOURCE_ID ASSET.json
recall kb visual save SOURCE_ID ASSET.json --apply
```

Preview validates without writing. Apply creates an immutable `Visuals/<sha256>.recall-visual.json` file and returns its reference. Then revision-save the note with a `recall-visual` fence whose JSON has only the returned `asset` field. Use the exact returned path; do not invent a digest. The referenced file must travel with the source folder when backing it up or moving it. JSON assets are not extra Knowledge Notes.

The reader enables each exact note/asset pair and then clicks Load. Authoring never grants that permission or modifies cards. A changed asset uses a new digest and requires new permission; stale references, missing files, modified bytes and paths outside the source fail closed. Moving a note requires enabling its visuals again. Keep the original figure or its full source recoverable and verify the actual destination, including every control, both appearances, narrow widths and expansion.
