# Candidate evidence record

[Distribution procedure](../DISTRIBUTION.md) · [Release checklist](../RELEASE_CHECKLIST.md)

Copy this template outside the repository for each candidate. An unchecked field means **unverified**. Do not copy private contacts, signing identity output, device identifiers, credentials or personal screenshots into Git.

## Identity

| Item                                        | Evidence      |
| ------------------------------------------- | ------------- |
| Reviewed source commit                      | Not recorded  |
| Mac version / architecture / minimum OS     | Not recorded  |
| iPad marketing version / build / minimum OS | Not recorded  |
| Xcode / SDK / Node versions                 | Not recorded  |
| Final Mac archive SHA-256                   | Not recorded  |
| iPad archive/export SHA-256                 | Not recorded  |
| Hosted CI for this commit                   | Not recorded  |
| Public release / TestFlight build URL       | Not published |

## Verification

- [ ] Core tests, UI journeys, build and documentation links pass for this candidate.
- [ ] Source/history, packaged resources and screenshot pixels are reviewed for privacy.
- [ ] Existing-profile upgrade preserves cards, reviews, schedules, drafts, paper work and paired identity.
- [ ] Fresh Mac install works without Node; optional tools are explained clearly.
- [ ] Mac Developer ID signatures, hardened runtime and entitlements verify.
- [ ] Notarization result is accepted, log reviewed, ticket stapled and final archive assessed by Gatekeeper.
- [ ] Actual Mac download is tested on a clean supported machine.
- [ ] Exported iPad IPA validates with correct icon, manifest, version, Apple Distribution signature and debugger-disabled distribution profile.
- [ ] Actual TestFlight installation is tested on a supported physical iPad.
- [ ] Pencil/palm/scroll, appearance, pagination, export, deletion and termination recovery pass.
- [ ] Pairing/revocation, wrong TLS identity, QR expiry/replay, permissions and changed IP pass.
- [ ] Interrupted, duplicate, oversized and invalid transfers lose no work; stale questions and restore stay safe.
- [ ] Paired submissions never flip/rate cards or change scheduling authority.
- [ ] Clipboard remains unchanged until Copy page. External messages are never dispatched automatically.
- [ ] Each advertised assistant/client version has an actual image-delivery result recorded.
- [ ] Assessment quality is supported by an independently reviewed live benchmark, if claimed in this release.
- [ ] Privacy, export, contact, age-rating and territory decisions are approved by the owner.
- [ ] All public URLs and reviewer resources work without private account access.
- [ ] Final beta description and review notes match the tested features and known limits.

## Outstanding gates

Record the exact missing check, responsible person, impact and decision. A simulator build, upload receipt or successful mock does not close a physical-device or provider-quality gate.

## Distribution states

Record these independently: **built**, **signed**, **validated**, **notarized**, **uploaded**, **processed**, **beta approved**, **invited**, **published**. Do not collapse them into “released.”

## Recovery

Record the previous audited app artifact and upgrade/rollback evidence. Before replacement, preserve a private profile backup. Profile backups include learning data; they are not release assets. Restoring a backup requires fresh execution/session authority and cannot trigger a provider request, clipboard copy or external message automatically.
