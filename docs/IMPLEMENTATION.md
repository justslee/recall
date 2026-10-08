# Implementation status

[Documentation](README.md) / Implementation

Recall is an Apple Silicon macOS source-build beta. This page summarizes what is implemented and verified; the [implementation history](history/IMPLEMENTATION_LOG.md) preserves detailed, dated records.

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
| Coding catalog                                | `electron/catalog.cjs`             |
| Local KB and Notion bridge                    | `adapters/knowledge.cjs`           |
| Profile backup/restore                        | `electron/backup.cjs`              |
| CLI                                           | `cli/recall.cjs`                   |
| Shared skill instructions                     | `skills/recall-source/references/` |

The eleven skill entry points share one quality contract. Schemas alone do not establish editorial accuracy; references, independent math/code checks and actual rendered interaction checks remain necessary.

## Still outside this beta

- Signed, notarized Mac downloads and verified support for other platforms.
- Automatic handwriting grading and full spoken back-and-forth conversation.
- Continuous knowledge-base synchronization and universal conversation capture.
- A bundled Notion OAuth/API client or connector authentication.

**Next:** [Contributing](../CONTRIBUTING.md) · [Release checklist](RELEASE_CHECKLIST.md) · [Detailed implementation history](history/IMPLEMENTATION_LOG.md)
