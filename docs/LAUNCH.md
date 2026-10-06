# Public-launch checklist

The source-build beta works locally. The highest-value next steps are about removing setup choices and verifying a complete first-user journey.

| Priority                                 | Work                                                                         | Done when                                                                                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before broad distribution                | Signed, notarized Apple Silicon Mac download with a versioned GitHub release | A downloaded app opens on a clean Mac through normal OS checks and can study without Node installed separately.                                                                                                              |
| Before promising seamless AI integration | Live first-run acceptance with both Codex and Claude                         | A fresh user connects, asks a concept question outside Recall, reuses an existing card, authors a genuine gap, validates a useful coding/math supplement, and sees a ready Self Test without changing any existing schedule. |
| First-user acceptance                    | Guided knowledge sources and assistant readiness                             | A new user can select scope/access, interpret local versus Notion connector checks, start a fresh assistant session, prove capture with a learning receipt, and finish a blocked item with their assistant.                  |
| Before linking the project publicly      | GitHub repository and first CI run                                           | The approved public contents are pushed to the chosen remote, the hosted workflow passes, and README links point to real release/issue destinations, and GitHub private vulnerability reporting is enabled.                  |

The [public-readiness review](PUBLIC_REVIEW.md) records dated source-build evidence. The public source destination is [justslee/recall](https://github.com/justslee/recall); the [Verify workflow](https://github.com/justslee/recall/actions/workflows/verify.yml) reports each published commit's hosted checks. Commit the reviewed candidate before its fresh-clone trial. A working local app is not evidence that a clone includes uncommitted files.

## Prepare the repository for publication

1. Run the source/history privacy audit and inspect the Git diff and untracked public files. Include every runtime, shared module, skill, schema, script, icon and document required by the candidate. Do not use a profile backup as seed content.
2. Commit the reviewed public snapshot. Make a fresh local clone of that commit and follow only the README: setup, demo, packaging and assistant installation in an isolated home/profile. A ZIP of a dirty checkout or passing local tests does not prove the commit is complete.
3. Connect the intended GitHub remote and publish when authorised. Enable private vulnerability reporting under the repository's security settings; verify the actual destination before adding report/release links.
4. Confirm the hosted workflow passes on the published commit, then test a download on another clean Mac. Its checkout uses `fetch-depth: 0` before the full-history privacy audit and does not persist Git credentials. Local checks do not establish hosted CI or notarized distribution.

README screenshots must remain original demo content. Keep local profiles, connection backups, transcripts, assessment drafts, credentials and KB exports out of the release. Audit the actual packaged archive as well as the source tree.

## Already in place

- One-command clone setup, an original demo, and a first-session walkthrough.
- Theme-aware product screenshots and concise paths for study, assistant integration and notes.
- Optional Codex/Claude global connections, readable shared skills, scoped catch-up and a persistent inbox.
- Guided Markdown/Obsidian/Notion source setup, separate assistant readiness checks, a copyable capture test and **Finish with assistant** for blocked preparation.
- Additive validated imports, full profile backups, study-data separation, and release privacy checks.
- Clean-copy install/build plus isolated desktop checks; Automated unit, native sandbox and desktop security regression checks are included.

The source-build setup uses npm's committed lockfile via [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/). A GitHub release download should follow [Electron's distribution guidance](https://www.electronjs.org/docs/latest/tutorial/distribution-overview), including signing and macOS notarization. Signing credentials and an Apple Developer identity belong in the maintainer's release configuration, never in the repository.

## A useful acceptance trial

Give a new tester only the README and an empty profile. Observe whether they can reach the first study question, connect their assistant from another project, identify pending versus ready learning, and locate their data and backup. Include one missing-runtime case and one interrupted preparation. Record actual outcomes; a mock provider response does not establish live AI authoring success.

Do not publish personal cards, KB exports, session excerpts or profile backups to make the demo feel populated. Keep examples original and redistributable. Run `npm run audit:release`, then build the app and run `npm run audit:package` before sharing it. These pattern checks supplement manual inspection; they do not certify arbitrary content or third-party code.
