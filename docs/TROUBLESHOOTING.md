# Troubleshooting

[Documentation](README.md) · [Setup reference](SETUP.md) · [Complete workflow](WORKFLOW.md)

Find the symptom, check its cause, then retry. Repairing the app does not require deleting your learning data.

[Installation](#installation) · [Connections & capture](#connections-and-capture) · [Cards & local data](#cards-and-local-data) · [Report a problem](#reporting-a-problem)

## Installation

### Setup stops before installing

From the cloned Recall folder, run:

```sh
npm run setup -- --check
node --version
```

The beta requires Apple Silicon, macOS 13 or later and Node 22.18 or later. Install a supported version from [Node.js](https://nodejs.org/en/download), reopen Terminal and check again. An older macOS version must be updated before this Electron build can run.

If you already use nvm, the checkout's `.nvmrc` selects the tested baseline:

```sh
nvm install
nvm use
npm run setup
```

### Dependency installation failed

1. Read the first installation error for a network, registry or permission problem.
2. Resolve that cause, then rerun:

   ```sh
   npm run setup
   ```

Setup uses `npm ci` and the committed lockfile. Do not change the lockfile just to bypass an unexplained failure. No global packages or `sudo` are required.

### The app will not open after an update

Quit Recall, then rebuild the checkout:

```sh
npm run setup
```

Study data is stored separately from the source. Keep a full profile backup before significant upgrades.

If you open **Recall.app** from Applications, rebuild and replace that copy too; rebuilding the checkout does not update an installed app. Follow [Update an existing installation](SETUP.md#update-an-existing-installation).

> [!IMPORTANT]
> Do not remove your profile to repair a build. It contains your cards, review history and drafts.

### Python or C++ is unavailable

Coding tools are optional; concepts and math remain available. Check the detected runtimes, then install Apple's Command Line Tools if missing:

```sh
node cli/recall.cjs doctor
xcode-select --install
```

Standard Python and C++ use Apple's `xcrun`. Scientific Python uses a separate profile environment; see [optional coding runtimes](SETUP.md#optional-coding-runtimes). No packages download when you open a card.

## Connections and capture

### My assistant did not add anything to Recall

1. Open **Settings & backups → Learning connections**.
2. Confirm learning capture is enabled and saved.
3. Choose **Check readiness** and inspect Installation, CLI, Sign-in and Learning receipt separately.
4. Choose **Verify learning → Create verification prompt → Copy prompt**.
5. Paste that exact prompt into a **fresh** Codex or Claude session.

The unique check ID ties a receipt to this verification; a different generic prompt will not complete it. Installed skills do not prove learning reached Recall. Instructions guide the assistant, but do not guarantee every conversation was logged.

For catch-up, check the start timestamp, selected folders, exclusions and last scan. Recall must be open for periodic scanning. Only supported local session files are available. A pending inbox item still needs preparation; it is not a ready card.

### Claude works in Terminal, but Recall reports signed out

Run `claude auth status --text` in Terminal. This checks Claude Code's login; being signed into the Claude website alone does not establish CLI authentication.

If Terminal reports signed in, you can continue using a fresh Claude Code session and **Verify learning**. The sign-in indicator does not block capture or verification. A learning receipt confirms the connection separately; it does not prove Recall's **Prepare next** worker can authenticate.

Older Recall builds explicitly set `CLAUDE_CONFIG_DIR` during readiness checks, which makes Claude look up a different macOS Keychain entry even when the directory is `~/.claude`. The check also omitted the OS username and denied Keychain file reads. The fix preserves the default login namespace and OS username, and permits read-only Keychain access only for Claude's local authentication-status command; internet access remains disabled.

Update and rebuild Recall, then select **Check readiness** again. You do not need to log out, clear credentials or reinstall the learning connection for this fix. The check uses Claude's default configuration; custom terminal account configurations can still differ from the app's environment. See [Claude's credential management](https://code.claude.com/docs/en/authentication#credential-management).

### Prepare next fails or stays blocked

Check the selected CLI first:

- Install Codex or Claude and sign in; its command should work in Terminal.
- Update unsupported CLI versions rather than weaken the required restrictions.
- For a custom `CODEX_HOME`, connect with that environment available, review the proposed path, and reconnect after moving it.

Preparation uses the default provider and existing authentication/usage allowance, with tools and personal configuration disabled inside the macOS sandbox. Codex requires file-based login credentials or an API-key environment; keyring-only login and custom provider setups are not currently supported.

Then inspect the specific inbox error. The restricted worker cannot use a browser or run code/calculations. Choose **Finish with assistant**, copy the handoff prompt and paste it into your normal assistant to complete the actual checks and submit the validated result.

**Retry** can address a transient failure. It cannot validate missing visual checks, failed code tests or conflicting card identities.

### My knowledge source is configured but not ready

Open **Learning connections → Knowledge sources**, edit the affected source and choose **Test connection**.

- **Markdown / Obsidian:** select an existing, readable folder. Use the smallest KB scope you need.
- **Notion:** connect your assistant's Notion tool and verify a real scoped search. A configured scope or cached snapshot does not prove live access or complete coverage.
- **Read-only:** authoring is intentionally blocked. Enable it only for the scope you want changed.

[Knowledge-source guide →](KNOWLEDGE.md)

### My new Notion knowledge base is still pending

Use **Finish Notion with assistant → Copy setup prompt** in a fresh, connected assistant session. The assistant needs live access to the selected parent page. After actual creation and read-back, choose **Refresh setup** in Recall.

If the primary is pending, ready local mirrors are not promoted. If setup says **Needs attention** after a source was removed or restricted, review or reconnect it explicitly; Retry does not undo your access change.

[Finish Notion setup →](KNOWLEDGE.md#finish-notion-setup)

## Cards and local data

### A coding card says it needs local review

An imported card or AI validation report cannot grant native execution permission.

1. Inspect the source and tests.
2. Follow the [exercise validation workflow](../skills/recall-source/references/exercises.md).
3. With Recall closed, use the explicit `cards trust --apply` action. It independently runs the reference and starter in the sandbox.

Never bypass this through profile settings. A backup restore clears native-code approvals; review and trust restored exercises again. Restoring study data does not restore authority to execute its code.

### A card link does not open

[Package Recall and keep it in Applications](SETUP.md#keep-recall-in-applications), then launch it once. Development `npm start` alone does not install the protocol handler.

Some chat clients block custom URL schemes. Search the exact card title in **Library** instead. Links identify a card in the receiving app's local library; they do not transfer cards or choose another data profile.

### Recall says the library is in use

Card imports and inbox capture/submission work while open; the app applies queued results through its writer and refreshes the library. Check a queued card import with `recall cards import-status REQUEST_ID`. Quit Recall before backup, restore, native-code trust or other exclusive CLI writes.

Do not delete a lock file while another Recall process is alive.

### I moved the checkout or app

Reconnect assistants from Recall's final location to refresh launcher and skill paths. Your library can stay in its original profile folder. Machine-specific connection paths are separate from portable card content.

## Reporting a problem

Include:

- Mac architecture, macOS, Node and Recall versions.
- The steps to reproduce and first relevant error.
- A small synthetic example where possible.

Do not attach a full profile, raw conversation log, token or private KB export to a public issue. For a sensitive vulnerability, use the [private security-reporting channel](../SECURITY.md).

**Next:** [Setup reference](SETUP.md) · [Knowledge sources](KNOWLEDGE.md) · [Voice troubleshooting](VOICE.md#troubleshooting)
