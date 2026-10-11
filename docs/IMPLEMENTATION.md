# Implementation status

[Documentation](README.md) / Implementation

Recall is an Apple Silicon macOS beta. Install a published app from [GitHub Releases](https://github.com/justslee/recall/releases), or build from source. This page summarizes what is implemented and verified; the [implementation history](history/IMPLEMENTATION_LOG.md) preserves detailed, dated records.

**Study → capture → prepare → self-test → revisit.**

## What works today

| Area                 | Implemented behavior                                                                                                                 | Details                                                              |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| Study                | Concepts, Math, Coding and Mixed sessions; independent topic/collection filters; explicit front/back reveal; FSRS ratings.           | [Workflow](WORKFLOW.md)                                              |
| Rich cards           | LaTeX, images, Mermaid, isolated SVG and interactive visuals loaded on request.                                                      | [Authoring](AUTHORING.md) · [Visuals](WIDGETS.md)                    |
| Coding               | Spacious matching editor, Python/C++ starter code and tests, explicit local validation and restricted execution.                     | [Coding runtimes](SETUP.md#optional-coding-runtimes)                 |
| Self Test            | Captured-day questions, previous-day review, needs-practice and repeat passes with strict format filters.                            | [Daily workflow](WORKFLOW.md#5-prepare-and-take-the-daily-self-test) |
| Progress             | 7/28/90-day activity, rating/format/topic summaries and a paginated, searchable review ledger.                                       | [Workflow](WORKFLOW.md)                                              |
| Voice & Speak        | Editable card dictation and explanation practice for a card, KB note or custom topic; audience-aware coaching and one focused retry. | [Voice](VOICE.md) · [Speak](SPEAK.md)                                |
| Learning connections | Managed Codex/Claude global instructions, profile bridge, separate readiness checks, scoped optional catch-up and an inbox.          | [Connections](WORKFLOW.md#2-connect-the-assistants-you-use)          |
| Knowledge sources    | Guided Markdown/Obsidian/Notion setup, multiple new destinations, explicit scope/access and primary-first mirrors.                   | [Knowledge sources](KNOWLEDGE.md)                                    |
| Library safety       | Additive imports, stable identities, full profile backups and restored-code review.                                                  | [Migration](MIGRATION.md) · [Privacy](PRIVACY.md)                    |

## Important boundaries

### Learning and review

Capture records discussed exposure. It never infers mastery, rates a card or changes a schedule. Starting a repeat Self Test preserves prior results; only subsequent ratings reschedule the original cards. Study Desk remains the place for scheduled due review.

Card links open with answers hidden. They cannot reveal, rate or execute a card, and they preserve a paused queue. Arbitrary content revisions are rejected rather than silently replacing existing learning material.

### Assistants and knowledge sources

Installed skills, CLI availability, sign-in and a verified learning receipt are separate checks. The bounded **Prepare next** worker has model tools disabled; rich new objectives may need **Finish with assistant** for independent visual, math or code checks. Copying a handoff never dispatches work or bypasses validation.

Claude readiness preserves its default macOS Keychain namespace and the OS username. Read-only Keychain directory access is confined to the local `claude auth status` probe, with network disabled. A negative CLI report does not block learning capture or receipt verification. On October 7, 2026, this path was verified against a signed-in Claude Code 2.1.290 installation; regression coverage checks login isolation, restricted read scope and verification despite a negative CLI report.

The Study Desk shelf offers **View all collections** when more than four collections match. Explicit CLI card imports can queue while the app is open; its writer validates and backs up the additive import, then notifies the interface. Learning-inbox imports send the same refresh signal. Neither path reloads the page or replaces an active review queue. Confirm queued imports with `cards import-status REQUEST_ID`; a pending request is not a ready card. October 7 regression and real-desktop checks verified collection expansion, new collection visibility, unchanged existing cards/history, and preserved concept, math and coding drafts without revealing answers.

Local source checks never author a note. Notion configuration and fetched snapshots do not establish live connector authentication. New Notion setup remains pending until the assistant creates and re-fetches its scoped database, then submits a fresh, consistent receipt. The app checks that attestation; it does not independently authenticate the provider. Mirrors follow verified primary writes through assistant skills, without continuous two-way sync.

### Execution and private data

Widgets run in an opaque sandbox with no network or privileged APIs. Imported code and validation reports cannot grant execution trust. Native execution fails closed without the supported macOS sandbox; canonical filesystem-root scratch/read/execute scopes are rejected. Runtime time/output limits are enforced; memory limits remain unenforced.

Restores clear native-code approvals and reject unexpected database triggers before replacing the live profile. Ordinary app updates retain existing approvals. Worker failures discard raw provider output and retain bounded local categories.

OpenAI keys stay main-process-only in an owner-only local plaintext file, outside Recall exports/profile backups. Recall saves no audio. Software running as the same OS account can read the key; whole-machine backups may include it. See [Privacy](PRIVACY.md).

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

### Earlier development verification

The iPad desk has a rolling three-question buffer, driven by the current/remaining Mac queue. Earlier fronts and saved sheets remain recoverable; completed questions do not refill the buffer, and ending a session clears it. Local verification passed 226 Recall regression tests, 32 native iPad tests and eight portable Swift tests; signed Mac/iPad development updates retained existing cards, reviews, sheets and submissions.

The writing toolbar now offers six canonical ink colors, adjustable pen thickness and a fixed-diameter partial-stroke eraser in compact popovers. Preferences persist on the iPad; tool or appearance changes do not rewrite saved ink. The updated verification passed 36 native iPad tests, eight portable Swift tests, 226 Recall tests and the web build. Native tests cover actual tool settings, pending-ink preservation, invalid-width handling, colored drawing save/reload, white-paper exports and visible blue ink across light/dark appearance. Simulator interaction confirmed color selection, thickness presets and the eraser popover. The signed development update installed and launched on the physical iPad; all six sheet records and five submission records remained unchanged. Physical Pencil use of the new color and size controls still needs user confirmation.

The earlier iPad SDK build, executed native simulator tests, Swift policy tests and isolated transfer/storage/UI checks validate their tested implementation boundaries. Current release gates cover real Pencil behavior, durable transfer/recovery and a reviewed live grading benchmark; desktop draft adapters have been removed. See [setup](HANDWRITING.md), [native builds](IPAD_NATIVE.md), [protocol](PAD_PROTOCOL.md) and [release checklist](RELEASE_CHECKLIST.md).

October 10 development verification includes the existing Recall regression suite, source and packaged handwriting checks, real IPC image intake and receiver shutdown in disposable profiles, backup/restore preservation, release-history and packaged privacy audits, and both native Swift policy suites. A signed iPad Debug build installed and paired on a physical iPad. A reported Tutor Pad crash was traced to infinite bounds on an empty PencilKit drawing; canvas/storage sizing now stays finite, restoration avoids phantom edits, and the grid renders only the visible sheet area. Further checks found saved Pencil strokes despite apparently blank paper; the writing surface now pairs adaptive paper with PencilKit ink, image exports use light appearance, and unchanged bridge refreshes preserve ink awaiting a PencilKit callback. The user confirmed the updated Tutor Pad stays open, saved ink is visible, and new Apple Pencil writing works on their ninth-generation iPad. Existing sheet records were retained. The scanner now creates a sized preview before camera authorization, serializes capture operations, and handles reopening, denied permissions, interruptions and runtime failures. Twenty-two native tests execute on the iPad simulator, six portable Swift tests and 216 Recall regression tests pass, and the web build succeeds. Automated scanner tests use a fake capture driver. The signed scanner update installed successfully, all three sheet records and the existing submission remained unchanged, and the user confirmed the live camera preview works after closing and reopening. The writing surface now follows iPad appearance without replacing strokes or matching tools; native pixel tests confirm both paper colors and contrasting ink, while exports stay white. The signed appearance update installed and all previously saved sheets and submissions remained present. The user confirmed that paper follows iPad appearance and ink stays visible when switching light/dark with a sheet open. Fresh QR recognition and physical interruption recovery were not retested. Extended physical Pencil/palm/scroll/zoom behavior, live tutor draft insertion, a paid assessment benchmark and TestFlight publication remain unverified.

The handoff/deletion update passed 230 Recall regression tests, 37 native iPad tests, five Mac helper policy tests, the web build, source and packaged Tutor Pad IPC/UI checks, and source/history/package privacy audits. Manual delivery now shows **Page receiver ready**; automatic arming shows its countdown and retains actionable permission/composer failures. Confirmed local sheet deletion immediately updates Recent sheets without depending on the bridge connection. Both signed development updates installed successfully: all existing cards, reviews, coding attempts, paper submissions and iPad sheet records were preserved. The installed Mac manual receiver was exercised; automated arming checks use synthetic helpers and do not establish real ChatGPT/Codex paste compatibility.

The subsequent deletion presentation update passed 41 native tests, 230 Recall tests and the web build. A shared, centered confirmation card adapts to light/dark appearance and leaves the writing canvas mounted. Four rendered checks cover readable content and centered geometry in both orientations; simulator interaction verified Cancel and actual deletion from Home and the editor. Follow Mac pauses while confirmation is open. The signed update installed and launched on the physical iPad, preserving all five existing sheet records and five submission records unchanged.

The October 11 Tutor Pad entry update removes the initial destination dialog. Home continues the latest saved Tutor sheet, or creates one blank sheet using the locally remembered destination. The sheet's inline menu selects ChatGPT or Codex; **New sheet** remains explicit. Existing sheets retain their own destinations and work, and earlier immutable submissions are unchanged. All 46 native iPad tests and 230 Recall regression tests passed, along with the web build and source/history privacy audit. Simulator interaction confirmed direct entry, destination selection, same-sheet reopening and separate new-sheet creation. The signed update installed and launched on the physical iPad; its saved-work index was byte-for-byte unchanged. This entry change does not establish automatic paste compatibility with either desktop client.

## Still outside this beta

- An automatic Mac updater and verified support for other platforms.
- Production-verified handwriting grading and full spoken back-and-forth conversation.
- Continuous knowledge-base synchronization and universal conversation capture.
- A bundled Notion OAuth/API client or connector authentication.

**Next:** [Contributing](../CONTRIBUTING.md) · [Release checklist](RELEASE_CHECKLIST.md) · [Detailed implementation history](history/IMPLEMENTATION_LOG.md)
