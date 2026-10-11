# Publisher submission templates

[Distribution procedure](../DISTRIBUTION.md) · [Release checklist](../RELEASE_CHECKLIST.md)

These are reusable drafts for publishers preparing **Recall Pad's TestFlight beta** and the paired **Developer ID Mac download**. They are not completed App Store Connect forms, private account records or evidence of an upload. Ordinary Recall users can skip this folder and follow the [setup guide](../SETUP.md).

| Document                                 | Purpose                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [TestFlight metadata](TESTFLIGHT.md)     | Description, test instructions, review notes and fields still needed from the owner.                                      |
| [Privacy and encryption](APP_PRIVACY.md) | Source-based data flows and declaration decisions.                                                                        |
| [Release record](RELEASE_RECORD.md)      | Template for candidate identity, artifact checks and unresolved release gates. Keep completed private records out of Git. |
| [Support](SUPPORT.md)                    | Public troubleshooting and a safe way to ask for help.                                                                    |

Copy forms that need completion to a private location. Keep actual contacts, signing configuration,
Apple upload/notarization receipts, screenshots of account pages, archives and symbol bundles out of
Git. The local build tools write outputs under ignored `release/` or `apps/ipad/.build/`; those folders
are working storage, not public release assets. Inspect any manually created archive before sharing
it. Public releases should contain the tested app, checksum and concise release notes only.

## Before anything is submitted

The owner must supply a monitored feedback email and Apple's review contact fields privately in App Store Connect, confirm the publisher/copyright identity and distribution territories, and approve final privacy and encryption answers. Do not substitute an invented email or publish private account information in these files.

The support and privacy URLs must load publicly after their reviewed documents are published. The paired Mac artifact must be downloadable, signed, notarized and tested. Resolve the live-device, grading and per-client compatibility gates in the [release checklist](../RELEASE_CHECKLIST.md), or keep those features outside the claimed beta scope.

Screenshots should show the actual candidate using original examples. Documentation screenshots are useful draft material; verify Apple's dimensions and capture the writing experience before reusing them as product-page assets. [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications).

Submission changes, invitations and public release remain distinct actions. Never infer Apple approval from an archive validation or an upload receipt.
