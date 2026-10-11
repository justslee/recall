# Release checklist

[Documentation](README.md) / Releases

**Distribution preparation:** [Mac download and iPad TestFlight](DISTRIBUTION.md) · [Submission packet](submission/README.md). Use a private copy of the [candidate record](submission/RELEASE_RECORD.md) to keep build, notarization and review evidence distinct. These guides do not close the checks below.

**Source version:** `0.6.0-beta.3`, matching `package.json`. Record each signed candidate's exact source commit and build separately; later documentation or tooling commits do not change an already signed app. Apple Silicon macOS beta; code/docs are MIT, original demo content is CC0-1.0, and imported material retains its own terms.

Use actual candidate output as evidence. Earlier test counts or audits do not validate later changes. [Implementation](IMPLEMENTATION.md) records the reviewed baseline.

## 1. Review the complete candidate

- [ ] Review the diff and every new file needed by a clone: app, shared modules, schemas, adapters, skills, examples, assets and docs.
- [ ] Review public commit attribution and use an account-linked identity without publishing private email.
- [ ] Validate the shared skill kit and optional plugin manifest.
- [ ] Check editorial accuracy, useful visuals, independent math and runnable code separately from schemas.
- [ ] Verify Python/C++ references pass and unfinished starters/representative wrong answers fail.
- [ ] Verify an existing-profile upgrade preserves content, IDs, schedules, reviews, attempts, drafts and paused sessions. Keep private fixture evidence outside the repo.

## 2. Run local and packaged checks

Core commands:

```sh
npm test
npm run build
npm audit --audit-level=moderate
npm run audit:release
npm run package
npm run audit:package
```

- [ ] Run desktop study, card-link, Self Test, Progress, connection, knowledge setup/bootstrap, native sandbox, Voice and Speak checks.
- [ ] Repeat the packaged journeys using the actual candidate executable.
- [ ] Label synthetic microphone/provider/Notion receipts as synthetic.
- [ ] Audit full Git history; shallow history must fail.
- [ ] Inspect image pixels and commit attribution manually.

Packaged check pattern:

```sh
RECALL_TEST_EXECUTABLE=release/Recall-darwin-arm64/Recall.app/Contents/MacOS/Recall npm run test:desktop
```

The [Verify workflow](https://github.com/justslee/recall/actions/workflows/verify.yml) lists the full command sequence. Archive checks inspect first-party contents; they do not certify every dependency.

## 3. Follow only the README from a fresh clone

- [ ] Commit the reviewed candidate and test `npm run setup` in a fresh clone with an isolated profile.
- [ ] Verify **Try demo**, **Import cards** → Library and **Connect learning** → Learning connections.
- [ ] Complete a Concepts/Math/Coding/Mixed review: math starts hidden, flip replaces the front, and widgets/code need explicit actions.
- [ ] Connect Markdown/Obsidian scopes with explicit access and **Test connection**; the check must not author notes or change other sources.
- [ ] Create a multi-destination KB: primary/mirror choices, preview without writes, explicit consent and safe retry without overwritten notes.
- [ ] Complete actual Notion create/re-fetch/receipt handling through a live connector; synthetic receipts are insufficient for live acceptance.
- [ ] Install each supported assistant in an isolated home, check installation/CLI/sign-in/receipt and start a fresh session.
- [ ] Capture a reused objective and genuine gap; verify ready cards and the Self Test.
- [ ] Finish a blocked item through its assistant handoff and validated import contract. Retry must not bypass missing checks.
- [ ] Verify pause/scope/catch-up, data location, backup/restore and interrupted preparation. Exposure/setup must not rate cards, infer mastery or change schedules.

## Recall Pad release gates

The companion is optional; a passing Mac build is not evidence of iPad, transfer or assessment quality. Keep the existing fresh-clone journey working without Xcode or companion permissions.

```sh
npm run build:pad-helper
npm run build:ipad
node --test tests/pad-handoff.test.cjs
```

- [ ] Run native Swift policy and simulator XCTest checks using full Xcode; record the exact build and simulator destination. [Native commands](IPAD_NATIVE.md).
- [ ] On a real iPad, verify Pencil/palm handling, scroll/zoom, long equations, offscreen pagination, dark/light export readability, autosave, termination recovery and PNG/PDF sharing.
- [ ] Verify real pairing through local-network permissions, QR expiry/replay, restart, changed IP, pinned identity mismatch, denied access and immediate device revocation.
- [ ] Verify interrupted/duplicate uploads, changed digests, oversized/invalid images, disk failures, stale questions, offline receipts and backup/restore without automatic assessments or clipboard changes. Existing chat-specific manifests must retry unchanged.
- [ ] Test the packaged Bonjour helper outside ASAR, ordered Tutor page delivery and explicit **Copy page**. Arrival, delayed reconnect and opening the tray must leave the clipboard unchanged. Verify manual attachment or iPad export/sharing into an application chosen by the tester; do not dispatch a chat message. No Accessibility permission or desktop adapter is required.
- [ ] Verify paper-learning skill/MCP preview and managed installation without overwriting unrelated client configuration. In the intended Codex chat, publish a synthetic problem, receive a real iPad submission and inspect ordered MCP image content. Verify wrong capabilities, cross-session reads, ended/restored authority, prompt revision conflicts, stale submissions and bounded wait timeouts. A receipt or mocked MCP response does not prove real-client image delivery. Record Claude/ChatGPT support separately; do not claim automatic idle-chat wakeup or draft attachment.
- [ ] Review a live handwriting benchmark covering alternate correct methods, sound partial work, arithmetic errors, ambiguous notation, unreadable pages and invalid references. Label mocked responses as mocks and require page-linked feedback with hidden solutions and unchanged schedules.
- [ ] Audit native sources, question-rendering resources/licenses, privacy manifests, drawings, credential/TLS backup exclusions and the packaged helper. Use only synthetic public examples.
- [ ] Before TestFlight publication, configure the owner's Apple Developer signing/distribution, review privacy declarations, archive a signed iPad build and test the actual distributed candidate. Do not describe an unsigned development build as an installable release.
- [ ] Complete the owner-approved [App Privacy and encryption decisions](submission/APP_PRIVACY.md), review contact, feedback email, age rating and territories. Keep private form fields and signing material outside Git.
- [ ] Verify the beta reviewer can exercise blank writing without an account, plus the paired flow using the exact signed/notarized Mac download and [review notes](submission/TESTFLIGHT.md#beta-review-notes-draft). An instructional recording does not replace working functionality.
- [ ] Verify public support/privacy URLs, candidate screenshots and the approved beta description before external tester invitations. No temporary pairing code or paper-session capability may appear in public assets.

Unfinished live-device, transfer or grading checks remain open release gates. A successful source build or synthetic receipt does not close them. [Recall Pad setup](HANDWRITING.md) · [Protocol v1](PAD_PROTOCOL.md).

**Development evidence, October 11, 2026:** 237 Node tests, six focused connection checks, the web build, 53 native simulator tests, 12 portable Swift tests and the signed device build passed. Actual source and packaged Electron/MCP journeys passed with synthetic device uploads and original image bytes; packaged Tutor UI and source handwriting/lifecycle checks passed. Source/history and packaged privacy audits passed. The in-place iPad update retained saved index/drawing/thumbnail bytes, and the Mac update and Codex/Claude Code registrations installed with existing learning data unchanged.

The user confirmed the published note on the physical iPad, wrote a line and sent it. Its one-page image was durably saved, read through the installed MCP connection with the original prompt/revision, and inspected in the existing Codex chat using an explicit CLI/MCP fallback. This live roundtrip does not close the broader fresh-client MCP discovery/rendering, Claude/ChatGPT, full physical-device or grading gates above. No personal image or content is used as a public fixture.

## 4. Publish and verify

- [ ] Confirm the owner/repository and reviewed commit, then publish when authorized.
- [ ] Verify real repository/issue/security-report destinations.
- [ ] Confirm **Verify** succeeds on that exact commit.
- [ ] Keep checkout at `fetch-depth: 0` with `persist-credentials: false`; see [checkout usage](https://github.com/actions/checkout#usage).
- [ ] For a downloadable release, sign/notarize and test the actual download on a clean Mac.
- [ ] Verify all bundled executables and required hardened-runtime entitlements, inspect the notarization log, staple/verify the ticket, assess the final archive with Gatekeeper and publish its final SHA-256. Development/ad-hoc signing is insufficient.
- [ ] Record Mac artifact publication and TestFlight upload/processing/review/invitation as separate states. No approval claim before the actual Apple result.
- [ ] Re-run source/history and archive audits after release edits.

> [!IMPORTANT]
> Never publish personal decks, KB exports, connection/profile backups, credentials, transcripts, assessment drafts or private migration evidence as seed content.

Local checks do not establish hosted CI, live provider access or notarization. Check the exact result at [justslee/recall](https://github.com/justslee/recall).

**Next:** [Public review](PUBLIC_REVIEW.md) · [Launch plan](LAUNCH.md) · [Privacy](PRIVACY.md)
