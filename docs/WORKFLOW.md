# Make Recall yours

Recall ships the study app and the learning instructions that connect it to an assistant. Your knowledge, accounts and capture scope are configured on your own machine. You can adopt the whole loop or start with study alone.

## 1. Get one study session working

Follow the [README](../README.md#start-in-five-minutes), try the original demo and flip a card. Choose Concepts, Math, Coding or Mixed independently of topic and collection. Coding tools are optional.

**Check:** the demo adds three original cards; a new installation has none of the maintainer's material. Answers start hidden. Rating a card updates that card's schedule.

If you want card links to open from chat, package Recall, move the app to its final location and launch it once before installing assistant connections.

## 2. Connect the assistants you use

Open **Settings & backups → Learning connections**. Connect Codex, Claude Code or both. Review the proposed global instruction/skill paths, then **Install connection**. Enable **Allow learning capture from my configured skills**, set your learning timezone, and **Save learning settings**. Start a fresh assistant session.

The installer creates a profile-specific CLI launcher, copies the portable skill kit and adds a managed global bridge instruction. Existing instructions are backed up and unrelated skills are preserved. You do not need to open the Recall repository for each conversation.

**Check from another local project:**

> Use the installed recall-bridge to check my connection and capture status. Then explain weighted means with a concrete example. Reuse suitable existing objectives, consider useful math/coding supplements, capture only what we discuss and return a new/reused/pending receipt with verified Recall links.

Existing, ready cards can enter today's Self Test immediately. A missing objective appears in the inbox; pending does not mean a card was created. A paused connection must stay paused.

You can tell the assistant **“Don't capture this discussion.”** Routine operations and assistant-only implementation should not be captured. Capture records exposure; it does not infer mastery or rate a card.

If you use a custom Codex home, connect from a process with that `CODEX_HOME` available and inspect the installation preview. Reconnecting refreshes saved paths. See [Troubleshooting](TROUBLESHOOTING.md).

## 3. Choose your knowledge source

Start with one source. See [Knowledge sources](KNOWLEDGE.md) for a copyable configuration and read/write permissions.

| Choice         | What you supply                                                            | What the assistant uses                                                         |
| :------------- | :------------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| Local Markdown | An existing folder of notes                                                | Scoped Markdown files and stable concept IDs                                    |
| Obsidian       | A selected vault or KB subfolder                                           | The same scoped filesystem adapter; no mandatory Obsidian plugin                |
| Notion         | A selected page/database scope and a connector available to your assistant | Live scoped searches/reads, local fetched snapshots and verified write receipts |

Ask the assistant to check the configured source before importing or writing. Start read-only if you are connecting existing notes. The app's source configuration does not authenticate a Notion account or install the assistant's connector.

For a Notion-first KB with an Obsidian mirror, configure both selected sources with write permission. Tell the assistant:

> Use my configured Notion KB as canonical and the selected Obsidian KB as its mirror. Search before creating. After a verified Notion write, mirror the same concept ID to Obsidian, preserving unrelated content. Report each outcome separately; keep a failed mirror pending rather than repeating the successful create.

**Check:** a newly captured concept has a verified canonical note, a separately verified mirror where requested, and matching source IDs on its cards. This is an assistant-driven workflow; continuous background or automatic bidirectional KB sync is not implemented.

## 4. Create questions that test the idea

Try this with your configured assistant:

> Use Recall's installed learning and card skills for this concept. Give it a general definition, connect it to my topic and include a concrete example. Add a purpose-built interactive visual only where it helps. Individually assess whether a math or coding question tests a useful objective. Reuse existing objectives, validate genuine additions and preserve existing history.

The kit includes concept capture, quick questions, deep dives and learning programs, plus card, visual, math, code, audit and Self Test skills. They share the contracts under `recall-source/references`; you can inspect and customise them.

Coding supplements include imports/signatures, starter code, a reference solution and behavioural tests. Validation must accept the reference, reject the unfinished starter and reject realistic incorrect implementations. An AI report alone does not unlock **Run**: a separate local source review and trust action is required. Interactive widgets also require explicit local permission and a **Load interactive** action. See [Authoring](AUTHORING.md).

**Check:** the receipt distinguishes reused, newly imported and blocked objectives. Open the cards and test their actual rendered content and interactions. Math/code questions have separate review state from their concept card.

## 5. Prepare and take the daily Self Test

Ask your connected assistant:

> Prepare today's Recall Self Test from actually captured learning, using my profile timezone. Inspect connection/capture status and respect pause. If catch-up is enabled, scan supported local records within its saved date/project scope first; do not broaden it. Inspect each pending inbox item. Reuse ready unsuspended objectives; resolve real gaps with the installed card skills and their editorial, visual, math and code checks. Submit validated results through the inbox, regenerate the daily Markdown log, and report specific blocked gaps. Do not start or rate a test, change schedules, invent learning or infer mastery.

**Prepare next** in Settings can prepare one previewed item with a supported, signed-in CLI. Its worker has tools disabled. For a missing visual, math or coding objective requiring browser/runtime checks, ask your normal assistant to complete the item directly using the inbox contract. Failed or incomplete checks remain blocked.

To make this daily, ask an assistant host that supports scheduling to run the preparation prompt at your chosen time. Include your timezone, opted-in scope and this notification preference: **stay quiet when unchanged; notify only when a new/materially updated test is ready, a failure occurs or a gap needs attention.** Recall does not create this automation during setup.

Open **Self Test**, choose a learning day and a format, and answer from memory. Previous days remain available through **Review needs practice** or **Review all cards**. These are real reviews: any ratings you submit update the original schedules. The next day's Self Test represents that day's captured learning; earlier due cards return through scheduled Study Desk review.

**Check:** Self Test covers the logged objectives, not every conversation you may have had. Completion means attempted, not mastered.

## 6. Catch up only if you want to

Under **Learning connections**, enable local catch-up and choose a start timestamp, included projects and exclusions. Save the settings, then **Check now**. Recall scans periodically while open.

It reads supported local Codex/Claude session records, excludes tool payloads and queues candidate learning. It cannot read missing/cloud-only sessions. It reports malformed and incomplete sources rather than fabricating coverage. Redaction is best-effort; inspect the exact provider preview before preparation.

**Check:** the displayed date/project scope matches your choice, source errors remain visible, and pending items are distinguished from ready cards. A scope change does not erase previously captured material.

## 7. Add spoken practice when ready

Save your own OpenAI API key once under **Settings & backups → Voice & feedback**. The key persists across restarts and updates in the local plaintext `credentials/openai.key` file, with owner-only `0600` file permissions inside a `0700` folder. Recall does not use `safeStorage` or access macOS Keychain for this connection. Software running as your OS account can read it. It is never returned to the renderer after saving and is excluded from Recall's exports/profile backups; whole-machine backups may include it. Someone setting up their own clone/profile saves their own key once. No key is needed for typed local drafts or ordinary study.

If a profile has only a legacy `credentials/openai.enc`, re-enter the key once in this section. Recall does not automatically migrate or decrypt it. The old file remains untouched until a replacement key is successfully saved or you explicitly remove the key.

Use the card's **Speak / Type** strip for a quick answer. Use **Speak → Your own topic** for an explanation or presentation, with an audience and optional reference. Record, correct the transcript and request feedback. Factual accuracy requires a reference; pause measurements are estimates. These API requests need internet and separately billed API access. See [Voice](VOICE.md) and [Speak](SPEAK.md).

## A simple daily rhythm

1. Learn or build in any connected project; ask questions as you go.
2. Check the assistant's receipt. Reuse covered objectives and finish genuine gaps.
3. Take the day's Self Test in the format you can manage.
4. Return to scheduled cards in Study Desk. Use Speak to practise explaining a larger idea.
5. Back up the profile periodically. Keep backups, session excerpts and private exports out of public repositories.

Updates to this checkout do not replace your library or saved key. After moving the app, reconnect assistants from its final location. After restoring a profile backup on another Mac, re-enter optional credentials; external KB folders and runtimes are separate from the profile backup.
