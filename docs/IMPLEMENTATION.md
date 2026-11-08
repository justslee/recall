# Implementation status

[Documentation](README.md) / Implementation

Recall is an Apple Silicon macOS beta. Install a published app from [GitHub Releases](https://github.com/justslee/recall/releases), or build from source. This page summarizes what is implemented and verified; the [implementation history](history/IMPLEMENTATION_LOG.md) preserves detailed, dated records.

**Study → capture → prepare → self-test → revisit.**

## Navigation labels (v0.6.0-beta.10)

Knowledge’s graph is labeled **My Brain**, with a matching brain icon. The card browser is labeled **Card Deck**, including its back links, search guidance and current setup documentation. Existing route keys, saved view preferences, graph identities and learning data are unchanged. Older verification records below retain the names used at the time.

Verified locally with 492 passing regression tests, the production build, documentation checks and the invisible graph/navigation journey across light, dark and narrow layouts. The synthetic cards, reviews, note drafts and unfinished session were preserved. These labels are included in the v0.6.0-beta.10 candidate; these checks did not replace the installed app.

## In-app updates (v0.6.0-beta.10)

General settings now includes explicit release checking, progress, cancellation before replacement, and **Update & restart**. The UI reuses the signed-release helper's checksum, publisher, architecture, notarization, transaction recovery and one-app rollback. A detached worker waits for the main process to quit normally before replacing the existing app; it reopens the same selected profile. Existing owned Codex/Claude connections refresh from the new runtime without adding hosts or changing capture preferences. Downloads and update receipts are outside profile backups.

An optional user-selected official Git clone receives a clean `main` fast-forward. The updater disables Git hooks, credential prompts, global configuration and submodule recursion; it rejects custom execution/filter/include configuration, local edits, local commits/divergence and non-main branches. A source failure is reported independently and does not block installing a verified app. It never runs downloaded source, builds dependencies, resets work or treats a source ZIP as a clone.

**Verified locally on November 8, 2026:** all 492 regression tests passed, including detached-worker completion after the parent exits, same-profile relaunch arguments, busy/cancel guards, version-bound readiness, owned-connection refresh, source preservation and the existing signed-release recovery fixtures. The web build, Mac development package, documentation checks, source/history privacy audit and packaged privacy audit passed. Hidden source and packaged UI checks covered release discovery, progress, cancellation, repository selection, both appearances and narrow layout while preserving synthetic cards, reviews and an unfinished session. CI now includes this hidden update journey.

These checks used disposable profiles and mocked release delivery. No live library or installed app was replaced. A real signed release-to-release UI upgrade remains a distribution acceptance check; this source change has not been published as a new release. The new app must serve its first successful library snapshot before the helper commits replacement; an unsuccessful launch follows the helper's rollback path without restoring a learning database.

## Local Knowledge space (source build)

Knowledge adds a scoped Markdown/HTML notebook with light/dark reading, Markdown editing, safe HTML source editing, recoverable local drafts, revision-conflict checks, move/rename, local assets, KaTeX/Mermaid, explicit backlinks and linked practice. Concepts, Math, Coding and Mixed remain independent session choices; an unfinished session is preserved. Existing note folders and Notion roles are not migrated. New Markdown notes retain canonical IDs in frontmatter; legacy notes moved inside Recall retain identity in a private sidecar.

A dedicated worker owns a separate SQLite FTS5 cache with exact title/alias lookup, ranked full-text search, bounded result pages, changed-file watching and periodic metadata reconciliation. The app keeps this index current in the background for CLI reuse. `kb search` returns index metadata/excerpts and freshness; `kb read` fetches the current source/revision. The original explicit scan, managed-note authoring and Notion publication workflows remain available. The cache is outside profile backups; external note folders must be backed up separately. No changes to the card/review database schema are required.

**Verified locally on November 6, 2026:** 339 regression tests and the web build passed. Hidden real-renderer journeys verified both appearances, narrow layouts, LaTeX and Mermaid, hostile HTML isolation, save/restart draft recovery, external-file changes, all four practice formats, new-note writing and unchanged cards/reviews. Atlas's separate 1,103-card hidden regression also passed. The synthetic production-worker benchmark at 50,000 notes measured warm p95 round trips of 2.31 ms for alias queries, 0.18 ms for selective text, 31.21 ms for a common term and 0.22 ms for misses. Initial indexing took 22.47 seconds; an unchanged metadata pass took 2.32 seconds. These are local worker/retrieval measurements, not end-to-end UI latency, live-vault acceptance or competitor benchmarks. The actual packaged app passed the same invisible Knowledge journey, and source/history plus packaged privacy audits passed. Installation and hosted CI remain separate gates.

[Illustrated Knowledge guide](KNOWLEDGE_SPACE.md)

## Interactive diagrams inside Knowledge Notes (source build)

Knowledge Notes can reference an existing card widget with a `recall-visual` fence. The note uses the exact library visual through the existing sandbox, without accepting scripts from the note. An explicit per-card enable action and a separate Load click remain required. The permission-only update rejects stale content and preserves the card revision, content, schedule, drafts and review history. Missing references remain readable. Leaving Notes, switching Knowledge views or editing removes the frame; Expand/Collapse and appearance changes retain active inputs.

The public visual skill now requires comparison with the approved composition and controls. Render counts, label preservation or colored text transcriptions cannot establish that a requested illustrated redesign was applied. Runtime support must be checked before adding live note references; older releases show the fence as code.

**Verified locally on November 8, 2026:** 477 Node regression tests, the web build and documentation checks passed. Hidden synthetic Knowledge journeys cover permission/Load separation, direct-request 403s, sandbox isolation, controls, appearance, expansion, navigation unload, missing references, hostile note content, editing/drafts and learning preservation. A separate private-content check reused the exact approved Batch Coalescing visual in its note and verified all 32 control combinations in four width/theme configurations (128 scenarios). These results apply to the source candidate; they do not establish installation or public release of this feature.

### Note-owned diagram assets (source build)

Local Markdown/Obsidian notes can reference immutable visual JSON assets under their configured source’s `Visuals/` directory. The asset hash, source scope and current note reference are verified before serving it through the existing opaque widget sandbox. Explicit per-note permission and a separate Load click remain required. The CLI previews and saves assets without making flashcards or granting trust; changed content gets a new hash and permission boundary. Source backups must include these assets.

Focused regression checks cover stale revisions, content mutation, missing references, path/symlink rejection, read-only sources, preview side effects and permission revocation. Hidden real-renderer tests exercise the asset through its actual note, including the direct 403, independent Load, live controls, expansion and unchanged card/review data. Private library migrations and app installation are separate from this public runtime implementation.

## Quiet preparation and connections (source build)

The current source build adds a previewed background queue of up to eight captured items, a process-local card search index with exact-content invalidation, and per-item timing/receipt checkpoints. Existing ready objectives keep the immediate capture path. New candidates are refreshed after every item so later work can reuse earlier imports. Provider jobs remain serial, tool-free and cancelable; blocked work remains explicit. Interrupted batches do not retry automatically. Local retrieval measurements do not establish end-to-end model latency.

Routine visual QA now has a guarded invisible Electron mode restricted to marked temporary profiles. The real app renderer, widget origin and sandbox remain intact. Strict verification disables ratings, native runs, provider calls and connection changes; copied QA widget permissions never flow into the real library. The card verifier hashes content, scenarios, runtime/dependencies and its own rules, and caches only successful reports with intact screenshot evidence. Older executables that lack hidden mode are rejected before launch.

Settings now has a unified Connections hub, recognizable integration icons and progressive readiness details. Paper setup is reachable from the assistant as well as iPad setup; speech uses the existing shared credential flow. Exact-revision local coding attempts are recorded for ordinary coding cards as well as catalog challenges. Progress now opens to the Review journal, and Knowledge’s My Brain provides graph exploration. Existing review, explanation and attempt records are preserved; navigating the journal does not replace an unfinished session.

**Verified locally on October 31, 2026:** all 326 Node tests and the web build passed, along with 25 hidden visual-runtime scenarios. Three representative cards passed the content-addressed verifier; repeating unchanged checks reused all three cached reports. Hidden source and packaged UI checks covered both appearances, setup navigation, evidence inspection, a math-only map session and preservation of an unfinished session. Documentation links and source/history/packaged privacy audits passed. A synthetic 1,100-card local retrieval benchmark improved from a 209 ms median to 1.1 ms warm (33 ms cold); this measures candidate lookup, not provider response time. No live provider benchmark or new iPad device test was performed for this change. This is a locally built candidate, not a newly published release.

[Usage and evidence boundaries](LEARNING_FLOW.md) · [Invisible verification](../skills/recall-source/references/invisible-verification.md)

## What works today

### A simpler iPad writing desk (source build)

Recall Pad opens to **Continue**, **New note**, and mixed recent work, with **Notebooks** and Mac questions still directly reachable. Continue uses the last opened saved item and safely falls back when it no longer exists. Opening Home does not create a note or submit anything. New notes remain private until explicitly added to Recall.

Writing keeps the existing PencilKit canvas, with pen/erase/undo first and secondary tools behind menus. Notebook shapes, selection, ink settings, pages and exports remain available. Incoming Study/Tutor questions offer **Open** in a floating banner; they do not replace or move the current writing surface automatically. Opening the next question saves the current work first and retains its original question/session binding.

Submission stays on the writing page with an inline receipt. The receipt distinguishes local saving, waiting, actual Mac receipt, tutor access and feedback; newer edits are identified as unsent. Exact-version repeat sends reuse the immutable submission after checking context and saved ink. Edited work gets a separate snapshot, and delivery failures retain an explicit manual retry. Notebook receipts describe only the selected submitted pages, without claiming that cards or Knowledge Base notes have been prepared.

No storage schema, saved drawing format or learning-history migration is involved. Existing notes, handwriting, shapes, submissions, review events and schedules retain their current storage contracts.

**Verified locally on November 7, 2026:** all 150 native iPad simulator tests, 12 portable Swift tests, 474 Node regression tests and the web build passed. Native fixtures cover regular and 320-point layouts in light/dark appearance, unchanged saved files, reopening handwriting and shapes, immutable submission bytes, exact-version resend, explicit retry and stale-context rejection. Receipt refreshes retain the same canvas and pending ink; the production incoming-prompt overlay retains canvas geometry, scroll offset and undo state without an automatic Open action. Tests used disposable stores and a dedicated simulator; the live Recall library and installed iPad app were not modified. This is a source update: physical Pencil interaction, real-device pairing/delivery and TestFlight installation were not performed.

[iPad writing](HANDWRITING.md) · [Private notebooks](NOTEBOOKS.md) · [Paper-learning handoff](PAPER_LEARNING.md)


### Review journal (source build)

Progress now opens directly to the Review journal. Knowledge’s My Brain is the graph entry point; the duplicate Atlas dashboard tab is removed. The journal uses the shared warm-light/forest-dark appearance with coordinated chart colors, selectable daily activity and the existing 7/28/90-day ranges. It adds first-versus-repeat activity, a review-weighted trailing-seven-day recall trend and a seven-day snapshot of scheduled reviews with older overdue cards separated. Format/topic summaries, difficult-card links and day-history navigation remain available.

The added metrics read existing cards, schedules and review events without a database migration. First reviews use each card’s earliest surviving scored event across all history; trends include the six earlier days needed at the visible range boundary. Practice, undone, invalid and future ratings are excluded. Schedule counts exclude new, draft and suspended cards and do not simulate future repetitions. Unknown recall remains unestimated, and none of these charts claims mastery. Existing Atlas evidence records and backend evidence tests are retained.

**Verified locally:** all 474 Node regression tests and the web build passed. Hidden real-renderer journeys verified exact metrics for 7/28/90 days, first/repeat activity, keyboard trend inspection, populated and empty schedule charts, day-history and hidden-answer navigation, zero Atlas requests, both appearances and narrow layouts. They preserved cards, reviews, schedules and an unfinished math session. The hidden Constellation regression also passed with 1,000 leaves, all formats, both appearances and narrow layouts, preserving notes, cards, drafts and the unfinished session. Source UI checks use disposable synthetic profiles; this is not a new installed or published app release.

| Area                 | Implemented behavior                                                                                                                 | Details                                                              |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| Study                | Concepts, Math, Coding and Mixed sessions; independent topic/collection filters; explicit front/back reveal; FSRS ratings.           | [Workflow](WORKFLOW.md)                                              |
| Rich cards           | LaTeX, images, Mermaid, isolated SVG and interactive visuals loaded on request.                                                      | [Authoring](AUTHORING.md) · [Visuals](WIDGETS.md)                    |
| Coding               | Spacious matching editor, Python/C++ starter code and tests, explicit local validation and restricted execution.                     | [Coding runtimes](SETUP.md#optional-coding-runtimes)                 |
| Self Test            | Captured-day questions, previous-day review, needs-practice and repeat passes with strict format filters.                            | [Daily workflow](WORKFLOW.md#5-prepare-and-take-the-daily-self-test) |
| Progress             | Review journal with daily activity, recall trend, scheduled reviews, format/topic summaries and searchable review history.        | [Review journal](LEARNING_FLOW.md#see-where-to-practice-next)        |
| Voice & Speak        | Editable card dictation and explanation practice for a card, KB note or custom topic; audience-aware coaching and one focused retry. | [Voice](VOICE.md) · [Speak](SPEAK.md)                                |
| Learning connections | Managed Codex/Claude global instructions, profile bridge, separate readiness checks, scoped optional catch-up and an inbox.          | [Connections](WORKFLOW.md#2-connect-the-assistants-you-use)          |
| Knowledge sources    | Guided Markdown/Obsidian/Notion setup, multiple new destinations, explicit scope/access and primary-first mirrors.                   | [Knowledge sources](KNOWLEDGE.md)                                    |
| Library safety       | Atomic card imports, stable identities, one previous version per widget-edited card and optional full profile exports.               | [Migration](MIGRATION.md) · [Privacy](PRIVACY.md)                    |

**Backup growth fix verified locally on November 6, 2026.** All 339 Node tests and the web build passed. A signed local build opened and applied a queued card import without creating a profile backup. Hidden renderer checks passed on concept, math and coding cards using a disposable profile.

## Important boundaries

### Tutor prompt LaTeX source fix

The shared iPad question formatter now preserves double-dollar delimiters literally and keeps line breaks inside equations as text, so multiline display math reaches KaTeX without intervening HTML breaks. Existing saved prompts and submissions remain unchanged; a corrected prompt must be published again to replace an already formatted front.

**Verified locally on October 19, 2026:** all 317 Node regression tests and the web build passed. A native iPad simulator test rendered the actual expanded Tutor prompt with all four supported delimiter forms and two multiline display equations using bundled offline assets. This is a source fix, not an installed Mac app update; the iPad renderer itself required no code change. Prompts on the existing installation can use single-line backslash-delimited math in the meantime, with currency amounts written as words to avoid interpreting dollar signs as math delimiters.

### Visual runtime and benchmark source update

The source build uses one shared app/widget palette, a bundled `RecallVisual` 1.0.0 toolkit and an instance-bound version 2 lifecycle protocol. Explicit Load, the opaque sandbox and offline CSP remain intact. Widgets have visible loading/error recovery, bounded automatic sizing, Reset, and expansion that retains the current iframe and inputs. Escape works from inside that iframe. A changed card revision returns to the Load gate.

Three synthetic [visual benchmarks](../examples/visual-benchmarks/README.md) cover yield-curve steepening, value-weighted duration gaps and weak-reference ownership. Their pure model tests are included in `npm test`; `npm run test:visuals` runs the actual Electron scenarios in an isolated profile and saves local screenshots. `npm run preview:visuals` builds an offline HTML gallery under ignored `evidence/visual-benchmarks/`. These preview commands do not import into a personal library or rate cards.

The widget-only revision CLI previews canonical content hashes, backs up before an atomic batch, preserves prose and learning records, rejects stale content and uses the existing writer while the app is open. Durable receipts prevent duplicate revisions after interruption; restored pending requests require explicit resubmission. Public and installed Codex/Claude authoring guidance separates calculation checks, rendered interaction QA and import receipts. Existing cards are not automatically migrated by this source update; benchmarks must be reviewed before broader migration. This does not publish or install a new release.

### Private notebook source build

The new source implementation adds a separate Recall Pad **Notebooks** space: notebooks contain named notes and user-managed PencilKit pages. Its additive index does not modify the live Study/Tutor index. Autosave never captures or submits learning. Explicit selected-page or selected-note notebook sends create immutable, Mac-bound offline snapshots; uploads preserve every selected drawing and rendered page through the existing authenticated writer.

The Mac's **From your notebooks** panel separates storage, assistant preparation, cards and per-source KB outcomes. The text-only worker skips notebooks. A full assistant uses the new page inspection/export CLI and [notebook result contract](../skills/recall-source/references/notebooks.md), searches/reuses concepts and cards, and supplies exact-source/page evidence plus actual scoped KB record revisions. Partial KB failures retain successful cards and allow a scoped retry. No notebook workflow rates a card or changes schedules.

**Verified locally on October 11, 2026:** all 284 Node regression tests, 69 native iPad simulator tests (including 14 notebook persistence/recovery tests), 12 portable Swift tests, the web build and an unsigned iPad device-SDK build passed. An isolated Electron journey passed in both source and a separate packaged Mac app: ordered page preview, keyboard/focus handling, assistant prompt copying without dispatch, partial KB results, remaining-gap handoff and restricted Tutor IPC. Synthetic cards, schedules, reviews, live sessions and the read-only KB stayed unchanged. The notebook regression tests also cover supplement-only and KB-only retries preserving earlier captures and card links.

Simulator interaction verified separate Live/Notebooks navigation, notebook/note creation, page creation/rename/navigation, reopening, paired-Mac and blank-page Send guards, Cancel without sending and deletion Cancel preservation. Light/dark screenshots use synthetic notes. Source/history and packaged privacy audits passed; image pixels were reviewed separately. These checks establish the tested storage, transfer and writer boundaries, not live handwriting interpretation or remote Notion authoring quality.

These checks describe the initial notebook source implementation. The later build-7 verification below establishes physical writing and notebook transfer; full assistant-to-KB/card preparation remains a separate gate. [User guide](NOTEBOOKS.md).

### Direct-to-canvas notebook source update

The next source UI opens a note directly on its remembered writing page. **New note** creates a blank first page without a naming prompt; the note title can be edited above the canvas. A **Pages** tray keeps page navigation and historical sent snapshots available without making the reader pass through a page overview. Notebooks remain the organizational list of notes, and **Send to Recall → Send selected** remains an explicit snapshot handoff.

**Verified locally on October 11, 2026:** the final source passed 77 native iPad simulator tests, 284 Node regression tests and the web build. Actual simulator interaction confirmed direct entry into an existing note's canvas, persistent inline title editing, returning to Page 2 after closing/reopening the note, choosing Page 1 through the optional Pages tray, and **New note** opening a blank untitled page without a naming prompt. The [guide screenshots](NOTEBOOKS.md#write-first) show this source UI with synthetic notes. Background ink autosave keeps title drafts separate; explicit navigation and Done require successful saves before leaving the page. Remembered-page metadata does not change content revisions, and renaming leaves the canvas identity intact.

These checks describe the direct-entry source candidate. This interface is included in the later installed TestFlight build 7, whose physical verification is recorded below; the candidate's simulator evidence alone did not establish notebook transfer or a KB/card outcome.

### Continuous sheet and diagram source update

The native update keeps a single growing vertical sheet as the default, with 35%–300% pinch zoom and a grid that shares paper coordinates with ink. Existing pages stay recoverable through the optional Pages tray; another sheet can be added from the menu. A compact diagram palette adds rectangles, ellipses, diamonds, arrows and editable text. Select supports moving/resizing, a visible **Edit text** action complements double-tap, and **Write** returns to Pencil input. Labels remain attached to their shape. The palette's accessible **On this sheet** list provides a second selection route. Local autosave and explicit offline **Send selected** remain separate.

Editable revisions use a versioned native artwork archive containing PencilKit ink and bounded vector objects. Legacy raw-ink revisions and queued immutable submissions retain their original bytes. The Mac stores the compound archive opaquely under the existing v3 hash/size contract; rendered exports must include all selected ink, geometry and labels. See [the protocol boundary](PAD_PROTOCOL.md#native-notebook-editable-assets).

**Verified locally on October 11, 2026:** the final continuous-sheet and diagram source passed all 93 native iPad simulator tests, all 284 Node regression tests and the web build. Checks cover bounded shape geometry, long/offscreen exports, editable compound recovery, preservation of legacy and queued assets, zoom coordinates, shared undo, complete label rendering, arrow-label hit testing and the accessible object-selection list. The source/history release privacy audit passed.

Actual simulator interaction confirmed upright labels, autosaving a second synthetic object and its label, selecting it through **On this sheet**, exposing **Edit text** and **Color** controls, and undoing/redoing the arrow. Both labels survived rebuilding and reopening the native app. The [diagram screenshot](NOTEBOOKS.md#write-and-diagram-on-one-sheet) shows actual synthetic simulator content. Automated simulator input did not establish touch scrolling, pinch, dragging or resizing; the coordinate checks are unit evidence only.

Recall Pad 0.1.0 build 7 has a locally signed archive and verified exported IPA. Apple finished processing the uploaded build, the owner approved its encryption declaration, and the existing internal TestFlight group reports it as Testing. Xcode's uploaded app matches the verified executable, all 73 resources, metadata and entitlements; the comparison was performed after upload and excludes signing/profile byte differences. Device metadata confirms the TestFlight installation as 0.1.0 (7), and the owner confirmed that it opens with existing work present. The owner separately verified continuous Pencil writing, finger scrolling beyond two screens, pinch alignment, rectangle/arrow creation, editable labels, moving/resizing, Undo/Redo and reopened ink/object recovery on the physical iPad. The previously validated build-6 candidate remains unchanged. Whole-notebook preparation is atomic on the iPad; after preparation, each note retains separate upload and processing outcomes.

The physical notebook send also reached durable Mac storage. Installed CLI inspection found two distinct snapshots of the same selected source revision, each with four PNG image pages. All four ordered images were inspected: the label remained readable and lower offscreen writing was present. Build 7's **Send selected** can complete without visible confirmation, leaving the selection screen open. Reopening and sending an unchanged selection creates another snapshot; the two received submissions establish that the same work was sent twice, not that one presentation bypassed its duplicate-click guard. Its selection thumbnails show the beginning of each source sheet, not a complete rendered export preview. No assistant preparation was run on this test content; receipt of the pages does not establish KB or card creation. Extended palm handling, VoiceOver, force-termination recovery and full assistant-to-KB/card preparation remain gates.

### Notebook send feedback source fix

The next source UI pins a visible saving/receipt panel above the selection list and permits one immutable commit per presentation. **Saved** disables the confirmation action, **Done** returns to writing, and available transfer retries reuse the saved submission IDs rather than create fresh snapshots. It distinguishes queued work from durable Mac receipt and keeps KB/card processing separate. The rendering, storage and v3 transfer contract are unchanged.

**Verified locally on October 11, 2026:** all 98 native iPad simulator tests passed, including five send-feedback cases. Native hosting and rendered-text checks cover the status panel at compact widths in light/dark appearance; these are fixture checks, not physical interaction or a complete selection-screen walkthrough. All 284 Node regression tests and the web build passed. The release privacy audit passed across 289 source files, 36 binary files and 627 historical file versions. The build-8 archive and exported IPA passed local signing/resource checks and remain unuploaded. The send-feedback fix was subsequently bundled into installed build 9 below; its receipt UI still requires a physical follow-up.

### Notebook object-editing source update

The editor now opens and reopens in **Write** with direct ink, selection and shape tools. Selecting an object displays a floating **Text · Style · Duplicate · Delete** bar; selection does not shift the canvas. Shape deletion needs no confirmation and remains undoable. Contextual style controls expose canonical colors, container fill, line thickness and text size with full label-bound validation. The handwriting lasso, paper choices and accessible object list remain under **More**. Hardware-keyboard object commands require committed selection and canvas focus; title/label inputs and editor modals suppress these custom commands. Existing artwork, immutable snapshots and transfer formats are unchanged.

Simulator interaction found a toolbar Undo defect in the earlier source: undo could redraw an object without publishing it back to SwiftUI's object list or saved state. Accepted Undo/Redo commands now drain after the representable update, retaining order and identity and cancelling when the canvas is removed. This preserves editable objects and pending Pencil ink instead of merely restoring visible layers.

**Verified locally on October 11, 2026:** all 106 native simulator tests, all 284 Node regression tests and the web build passed. Eight new native cases cover keyboard/text/modal boundaries, bounded duplication, visible actions at compact/light/dark sizes, real `@State` toolbar Undo through stored/reopened object recovery, and queued command order/cancellation. Actual simulator interaction verified direct selection, visible Delete, toolbar Undo restoring the object list, duplication/Undo, one-tap Write, Done/reopen recovery, shape creation, attached text editing and the Style fill control. The [guide](NOTEBOOKS.md#write-and-diagram-on-one-sheet) uses new synthetic simulator screenshots. The device confirmations below cover direct editing and recovery; VoiceOver remains a separate check. Build 9 includes the send-feedback fix and is installed through TestFlight. The owner confirmed that it opens with existing notebooks and sheets present; this is an observed preservation check, not a byte-for-byte comparison.

Build 9's local signed archive and exported IPA passed distribution identity, disabled-debugger, provisioning, Apple-anchored signature, locked offline-resource and application-layout checks. The source/history privacy audit passed across 289 source files, 38 binary assets and 627 historical file versions; the two new screenshot images were reviewed as synthetic content. Documentation checks passed across 44 Markdown files and 461 links/anchors. Builds 7 and 8 remain unchanged. With owner approval, Xcode uploaded build 9 to App Store Connect; its upload package matches the verified executable, 73 resources, metadata and entitlements. Apple accepted the owner-approved per-build encryption declaration, and build 9 is Testing in the existing internal TestFlight group. The owner confirmed installation on the physical iPad and separately tested a disposable note: direct shape deletion, Undo restoring the object and label, Done/reopen recovery, and Pencil writing after returning to Write all work. These confirmations cover the reported journey; updated Send feedback, VoiceOver and extended palm interaction remain separate checks. Build 3's external beta review was left unchanged.

### Zoom width and attached-arrow source update

Continuous notebook paper now grows to cover the visible right edge at every supported zoom level, retaining its width through layout, style and tool refreshes. This fixes the mismatch where the paper background filled the screen but PencilKit's zoomed drawing area ended sooner. Existing ink and object coordinates remain unchanged.

Straight arrows snap to rectangles, ellipses and diamonds near their outlines. Visible endpoint handles reconnect or detach either end; attached ends follow target movement and resizing. Style exposes the attachment state and an explicit Detach action. Deleting a target materializes and detaches its visible endpoints; Undo restores both the target and its relationships. Legacy free arrows remain unbound on load, and duplicates are independent free arrows. Optional metadata remains inside artwork archive version 1; immutable queued revisions and the Mac's v3 transfer contract are preserved.

**Verified locally on October 11, 2026:** all 120 native simulator tests, all 284 Node regression tests and the web build passed. Fourteen added cases cover actual PencilKit content geometry in portrait, landscape and narrow Split View at 35%, 50% and 75%; live modeled ink near the right edge; save/reopen/export and native Undo; normalized connector geometry, reconnecting and container deletion; strict invalid-reference recovery; and preservation of legacy and queued assets. A separate source review found no blockers in full-array validation or relationship recovery.

Actual simulator interaction confirmed an attached connector, filled endpoint handles, the Style connection status, explicit detachment, toolbar Undo and Done/reopen recovery with both bindings intact. The [guide](NOTEBOOKS.md#write-and-diagram-on-one-sheet) includes a synthetic simulator screenshot. Simulated pointer dragging did not establish finger or Pencil gesture quality. Physical right-edge Pencil writing, endpoint dragging, moving/resizing connected boxes and extended palm behavior remain device gates. These source checks do not update the installed build 9.

Build 10's local signed archive and exported IPA passed distribution identity, disabled-debugger, provisioning, Apple-anchored signature, locked offline-resource and application-layout checks. Source/history privacy checks passed across 289 source text files, 39 binary assets and 627 historical file versions; the added image was reviewed as synthetic simulator content. Documentation checks passed across 44 Markdown files, 463 local links/anchors and 31 image references. Build 10 was uploaded through Xcode after owner approval. A local comparison after upload started confirmed the same executable payload, all 73 resources, metadata and entitlements as the frozen candidate, excluding signing/profile byte differences. Xcode reports the upload complete. App Store Connect has processed build 10, and the owner-approved per-build encryption declaration is saved. After separate owner approval, the build was added to the existing internal group and reports Testing with its existing single tester. No additional testers were invited and the external beta was unchanged. The owner confirmed TestFlight build 10 opens on the physical iPad with existing notebooks and sheets present. Right-edge Pencil writing and attached-arrow gestures still await their separate device checks; earlier frozen candidates are unchanged.

### Four-corner resizing, rotation and smooth curves

The notebook editor now exposes four corner handles and a top rotation circle for selected shapes. Resizing retains the opposite corner, including on rotated shapes and wrapped text. Shapes and their labels rotate together; normalized attached endpoints follow the transformed container. A headless Line tool and a draggable middle circle add one smooth quadratic bend to lines/arrows. Attached endpoints stay anchored while bending; whole-connector rotation and proportional resizing require free endpoints. Style includes a shape rotation slider and Straighten line. Writing still opens by default.

Optional angle/bend fields and line geometry remain inside artwork archive version 1. Existing nil-field artwork retains its encoding and queued snapshot bytes. Shared transforms cover hit testing, visible layers, text clipping, bindings, export bounds and pagination. Curved shafts and solid arrowheads render separately. Recovery rejects invalid metadata or resolved curves outside the page while retaining original saved work. Pinch cancels an unfinished object transformation. The iPad receipt now gives the exact Mac navigation to the received-page preview; receipt remains distinct from KB/card preparation.

**Verified locally on October 12, 2026:** all 136 native simulator tests, all 284 Node regression tests, the web build, documentation checks and source/history privacy checks passed. Native cases cover four corners at three zoom levels, rotation and attached-arrow Undo/Redo, curve selection without invisible hit areas, proportional connector resizing, midpoint/tangent geometry, save/reopen/export, immutable queued work and strict recovery. Four native editor renderings use synthetic fixtures in light/dark appearance and show the actual selected controls and contextual bar. They are rendered test fixtures, not a physical Pencil walkthrough. The simulator's computer-use surface was unavailable during this pass; real-iPad corner, rotation, midpoint, pinch and recovery checks remain release gates. Build 11's frozen signed archive and exported IPA passed all 15 distribution, Apple trust-chain, provisioning, disabled-debugger, privacy, icon, locked-resource and layout checks. It was uploaded after approval, processed, and enabled for the existing internal tester. The tester confirmed installation and preservation of existing work, but reported that dragging a new rectangle produced a preview that disappeared on Pencil lift. That physical failure leaves the editor's gesture gate open.

**Gesture cancellation correction:** two new native regressions reproduced the lost shape in build 11, including a hosted SwiftUI editor with real state refreshes and save/reopen. UIKit's simultaneous-recognition delegate is now a policy query without side effects; only an actual canvas pinch in its began/changed state cancels an unfinished edit. The corrected source passed all 138 native tests and all 284 Node tests, plus the web build, documentation and source/history privacy checks. Coverage preserves committed shapes, original ink, selection, one-step Undo and recovery while checking dormant and terminal pinch states. Build 12 was uploaded and processed, its approved encryption declaration saved, and internal TestFlight testing enabled for the existing tester group. Physical Pencil verification remains pending; local tests do not close that device gate. Earlier frozen artifacts and personal notes are unchanged.

### Learning and review

Capture records discussed exposure. It never infers mastery, rates a card or changes a schedule. Starting a repeat Self Test preserves prior results; only subsequent ratings reschedule the original cards. Study Desk remains the place for scheduled due review.

Card links open with answers hidden. They cannot reveal, rate or execute a card, and they preserve a paused queue. Arbitrary content revisions are rejected rather than silently replacing existing learning material.

### Constellation domain colors and evidence precision — November 7, 2026

Domain colors now follow the primary ancestor path: Computing blue, Mathematics & Statistics violet, Economics & Finance teal, with stable fallback colors for other profiles. Descendants retain their domain hue. A labeled legend and Other domain badges identify retained context while a branch is selected. Canvas markers, hierarchy links and cross-domain gradients use the same theme-aware palette. Hue identifies subject; internal density and explicit assessed/needs-practice labels identify review evidence. Unassessed remains hollow, true zero remains zero, and positive sub-decimal values display as `<0.1`.

A precision defect previously truncated scores to tenths at each aggregation layer, losing small positive contributions in broad/deep hierarchies. Derived scores now keep full precision through card, objective and ancestor calculations. Compensated incremental sums and positive-contributor counts preserve genuine zero after correction or undo. Precision projection version 2 retains model version 1, its eligibility rules, constants and cap. Its atomic migration marks bounded checkpoint recomputation without replaying historical reviews; pending correction/deletion replay flags survive.

**Verified:** all 413 regression tests passed with zero skips, including 71 focused expertise/taxonomy/graph/backup checks and eight graph-model checks. The new tests cover small positive evidence through wide/deep paths, true zero after correction/undo, bounded upgrade/restart without old-history reads, and preserved pending replay work. The final Mac package passed privacy checks and both invisible Constellation and Notes journeys. Graph checks include domain inheritance/context, theme colors, all 1,000 leaves, gestures, format evidence, notes/cards, drafts, sessions and unchanged raw learning data. Light/dark and narrow screenshots were visually inspected. Signed local Mac build 16 was installed with the exact tested application archive. The precision checkpoint upgrade completed with no pending work; read-only inspection confirmed that a previously erased positive domain contribution remains positive while unassessed domains remain unknown. Before/after hashes matched cards, reviews, schedules, attempts, session, note files, drafts and taxonomy. No full-profile backup was created. This is a local update; new notarization and public release remain separate.

### Constellation continuous-canvas and local installation acceptance — November 7, 2026

Constellation reads a versioned local expertise projection with per-objective and per-format summaries, weighted primary-branch rollups, and bounded dirty-card refresh. Normal review appends consume only new events; undo, corrected history, content epochs and clock rollback reconcile the affected evidence without modifying raw reviews or real FSRS schedules. Pure-SQL semantic edit guards retain compact cutoffs instead of card-body copies. Taxonomy updates use revision-checked plans and the existing app writer; the bundled hierarchy skill cannot grant expertise or execution trust.

**Earlier expertise baseline:** 399 regression tests passed before the continuous-canvas and locked-domain changes. A synthetic 3,000-card, 60,000-review fixture initialized in 1.57 seconds, refreshed warm in a 0.54 ms median with no history rows read, and processed one appended review in 2.33 ms reading one new history row. A 1 MiB card fixture survived 128 widget/metadata edits with one dirty marker, no retained content copies, unchanged database size and no automatic profile backups. These finite local benchmarks establish the tested workload only. The expertise constants remain provisional product policy, not scientific calibration.

Knowledge opens the Constellation graph, with the existing Notes workspace available beside it. Notes remain mounted while exploring so unsaved edits and external-file conflict recovery survive the switch. All domain roots remain on one canvas as branches expand and collapse in place. Relationships connect the currently exposed regions while preserving explicit or suggested status. The renderer automatically loads bounded node and edge batches from one graph revision; it does not expose pagination or replace the canvas with a six-branch scene. Viewport-aware labels limit expensive controls without removing the other node markers, and canvas search exposes selectable matches throughout the loaded expansion.

An optional profile-owned `rootPolicy` locks the exact approved top-level node IDs. Ordinary plans preserve it; changing that set requires an explicit policy revision. Explicit mappings win. Under a locked policy, unmatched content can reuse one exact normalized label or alias anywhere in the canonical hierarchy, including a nested branch; ambiguous and unknown topics go to Unclassified instead of creating roots. The reserved note-only Library guides shelf keeps administrative navigation outside the domain hierarchy and scoring. Legacy open-policy behavior remains compatible.

Node density reflects the provisional expertise index from scored reviews; hollow nodes remain unassessed. The inspector separates mapped-objective coverage, evidence confidence, review counts and format-specific results. Indexing issues and the indexed-note count remain visible. Pinch, drag, zoom buttons, keyboard plus/minus and arrow keys, and Fit work locally; reduced motion, pause and offscreen behavior limit animation. Opening a linked note or practice card uses existing navigation and never rates a card or replaces an unfinished review session.

**Current source verification:** all 407 Node regression tests passed with zero skips, including 67 focused taxonomy/expertise/graph backend tests and six graph-model tests. The hidden `npm run test:constellation` journey also passed. It runs the production renderer and real IPC against a marked disposable profile with synthetic indexed notes, taxonomy mappings and scored review transactions. Its 1,000-leaf branch expands completely on the same canvas, with no Next/Previous controls; it checks viewport-aware labels, searching the last leaf, in-place collapse, explicit and suggested cross-links, unassessed and needs-practice evidence, all four formats, wheel and two-touch pinch, keyboard zoom/pan/Fit, light/dark appearances at 1420, 780 and 375 pixels, note/card navigation, hidden answers, retained drafts and unfinished sessions. Raw cards, schedules, reviews and source notes remain unchanged, and every Electron window is invisible and unfocused.

**Current package verification:** the production Mac package passed the invisible 1,000-leaf Constellation journey and the Notes journey, including preservation checks. The packaged CLI passed the hierarchy skill's synthetic forward test, covering the locked root policy, existing-writer queue, revision receipts, idempotence and administrative guide placement. Package privacy checks passed.

**Current local installation:** signed Mac build 15 was installed with the exact tested `app.asar`. The installed launcher applied the authorized complete taxonomy plan and returned its revision receipt. Read-only installed-graph enumeration accounted for the complete note/card inventory with exactly three approved domain roots, a locked root policy and a separate Library guides shelf. Expertise checkpoint pending work reached zero. Before/after hashes verified unchanged raw cards, reviews, schedules, coding attempts, the saved session, all note files and drafts. No full-profile backup was created. New notarization, public release and physical trackpad verification remain uncompleted; these local checks do not close those gates.

### Assistants and knowledge sources

The earlier local build 14 package passed both invisible Constellation and Knowledge journeys for its previous graph implementation, including preservation checks. Its archive passed packaged privacy checks. The taxonomy skill's independent CLI journey verified a live synthetic writer, revision conflicts, idempotent application, scoped concept/note mappings and preservation of notes, cards, reviews and settings. Those historical results do not verify the continuous-canvas revision; public release and physical trackpad verification remain separate.

In that earlier build 14 installation, the installed launcher applied a revision-checked hierarchy request, the initial expertise checkpoints completed, and the hierarchy skill and existing personal publishing routes were reconciled. Before/after hashes verified preservation of source notes, cards, schedules, reviews, coding attempts and the saved session; no full-profile backup was created. This historical local installation was not a newly notarized or published release.

Installed skills, CLI availability, sign-in and a verified learning receipt are separate checks. The bounded **Prepare next** worker has model tools disabled; rich new objectives may need **Finish with assistant** for independent visual, math or code checks. Copying a handoff never dispatches work or bypasses validation.

Claude readiness preserves its default macOS Keychain namespace and the OS username. Read-only Keychain directory access is confined to the local `claude auth status` probe, with network disabled. A negative CLI report does not block learning capture or receipt verification. On October 7, 2026, this path was verified against a signed-in Claude Code 2.1.290 installation; regression coverage checks login isolation, restricted read scope and verification despite a negative CLI report.

The Study Desk shelf offers **View all collections** when more than four collections match. Explicit CLI card imports can queue while the app is open; its writer validates and backs up the additive import, then notifies the interface. Learning-inbox imports send the same refresh signal. Neither path reloads the page or replaces an active review queue. Confirm queued imports with `cards import-status REQUEST_ID`; a pending request is not a ready card. October 7 regression and real-desktop checks verified collection expansion, new collection visibility, unchanged existing cards/history, and preserved concept, math and coding drafts without revealing answers.

Local source checks never author a note. Notion configuration and fetched snapshots do not establish live connector authentication. New Notion setup remains pending until the assistant creates and re-fetches its scoped database, then submits a fresh, consistent receipt. The app checks that attestation; it does not independently authenticate the provider. Mirrors follow verified primary writes through assistant skills, without continuous two-way sync.

### Execution and private data

Widgets run in an opaque sandbox with no network or privileged APIs. Imported code and validation reports cannot grant execution trust. Native execution fails closed without the supported macOS sandbox; canonical filesystem-root scratch/read/execute scopes are rejected. Runtime time/output limits are enforced; memory limits remain unenforced.

Restores clear native-code approvals and reject unexpected database triggers before replacing the live profile. Ordinary app updates retain existing approvals. Worker failures discard raw provider output and retain bounded local categories.

OpenAI keys stay main-process-only in an owner-only local plaintext file, outside Recall exports/profile backups. Recall saves no audio. Software running as the same OS account can read the key; whole-machine backups may include it. See [Privacy](PRIVACY.md).

### Automatic release retention — November 7, 2026

The source release tooling now completes verification with
`npm run release:mac:verify`. It binds the quality evidence to the downloadable
ZIP, checks the signatures and stapled ticket, and compares the extracted app
with the staged and installed copies. It records the verified release and
automatically retains the previous verified release as rollback.
Superseded distribution app bundles and ZIPs are pruned with a retryable file
manifest. Release evidence, active candidates and learning profiles remain
protected. See [release verification and retention](DISTRIBUTION.md#verify-the-release-and-retain-one-rollback).

Local validation passed all 434 regression tests and the production build.
Synthetic release fixtures covered rollback rotation, repeated verification,
incomplete or changed evidence, active builds, path aliases, interrupted removal
and preservation of learning files. A real macOS extraction check covered
framework symlinks, and both retained published ZIPs passed read-only archive
inspection. Physical installation, study, companion and
learning-preservation checks are supplied through the artifact-bound release QA
record for each actual release.

## Verified baseline

Reviewed **October 5, 2026**, on **Node 22.23.3**. The [published source commit](https://github.com/justslee/recall/commit/d2b704e100f2c186743f09317ee96029b6a750b0) passed the full [hosted Verify run](https://github.com/justslee/recall/actions/runs/37405060805).

| Check            | Evidence                                                                                                                        |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| Regression suite | 150 tests passed. Timezone coverage distinguishes host defaults from selected profiles.                                         |
| Fresh setup      | Locked dependencies/runtime install and production build; a separate committed-clone trial passed setup, tests and demo study.  |
| Native isolation | Python/C++ references passed; outside-file, network, system-utility and fork probes were denied. Provider canary checks passed. |
| Desktop journeys | Study, card links, Self Test, Progress, connections, knowledge-source setup and new-KB creation passed.                         |
| Package          | Fuses, archive audit and packaged study/Progress/connections/knowledge/security checks passed.                                  |
| Voice & Speak    | Source and package passed with synthetic audio and mocked evaluations.                                                          |
| Privacy          | Source, full-history and archive checks passed; demo image pixels and public attribution were reviewed separately.              |
| Dependencies     | Registry audit reported zero advisories at review time.                                                                         |

> [!NOTE]
> Synthetic checks do not establish live microphone quality, provider assessment quality, account access or a real user's Notion create/write/mirror experience. A passing privacy audit does not certify arbitrary content or every dependency's source.

For later changes, use the [current workflow result](https://github.com/justslee/recall/actions/workflows/verify.yml) rather than treating this dated baseline as fresh evidence.

## Code and contracts

| Concern                                       | Location                           |
| :-------------------------------------------- | :--------------------------------- |
| Portable contracts                            | `schemas/`                         |
| Profile configuration and writer coordination | `electron/config.cjs`              |
| Imports and local execution trust             | `electron/bundles.cjs`             |
| Live additive import queue                    | `electron/card-imports.cjs`        |
| Coding catalog                                | `electron/catalog.cjs`             |
| Local KB and Notion bridge                    | `adapters/knowledge.cjs`           |
| Profile backup/restore                        | `electron/backup.cjs`              |
| CLI                                           | `cli/recall.cjs`                   |
| Shared skill instructions                     | `skills/recall-source/references/` |

The learning-authoring skills share one quality contract. Schemas alone do not establish editorial accuracy; references, independent math/code checks and actual rendered interaction checks remain necessary. The separate `paper-learning` skill coordinates handwritten work in a requested assistant session; it does not create cards or capture every mathematical discussion.

## Recall Pad development build

The optional companion adds a schema 3 migration, immutable paper submissions and reference snapshots, separate image assessment, a local HTTPS/WSS receiver, native PencilKit drafts/outbox, and a Swift Bonjour discovery helper. Closing the Recall window retains the receiver only when the companion is enabled; explicitly quitting stops it. Answers, API credentials and scheduling authority remain on the Mac.

Tutor Pad opens saved Tutor work directly and sends pages to a separate Mac tray. The user explicitly copies a page and pastes it into any chosen application, or exports/shares from the iPad. There is no chat-app selector, automatic pasting or Accessibility setup. Arrivals and reconnects store work without changing the clipboard. Legacy sheet metadata and immutable manifests remain readable and retryable with their original hashes.

An optional Codex-first paper-learning connection adds scoped session capabilities, immutable problem/writing prompts and selected page reads through a local stdio MCP server. A shared skill keeps hints and discussion in the invoking chat, publishes only useful writing tasks and uses bounded waits or **Check my paper** to receive work. It does not send messages, attach to a draft or wake an idle assistant. Managed Codex/Claude configuration is separate from live-client compatibility; ChatGPT desktop on a supported shared Codex host can reuse its MCP registration. [Paper learning](PAPER_LEARNING.md) describes the setup, actual client limits and manual fallback.

**Verified locally on October 11, 2026:** 237 Node regression tests, six focused connection checks, the web build, 53 native iPad simulator tests, 12 portable Swift tests and a signed device build passed. An actual Electron → stdio MCP → local receiver journey with synthetic paired-device uploads preserved the prompt and returned the original ordered image bytes, in both source and the packaged Mac app. Source handwriting/Tutor UI, packaged Tutor UI and receiver lifecycle checks passed. Source/history privacy checks passed over 252 first-party text files, nine assets and 382 historical file versions; the packaged audit passed over 19,230 entries, 196 first-party text files and 62 assets. Rerun candidate audits after later edits.

The signed update installed in place on a physical iPad with its saved index, drawing and thumbnail bytes unchanged. The Mac package also installed locally, Codex and Claude Code registrations and skills were verified, and a connection-check note was published through the installed MCP server. Existing cards, schedules, reviews, coding attempts and paper data were unchanged. The user then confirmed the note was visible, wrote a line and submitted it. The physical iPad → durable Mac storage → installed MCP read → existing Codex chat image-inspection roundtrip passed for that one-page submission, using an explicit CLI/MCP fallback with the original prompt/revision preserved. No real image or personal content is published.

The returned image hash matched its stored page hash, the durable binding retained the original problem, and cards/reviews/coding state and attempts matched the preinstall baseline. These checks establish implementation boundaries, including session isolation, restore authorization, managed configuration and recovery, plus the one-page live transfer. Fresh-client native MCP discovery/rendering, actual Claude/ChatGPT image delivery, sustained tutoring and grading quality remain unverified. The fallback image inspection does not certify all client integrations.

### Recall Pad Study Index refresh

The native home and editor now share the Mac app's warm paper, forest appearance, serif headings and index-card surfaces. Recent sheets use a native List with All/Study/Tutor filters, swipe-left Delete, long-press actions and a visible options menu. Full-swipe deletion is disabled; every deletion still requires the centered confirmation. Question prompts collapse to leave more room for writing and reopen for a new problem. The tool strip and Send controls adapt to narrow Split View, and current-work export has a direct toolbar button. Pencil input, finger scrolling/zoom, immutable submissions, autosave, pairing and stored-data formats retain their existing boundaries.

**Verified locally on October 11, 2026:** 55 native simulator tests, 12 portable Swift tests, all 271 Node regression tests and the web build passed. New native checks cover pending-ink/canvas/undo preservation through prompt layout changes and all three Send modes at 320-point width in light/dark appearance. Simulator interaction verified the Study filter, light/dark Home, actual prompt Show/Hide, the native Delete accessibility action and Cancel preservation. Mouse-drag automation opened a row instead of establishing touch-swipe recognition, so real-iPad swipe and Pencil interaction remain a device check. Setup screenshots use a synthetic front-only sheet. The source/history privacy audit passed; this verification does not imply a new TestFlight upload or physical-device installation.

Recall Pad 0.1.0 build 4 was archived, exported and uploaded to App Store Connect with owner approval. The immutable candidate passed distribution-signature, disabled-debugger, matching-profile, privacy, icon, resource-layout and locked offline-resource checks. A post-upload comparison confirmed that Xcode's uploaded package contains the same app code, 73 resources, metadata and entitlements as the verified candidate. Apple completed processing, and the owner approved the build's encryption declaration. Build 4 is Testing in the existing internal TestFlight group. Physical-device interaction remains a separate check; build 3's external beta review was left unchanged.

### Earlier development verification

The iPad desk has a rolling three-question buffer, driven by the current/remaining Mac queue. Earlier fronts and saved sheets remain recoverable; completed questions do not refill the buffer, and ending a session clears it. Local verification passed 226 Recall regression tests, 32 native iPad tests and eight portable Swift tests; signed Mac/iPad development updates retained existing cards, reviews, sheets and submissions.

The writing toolbar now offers six canonical ink colors, adjustable pen thickness and a fixed-diameter partial-stroke eraser in compact popovers. Preferences persist on the iPad; tool or appearance changes do not rewrite saved ink. The updated verification passed 36 native iPad tests, eight portable Swift tests, 226 Recall tests and the web build. Native tests cover actual tool settings, pending-ink preservation, invalid-width handling, colored drawing save/reload, white-paper exports and visible blue ink across light/dark appearance. Simulator interaction confirmed color selection, thickness presets and the eraser popover. The signed development update installed and launched on the physical iPad; all six sheet records and five submission records remained unchanged. Physical Pencil use of the new color and size controls still needs user confirmation.

The earlier iPad SDK build, executed native simulator tests, Swift policy tests and isolated transfer/storage/UI checks validate their tested implementation boundaries. Current release gates cover real Pencil behavior, durable transfer/recovery and a reviewed live grading benchmark; desktop draft adapters have been removed. See [setup](HANDWRITING.md), [native builds](IPAD_NATIVE.md), [protocol](PAD_PROTOCOL.md) and [release checklist](RELEASE_CHECKLIST.md).

October 10 development verification includes the existing Recall regression suite, source and packaged handwriting checks, real IPC image intake and receiver shutdown in disposable profiles, backup/restore preservation, release-history and packaged privacy audits, and both native Swift policy suites. A signed iPad Debug build installed and paired on a physical iPad. A reported Tutor Pad crash was traced to infinite bounds on an empty PencilKit drawing; canvas/storage sizing now stays finite, restoration avoids phantom edits, and the grid renders only the visible sheet area. Further checks found saved Pencil strokes despite apparently blank paper; the writing surface now pairs adaptive paper with PencilKit ink, image exports use light appearance, and unchanged bridge refreshes preserve ink awaiting a PencilKit callback. The user confirmed the updated Tutor Pad stays open, saved ink is visible, and new Apple Pencil writing works on their ninth-generation iPad. Existing sheet records were retained. The scanner now creates a sized preview before camera authorization, serializes capture operations, and handles reopening, denied permissions, interruptions and runtime failures. Twenty-two native tests execute on the iPad simulator, six portable Swift tests and 216 Recall regression tests pass, and the web build succeeds. Automated scanner tests use a fake capture driver. The signed scanner update installed successfully, all three sheet records and the existing submission remained unchanged, and the user confirmed the live camera preview works after closing and reopening. The writing surface now follows iPad appearance without replacing strokes or matching tools; native pixel tests confirm both paper colors and contrasting ink, while exports stay white. The signed appearance update installed and all previously saved sheets and submissions remained present. The user confirmed that paper follows iPad appearance and ink stays visible when switching light/dark with a sheet open. Fresh QR recognition and physical interruption recovery were not retested. Extended physical Pencil/palm/scroll/zoom behavior, live tutor draft insertion, a paid assessment benchmark and TestFlight publication remain unverified.

The handoff/deletion update passed 230 Recall regression tests, 37 native iPad tests, five Mac helper policy tests, the web build, source and packaged Tutor Pad IPC/UI checks, and source/history/package privacy audits. Manual delivery now shows **Page receiver ready**; automatic arming shows its countdown and retains actionable permission/composer failures. Confirmed local sheet deletion immediately updates Recent sheets without depending on the bridge connection. Both signed development updates installed successfully: all existing cards, reviews, coding attempts, paper submissions and iPad sheet records were preserved. The installed Mac manual receiver was exercised; automated arming checks use synthetic helpers and do not establish real ChatGPT/Codex paste compatibility.

The subsequent deletion presentation update passed 41 native tests, 230 Recall tests and the web build. A shared, centered confirmation card adapts to light/dark appearance and leaves the writing canvas mounted. Four rendered checks cover readable content and centered geometry in both orientations; simulator interaction verified Cancel and actual deletion from Home and the editor. Follow Mac pauses while confirmation is open. The signed update installed and launched on the physical iPad, preserving all five existing sheet records and five submission records unchanged.

The October 11 Tutor Pad entry update removes the initial destination dialog. Home continues the latest saved Tutor sheet, or creates one blank sheet using the locally remembered destination. The sheet's inline menu selects ChatGPT or Codex; **New sheet** remains explicit. Existing sheets retain their own destinations and work, and earlier immutable submissions are unchanged. All 46 native iPad tests and 230 Recall regression tests passed, along with the web build and source/history privacy audit. Simulator interaction confirmed direct entry, destination selection, same-sheet reopening and separate new-sheet creation. The signed update installed and launched on the physical iPad; its saved-work index was byte-for-byte unchanged. This entry change does not establish automatic paste compatibility with either desktop client.

## Still outside this beta

- Unattended app updates and verified support for other platforms.
- Production-verified handwriting grading and full spoken back-and-forth conversation.
- Continuous knowledge-base synchronization and universal conversation capture.
- A bundled Notion OAuth/API client or connector authentication.

**Next:** [Contributing](../CONTRIBUTING.md) · [Release checklist](RELEASE_CHECKLIST.md) · [Detailed implementation history](history/IMPLEMENTATION_LOG.md)

### Assistant-driven app upgrades — November 7, 2026

The public `recall-upgrade` skill checks official GitHub releases using the installed app's bundled runtime. An explicit upgrade verifies the bounded ZIP, SHA-256, signed publisher, notarization and Apple Silicon executable before gracefully replacing the app. Stable and beta installations follow their existing release channel; newer local versions and builds are preserved. One previous app is retained beside the installation. A saved transaction recovers interrupted replacement and removes superseded app/download files only after identity checks. Learning data and profile backups remain outside this transaction. Previously connected assistants can be refreshed through their existing profile launchers. New source Connections installs the standalone skill for Codex and Claude Code, preserving unrelated skills.

**Verified locally:** all 456 regression tests and the production build passed, including a real process-kill/restart fixture, failed replacement and launch recovery, stale cleanup recovery, channel/build selection, bad downloads, incompatible apps, unrelated-skill preservation and unchanged synthetic learning data. The standalone skill was copied outside the checkout and run with the installed Recall runtime against the actual published beta.6 build 17. With app quit, replacement and launch explicitly disabled for that validation, its downloaded artifact matched the installed app and returned `up_to_date`. A follow-up read-only check passed using built-in macOS commands without Xcode tools. Actual app replacement was tested with isolated fixtures; this change did not replace the owner's running app. This is source functionality, not a newly published Mac release.

### Scoped static-figure revisions — source build

Version 2 visual revision requests can restyle one existing SVG or Mermaid figure per card, with a same-kind presentation proof and exact source-span replacement outside widget/code blocks. Text, geometry and topology changes are rejected. The transaction preserves the exact existing expertise cutoff and leaves normal dirty refresh to replay review evidence under the unchanged objective hash function; it never directly rewrites confidence or cached statistics. Version 1 widget revisions retain their existing contract. Both versions use the existing sole writer, expected-content hash, atomic batch, previous-version record and durable idempotent receipt. Numeric grading, identities, prose outside the selected figure, widget permission and learning state remain preserved. A conservative inert-markup gate accepts presentation-only SVG themes and local references while rejecting executable/network features; the renderer keeps its existing sanitization and isolation.

**Verified locally:** all 469 regression tests and the production build passed in a disposable source checkout, including static math preservation, code/widget overlap exclusion, stale hashes, atomic rollback, malformed/hostile markup receipt-failure recovery, fixed-time expertise equality, prior semantic cutoffs, future rating/undo and normal semantic-edit invalidation. Actual private diagram rendering and installation acceptance remain separate gates. This is a source extension, not a published release or an update to a running app. See [Scoped static-figure revisions](STATIC_FIGURE_REVISIONS.md).


### Installer archive-cache recovery — November 7, 2026

The standalone upgrade helper now hashes physical bundle files through Electron's
`original-fs` and reads package metadata in a fresh runtime. This prevents the
old path-keyed ASAR cache from misidentifying an app after replacement. Existing
transaction identities are converted only after fresh identity and signed-app
inspection; new journals identify the physical hash format. Existing receipts
are revalidated against the published artifact. Signature, publisher, checksum,
notarization and rollback checks remain required; learning profiles are outside
the replacement transaction.

The previous helper reproduced its interrupted-verification error on disposable
copies of the actual notarized build 17 and build 18. The fixed standalone helper
completed the same replacement, retained build 17, cleared its transaction, and
returned `up_to_date` on a second check. GUI quit/launch were stubbed for this
isolated installer test; the real signing and Gatekeeper checks ran. A real
Electron regression warms the old archive cache and checks successful replacement,
failed launch rollback, tampering rejection, process-kill recovery and legacy
journal recovery while preserving synthetic learning files. This source fix does
not modify an already published signed Mac app.

Final local verification passed all 475 regression tests, the production build,
41 focused installer/retention tests, and documentation checks. Existing Codex,
Claude and portable profile skill copies were refreshed with backups. The current
build 18 receipt was revalidated against the published ZIP with app replacement
and launch forbidden; the subsequent installed check returned `up_to_date`.
