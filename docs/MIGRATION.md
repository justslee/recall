# Migration and restore

Back up before upgrading. Keep the previous app until an isolated upgrade and restore have passed. The Mac app identity and default data location remain Recall. Never seed or replace an existing library to adopt the public app.

```sh
# Quit Recall before these profile-write commands.
recall backup /absolute/backup-destination
recall --data /absolute/isolated-profile restore /absolute/backup-destination --apply
```

A complete backup contains SQLite (cards, reviews, photos, drafts, attempts and settings), self-tests, the learning inbox and connection preferences, knowledge indexes/outbox/backups, pack receipts, configuration and the optional legacy presentation compatibility file. A manifest checks file hashes on restore. External KB roots and installed Python environments are not duplicated; back up those independently using their normal tools.

Restore verifies the manifest and database integrity/version, rejects unsupported database triggers, refuses an active writer, preserves the previous profile under backups, and rolls it back if copying fails. Do not use an arbitrary untrusted directory as a backup. Knowledge-source configuration is restored without automatically reading or writing those sources. Catch-up preferences are also restored; enabled catch-up can resume in the saved scope when the assistant connection is available. Review that scope and reconnect on a new machine. Global assistant instructions and their machine-local backups are separate from the profile backup.

Legacy personal builds may have rendered extra diagrams from a bundled private seed instead of stored card content. Before switching builds, export those derived presentations into a private `presentations.json` keyed by card ID with `{answer,presentation}`; they are applied only while the original answer matches. Code execution trust cannot be imported from a standalone trust file. A profile backup includes database settings, but restore removes only its saved native-code approvals: re-run `recall cards trust --apply` for exercises you have reviewed locally before Run. Ordinary app upgrades preserve existing live approvals. These files are private migration inputs, never public pack content. Set the profile timezone to the old learning timezone before opening legacy captures.

`scripts/verify-upgrade.cjs PROFILE BASELINE.sqlite` compares every existing data table, permits additive settings while requiring prior settings unchanged, and optionally checks a private render baseline beside the supplied database. Private baseline files must never enter the repository or release archive.
