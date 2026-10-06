# Public-readiness review

Updated October 5, 2026. This is a source-build beta for Apple Silicon macOS, with a portable learning toolkit and user-configured integrations.

The current onboarding follow-up adds in-app source setup, multi-destination knowledge-base creation and separate assistant readiness checks; its verified results belong in [Implementation](IMPLEMENTATION.md). The October 3 test counts and clean-clone results below remain dated evidence for that reviewed commit, not proof of subsequent edits. The release checklist follows candidate **0.6.0-beta.2**. See the [public repository](https://github.com/justslee/recall) and [Verify workflow](https://github.com/justslee/recall/actions/workflows/verify.yml) for publication and current hosted results.

## Final source security review — October 5

The refreshed dependency audit found advisories in source-map-js and Mermaid's nested KaTeX. The lockfile now uses source-map-js 1.2.2 and deduplicated KaTeX 0.18.10; the registry audit reports zero advisories at review time. This is a dated result, not a guarantee against future advisories.

Backup restore now removes code-execution approvals from the staged database, so restored challenges require review on the destination device. Unexpected database triggers reject the restore before changing the live profile. Provider failure output is discarded instead of being persisted in learning-inbox errors; user-facing errors retain local failure categories and the original learning item. Source/history privacy checks now also inspect excluded tracked roots, historical path allowlists, refs and annotated tags. Synthetic regressions exercise crafted backups, approval reinsertion and secret-containing provider output.

All **147 regression tests** passed, along with the production build, Python/C++ native isolation probes and source desktop checks for welcome/setup, hidden math, Monaco, interactive diagrams and SVG/Mermaid boundaries. Clipboard operations await Electron's asynchronous write; rejected writes never report success and preserve the handoff prompt. CI uses macOS 15 and Node 22.23.3, fetches full history, retains pinned actions and runs the original demo against the packaged app as well as source.

Manual review found original demo content only in the candidate and reachable history; personal profiles, notes, captures, credentials and private installation evidence remain outside the public source. README now leads through one-command setup, four study modes and three optional connection steps, with packaging and advanced workflows collapsed. Signed downloads and live authenticated Notion/Codex/Claude/voice acceptance remain separate work.

The complete source candidate `5e79c8a` was cloned into a new directory with no dependencies or build output. On Node 22.23.3, the README's `npm run setup -- --no-launch`, all 147 tests, full-history privacy audit and original-demo desktop journey passed. The candidate package passed archive privacy (17,926 entries, 182 first-party text files and 59 binary assets), demo study, multi-destination bootstrap and desktop isolation checks. All profiles were disposable; the personal installation and library were untouched. Subsequent documentation-only edits record these results and link the public destination; the hosted workflow checks the final published commit separately.

Timezone acceptance now specifies fixture zones independently of the host. All 149 regression tests pass under UTC and America/New_York; additional checks cover Tokyo day boundaries, host-based defaults and preserved capture dates after changing profile settings. The previous-day desktop journey also passes on a UTC host with a New York profile. These changes correct test assumptions; the app continues to use each user's selected timezone.

## Verdict

The application and learning workflow can be reproduced with another person's knowledge. A clean candidate installation reaches a working study session, and the reusable skills/integration infrastructure are included. Reproducing the full workflow still requires the user's own KB scope, assistant connection, optional API key and daily schedule.

No credentials, private card collection, personal KB export, workspace/page identity or personal screenshot was detected in the reviewed candidate or reachable history. Public examples and screenshots contain original demo material. Pattern checks and manual review reduce risk; they are not a security certification.

The October 3 review started from a checkout whose recent features were uncommitted and which had no Git remote. A clone of the earlier commit would miss the current app. The complete source was committed locally as `3962a43`, then cloned into a fresh directory and verified through the README setup, full tests and demo study journey. Publication and hosted CI were not verified in that earlier review.

## Findings and changes

| Finding                                                                | Result                                                                                                                                                                                                            |
| :--------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recent app/integration files were absent from the committed snapshot   | Complete public source committed locally and verified from a fresh clone. Publishing to the selected GitHub destination remains a release step.                                                                   |
| README screenshots/navigation/voice instructions lagged behind the app | Updated demo-only screenshots, current Settings paths, four study formats and Answer Strip instructions. Added a complete [workflow guide](WORKFLOW.md).                                                          |
| First launch could silently download Electron after no-launch setup    | Setup explicitly installs the locked Electron runtime before building. Download failures stop setup; later launch uses the installed runtime.                                                                     |
| Unsupported older macOS passed prerequisite checks                     | Setup checks macOS 13 or later, matching the bundled Electron minimum.                                                                                                                                            |
| Runtime diagnosis differed from execution                              | Doctor resolves the actual `xcrun` tools and reports the selected scientific interpreter separately.                                                                                                              |
| Scientific Python validation ignored the selected profile              | Validator supports `--data` and `RECALL_DATA_DIR`; documentation includes an explicit optional venv/NumPy recipe.                                                                                                 |
| Custom Codex homes could receive the wrong installation/scan           | Installer, scanner and preparation use the selected/saved Codex home.                                                                                                                                             |
| A stale profile could disconnect another profile's active bridge       | Connection status/disconnect bind to profile identity, with legacy compatibility.                                                                                                                                 |
| Public implementation notes included exact personal study counts       | Generalised preservation evidence without exposing library/review/draft/attempt or paused-queue counts.                                                                                                           |
| Privacy scans missed some databases, encrypted files and archives      | Shared source/package checks cover broader private artifact types, SQLite signatures, common credentials and unsupported first-party binaries; history failures fail closed. Added synthetic regression fixtures. |
| CI omitted voice/Speak desktop flows                                   | Added isolated synthetic checks for source and packaged builds. Hosted execution is still unverified.                                                                                                             |

## What another user configures

| Workflow                                | Included                                                                   | User supplies                                                                  |
| :-------------------------------------- | :------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| Study concepts, math, code or a mixture | Local app, renderer, editor, scheduler, demo and imports                   | Their own content; optional Apple coding tools                                 |
| Author rich cards and supplements       | Shared concept/card/visual/math/code/audit skills and validation contracts | A capable assistant and actually completed checks                              |
| Learn across projects                   | Global Codex/Claude bridge installer and profile launcher                  | Capture opt-in and a fresh assistant session                                   |
| Reference or maintain a KB              | Scoped local adapters and Notion snapshot/outbox workflow                  | Folder or Notion scope, connector authentication and optional write permission |
| Canonical KB plus mirror                | Assistant-driven stable-ID/revision/receipt procedure                      | Selected canonical/mirror sources; no continuous two-way sync                  |
| Daily Self Test                         | Local captures, inbox, linked questions and Markdown logs                  | Preparation and optional host automation/timezone                              |
| Catch-up                                | Incremental supported local session scanning                               | Explicit date/project scope; app open for periodic scans                       |
| Speak and answer feedback               | Transcription/evaluation UI and owner-only local plaintext key storage     | Their OpenAI API account, key, internet and billing                            |

The restricted **Prepare next** worker cannot execute code/calculations or inspect a visual in a browser. Rich new objectives may need a normal assistant to finish independent checks and submit the validated inbox result. Blocked items offer **Finish with assistant**, which copies an item-specific prompt, alongside **Retry**. Missing checks remain blocked; an imported code report does not grant execution trust.

Knowledge-source setup selects Markdown, Obsidian or Notion, explicit scope, and read-only/authoring access. **Test connection** distinguishes local folder diagnostics from Notion scope/snapshot preflight; only the assistant's real scoped connector search proves live Notion access. Assistant readiness similarly separates **Installation**, **CLI**, **Sign-in** and **Learning receipt**. Installed skills do not establish successful capture or authenticated authoring.

The current OpenAI connection saves a user's key once in **Settings & backups → Voice & feedback**, then preserves it across restarts and updates. It stores plaintext in `credentials/openai.key` (`0600` file, `0700` credentials folder), never returns the saved key to the renderer, and excludes credentials from Recall exports/profile backups. Whole-machine backups may include them, and software running as the same OS account can read them. Recall does not use `safeStorage` or access macOS Keychain for this connection. Legacy `openai.enc` files are not automatically migrated or decrypted; they remain untouched until a replacement is successfully saved or the user explicitly removes the key. Earlier verification below is dated evidence for the reviewed build; current credential-change verification is recorded separately in [Implementation](IMPLEMENTATION.md).

## Verification

The clean-install trial used a candidate copy with no initial dependencies/build and an isolated home/profile. Real `npm ci`, explicit Electron installation and production build passed. The desktop trial covered an empty library, the three original demo cards, both themes, widget input/isolation, hidden math and rendered steps, Monaco, actual sandboxed Python execution, manual advance and capture opt-in. Later launch was checked with npm offline mode.

All 95 regression tests passed both in the candidate and the fresh committed clone, including runtime selection, custom assistant homes, profile ownership and stronger source/history/archive privacy checks. Native isolation probes passed for Python/C++ outside reads/writes, network, system utilities and forking. The documented optional NumPy recipe was actually installed in a disposable profile; scientific validation passed its reference and rejected its starter and a realistic incorrect implementation. Dependency auditing reported zero advisories at review time. That is a dated registry result, not a guarantee against future advisories.

The newly packaged app passed its installer/CLI bridge and desktop isolation checks. Its archive audit reviewed 18,161 entries, including 179 first-party text files and 59 binary assets. Application-source matching found no differences across 109 source/assets/package files. Connection checks use isolated temporary homes/profiles. Packaged Voice/Speak checks passed with synthetic microphones and respectively two/four mocked evaluations; they do not verify real microphone quality, live API model access, billing or factual assessment quality. Screenshots were visually checked and use only original demo content.

Source/history checks cover first-party files and reachable commits; a shallow repository now fails the audit rather than claiming complete history. CI requests `fetch-depth: 0` and `persist-credentials: false` as described in [checkout usage](https://github.com/actions/checkout#usage). Package checks inspect the actual first-party archive contents. The workflow targets the documented [ARM Mac runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), and its pinned [checkout](https://github.com/actions/checkout/commit/11d5960a326750d5838078e36cf38b85af677262) and [setup-node](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020) references resolve to the official action repositories. No hosted run was available. Dependency source, arbitrary image pixels and public identity attribution require separate review; commit identity counts are reported without printing names/emails. A passing audit does not establish correctness of every authored card.

## Remaining before broad distribution

1. Publish the reviewed commit to the intended GitHub remote and confirm the hosted workflow. Enable a real private vulnerability reporting channel.
2. Provide a signed, notarized Mac download to remove Node/source-build setup for nontechnical users.
3. Perform a real first-user acceptance trial with authenticated Codex and Claude, a live scoped Notion KB/mirror, and actual voice evaluation. Only the permitted local/synthetic boundaries were tested here.
4. Verify the current guided setup with a real new user: selected local folders, permission boundaries, a live Notion connector, fresh assistant sessions, capture receipts and blocked-item handoff. Configuration/preflight and synthetic checks do not replace that acceptance trial.

See [Launch](LAUNCH.md), [Privacy](PRIVACY.md) and [Troubleshooting](TROUBLESHOOTING.md). Profile backups remain private and must never be used as public seed content.
