# Setup reference

[Documentation](README.md) · [Quick start](../README.md#start-in-five-minutes) · [Complete workflow](WORKFLOW.md)

Use this page for installation, optional coding tools and advanced CLI setup. For a first study session, start with the [README](../README.md#start-in-five-minutes).

[Install](#install-and-open-recall) · [Applications](#keep-recall-in-applications) · [Coding tools](#optional-coding-runtimes) · [CLI & profiles](#cli-and-profiles) · [Capture](#learning-capture) · [Catch-up](#catch-up-and-preparation-controls)

## Install and open Recall

**Requirements:** Apple Silicon Mac, macOS 13 or later, and Node 22.18 or later. A current Node 22 LTS release is recommended; `.nvmrc` records the tested baseline.

**Install Node before running setup.** Use the [Node.js 22 macOS installer](https://nodejs.org/en/download), which includes npm. Open a new Terminal window and run `node --version` and `npm --version` to verify installation. Recall's setup checks prerequisites; it does not install Node.

From the cloned Recall folder:

```sh
npm run setup
```

Setup installs the committed lockfile and locked Electron runtime, builds Recall and opens it. It needs internet. Ordinary study works offline afterward; no assistant connection, Python packages or compiler are installed by this command.

To build without launching:

```sh
npm run setup -- --no-launch
npm start
```

A fresh profile offers **Try demo**, **Import cards** and **Connect learning**. Existing profiles bypass the welcome demo. A knowledge base and API key are optional.

If setup stops, follow [Troubleshooting](TROUBLESHOOTING.md#setup-stops-before-installing).

## Keep Recall in Applications

1. From the checkout, build the Mac app:

   ```sh
   npm run package
   ```

2. Move `release/Recall-darwin-arm64/Recall.app` into Applications.
3. Quit a running development copy, then open the packaged app.
4. Install assistant connections from this final app location. Reconnect if you move it later.

The packaged **Recall.app** includes its own Electron/Node runtime. Opening it and using its installed assistant bridge do not require a separate Node installation. Keep Node and npm available if you want to rebuild, update from source or run checkout CLI commands.

Launching the packaged app registers **Open in Recall** links. Development `npm start` alone does not install the macOS protocol handler.

This is a source-build beta. A signed, notarized download is not yet available; Intel Macs and other operating systems do not have a verified setup path.

## Optional coding runtimes

Concept and math study work without coding tools. Standard Python and C++ use runtimes resolved by Apple's `xcrun`. Install Apple's Command Line Tools if missing, then check Recall's detection:

```sh
xcode-select --install
node cli/recall.cjs doctor
```

### Scientific Python

Most exercises use only the standard library. Cards marked `scientific-python` use `python/bin/python3` inside the selected profile. To create that environment explicitly with NumPy for the default profile:

```sh
recall_profile="$HOME/Library/Application Support/Recall"
xcrun python3 -m venv "$recall_profile/python"
"$recall_profile/python/bin/python3" -m pip install numpy
node cli/recall.cjs doctor
```

For a custom profile, use its absolute path and pass `--data "$recall_profile"` to the CLI. Choose a Python version supported by the exercise's dependencies. Additional packages must be reviewed and installed explicitly; nothing downloads when you open a card.

npm manages the application through its lockfile. uv is not required or installed by Recall. Optional runtimes live outside the checkout and are excluded from profile backups; recreate them on a new machine.

### Exercise validation

The validator uses the selected profile through `RECALL_DATA_DIR` or `--data`:

```sh
node scripts/validate-card-exercises.cjs cards.json mutants.json validation.json --data "$recall_profile"
```

Inspect the source and tests before validation. A report does not grant execution trust: follow the separate [local review and trust workflow](AUTHORING.md).

## CLI and profiles

In these guides, `recall` means the installed profile launcher or the optional short command from `npm link`. Every example also works from the checkout as `node cli/recall.cjs …`.

```sh
node cli/recall.cjs doctor
```

Doctor reports the active profile, configured sources and runtime availability. Start the app once, or use `recall init`, to initialize a profile.

| Profile choice                 | How to select it                               |
| ------------------------------ | ---------------------------------------------- |
| Default Mac profile            | `~/Library/Application Support/Recall`         |
| An explicit CLI profile        | Add `--data /absolute/profile` to the command. |
| An isolated app or CLI profile | Set `RECALL_DATA_DIR` before launching.        |

```sh
RECALL_DATA_DIR=/absolute/test-profile npm start
node cli/recall.cjs --data /absolute/test-profile doctor
```

> [!IMPORTANT]
> Quit Recall before direct CLI card imports, backup, restore or other SQLite writes. Read-only searches and inbox capture/submission work while it is open; the app applies submitted results through its writer.

Card links identify a card in the receiving app's local library. They do not transfer content or encode a custom data profile. Opening a card is read-only; a study rating is a separate action.

## Knowledge sources

Use **Settings & backups → Learning connections → Knowledge sources** to create a KB or connect existing notes. Choose Markdown, Obsidian, Notion or several destinations, with explicit scope and access.

For scripted configuration, see [Optional CLI configuration](KNOWLEDGE.md#optional-cli-configuration). Source roots must already exist. Reading is the default; enable `write:true` only when you want scoped authoring. Passwords and tokens do not belong in configuration, and source folders need not live in this repository. Remote assets are not downloaded automatically.

## Learning capture

1. Open **Settings & backups → Learning connections**.
2. Connect Codex, Claude Code or both, review the installation, and choose **Install connection**.
3. Enable capture, choose your learning timezone and save.
4. Start a fresh assistant session and [verify a learning receipt](WORKFLOW.md#2-connect-the-assistants-you-use).

The installer preserves unrelated skills and instructions. Disconnect removes its managed section only. Daily scheduling is a separate opt-in through a supported assistant host; setup does not create an automation.

For scripted installation, preview the connection before applying it:

```sh
recall connections connect codex
recall connections connect codex --apply
```

Use `claude` instead of `codex` for Claude Code. Enable capture and choose the learning timezone separately; installing instructions is not capture consent.

### Manual capture example

Use only learning that actually happened. Replace the IDs and timestamp with the real session values:

```json
{
  "id": "session-id/weighted-mean/1",
  "sessionId": "session-id",
  "title": "Weighted mean",
  "objective": "Explain the role of weights",
  "context": "Worked through a course score example",
  "at": "2026-09-13T12:00:00Z",
  "evidence": "discussed",
  "cardIds": ["demo:weighted-mean:concept"]
}
```

```sh
recall capture capture.json
recall self-test status
recall self-test prepare
```

To connect a genuine gap after its card is imported:

```sh
recall self-test link CAPTURE_ID CARD_ID
```

Preserve capture IDs and timestamps on retries. New captures store their learning date and timezone; changing the profile timezone does not move them. Legacy records without these fields use the profile timezone, so retain the original timezone during migration.

### Review a learning day

Open **Self Test**, choose **Learning day**, then **Review needs practice** or **Review all cards**.

- **Needs practice** uses the latest Again/Hard ratings.
- Ratings update original card schedules, including early reviews. Starting a pass alone does not change them.
- The page shows the latest non-practice rating since that learning day, rather than a frozen historical score.
- Suspended, draft and missing cards cannot enter the queue. Skip/Undo leave questions untested.
- Prior tested questions are not repeated solely because they were mentioned again. Completion means attempted, not mastered; due cards also return in Study Desk.

The app tests exact relevant card IDs, including questions not yet due. Discussed, independently explained and solved are evidence labels, not mastery scores.

## Active reading in Codex or Claude Code

The global connection points substantive learning to the selected profile. Skills are instructions an assistant follows, not hooks that observe every conversation. Start a fresh session after changing instructions already loaded by the current one.

The [active-reading contract](../skills/recall-source/references/active-reading.md) covers reuse, genuine gaps, useful supplements and verified card links. Prefer the connection installer; it backs up existing global instructions.

If configuring manually, install the skill kit, enable capture and add this instruction:

> For substantive reading questions and learning discussions, use the installed recall-self-test skill before ending the response. Search and reuse suitable cards; fill genuine gaps through recall-cards; assess meaningful math/coding supplements even when a concept card exists. Return verified Recall links and report capture outcomes. Respect opt-out; never infer mastery or change schedules from exposure.

Generate a card link with:

```sh
recall cards link CARD_ID
```

[Daily Self Test workflow →](WORKFLOW.md#5-prepare-and-take-the-daily-self-test)

## Catch-up and preparation controls

### Select the scan scope

Catch-up defaults off. Configure it in Learning connections, or use:

```sh
recall connections config connection-options.json
recall connections config connection-options.json --apply
```

The file accepts `agent` (`codex` or `claude`) and `catchUp` options: `enabled`, `allProjects`, `projects` (absolute paths), `exclude` (absolute paths), and `since` (ISO timestamp with timezone). For “today,” use local midnight with its actual UTC offset.

A scope change re-inspects eligible records with stable identities to prevent duplicate queue items. Excluding a project stops future inspection; it does not erase previously queued or captured learning. Periodic scans require Recall to be open.

### Understand scan coverage

The scanner reads Codex `sessions/**/*.jsonl` and Claude `projects/**/*.jsonl` under the saved assistant home, including a selected custom Codex home. It retains byte checkpoints and incomplete turns, excludes tool payloads and subagent logs, and reports malformed, truncated or oversized records.

A scan reads up to 100 changed files; later scans continue. Session formats can change and local files can be incomplete. Unavailable or unreadable records never establish coverage. Sensitive-text redaction is best-effort.

The private inbox lives under `learning-inbox/`. Profile backups include it and connection preferences. Global instruction backups stay machine-local under `connections/backups/`; reconnect after moving Recall or restoring on another machine.

### Prepare one item

```sh
recall inbox inspect ID
recall inbox preview
recall inbox prepare DIGEST
```

`inspect` lets your existing assistant process an item without another worker. `preview` selects the next pending item and shows its exact context and digest without contacting a provider. `prepare` requires that digest and refuses changed context.

Preparation needs a supported, signed-in Codex or Claude CLI on PATH; common Mac install locations are also checked. It uses the default provider and existing authentication, with tools, personal hooks, plugins and connector configuration disabled, inside an outer macOS filesystem sandbox. Unsupported CLI versions fail closed; update rather than weaken restrictions.

Preparation is limited to one item per action and at most fifteen minutes per item. Failures remain blocked for a later retry or **Finish with assistant** handoff. Editorial, visual, math and coding checks still apply; a blocked check cannot become a ready card. See the [inbox contract](../skills/recall-source/references/inbox.md).

**Next:** [Complete workflow](WORKFLOW.md) · [Knowledge sources](KNOWLEDGE.md) · [Troubleshooting](TROUBLESHOOTING.md)
