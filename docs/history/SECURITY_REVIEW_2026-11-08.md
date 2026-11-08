# Public security review — November 8, 2026

[Security policy](../../SECURITY.md) · [Public readiness](../PUBLIC_REVIEW.md) · [Privacy](../PRIVACY.md)

## Result

No API keys, private signing keys, personal learning databases, notes, review history, account contact details or live pairing/session credentials were identified in the checked public source, images and app archives. This is a scoped review, not a certification or evidence that every vulnerability is absent.

**Two older public downloads did contain dependency versions with published advisories.** Beta.3 and beta.7 were changed to unpublished drafts, preserving their assets and Git tags. Users with either installed should upgrade to [beta.10](https://github.com/justslee/recall/releases/tag/v0.6.0-beta.10) or a newer reviewed release. Withdrawing a download cannot remove existing copies or third-party caches.

## Evidence and boundaries

| Surface | Check and finding |
| --- | --- |
| Source and history | The release audit inspected the full 45-commit reachable baseline and 981 historical file/path versions, including deleted content, ref names and commit metadata. The final source audit also covers this review's additions. No private-artifact or credential finding. |
| Independent secret scan | Checksum-verified Gitleaks 8.30.1 scanned all Git refs and the prospective public working tree, with redacted output. No findings. Gitleaks reports 41 diff-bearing commits; the repository audit includes all 45 commits. |
| Attribution | Raw author/committer identities were reviewed without relying on mailmap substitution. They use GitHub noreply or the historical localhost placeholder; no personal email address was found. Public author names and publisher signing identities are intentional attribution. |
| Images | All 51 public PNG/JPEG/WebP assets underwent local OCR, metadata and barcode inspection. No personal-contact, credential, private-project or decoded pairing-QR finding. Flagged metadata contained dimensions, color/resolution information and generic screenshot captions. New article illustrations were also visually reviewed. OCR/barcode detection can miss content. |
| Public GitHub surfaces | Secret scanning returned no alerts; all 30 dependency alerts were fixed. Release text was checked; issue/comment endpoints and hosted artifact inventory were empty at review time. Future uploads and logs require their own review. |
| Mac downloads | Seven archives were matched byte-for-byte to GitHub's published SHA-256 digests. ZIP entry names, bundled first-party source/assets and native-helper strings were inspected. No private profile, signing key, transcript or source-path finding. The latest archive contains 283 first-party files and 17,465 third-party files; third-party source was not manually audited line by line. |
| Dependencies | The current lockfile audit reported zero advisories. Separately, the exact packaged dependency versions and Electron runtime from each public archive were checked against the registry's current advisory database. This identified the older affected downloads below. |
| Runtime | Manual boundary review covered renderer/IPC restrictions, note/card sanitization, scoped KB files, local credentials, backup exclusions, authenticated iPad uploads and signed updates. All 493 regression tests, the build, native isolation probes and hidden hostile-note/widget checks passed. |

Native probes verified denied unrelated reads/writes, networking, system utilities and forking; imported reports cannot grant code trust. Bridge tests cover approval/expiry/replay, revocation, device ownership, front-only questions, reference preservation and idempotent receipts. Hidden renderer checks cover explicit visual loading, denied disabled widgets, hostile notes and preserved data. These fixtures do not establish freedom from all sandbox escapes, malicious-content attacks or real-device failures.

## Findings and changes

### Older releases used affected dependencies

Beta.3 and beta.7 bundled DOMPurify 3.4.16, fast-uri 3.1.8 and Electron 44.2.0. Their versions matched 14 current advisories per archive, including the critical [DOMPurify template/shadow-root advisory](https://github.com/advisories/GHSA-cg2g-xh64-v4q7) and the high-severity [Electron certificate mitigation advisory](https://github.com/advisories/GHSA-jr5w-w6x2-84p9).

This is a dependency-version finding, not a demonstrated exploit in Recall: some advisories depend on API options or features Recall may not use. The unsupported downloads were nevertheless withdrawn rather than offered to new users. Beta.5, beta.6, beta.8, beta.9 and beta.10 had no matching packaged dependency advisories at review time. Beta.4 was already an unpublished draft and was outside the public-download set.

### Continuous checks were strengthened

- Enabled GitHub's automatic dependency security fixes. Secret scanning, push protection and private vulnerability reporting remain enabled.
- Required full commit-SHA pins for GitHub Actions. Workflow tokens remain read-only and cannot approve pull requests; no repository Actions secrets were configured.
- Added weekly npm and GitHub Actions dependency-update proposals, with a bounded number of open requests. They still require review and checks; automatic merging was not enabled.
- Moved the dependency-free source/history privacy audit before installation and app/test execution in CI, with a regression assertion for its ordering.
- Updated release guidance to inspect historical downloads and image metadata/QR payloads, not just the current lockfile and visible screenshot text.

### A hidden note could receive a delayed save shortcut

A prior hosted preservation test showed a draft being saved after switching from Notes to My Brain. The source now checks the current view both in the keyboard handler and before saving. The invisible regression deliberately invokes a retained old callback after switching views and checks that the file remains unchanged and the draft survives. This is a data-integrity guard, not a finding of data exfiltration. It is a source update and is not retroactively included in beta.10.

## Remaining limits

- A local OpenAI API key is plaintext in an owner-only file. It is excluded from Recall exports/backups and was not found in public artifacts, but software running as the same OS user can read it. See [key storage](../PRIVACY.md#api-key-storage).
- Optional AI actions transmit selected content to the provider. Local library storage does not imply zero provider retention.
- Native exercise memory limits are not enforced. The macOS sandbox and bounded execution are defenses, not a guarantee against an OS/runtime vulnerability.
- Old Git tags remain available for historical source; use current supported code and downloads. Package advisories change over time.
- This review did not perform a new real-iPad test, live assessment-quality benchmark, third-party penetration test or every historical workflow-log inspection. No user's live library, pairing, review state or installed app was altered.

Detailed raw diagnostics remain local and excluded from Git. Public documentation contains only reusable procedures and redacted findings.
