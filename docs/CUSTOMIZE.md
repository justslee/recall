# Make Recall yours with Codex or Claude

[Documentation](README.md) · [Connect an assistant](SETUP.md#learning-capture) · [Card authoring](AUTHORING.md)

**Prefer shorter answers? Brighter diagrams? Different examples? Just ask.** These are choices about your card content, so they do not require a new version of Recall.

Use a connected **Codex or Claude Code** session with the installed Recall skills. You can do this from another local project; you do not need to open the Recall repository. Ordinary Claude or ChatGPT conversations do not automatically have this local connection.

## What can change without an app update?

| What you want                                                                | How to change it                                                                                         |
| :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| More concise answers, a different tone or more familiar examples             | Give the card-authoring assistant your preference.                                                       |
| More colorful diagrams or a particular visual style                          | Ask for themed SVG or interactive HTML/SVG using the existing visual skills.                             |
| Different topic, collection or tag conventions                               | Describe your organization; ask the assistant to reuse appropriate existing collections.                 |
| Beginner exercises, harder practice or a preferred supported coding language | Tell the assistant what to target; math and coding still need to suit the objective and pass validation. |
| Light or dark appearance                                                     | Change your device appearance; Recall follows it.                                                        |
| New navigation, app-wide colors, controls or functionality                   | These change the application itself and need a source change, rebuild and installation.                  |

New cards imported through the supported workflow appear while Recall is open. A changed authoring preference guides **future work**; it does not automatically rewrite existing cards.

## Try a preference in one session

Copy a prompt and replace the topic with yours. These examples create content; they do not edit your installed skills or change your defaults.

**Shorter answers**

> Use the installed Recall card skills to create cards about [topic]. Keep each concept's main answer around 60–90 words: a precise general definition, its connection to the topic and one concrete example. Put useful extra detail in an optional exploration. Preserve necessary caveats and complete worked solutions on math cards. Search existing objectives first and validate any additions.

**More colorful visuals**

> For new Recall cards about [topic], use the installed visual skills. Where a diagram helps, use 2–4 distinct semantic accent colors, meaningful labels and a clean layout. Keep light/dark contrast readable and don't rely on color alone. Use interaction only when it teaches the mechanism; test the calculations and controls. Keep the app's surrounding theme unchanged.

**Practice that fits your needs**

> For [topic], use beginner examples and terminology I can explain aloud. Assess math and Python supplements individually; add them only when they test a useful objective. Keep imports, function signatures and starter code ready, with tests that distinguish correct solutions from realistic mistakes.

## Save your defaults once

After trying a sample, ask your assistant to save a short **Recall preferences** section. Use both hosts if you work in both:

> Save these preferences for future Recall authoring in my connected Codex and Claude Code setups: [paste my preferences]. Resolve each host's active global instruction file, back up the files and add the same concise Recall-only section outside `<!-- recall-connection:begin -->` and `<!-- recall-connection:end -->`. Preserve unrelated instructions, Recall's managed block and the installed skills. Keep source checks, validation, permissions, hidden solutions and review history intact. Show me the actual files changed. Do not rewrite existing cards or change app code.

The usual locations are `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`. Custom Codex homes or an active `AGENTS.override.md` can change which file is loaded; have the assistant check rather than guess. See [OpenAI's instruction guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [Claude Code's instruction guide](https://code.claude.com/docs/en/memory).

**Start a fresh assistant session**, then ask:

> What Recall authoring preferences did you load? Apply them to one genuinely missing objective from [topic], validate it and return its verified Recall link. If the objective already exists, show the existing card instead of duplicating it.

Keep preferences outside Recall's managed block: connection refreshes preserve unrelated instruction text but regenerate the bridge and copied skill kit. Editing those generated files is not a durable way to keep personal defaults. Longer preferences can live in a private Markdown file that your global instructions explicitly tell the assistant to read; Recall does not automatically discover preference files. Keep personal examples and paths out of shared repositories.

These defaults guide your normal assistant sessions. **Prepare next** uses a restricted prompt without these personal instruction files. Ask your connected assistant to inspect and prepare pending items using your saved preferences and the installed inbox workflow. For a blocked item, choose **Finish with assistant** and ask that assistant to apply your preferences.

## Improve cards you already have

Start with a small, named set:

> Review the existing concept cards in [collection] using my Recall preferences. Keep their learning objectives, definitions and examples intact. Show proposed before/after answers and visuals for three cards first, preserving their IDs and study history. Do not create replacements or apply a bulk rewrite.

For existing **concept** cards, approved text or diagram revisions can be saved through Recall's card editor. The additive import CLI rejects changed content under an existing ID; an assistant should report that boundary rather than invent new IDs or edit SQLite directly. Existing **math and coding** prompt/answer revisions currently need a specialist editing path that is not implemented—do not bypass their grading or test checks.

Inspect a sample before scaling up. A concise answer must still teach the concept; a colorful diagram must still explain it. Interactive widgets retain their per-card permission and explicit **Load** step. Your ratings and review schedules stay separate from content customization.
