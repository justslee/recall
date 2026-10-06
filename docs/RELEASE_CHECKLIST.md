# Public beta release checklist

Candidate: **0.6.0-beta.2**, matching `package.json`. Code and documentation are MIT; original demo content is CC0-1.0. Imported material retains its own terms. This is an Apple Silicon macOS source-build beta, with optional integrations.

Use the candidate's actual command output as release evidence. [Implementation](IMPLEMENTATION.md) records dated local results; a previous test count or dependency audit does not validate a later candidate.

## Verify the candidate locally

- [ ] Review the diff and every untracked release file. Include the app, shared modules, schemas, adapters, skills, examples, assets and documentation required by a fresh clone.
- [ ] Run `npm test` and `npm run build`, then the documented desktop, connection, native sandbox, card-link, progress, voice and Speak checks. Run `node scripts/smoke-knowledge-setup.cjs` for the source setup journey, then repeat it with `RECALL_TEST_EXECUTABLE` set to the packaged Recall executable. Synthetic provider checks must be labelled synthetic.
- [ ] Validate the original Python/C++ examples: reference solutions pass; unfinished starters and realistic incorrect implementations fail.
- [ ] Run `npm run audit:release` from a full Git clone. Shallow history fails this check. Inspect reported author/committer attribution and image pixels manually; pattern checks do not certify arbitrary content or dependencies.
- [ ] Run `npm run package`, `npm run audit:package` and packaged connection/security/voice/Speak checks against the actual candidate archive.
- [ ] Confirm an existing-profile upgrade preserves cards, source content, identities, schedules, reviews, attempts, drafts and paused sessions. Keep all private fixture evidence outside the repository.
- [ ] Validate the shared skill kit and optional plugin manifest; inspect editorial, interactive-visual, math and code quality separately from format validation.

## Follow only the README from a fresh clone

- [ ] Commit the reviewed candidate, make a fresh local clone and run `npm run setup` with an empty, isolated profile.
- [ ] Check welcome actions: **Try demo** adds only original content; **Import cards** opens **Library**; **Connect learning** opens **Learning connections**.
- [ ] Complete a Concepts, Math, Coding or Mixed review. Math starts hidden, card flipping replaces front with back, and interactive widgets/code still require explicit permission and execution actions.
- [ ] In **Knowledge sources**, connect Markdown and Obsidian with an explicitly selected folder, read-only/authoring choice and **Test connection** result. Verify other sources/settings remain intact; checking a connection must not author a note.
- [ ] Run `npm run test:knowledge-bootstrap` against source and package. Use **Create my first knowledge base** with multiple destinations: check the primary/mirror choices, preview without writes, explicit creation consent, new folders and preserved existing sources. Resume an interrupted setup without overwriting notes. Complete Notion through actual connector create/read-back and its staged receipt; synthetic completion does not verify live access.
- [ ] Configure a selected Notion scope and complete a real authenticated connector search with the assistant. Configuration/snapshots are not evidence of live authentication. Verify any authorised canonical write and mirror independently.
- [ ] Install each supported assistant in an isolated home. Check **Installation**, **CLI**, **Sign-in** and **Learning receipt**, start a fresh session, and paste the connection test prompt from another project.
- [ ] Capture a reused objective and a genuine gap. Verify the receipt and ready Self Test, then resolve one blocked item through **Finish with assistant** and the actual validation/import contract. Retry must not bypass missing checks.
- [ ] Check scope/pause, optional catch-up, data location, backup/restore and one interrupted preparation. No exposure or setup action may rate a card, change schedules or imply mastery.

## Verify publication separately

- [ ] Choose the intended GitHub owner/repository, review commit attribution, configure its remote and publish only the reviewed public snapshot.
- [ ] Enable an actual private vulnerability-reporting channel and verify repository/release/issue destinations before linking them in documentation.
- [ ] Confirm **Verify** passes on the published commit. Checkout must retain `fetch-depth: 0` so the privacy audit sees history; action credentials are not persisted. See [checkout usage](https://github.com/actions/checkout#usage).
- [ ] For a downloadable Mac release, sign and notarize it and test that download on a clean Mac. A local source build or unsigned archive is not a notarized distribution.

The public source destination is [justslee/recall](https://github.com/justslee/recall). Check the [Verify workflow](https://github.com/justslee/recall/actions/workflows/verify.yml) for the exact published commit. Local checks do not establish hosted CI, signing/notarization or authenticated first-user integration. See [Public review](PUBLIC_REVIEW.md) and [Launch](LAUNCH.md).

Never publish personal decks, KB exports, connection backups, credentials, transcripts, assessment drafts, profile backups or private migration evidence as seed content. Re-run source/history and archive checks after release edits.
