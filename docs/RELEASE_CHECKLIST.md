# Public beta release candidate

Version: 0.5.0-beta.1. Code/documentation: MIT; original demonstration content: CC0-1.0. These are the proposed release licenses for maintainer review before public publication.

Verified locally on Apple Silicon macOS:

- 14 backend/CLI tests pass, including the complete KB → cards → self-test → rating → restart/restore workflow, duplicate/conflict handling, scoped assets, timezone retention, catalog merge preservation, code trust, and corrupted-backup rejection.
- Original Python and C++ reference implementations pass; incomplete stubs and representative behavioral mutants fail.
- Electron tests pass on the actual packaged app: empty-profile onboarding, demo import, both system themes, useful widget interaction, widget isolation, hidden math, Monaco/Python and capture opt-in.
- Existing-profile tests pass: onboarding bypass, catalog navigation and coding workspace. Private fixture evidence is deliberately outside the repository. Existing card data and derived visuals survive upgrade and a complete profile backup/restore.
- Source allowlist and packaged app-owned file scans pass. Dependency audit reported zero known vulnerabilities after the archive dependency update.
- All eleven skills and the optional plugin manifest pass their format validators. Those validators do not replace editorial and behavioral review.

Not yet claimed:

- Public GitHub publication or hosted CI execution.
- Signed/notarized distribution or support outside the tested Mac target.
- A live third-party Notion connector round trip. Its scoped request/acknowledgment bridge is implemented and fixture-tested; users supply the actual connected tool.
- Fully automatic background mirroring, arbitrary card revision import, handwriting grading or comprehensive recording of every conversation.

Before publishing: review this tree, choose the GitHub owner/repository, confirm the release licenses, configure a private security-reporting contact, and decide whether to publish source first or also distribute the unsigned Mac beta. Do not include private migration evidence, original personal decks or third-party challenge collections. Re-run source/archive checks after any release edits.
