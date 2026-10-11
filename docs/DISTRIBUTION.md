# Distribute Recall

[Documentation](README.md) · [Release checklist](RELEASE_CHECKLIST.md) · [Submission drafts](submission/README.md)

Prepare two downloads: **Recall for Mac**, signed and notarized for direct download, and **Recall Pad for iPad**, initially through TestFlight. The public source remains available. Neither route requires a hosted library or a Recall account.

> [!IMPORTANT]
> This is a release procedure, not an announcement of an available download. A successful local build is not a signed release, an Apple approval or proof of device compatibility. Record the actual candidate and outstanding gates in a private copy of the [release record](submission/RELEASE_RECORD.md).

## The intended installation

| App            | User installs                       | What the user does next                                                                                                                                |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recall for Mac | The audited, notarized app download | Move Recall to Applications, open it, then try the demo or connect learning. No Node or Terminal is needed to run the packaged app.                    |
| Recall Pad     | TestFlight and its invitation       | Open a blank Tutor Pad immediately, or pair with Recall on the same local network. No Xcode or Developer Mode is needed for a TestFlight installation. |

Python/C++ exercises and assistant integrations have their own optional runtime or client requirements. A packaged Recall app does not install those tools automatically. Keep the [setup guide](SETUP.md) accurate for whichever distribution is actually available.

## 1. Freeze and verify one candidate

Start from a reviewed commit with a clean working tree. Use the locked dependencies and current build scripts. Complete the [release checklist](RELEASE_CHECKLIST.md), including source/history, artifact and image-pixel privacy review.

Keep private decks, profiles, API keys, local signing configuration, device credentials, provisioning profiles, diagnostics and tester evidence outside public assets. Use original demo content for screenshots and reviewer examples. Build archives contain executable code and bundled resources; they must not contain a developer's Recall profile.

Keep a private evidence record with the commit, app versions, build number, SDK, minimum OS, signing checks and exact artifact hashes. Do not commit account contacts, team identifiers, certificate names containing personal details or private device logs to that record.

## 2. Prepare the Mac download

Build the packaged source candidate, then run the read-only preparation check:

```sh
npm run build:pad-helper
npm run package
npm run release:mac -- --check
```

Configure `RECALL_MAC_SIGN_IDENTITY` with the locally available Developer ID Application certificate and choose a new numeric `RECALL_MAC_BUILD_NUMBER`. Keep those values in your private build environment. `RECALL_NOTARY_PROFILE` names an already stored `notarytool` Keychain profile; it is not an API password. No private credential belongs in a command pasted into documentation or Git.

To create a separate signed candidate without uploading:

```sh
npm run release:mac -- --sign
```

After the privacy/signing checks and owner review, the explicit notarization operation is:

```sh
npm run release:mac -- --sign --notarize --staple
```

Only `--notarize` uploads the signed app to Apple. It is not a GitHub publication or App Store submission. The script keeps the installed app and original package unchanged and writes a separate candidate under ignored `release/distribution/`; do not reuse a completed build number. An uncertain/not-finished request requires checking its Apple status before any retry.

1. Build and audit the candidate app, including the bundled native helper.
2. Sign all executable components with **Developer ID Application**, enable the hardened runtime, include secure timestamps and verify the resulting signatures. Release code must not have the debug `get-task-allow` entitlement.
3. Submit the app archive through Apple's notarization service, inspect the complete result and resolve warnings. An accepted request still needs its ticket stapled to the distributable app.
4. Verify the stapled app and the final download artifact. Compute a SHA-256 checksum after the final archive is made; notarization or stapling can change its bytes.
5. Install the actual downloaded artifact on a clean supported Mac. Verify first launch, ordinary study, local profile upgrade, assistant setup, native exercise sandboxing and the enabled companion.

Signing identifies the publisher. Notarization checks malware and signing requirements; it is separate from App Review and does not establish Recall's grading quality. Use the project's distribution script rather than an unreviewed recursive signing command. [Apple notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

Publish only the tested artifact, checksum and concise release notes. Explain manual updates until a verified updater exists. Do not instruct users to disable Gatekeeper or remove quarantine to install a public release.

## 3. Prepare Recall Pad for TestFlight

Run source checks first. An unsigned Release archive can validate bundled assets and release settings without contacting Apple:

```sh
npm run release:ipad -- --check
npm run release:ipad -- --unsigned --version 0.1.0 --build 1
```

These are example candidate numbers, not an instruction to overwrite an existing archive or reuse an uploaded build. Set the owner-approved version and a new build number for the actual submission.

Once Xcode's account and signing configuration are ready, archive and export locally:

```sh
npm run release:ipad -- --archive --version 0.1.0 --build 1
npm run release:ipad -- --export --version 0.1.0 --build 1
```

Check an existing export without rebuilding, signing or contacting Apple:

```sh
npm run release:ipad -- --verify-export --version 0.1.0 --build 1
```

The signed operations require ignored `apps/ipad/Local.xcconfig` with owner-only permissions (`chmod 600 apps/ipad/Local.xcconfig`). If the command-line developer directory still points to Command Line Tools, prefix the command with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. `--allow-provisioning-updates` explicitly lets Xcode contact Apple for signing resources when needed; it does not upload an app. All modes keep archives and detailed logs in ignored, private `apps/ipad/.build/distribution/VERSION-BUILD/`. There is no upload mode in this script.

1. Confirm the final bundle identifier in the owner’s Apple account. Select the intended paid Developer Program team; keep its configuration private.
2. Prepare the locked web resources, then create a **Release archive for a generic iOS device**. Xcode may development-sign this intermediate archive. Use **Apple Distribution** signing for its App Store Connect IPA export. The existing unsigned Debug build command is a development check, not a TestFlight artifact.
3. Validate the exported IPA: icon catalog, version/build, iPad-only device family, deployment target, privacy manifest, camera/local-network explanations and locked web resources. Require Apple Distribution signing, disabled debugger access, matching app/team/profile identities, an unexpired distribution-only profile and no private resources. The intermediate archive's development signature does not establish these export checks.
4. Review the [privacy and encryption worksheet](submission/APP_PRIVACY.md). Resolve the owner decisions before uploading; do not guess privacy or export answers from an empty manifest.
5. In App Store Connect, create or select the app record. Fill the [metadata drafts](submission/TESTFLIGHT.md), real feedback/review contacts, privacy/support URLs, age-rating and any applicable regional requirements.
6. Upload and validate the archive using Xcode Organizer or Apple's supported upload tools. Processing and upload acceptance are separate from beta-review approval.
7. Install the processed build through TestFlight for internal testing. Test the actual distributed build, including pairing with the exact Mac candidate. Then request external beta review if the remaining beta gates are closed.

TestFlight builds expire after 90 days. External testing requires test information and the first external build is reviewed. Record its approved build and invitation separately from the local archive. [Apple's TestFlight workflow](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

## 4. Make the paired flow reviewable

Recall Pad's blank writing, autosave and PNG/PDF sharing work without an account or Mac. Recall Study and transfer need a supported Mac running Recall on the same local network. The reviewer must receive the tested Mac download and exact pairing instructions before review; never publish a live pairing QR code, device credential or paper-session capability.

Use the [review notes](submission/TESTFLIGHT.md#beta-review-notes-draft) and include a short recording with synthetic work when helpful. A recording explains the journey; it does not replace working functionality. If Apple's reviewer cannot access the required companion, resolve that with App Review before treating the submission as ready. Apple asks for access to features and any special resources needed to review them. [App Review preparation](https://developer.apple.com/app-store/review/guidelines/#before-you-submit).

## 5. Keep the release claims narrow

- Confirm the full physical-iPad writing, recovery and transfer matrix before expanding the beta.
- Claim Codex, Claude or ChatGPT image delivery only for a client/version actually tested. Configuration alone is not proof of image delivery.
- Keep AI assessment optional. A live reviewed grading benchmark is needed before promising assessment quality; mock fixtures do not establish it.
- No companion arrival, restore or external handoff should reveal a solution, rate a card, change schedules, send a chat message or start an unrequested provider call.
- Preserve existing app identifiers and profile paths across updates. A fresh installation must start with an empty or original demo library, never personal content.

The Mac App Store remains a separate project: assistant instruction installation, scoped local session/KB access and Python/C++ execution need a dedicated App Sandbox design and compatibility review. Developer ID notarization does not approve a Mac App Store build.

**Next:** [Submission packet](submission/README.md) · [Tester walkthrough](demos/PAPER.md) · [Privacy](PRIVACY.md)
