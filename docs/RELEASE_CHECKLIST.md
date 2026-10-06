# Release checklist

[Documentation](README.md) / Releases

**Candidate:** `0.6.0-beta.2`, matching `package.json`. Apple Silicon macOS source-build beta; code/docs are MIT, original demo content is CC0-1.0, and imported material retains its own terms.

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

## 4. Publish and verify

- [ ] Confirm the owner/repository and reviewed commit, then publish when authorized.
- [ ] Verify real repository/issue/security-report destinations.
- [ ] Confirm **Verify** succeeds on that exact commit.
- [ ] Keep checkout at `fetch-depth: 0` with `persist-credentials: false`; see [checkout usage](https://github.com/actions/checkout#usage).
- [ ] For a downloadable release, sign/notarize and test the actual download on a clean Mac.
- [ ] Re-run source/history and archive audits after release edits.

> [!IMPORTANT]
> Never publish personal decks, KB exports, connection/profile backups, credentials, transcripts, assessment drafts or private migration evidence as seed content.

Local checks do not establish hosted CI, live provider access or notarization. Check the exact result at [justslee/recall](https://github.com/justslee/recall).

**Next:** [Public review](PUBLIC_REVIEW.md) · [Launch plan](LAUNCH.md) · [Privacy](PRIVACY.md)
