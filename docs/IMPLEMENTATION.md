# Implementation status

The portable beta keeps the existing Electron/React/SQLite study app and adds configuration, scoped KB operations, content-pack imports, full profile backups, original demo content and a portable learning skill kit.

Implemented contracts: `schemas/`; configuration and writer coordination: `electron/config.cjs`; cards/trust/import: `electron/bundles.cjs`; catalogs: `electron/catalog.cjs`; local KB and Notion connector bridge: `adapters/knowledge.cjs`; CLI: `cli/recall.cjs`; complete profile backup/restore: `electron/backup.cjs`.

Eleven skill entry points share instructions under `skills/recall-source/references`. Notion operations require the user's connected tool: pending requests and fetched-result acknowledgments are implemented, but no bundled OAuth/API client or continuous mirror service is claimed.

The beta includes original concept, numeric math and Python/C++ exercises. Schemas and import checks do not establish editorial accuracy; skill validation and actual rendered interaction checks remain necessary. Arbitrary card-content revisions are rejected instead of silently replacing existing learning material.

Verification scripts: `npm test`, `npm run test:desktop`, `scripts/verify-upgrade.cjs`, `scripts/smoke-upgrade.cjs`, `npm run audit:release`. Upgrade scripts require explicitly supplied private fixtures kept outside this repository. Dependency advisories are checked before packaging. A GitHub workflow is supplied but its hosted execution is not claimed until it actually runs.

Release signing/notarization, other operating systems, automatic handwriting grading and universal conversation capture remain outside this beta. Local rendering and backend checks do not imply public publication or a live Notion connector test.
