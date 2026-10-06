# Migration and restore

[Documentation](README.md) · [Privacy and execution](PRIVACY.md)

Back up before upgrading. Keep the previous app until an isolated upgrade and restore have passed.
The Mac app identity and default data location remain Recall. Never seed or replace an existing
library to adopt the public app.

## Back up and test a restore

Quit Recall before these profile-write commands. Restore into an isolated profile first:

```sh
recall backup /absolute/backup-destination
recall --data /absolute/isolated-profile restore /absolute/backup-destination --apply
```

| Included in a complete profile backup                                  | Back up independently                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| SQLite: cards, reviews, photos, drafts, attempts and settings          | External knowledge-base folders                               |
| Self-tests, learning inbox and connection preferences                  | Installed Python environments                                 |
| Knowledge indexes, outbox and backups; pack receipts and configuration | Global assistant instructions and their machine-local backups |
| Optional legacy presentation compatibility file                        | —                                                             |

A manifest checks file hashes on restore. Use the normal tools for external knowledge bases and
Python environments; Recall does not duplicate them.

## What restore preserves and resets

Restore verifies the manifest and database integrity/version, rejects unsupported database triggers,
refuses an active writer, preserves the previous profile under backups, and rolls it back if copying
fails. Do not use an arbitrary untrusted directory as a backup.

Knowledge-source configuration is restored without automatically reading or writing those sources.
Catch-up preferences are also restored; enabled catch-up can resume in the saved scope when the
assistant connection is available. Review that scope and reconnect on a new machine.

> Restore removes saved native-code execution approvals. Review exercises locally and re-run
> `recall cards trust --apply` before **Run**. Ordinary app upgrades preserve existing live approvals.

Code execution trust cannot be imported from a standalone trust file. A profile backup includes
database settings, but restore removes only its saved native-code approvals.

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
