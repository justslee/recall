# Privacy and encryption worksheet

[Submission packet](README.md) · [User-facing privacy](../PRIVACY.md)

**Engineering evidence for the owner's review, not preselected App Store Connect answers.** Review the final archive, its dependencies and enabled integrations before submitting a declaration. The empty collected-data list in Recall Pad's privacy manifest does not determine its App Privacy label.

## Where information goes

| Flow                   | Content                                                               | Recipient and persistence                                                                                          | Control                                                                                               |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Blank writing          | Pencil strokes, sheet metadata, thumbnails and exported pages         | Stored on the user's iPad. No developer-operated destination.                                                      | Autosave; explicit export; local sheet deletion.                                                      |
| Pairing                | Random device ID, device name, local endpoint and credential exchange | User's Mac stores device registration and credential hash. iPad stores the credential in its device-only Keychain. | Companion opt-in; single-use QR; Mac confirmation; revocation.                                        |
| Recall Study           | Issued question fronts and original submission pages/drawing          | User's paired Mac and iPad. The Mac retains submissions, question/reference snapshots and receipts.                | Scoped authenticated connection; no solution or API key sent to iPad.                                 |
| Manual Tutor transfer  | Selected sheet's complete ordered pages and editable drawing          | User's paired Mac page tray.                                                                                       | Explicit Send to Mac; explicit Copy page; no automatic chat dispatch.                                 |
| Paper-learning tools   | Published prompt, submitted-work metadata and selected images         | User's Mac; selected pages enter the invoking assistant/provider's context when read.                              | Session capability; explicit assistant tool invocation. No transcript crawl to recover chat bindings. |
| Handwriting assessment | Selected pages, question and Mac-held reference                       | OpenAI using the user's Mac-owned API project. Feedback is saved on the Mac.                                       | Explicit request and Mac consent. `store: false` does not prove no provider retention.                |
| QR camera              | Live camera frames used to recognize the pairing code                 | Processed on iPad; Recall Pad saves no camera image or recording.                                                  | Permission requested for the scanner.                                                                 |
| Sharing and backups    | User-selected exports; saved documents/backups                        | Destinations selected by the user and operating-system backups.                                                    | No Recall cloud library. Copies are managed at each destination.                                      |
| Feedback/support       | Information and screenshots a tester chooses to submit                | TestFlight/Apple or GitHub/support contact, depending on submission path.                                          | Review the material before sending; do not include personal work or secrets.                          |

There is no embedded advertising, analytics or crash-reporting SDK in the reviewed iPad source. TestFlight itself provides beta diagnostics and feedback under Apple's service. This statement must be rechecked if dependencies or integrations change.

Review separately any tester feedback or diagnostics the publisher receives and retains through Apple or support. Absence of an embedded analytics SDK does not mean no beta feedback ever reaches the publisher.

### Source evidence to recheck

- `apps/ipad/RecallPad/DocumentStore.swift`: local documents, immutable attempt files, page export and deletion.
- `apps/ipad/RecallPad/BridgeClient.swift`: paired endpoint, HTTPS/WebSocket requests and transfer queues.
- `apps/ipad/RecallPad/Keychain.swift`: device-only credential and pinned public-key verification.
- `apps/ipad/RecallPad/PaperEditor.swift`: explicit submission, assessment disclosure and sharing.
- `electron/paper-store.cjs`, `electron/paper-sessions.cjs` and `electron/handwriting.cjs`: Mac persistence, assistant access and provider assessment.
- `apps/ipad/RecallPad/Resources/PrivacyInfo.xcprivacy`: required-reason API and tracking declarations.

## App Privacy decisions

Apple's collection test concerns off-device transmission accessible to the developer or third-party partners beyond servicing a real-time request. Data processed only on-device is excluded. Optional disclosure has additional conditions; merely offering an opt-in does not qualify. [Apple's definitions](https://developer.apple.com/app-store/app-privacy-details/).

The local companion transfers work off the iPad and retains it on the **user's own Mac**. It does not grant the Recall publisher access. That is the factual basis for a possible noncollection declaration for purely local writing/transfer, not a reason to ignore the transfer or optional provider processing.

**Do not automatically select Data Not Collected for the complete product.** The owner must determine whether optional Mac assessment and assistant-provider access are attributable third-party collection for the submitted iPad app. Review actual retention and vendor relationships. If those flows are included as collection, candidate categories include **Other User Content** for drawings/prompts, and the relevant image-content category where Apple's form requires it. Purpose is app functionality; tracking/advertising are absent from this design. Identity linkage must be evaluated against provider authentication, device identifiers and retention, not assumed absent because Recall has no account.

For the Mac's separate optional microphone features, audio, transcript and selected reference flows need their own declaration review if a Mac App Store product is pursued. They do not run on Recall Pad merely because it is paired.

Record the final data categories, purposes, identity linkage, tracking answer, provider evidence and reasoning in private release evidence. App-level answers must cover the shipped functionality and platforms. [Manage App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy).

### Open decisions before upload

- [ ] Owner has approved the public privacy policy and monitored support/contact route.
- [ ] Final archive and all SDK privacy manifests have been reviewed.
- [ ] Local-only transfer and optional provider flows have been assessed separately; collection categories and identity linkage are documented.
- [ ] No tracking is performed by the candidate or its dependencies.
- [ ] Privacy answers match the actual release scope rather than a future disabled roadmap.
- [ ] Actual image/user-content retention and deletion behavior are explained. Deleting an iPad sheet does not delete copies already saved on Mac, exported or shared.

## Encryption/export review

Recall Pad uses Apple's URLSession/Security TLS and Keychain, CryptoKit SHA-256 content hashes, and public-key fingerprint verification. The Mac receiver uses Node/OpenSSL TLS and a pinned X.509 dependency. Hashes and pinned trust are not a custom encryption algorithm, but the two binaries have different cryptographic implementations to assess.

Apple explains that OS-provided HTTPS commonly qualifies for exemption from documentation upload; the owner remains responsible for determining applicable export requirements. Answer the current App Store Connect questionnaire for the iPad archive and intended territories. Do not describe the app as using no encryption. [Apple export guidance](https://developer.apple.com/documentation/Security/complying-with-encryption-export-regulations), [Export compliance overview](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/).

**Owner decision required:** whether Recall Pad uses only exempt encryption, whether any reporting/documentation is required, and whether the selected territories introduce additional obligations. Consider the separately distributed Mac's Node/OpenSSL cryptography rather than copying an iPad determination to it.

Only after this determination should `ITSAppUsesNonExemptEncryption` be set to `NO` for an exempt app, or applicable documentation/declaration be attached for a nonexempt app. Leaving the declaration unresolved is preferable to an unsupported exemption claim. [Property-list declaration](https://developer.apple.com/documentation/BundleResources/Information-Property-List/ITSAppUsesNonExemptEncryption).

## Safe evidence handling

Keep signing identities, Team IDs, provisioning profiles, private keys, authentication material and legal/contact forms outside Git. Use synthetic work for reviewer screenshots. A QR code/capability is a secret even if it appears in an otherwise harmless UI screenshot.
