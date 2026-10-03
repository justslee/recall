# Troubleshooting

## Setup stops before installing

Run `npm run setup -- --check` in the cloned Recall folder. The beta setup supports Apple Silicon Macs running macOS 13 or later and Node 22.18 or later. Install a supported Node version from [nodejs.org](https://nodejs.org/en/download), reopen Terminal, and check `node --version`. If you already use nvm, run `nvm install` and `nvm use` in the checkout; `.nvmrc` pins the tested baseline. An older macOS version must be updated before this Electron build can run.

## Dependency installation failed

Setup uses `npm ci` and the committed lockfile. Check the first installation error for network, registry or permissions problems, resolve it, then rerun `npm run setup`. Avoid changing the lockfile just to get past an unexplained failure. Setup does not install global packages or require sudo.

## The app will not open after an update

Quit Recall and rerun `npm run setup`. That rebuilds the checkout with the locked dependencies. Your study data is stored separately. Keep a full profile backup before significant upgrades; do not remove your profile to repair a build.

## Python or C++ is unavailable

These runtimes are optional and do not block concept or math study. Run `node cli/recall.cjs doctor`. Standard Python and C++ are resolved through Apple's `xcrun` and require Apple's Command Line Tools, installed explicitly with `xcode-select --install`. Scientific Python uses a separate profile environment; see [runtime setup](SETUP.md#optional-coding-runtimes). No packages are downloaded when you open a card.

## My assistant did not add anything to Recall

Check **Settings & backups → Learning connections**: learning capture must be enabled and saved, and the relevant assistant must be connected. Start a fresh Codex or Claude session so it loads global instructions. Ask it to check the installed recall-bridge and give a capture receipt. Instructions guide the assistant; they do not guarantee every conversation was logged.

If you enabled catch-up, check its start timestamp, selected folders, exclusions and last scan. Recall must be open for its periodic scanner. Only supported local session files can be inspected. A pending inbox item still needs preparation; it is not a ready card.

## Prepare next fails or stays blocked

Install and sign into your selected Codex or Claude CLI. Its command should work in your terminal. Preparation uses the default provider and your existing authentication/usage allowance, with tools and personal configuration disabled. Recent CLI restriction flags and the macOS sandbox are required; unsupported versions fail closed. Codex needs file-based login credentials or an API-key environment; keyring-only/custom provider setups are not currently supported. If you use a custom `CODEX_HOME`, connect with that environment available and check the previewed instruction path. Reconnect to refresh saved paths after moving it.

Read the specific inbox error before retrying. The restricted worker cannot perform browser interaction checks or execute code/calculations. Missing visual checks, failed code tests or conflicting card identities must be resolved by a normal assistant with the included skills; a retry alone cannot validate them. Ask your current assistant to inspect the item and prepare it directly through the inbox contract, then report what actually passed.

## A coding card says it needs local review

Importing a card or receiving an AI validation report does not unlock native execution. Review the source and tests, follow the [exercise validation workflow](../skills/recall-source/references/exercises.md), then use the explicit `cards trust --apply` command with Recall closed. This command independently runs the reference and starter in the sandbox. Never bypass this by editing profile settings. Existing reviewed exercises keep their approvals.

## A card link does not open

Build the packaged app with `npm run package`, move it to its intended location, and open it once. This registers Mac card links. Development `npm start` alone does not install the protocol handler. Some chat clients block custom URL schemes; search the exact card title in Library instead. Links identify a card in the receiving app's local library; they do not transfer cards or choose a different data profile.

## Recall says the library is in use

Quit the app before direct CLI card imports, restore or other SQLite writes. Read-only commands and inbox capture/submission work while open; the app applies submitted inbox results through its own writer. Do not delete a lock file while another Recall process is alive.

## I moved the checkout or app

Reconnect your assistants from the app's final location to refresh the launcher and skill paths. Your library can stay in its original profile folder. Machine-specific connection paths are separate from portable card content.

## Reporting a problem

Include your Mac architecture, macOS and Node versions, Recall version, steps to reproduce, and the first relevant error. Prefer a small synthetic example. Do not attach a full profile, raw conversation log, token or private knowledge-base export to a public issue.
