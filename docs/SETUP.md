# Setup

From a clone on an Apple Silicon Mac running macOS 13 or later with Node 22.18 or later, run `npm run setup`. It installs the lockfile and locked Electron runtime, builds and opens Recall. Use `npm run setup -- --no-launch` to prepare without launching, then `npm start` later. Setup needs internet; ordinary study works offline afterward. No AI connection, Python package or compiler is installed by this command. See [Troubleshooting](TROUBLESHOOTING.md) if a check fails, or [Make it yours](WORKFLOW.md) for the complete learning workflow.

Run the app once or `recall init`. The default Mac profile is `~/Library/Application Support/Recall`; pass `--data /absolute/profile` or set RECALL_DATA_DIR to isolate another profile. Existing profiles bypass the welcome demo. Quit the app before a direct CLI card import, backup or restore. Read-only card search and learning inbox capture/submission work while it is open.

Create a configuration JSON (substitute your selected folder):

```json
{
  "version": 1,
  "timeZone": "Europe/London",
  "captureEnabled": false,
  "sources": [
    {
      "id": "my-kb",
      "type": "markdown",
      "root": "/absolute/selected/notes",
      "write": false
    }
  ]
}
```

`recall config config.json` previews; `recall config config.json --apply` saves. Source roots must already exist; `write:false` is the default for reading existing notes. Choose `obsidian` for a selected vault/folder, or `notion` with scopeId/propertyMap as described in KNOWLEDGE.md. No passwords/tokens belong in this file. Sources do not need to be inside the Recall repository. The CLI does not download remote assets automatically.

In this guide, `recall` means your installed profile launcher or the optional short command from `npm link`. From the checkout, every example also works as `node cli/recall.cjs …`. Use `recall doctor` to check the active profile, sources and runtime availability. Missing coding tools do not prevent concept or math study. To let the assistant author KB notes, explicitly change the selected source to `write:true`; reading is the default.

## Optional coding runtimes

Standard Python and C++ use runtimes resolved by Apple's `xcrun`, so install Apple's Command Line Tools for either language if missing:

```sh
xcode-select --install
node cli/recall.cjs doctor
```

Most exercises need only the standard library. Cards marked `scientific-python` use `python/bin/python3` inside the selected profile. For the default Mac profile, create that environment explicitly with NumPy:

```sh
recall_profile="$HOME/Library/Application Support/Recall"
xcrun python3 -m venv "$recall_profile/python"
"$recall_profile/python/bin/python3" -m pip install numpy
node cli/recall.cjs doctor
```

For a custom profile, replace `recall_profile` with its absolute path and pass `--data "$recall_profile"` to the CLI. Use a Python version supported by the exercise's dependencies; packages are installed into this optional environment, not the app checkout. Additional dependencies must be reviewed and installed explicitly. npm manages the application through its lockfile; uv is not required or installed by Recall. Recreate optional runtimes on a new machine, since profile backups exclude them.

The exercise validator uses the same selected profile, via `RECALL_DATA_DIR` or `--data`:

```sh
node scripts/validate-card-exercises.cjs cards.json mutants.json validation.json --data "$recall_profile"
```

Inspect the authored source and tests before running validation. See [Authoring](AUTHORING.md) for the explicit trust workflow.

## Learning capture

Enable capture under **Settings & backups → Learning connections**, choose your learning timezone and save. In the same tab, use **Connect → Install connection** for Codex/Claude globally, or use `recall connections connect codex --apply` (and/or claude). The installer preserves other skills and instructions; disconnect removes only its managed section. Start a fresh assistant session. Use a supported host automation tool to schedule daily preparation and authorized card-gap authoring; setup does not schedule it. Optional local catch-up runs while the app is open. Preparation is bounded to one item per explicit action and uses the chosen signed-in CLI; a normal assistant or host automation can also inspect and resolve queued items directly through the inbox skill.

Example capture JSON (use an actual timestamp):

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

`recall capture capture.json` records it; `recall self-test status` shows recorded sessions; `recall self-test prepare` regenerates readable daily Markdown. To fill a gap after importing a card, use `recall self-test link CAPTURE_ID CARD_ID`. Preserve the capture ID and timestamp on retries. New captures store their learning date/timezone so changing the profile timezone does not move them to another day. Legacy records without these fields use the profile's configured timezone; set it to the original timezone during migration.

The app refreshes captured learning and tests exact relevant card IDs, including questions not due yet. Actual ratings update FSRS. Skip/Undo leave questions untested; prior tested questions are not repeated just because they were mentioned again. Discussed, independently explained and solved are evidence labels, not mastery scores.

To revisit a previous day, open **Self test**, choose **Learning day**, then **Review needs practice** (latest Again/Hard ratings) or **Review all cards**. These are real reviews of the original cards: ratings update their schedules, even when reviewed early. Starting a pass alone does not change schedules. The page shows the latest non-practice rating since that learning day, rather than a frozen historical score. Suspended, draft and missing cards cannot enter the queue. Finishing a pass means attempted, not mastered; due cards also return in **Study Desk → Due + new cards**.

# Active reading in Codex or Claude Code

The connection installer writes a managed global instruction and a recall-bridge skill that points to this profile. Existing instructions are backed up. If configuring manually instead, install the skill kit, enable capture, then add this to your global instructions:

> For substantive reading questions and learning discussions, use the installed recall-self-test skill before ending the response. Search and reuse suitable cards; fill genuine gaps through recall-cards; assess meaningful math/coding supplements even when a concept card exists. Return verified Recall links and report capture outcomes. Respect opt-out; never infer mastery or change schedules from exposure.

The shared active-reading workflow is in `skills/recall-source/references/active-reading.md`. Skills are instructions the assistant follows, not hooks that observe all conversations. Start a fresh agent session after changing global instructions if the current session has already loaded older instructions.

Build a packaged app with `npm run package` and launch it to register Mac card links. Development `npm start` alone does not install the macOS protocol handler. Links generated by `recall cards link CARD_ID` open the card in the receiving app's library; custom `--data` profiles are not encoded into links. Opening is read-only; take a Self Test or Study Desk session to record a real rating.

## Catch-up and preparation controls

`recall connections config FILE --apply` accepts `agent` (`codex` or `claude`) and `catchUp` with `enabled`, `allProjects`, `projects` (absolute paths), `exclude` (absolute paths) and `since` (ISO timestamp with timezone). Catch-up defaults off. Use local midnight with its actual UTC offset if selecting “today.” A scope change re-inspects eligible records; stable source identities prevent duplicate queue items. Excluding a project stops future inspection, but does not erase already captured/queued learning.

The scanner supports Codex `sessions/**/*.jsonl` and Claude `projects/**/*.jsonl` under the connected assistant's default home. It retains byte checkpoints and incomplete turns, excludes tool payloads/subagent logs, and reports malformed, truncated or oversized records. Up to 100 changed files are read per scan; later scans continue. Session formats can change, and local files may be incomplete. Read errors never imply coverage.

The inbox is under the profile's `learning-inbox/`; full backups include it and connection preferences. Global instruction backups live under `connections/backups/` and remain machine-local. After restoring on another machine or moving the app/repository, reconnect to refresh local paths. Source excerpts are retained locally for retry; protect the profile like your notes. Pattern redaction is best-effort, not a guarantee that transcripts contain no sensitive data.

`inbox inspect ID` lets an existing assistant process an item without spawning a new worker. See `skills/recall-source/references/inbox.md` for result submission and validation. `inbox preview` shows the exact selected learning context without contacting a provider and prints its digest. `inbox prepare DIGEST` sends that previewed context and refuses if it changed since the preview; it also requires a supported, signed-in Codex or Claude CLI on PATH (common Mac install locations are also checked). Provider/tool failures stay blocked and can be retried after fixing their cause. It disables model-facing tools, personal hooks, plugins and connector configuration, and applies an outer macOS filesystem sandbox. Unsupported CLI versions fail closed; update the CLI instead of weakening restrictions. It uses the default provider rather than custom personal provider configuration. Preparation runs for at most fifteen minutes per item. Required editorial, visual, math and coding checks still apply; a blocked check cannot produce a ready card.
