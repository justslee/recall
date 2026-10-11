# Security

[Documentation](docs/README.md) · [Privacy and execution](docs/PRIVACY.md)

## Report a problem

| What you found                       | Where to report it                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| A vulnerability or sensitive finding | [GitHub private vulnerability reporting](https://github.com/justslee/recall/security/advisories/new) |
| An ordinary bug or setup question    | [GitHub Issues](https://github.com/justslee/recall/issues)                                           |

> Keep credentials, private profiles, transcripts and executable payloads out of public reports.
> Describe sensitive findings privately while a fix is being coordinated.

## Security boundaries

- **Widgets:** no privileged app APIs.
- **Native code:** explicit local review and execution within the supported macOS sandbox.
- **Learning inbox:** submissions cannot grant execution trust.
- **Preparation:** previewed context, with model tools disabled.
- **Knowledge bases:** operations stay within configured scope.
- **External documents:** content cannot issue tool instructions.
- **Profile writes and restore:** exclusive access is required.

The [privacy and execution guide](docs/PRIVACY.md) explains these boundaries and their supported
limitations.

## What belongs in the public repository

| Public and reusable | Local or private |
| :------------------ | :--------------- |
| App source, learning skills, tests and locked dependencies | Personal cards, KB notes, learning captures, drafts and profile backups |
| Original demo content and screenshots of synthetic work | Screenshots of personal work, live pairing codes and paper-session capabilities |
| Setup guides, contributor checks and unfilled release templates | API keys, signing keys, account contacts, device credentials and local signing configuration |
| Public release notes and verified artifact checksums | Completed submission records, private diagnostics, build archives and debug symbols |

The [submission packet](docs/submission/README.md) contains reusable publisher templates, not the
maintainer's Apple account or completed forms. Signing certificates and identifiers identify a
publisher; private signing keys and authentication credentials are the secrets. Keep local build
configuration and detailed signing output private regardless. Debug symbols and upload diagnostics
can include source paths or device/account details, even when they contain no credential.

## Before publishing source or a download

1. Run `npm run audit:release` against full Git history. Review the staged diff and screenshot pixels
   as well; pattern checks cannot recognize every private sentence or image.
2. Inspect the actual packaged app with `npm run audit:package`. Publish only the reviewed runtime
   artifact, checksum and release notes. Do not attach a workspace ZIP, profile backup, Xcode archive,
   symbol bundle or raw upload log.
3. Keep credentials and completed evidence outside Git. Ignored files remain on disk and can still
   enter a manual ZIP or be force-added. Removing a tracked file does not remove it from Git history.

If a credential reaches a public commit, issue or artifact, revoke or rotate it first, then remove
the exposed material and review retained history and copies. Report the finding privately rather
than posting the credential as proof. See the [distribution procedure](docs/DISTRIBUTION.md) for
candidate checks and the [privacy guide](docs/PRIVACY.md#sharing-the-source-safely) for audit limits.
