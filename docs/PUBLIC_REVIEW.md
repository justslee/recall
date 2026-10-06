# Public-readiness review

[Documentation](README.md) / Public readiness

**Status:** published Apple Silicon macOS source-build beta. The portable app, original demo and learning skill kit are available at [justslee/recall](https://github.com/justslee/recall).

## Verified publication baseline

The reviewed [source commit](https://github.com/justslee/recall/commit/d2b704e100f2c186743f09317ee96029b6a750b0) passed [hosted Verify](https://github.com/justslee/recall/actions/runs/37405060805) on October 5, 2026. Check the [current workflow](https://github.com/justslee/recall/actions/workflows/verify.yml) for later commits.

| Area                  | Verified evidence                                                                                                                      |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh setup           | Locked installation/build and original-demo study from a committed clone.                                                              |
| Regression tests      | 150 passed on Node 22.23.3; timezone fixtures distinguish device and profile settings.                                                 |
| Study & setup         | Source and packaged journeys cover welcome actions, study formats, hidden math, Monaco, visuals, connections and knowledge-base setup. |
| Security              | Native Python/C++ isolation, provider canary, main/frame boundaries and SVG/Mermaid/widget checks passed.                              |
| Privacy               | Source, full-history and archive audits passed; manual review found original demo content only.                                        |
| Dependencies          | Registry audit reported zero advisories at review time.                                                                                |
| Voice & Speak         | Source/package flows passed with synthetic audio and mocked evaluations.                                                               |
| Repository protection | Private reporting, dependency alerts, secret scanning and push protection enabled.                                                     |

> [!NOTE]
> These are dated checks. Synthetic provider tests do not verify a real microphone, account access, live factual assessment or a user's Notion writes. Pattern audits do not certify arbitrary content, image pixels or every dependency.

## What was improved

### Setup and daily use

- One-command setup, three welcome actions and separate Concepts/Math/Coding/Mixed study.
- Guided local/Obsidian/Notion sources, explicit access and multi-destination KB creation.
- Separate assistant installation, CLI, sign-in and actual learning-receipt checks.
- Scoped catch-up, a persistent inbox and **Finish with assistant** for blocked authoring.

### Security and private data

- Patched source-map-js and deduplicated Mermaid's KaTeX dependency.
- Restore removes execution approvals and rejects unexpected database triggers before live replacement.
- Worker failures discard raw provider output and keep bounded local error categories.
- Sandbox scratch/read/execute scopes reject the canonical filesystem root, including symlinks.
- Privacy auditing checks historical path allowlists, excluded tracked roots, refs and tags; shallow history fails closed.

Original demo content remains separate from private cards, KB exports, captures, credentials and installation evidence. The complete [review record](history/PUBLIC_REVIEW_2026-10-05.md) and [implementation history](history/IMPLEMENTATION_LOG.md) retain the detailed findings and dated test counts.

## What each user supplies

| Optional workflow               | User setup                                                                                     |
| :------------------------------ | :--------------------------------------------------------------------------------------------- |
| Assistant capture and authoring | Codex or Claude Code, its login, capture opt-in and a fresh session.                           |
| Knowledge base                  | A selected local folder or Notion scope; authoring permission only when desired.               |
| Notion                          | A working assistant connector and verified scoped operations. Recall supplies no OAuth client. |
| Mirrors                         | Primary and mirror destinations; verified assistant writes, without continuous two-way sync.   |
| Coding                          | Apple's coding tools; optional scientific Python environment for exercises that need it.       |
| Daily scheduling                | A supported assistant host, chosen timezone and preparation request.                           |
| Spoken feedback                 | An OpenAI API account/key, internet and separate API billing.                                  |

Study and the original demo require no account or knowledge base. Notion setup remains pending until an actual assistant receipt is registered; installed skills alone do not establish working capture. See [Workflow](WORKFLOW.md) and [Knowledge sources](KNOWLEDGE.md).

## Remaining acceptance work

1. **Signed distribution:** provide a notarized Mac download and test it on a clean Mac.
2. **Real first-user trial:** verify authenticated Codex/Claude, fresh-session capture, scoped Notion creation/write/mirror, blocked-item handoff and actual spoken feedback.
3. **Ongoing releases:** check each exact commit's hosted results and re-review content before distributing it.

The source-build beta is shareable today. Intel/other platforms, automatic handwriting grading and continuous KB synchronization remain outside its verified scope.

**Next:** [Launch plan](LAUNCH.md) · [Release checklist](RELEASE_CHECKLIST.md) · [Privacy](PRIVACY.md)
