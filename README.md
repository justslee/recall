In the world of AI, we consume more text and move faster than ever. But how much do we actually learn and retain? Recall helps you continuously capture what you’re learning, log it, and test yourself—so more of it stays with you.

> “All of learning is anti-forgetting.”
>
> — [Andrew Huberman, Huberman Lab](https://www.hubermanlab.com/episode/your-top-health-questions-answered)

<div align="center">

<img src="packaging/icon.png" width="88" alt="Recall's index-card icon">

# Recall

### Turn what you learn into what you can recall.

A study desk for concepts, mathematics and code.<br>
Warm paper. Quiet cards. Your own knowledge.

**Mac · Local first · Visual explanations · Light & dark**

[![Verify](https://github.com/justslee/recall/actions/workflows/verify.yml/badge.svg)](https://github.com/justslee/recall/actions/workflows/verify.yml)

[Get started](#start-in-five-minutes) · [Connect your learning](#connect-your-learning) · [Complete workflow](docs/WORKFLOW.md) · [Documentation](#documentation)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/study-desk-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/study-desk-light.png">
  <img src="docs/images/study-desk-light.png" alt="Recall Study Desk with original demo content and separate Concepts, Math, Coding and Mixed sessions" width="1100">
</picture>

<sub>Original demo content. Appearance follows your Mac.</sub>

</div>

**Learn → capture → self-test → revisit.**

## Choose how you want to study

- **Concepts:** recall the idea, then flip to a precise definition, concrete example and useful visual. Cards support LaTeX, images and interactive diagrams.
- **Math:** solve on paper or enter a numerical answer, then reveal the worked steps.
- **Coding:** solve a focused Python or C++ challenge with starter code and tests in the matching editor.
- **Mixed:** combine the formats you have time and space for.

Choose a topic or collection independently of the format. Math and coding supplements are added when they test a useful objective; every concept does not need all three. Your **Again / Hard / Good / Easy** rating controls each question's spaced-repetition schedule.

**Self Test** revisits learning captured on a chosen day. **Progress** shows study activity and cards needing practice. **Review history** keeps your actual ratings visible.

## Start in five minutes

**You need:** an Apple Silicon Mac running macOS 13 or later, and a current [Node.js 22 LTS](https://nodejs.org/en/download) release (22.23.3 or later recommended; 22.18 is the functional minimum). Setup needs internet; ordinary study works offline afterward. No account, API key or knowledge base is required to try Recall.

1. Choose **Code → Download ZIP** on this repository's GitHub page and unzip it, or clone using its **Code** menu.
2. Open Terminal, type `cd `, drag the Recall folder into the window, then press Return.
3. Run:

```sh
npm run setup
```

Setup checks your Mac, installs the locked dependencies and desktop runtime, builds Recall and opens it. Assistant connections and learning capture remain opt-in.

4. Choose **Try demo** for three original questions, **Import cards** for an Anki deck, or **Connect learning** for your own material. Anki import is in **Library**.
5. Choose a study format and **Start review**. Answer from memory, flip when ready, then rate your recall. Coding needs the optional tools below.

To open it again from the same checkout:

```sh
npm start
```

<details>
<summary><strong>Prefer Git?</strong></summary>

```sh
git clone https://github.com/justslee/recall.git
cd recall
npm run setup
```

</details>

<details>
<summary><strong>Keep Recall in Applications</strong></summary>

After setup, build the Mac app:

```sh
npm run package
```

Move `release/Recall-darwin-arm64/Recall.app` into Applications. Quit a development copy, then open the installed app. Launching it registers **Open in Recall** card links. Install assistant connections from this final location; reconnect if you move it later.

This is a source-build beta. A signed, notarized download is not yet available. Intel Macs and other operating systems do not have a verified setup path.

</details>

<details>
<summary><strong>Run Python or C++ challenges</strong></summary>

Recall uses Apple's Command Line Tools for its standard coding runtimes. Install them if missing, then check what Recall detects:

```sh
xcode-select --install
node cli/recall.cjs doctor
```

Standard exercises need no Python packages. Scientific Python exercises can use a separate environment with NumPy; see [runtime setup](docs/SETUP.md#optional-coding-runtimes). Nothing is downloaded when you open a card. Imported code requires explicit source review and validation before **Run** is enabled.

</details>

## Connect your learning

This repository includes the app **and** the [learning skill kit](skills/). Connect the parts you want once, then keep learning in your usual projects.

### 1. Connect Codex or Claude

Open **Settings & backups → Learning connections**. Choose **Connect**, review the proposed installation, then **Install connection**. Use Codex, Claude Code or both. Enable learning capture, choose your learning timezone and save.

Recall installs its portable skills and a managed global bridge instruction, with backups of existing instructions. You can ask learning questions from other local projects; you do not have to open the Recall repository. Start a **fresh assistant session** after installation.

Choose **Check readiness**. **Installation**, **CLI**, **Sign-in** and **Learning receipt** are separate checks: installed skills alone do not prove capture worked. Your assistant and its login are separate from Recall. [Connection help](docs/TROUBLESHOOTING.md).

### 2. Choose a home for your knowledge—optional

In **Learning connections → Knowledge sources**, choose:

- **Create my first knowledge base:** select **Local Markdown**, **Obsidian**, **Notion**, or several together. Choose a primary home and which other destinations should receive mirrors. Review the destinations and authoring permission before creating them.
- **Add knowledge source:** connect existing notes with **Read-only** or **Scoped authoring** access, then test the selected folder or scope.

Local creation makes a new folder with an index and space for concepts. Obsidian gets a minimal vault you can open as a folder. Notion needs an installed Recall assistant connection plus a working Notion connector: choose a parent page, then **Finish Notion with assistant → Copy setup prompt**. The assistant creates and reads back the new database; it stays pending until that result is registered. Recall does not include Notion OAuth or a token field.

Mirrors follow verified primary writes through the assistant skills; they are not automatic two-way sync. Your existing notes, cards and review history remain intact. You can also use Recall cards without a separate KB. [Knowledge source guide](docs/KNOWLEDGE.md).

### 3. Prove learning reaches Recall

Choose **Verify learning**, enter a real concept, then **Create verification prompt → Copy prompt**. Paste it into a fresh assistant session. The unique check ID lets Recall verify this exact learning receipt against actual ready cards.

Then try a normal question from any connected project:

> Explain how a weighted mean differs from an ordinary average, with a concrete example. Use my installed Recall learning skills to search my selected KB, reuse suitable cards and assess whether a math or coding question would help. Capture only what we discuss, respect capture pause, and return new/reused/pending outcomes with verified Recall links.

Ready reused cards can enter today's **Self Test** immediately. Missing objectives stay in the **Learning inbox** until cards are authored and validated. For a blocked item, **Finish with assistant** copies the scoped handoff prompt; **Retry** handles a transient failure. A pending item is not a completed card. [Complete workflow](docs/WORKFLOW.md).

## Make it a daily habit

Learn or build in your connected projects. Check the assistant's receipt, prepare the day's captured learning, then open **Self Test** and choose the formats you can handle. Return to due cards in **Study desk**. Earlier learning days remain available; ratings update the original cards' schedules.

A useful preparation request:

> Prepare today's Recall Self Test from actually captured learning in my profile timezone. Respect capture pause, reuse ready cards, resolve genuine gaps with the installed quality checks, and regenerate the daily Markdown log. Report pending gaps. Do not start or rate a test or change review schedules.

<details>
<summary><strong>Optional daily scheduling and catch-up</strong></summary>

Ask an assistant host that supports scheduling to run preparation at your chosen time and timezone. Include: **stay quiet when unchanged; notify only for a new or materially updated test, a failure, or a gap needing attention**. Recall does not create a schedule during setup.

Separately, **Learning connections → Optional catch-up** can inspect supported local Codex/Claude session records while Recall is open. Choose its start time, included projects and exclusions before enabling it. It cannot retrieve unavailable or cloud-only conversations. Capture records exposure, not mastery; it never rates a card for you. You can tell your assistant **“Don't capture this discussion.”**

[Daily workflow](docs/WORKFLOW.md#5-prepare-and-take-the-daily-self-test) · [Capture limits](docs/PRIVACY.md)

</details>

<details>
<summary><strong>Optional voice answers and explanation practice</strong></summary>

Cards have a compact **Speak / Type** strip. Edit your response, then **Evaluate & flip** compares it with the reference. In the separate **Speak** tab, explain a card, KB note or your own topic to a chosen audience. Feedback covers clarity, structure, depth and audience fit, with one focused retry. Accuracy requires a reference; filler counts and approximate pauses stay separate. Practice does not change review schedules.

Save your own OpenAI API key in **Settings & backups → Voice & feedback**. Internet and separate API billing are required; a ChatGPT subscription does not cover it. Recording sends audio to OpenAI; evaluation sends the selected reference and your response. Recall saves no audio. Typed local drafts and ordinary study need no key.

The key persists locally as plaintext in `credentials/openai.key`, with owner-only permissions, and is excluded from Recall's exports and profile backups. Recall does not use macOS Keychain for this connection. Software running as your OS account can read it; whole-machine backups may include it.

[Voice setup](docs/VOICE.md) · [Speak](docs/SPEAK.md) · [Articulation coaching](docs/ARTICULATION.md)

</details>

## Your learning stays yours

Cards, review history, photos, drafts and learning logs live in `~/Library/Application Support/Recall`, separately from the repository. A fresh profile has none of the maintainer's cards, notes or credentials. Back up through **Settings & backups → Library & backups** before substantial upgrades.

Sharing the source does not share your library. **Profile backups and library exports can contain private learning material**; keep them private. Optional AI requests send selected context to the chosen provider. Study needs no account, hosted database or telemetry service.

Interactive widgets load on request in a sandbox without network or privileged app access. Reviewed code runs only on **Run**, inside the supported macOS sandbox. [Privacy and execution](docs/PRIVACY.md) · [Security](SECURITY.md).

## Documentation

- [Make it yours](docs/WORKFLOW.md): the complete assistant, KB and daily study loop.
- [Setup](docs/SETUP.md) · [Troubleshooting](docs/TROUBLESHOOTING.md): prerequisites, runtimes and connection help.
- [Knowledge sources](docs/KNOWLEDGE.md): new KBs, scoped access, Notion and mirrors.
- [Authoring](docs/AUTHORING.md) · [Interactive visuals](docs/WIDGETS.md): concepts, mathematical exercises and coding questions with tests.
- [Migration & restore](docs/MIGRATION.md): move or restore your library.
- [Implementation](docs/IMPLEMENTATION.md) · [Launch checklist](docs/LAUNCH.md): verified scope and remaining release work.
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md): contribute or report an issue.

<details>
<summary><strong>CLI and development</strong></summary>

No global npm installation is required. From the checkout:

```sh
node cli/recall.cjs doctor
node cli/recall.cjs cards search "weighted mean"
node cli/recall.cjs connections status
node cli/recall.cjs inbox status
```

The connection installer creates a profile-specific launcher for your assistant; `npm link` optionally provides the short `recall` command. `npm run setup -- --check` checks prerequisites only. `npm run setup -- --no-launch` installs and builds without opening a profile.

```sh
npm test
npm run build
npm run test:desktop
npm run test:connections
npm run audit:release
```

Use `RECALL_DATA_DIR=/absolute/test-profile npm start` for an isolated library. Direct CLI imports, backups, restore and trust actions require the app to be closed. Inbox capture/submission and read-only searches work while it is open. The reusable skill contracts are under [skills/recall-source/references](skills/recall-source/references/).

</details>

**Beta boundaries:** Apple Silicon macOS, source build and optional integrations. Signed distribution, automatic handwriting grading, continuous KB sync and other platforms remain future work. See the [public-readiness review](docs/PUBLIC_REVIEW.md).

Code is **MIT**. Original demo content is **CC0-1.0**. Imported material retains its own terms. Recall is not affiliated with the services it can connect to.
