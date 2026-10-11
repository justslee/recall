# Migration and restore

[Documentation](README.md) · [Privacy and execution](PRIVACY.md)

**Detailed reference.** Start with the [illustrated setup and update guide](SETUP.md). The [Study walkthrough](demos/STUDY.md) shows the normal card flow to check after an update.

Back up before upgrading. Keep the previous app until an isolated upgrade and restore have passed.
The Mac app identity and default data location remain Recall. Never seed or replace an existing
library to adopt the public app.

## Back up and test a restore

In the app, use **Settings & backups → Library & backups → Back up now** before an update.
For CLI backup and restore checks, quit Recall before these profile-write commands and restore into an isolated profile first:

```sh
recall backup /absolute/backup-destination
recall --data /absolute/isolated-profile restore /absolute/backup-destination --apply
```

| Included in a complete profile backup                                  | Back up independently                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| SQLite: cards, reviews, photos, drafts, attempts and settings          | External knowledge-base folders                               |
| Paper documents, editable drawings, ordered pages and assessments      | —                                                             |
| Original question/reference snapshots and tutor prompt revisions       | —                                                             |
| Self-tests, learning inbox and connection preferences                  | Installed Python environments                                 |
| Knowledge indexes, outbox and backups; pack receipts and configuration | Global assistant instructions and their machine-local backups |
| Optional legacy presentation compatibility file                        | —                                                             |

A manifest checks file hashes on restore. Use the normal tools for external knowledge bases and
Python environments; Recall does not duplicate them.

API keys, TLS private keys, pairing credentials, paper-session authority and private runtime
connection files are excluded. A Recall backup is private learning data, not a portable assistant
or device authorization. Whole-machine backups may include files that Recall's backup excludes.

## What restore preserves and resets

Restore verifies the manifest and database integrity/version, rejects unsupported database triggers,
refuses an active writer, preserves the previous profile under backups, and rolls it back if copying
fails. Do not use an arbitrary untrusted directory as a backup.

Knowledge-source configuration is restored without automatically reading or writing those sources.
Catch-up preferences are also restored; enabled catch-up can resume in the saved scope when the
assistant connection is available. Review that scope and reconnect on a new machine.

> Restore removes saved native-code execution approvals. Review exercises locally and re-run
> `recall cards trust --apply` before **Run**. Ordinary app upgrades preserve existing live approvals.

Code execution trust cannot be imported from a standalone trust file. Restoring database settings
does not grant authority to run native code.

Paper drawings, submissions, feedback and original prompt bindings remain recoverable. Restore
disables the companion, clears issued device grants and invalidates restored tutor-session
capabilities. Interrupted assessments and pending operations require an explicit retry or new
authorization; restoring never starts an API call, sends pages to a chat or changes the clipboard.
Enable the receiver deliberately and start a new chat-bound session when ready. Pair again on a
new Mac. If the old chat has lost its capability, use the saved page tray or export rather than
trying to reconstruct authorization from conversation logs.

## Legacy personal builds

Legacy personal builds may have rendered extra diagrams from a bundled private seed instead of
stored card content. Before switching builds, export those derived presentations into a private
`presentations.json` keyed by card ID with `{answer,presentation}`; they are applied only while the
original answer matches.

These files are private migration inputs, never public pack content. Set the profile timezone to the
old learning timezone before opening legacy captures.

## Verify an upgrade

```sh
node scripts/verify-upgrade.cjs PROFILE BASELINE.sqlite
```

The script compares every existing data table, permits additive settings while requiring prior
settings unchanged, and optionally checks a private render baseline beside the supplied database.
Private baseline files must never enter the repository or release archive.

Return to the [documentation guide](README.md), or read [privacy and execution](PRIVACY.md) before
sharing an archive.
