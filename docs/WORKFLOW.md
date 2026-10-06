# Make Recall yours

[Documentation](README.md) · [Quick start](../README.md#start-in-five-minutes) · [Get help](TROUBLESHOOTING.md)

Start with one study session. Add an assistant, a knowledge base and daily self-testing when you want them. Your accounts, notes and capture scope stay specific to your machine.

[Study](#1-get-one-study-session-working) · [Connect](#2-connect-the-assistants-you-use) · [Knowledge base](#3-choose-your-knowledge-source) · [Daily Self Test](#5-prepare-and-take-the-daily-self-test) · [Daily rhythm](#a-simple-daily-rhythm)

## 1. Get one study session working

1. Follow the [quick start](../README.md#start-in-five-minutes) and choose **Try demo**.
2. Choose **Concepts**, **Math**, **Coding** or **Mixed**, independently of topic and collection. Coding tools are optional.
3. Answer from memory, flip the card, then choose **Again / Hard / Good / Easy**.

**Check:** the demo adds three original cards, answers start hidden, and your rating updates that card's schedule. A fresh profile contains none of the maintainer's material.

For card links from chat, [keep Recall in Applications](SETUP.md#keep-recall-in-applications) and launch it before installing assistant connections.

## 2. Connect the assistants you use

1. Open **Settings & backups → Learning connections**.
2. Connect Codex, Claude Code or both. Review the proposed instruction and skill paths, then choose **Install connection**.
3. Enable **Allow learning capture from my configured skills**, choose your learning timezone and **Save learning settings**.
4. Start a **fresh assistant session** and choose **Check readiness** in Recall.

The installer adds a profile-specific launcher, the portable skill kit and a managed global bridge instruction. It backs up existing instructions and preserves unrelated skills. You can learn in another local project without opening the Recall repository.

| Readiness check  | What it establishes                                                               |
| ---------------- | --------------------------------------------------------------------------------- |
| Installation     | The managed connection is installed.                                              |
| CLI              | The local assistant command is available and supports the required restrictions.  |
| Sign-in          | The CLI reports local sign-in; this is not a live provider test.                  |
| Learning receipt | The unique verification request reached ready, unsuspended cards in this library. |

Choose **Verify learning**, enter a real concept, then **Create verification prompt → Copy prompt**. Paste that exact prompt into the fresh assistant session. Its unique check ID binds the receipt to this verification; a generic prompt does not complete the check.

After verification, try a normal request from another project:

> Use the installed recall-bridge to check my connection and capture status. Then explain weighted means with a concrete example. Reuse suitable existing objectives, consider useful math/coding supplements, capture only what we discuss and return a new/reused/pending receipt with verified Recall links.

**Check:** ready cards can enter today's Self Test immediately. Missing objectives remain in the inbox until prepared; **pending** does not mean a card exists.

You can say **“Don't capture this discussion.”** Routine operations and assistant-only implementation should not be captured. Exposure does not infer mastery or rate cards. A paused connection stays paused.

For a custom Codex home, connect with `CODEX_HOME` available and inspect the proposed paths. Reconnect after moving the home or app. See [connection troubleshooting](TROUBLESHOOTING.md#my-assistant-did-not-add-anything-to-recall).

## 3. Choose your knowledge source

Open **Settings & backups → Learning connections → Knowledge sources**.

- **Starting from scratch:** choose **Create my first knowledge base**. Select Markdown, Obsidian, Notion or several together; choose one primary home and optional mirrors. Review the destinations and authoring permission before creating them.
- **Already have notes:** choose **Add knowledge source**, select its folder or Notion scope, choose access, then **Test connection**. Keep it read-only until you want authoring.

| Source         | What you provide                                                                             |
| -------------- | -------------------------------------------------------------------------------------------- |
| Local Markdown | A home for a new folder, or an existing notes folder.                                        |
| Obsidian       | A home for a new vault, or an existing vault/KB subfolder. No mandatory plugin.              |
| Notion         | A selected parent page or existing KB scope, plus your assistant's working Notion connector. |

Local folders are created immediately. Notion stays pending until your assistant creates and reads back the selected KB. Use **Finish Notion with assistant → Copy setup prompt**, then **Refresh setup**. Recall does not log into Notion or install that connector.

For a Notion-first KB with an Obsidian mirror, select both and make Notion primary. Finish the primary before authoring concepts; a ready mirror is not silently promoted. For an existing setup, grant scoped write permission to the selected destinations, then tell your assistant:

> Use my configured Notion KB as canonical and the selected Obsidian KB as its mirror. Search before creating. After a verified Notion write, mirror the same concept ID to Obsidian, preserving unrelated content. Report each outcome separately; keep a failed mirror pending rather than repeating the successful create.

**Check:** the canonical note and each requested mirror have separately verified outcomes, with matching source IDs on the cards. Connection preflight and cached snapshots do not prove live Notion access. Mirroring is assistant-driven; automatic background or bidirectional sync is not implemented.

[Knowledge-base guide →](KNOWLEDGE.md)

## 4. Create questions that test the idea

Try this with your connected assistant:

> Use Recall's installed learning and card skills for this concept. Give it a general definition, connect it to my topic and include a concrete example. Add a purpose-built interactive visual only where it helps. Individually assess whether a math or coding question tests a useful objective. Reuse existing objectives, validate genuine additions and preserve existing history.

The [skill kit](../skills/) covers concepts, quick questions, deep dives, learning programs, cards, visuals, math, code, audits and Self Tests. Its shared contracts live under [recall-source/references](../skills/recall-source/references/).

- Coding supplements include imports, signatures, starter code, a reference solution and behavioural tests. Validation must accept the reference and reject the starter and realistic incorrect implementations.
- An AI validation report does not unlock **Run**. Native code requires a separate local source review and trust action.
- Interactive widgets need explicit local permission and **Load interactive**.

**Check:** the receipt distinguishes reused, newly imported and blocked objectives. Inspect actual rendered content and interactions. Math and coding questions have their own review state.

[Authoring guide →](AUTHORING.md)

## 5. Prepare and take the daily Self Test

Ask your connected assistant:

> Prepare today's Recall Self Test from actually captured learning, using my profile timezone. Inspect connection/capture status and respect pause. If catch-up is enabled, scan supported local records within its saved date/project scope first; do not broaden it. Inspect each pending inbox item. Reuse ready unsuspended objectives; resolve real gaps with the installed card skills and their editorial, visual, math and code checks. Submit validated results through the inbox, regenerate the daily Markdown log, and report specific blocked gaps. Do not start or rate a test, change schedules, invent learning or infer mastery.

For an individual inbox item:

- **Prepare next** sends one previewed item through a supported, signed-in CLI. Its restricted worker has tools disabled.
- **Finish with assistant** copies an item-specific prompt for your normal assistant to complete missing browser, runtime or connector checks and submit a validated result.
- **Retry** can address a transient failure; it cannot substitute for missing quality checks.

To schedule preparation, ask an assistant host that supports scheduling. Specify your time, timezone and opted-in scope. Ask it to **stay quiet when unchanged; notify only when a new or materially updated test is ready, a failure occurs or a gap needs attention**. Recall does not create this automation during setup.

Then open **Self Test**, select a learning day and format, and answer from memory. Previous days offer **Review needs practice** and **Review all cards**. Ratings update the original cards' schedules. The next day's test covers that day's captured learning; earlier due cards return through Study Desk.

**Check:** coverage means logged objectives, not every conversation. Completing a pass means attempted, not mastered.

## 6. Catch up only if you want to

1. Under **Learning connections**, enable local catch-up.
2. Choose a start timestamp, included projects and exclusions.
3. Save, then choose **Check now**. Periodic scanning runs while Recall is open.

The scanner reads supported local Codex/Claude session records, excludes tool payloads and queues candidate learning. Missing or cloud-only sessions are unavailable. Malformed and incomplete sources remain visible rather than becoming fabricated coverage. Redaction is best-effort; inspect the exact context preview before preparation.

**Check:** the displayed scope matches your choice and pending items remain distinct from ready cards. Changing scope does not erase previously captured learning.

## 7. Add spoken practice when ready

Save your own OpenAI API key once under **Settings & backups → Voice & feedback**. No key is needed for ordinary study or typed local drafts. API requests need internet and separate API billing.

- Use the card's **Speak / Type** strip for a quick answer.
- Use **Speak → Your own topic** for a longer explanation or presentation, with an audience and optional reference.
- Record, correct the transcript, then request feedback. Accuracy needs a reference; pause measurements are estimates.

The key persists locally as plaintext in `credentials/openai.key`, with `0600` file permissions inside a `0700` folder. Recall does not use macOS Keychain or `safeStorage`; software running as your OS account can read it. The key is not returned to the renderer and is excluded from Recall exports and profile backups; whole-machine backups may include it.

Legacy `credentials/openai.enc` is not automatically migrated or decrypted. Re-enter the key once; the old file remains until a replacement is successfully saved or you explicitly remove it. Each new profile or Mac needs its own optional credentials.

[Spoken answers →](VOICE.md) · [Speak practice →](SPEAK.md)

## A simple daily rhythm

1. Learn or build in any connected project; ask questions as you go.
2. Read the assistant's receipt. Reuse covered objectives and finish genuine gaps.
3. Take the day's Self Test in the format you can manage.
4. Return to due cards in Study Desk. Practise explaining larger ideas in Speak.
5. Back up periodically. Keep backups, session excerpts and private exports out of public repositories.

Checkout updates do not replace your library or saved key. After moving Recall, reconnect assistants from its final location. External KB folders and optional runtimes are separate from profile backups; reconnect and re-enter credentials after restoring on another Mac.

**Next:** [Knowledge sources](KNOWLEDGE.md) · [Setup reference](SETUP.md) · [Troubleshooting](TROUBLESHOOTING.md)
