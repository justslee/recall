# Launch plan

[Documentation](README.md) / Launch

The source-build beta is published at [justslee/recall](https://github.com/justslee/recall). The next distribution work is about easier installation and a verified first-user journey.

## Already available

- One-command setup, an original demo and four study formats.
- Optional Codex/Claude connections with separate readiness and capture checks.
- Guided Markdown, Obsidian and Notion sources; new KBs with several destinations.
- Scoped catch-up, a persistent learning inbox and validated additive imports.
- Theme-aware screenshots, backups and private study data kept outside the repo.
- Full-history privacy checks and [hosted verification](https://github.com/justslee/recall/actions/workflows/verify.yml).
- [Private vulnerability reporting](https://github.com/justslee/recall/security/advisories/new), dependency alerts and secret scanning/push protection.

## Next distribution milestones

### 1. A signed Mac download

Build a versioned Apple Silicon release, sign and notarize it, then test the actual download on a clean Mac. The goal is an app that opens through normal OS checks and studies without a separate Node installation.

Use [Electron's distribution guidance](https://www.electronjs.org/docs/latest/tutorial/distribution-overview). Apple Developer/signing credentials belong in maintainer release configuration, never in the repository. A working source build or unsigned archive is not a notarized download.

### 2. A real first-user learning loop

Give a tester only the README and an empty profile. Verify that they can:

1. Reach a study question through **Try demo**, **Import cards** or **Connect learning**.
2. Connect Codex or Claude, start a fresh session and ask a substantive question outside Recall.
3. Reuse a ready card, finish a genuine gap, validate a useful supplement and see a ready Self Test.
4. Select a local/Notion scope and access, distinguish preflight from live checks, and verify a permitted write/mirror.
5. Resolve a blocked item through **Finish with assistant**, then find their data and backup.

Include one missing-runtime case and one interrupted preparation. Test actual voice feedback separately. Record observed outcomes; synthetic provider responses do not establish live integration quality or authentication.

### 3. Repeatable releases

Use the [release checklist](RELEASE_CHECKLIST.md) for every candidate. Commit the reviewed source before testing its fresh clone, confirm hosted checks for the exact published commit, and audit the archive that will actually be distributed.

CI fetches full history and does not persist Git credentials. Setup uses the committed lockfile through [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/). Local checks do not establish a later hosted result or notarized distribution.

> [!IMPORTANT]
> Public examples and screenshots must stay original and redistributable. Personal decks, KB exports, transcripts, drafts, credentials, profile/connection backups and private migration evidence must not become release content.

Source/archive pattern checks supplement manual review; they do not certify arbitrary prose, image pixels or dependency source.

**Next:** [Release checklist](RELEASE_CHECKLIST.md) · [Public review](PUBLIC_REVIEW.md) · [Privacy](PRIVACY.md)
