# A quieter learning loop

[Setup](SETUP.md) · [Study walkthrough](demos/STUDY.md)

These controls are in the current source build. Older downloadable releases may show the previous settings tabs until updated.

## Connect what you use

Open **Settings & backups → Connections**. Choose Codex, Claude, your knowledge base, iPad or speech. There is no required order and no Recall account.

- **Assistant:** install the connection, start a fresh chat, then verify that a real learning receipt arrives. CLI sign-in and a learning receipt are separate checks. Open connection details only when you need diagnostics.
- **Knowledge base:** create or connect Notion, Obsidian or Markdown. Multiple destinations are supported. Choose the folder or scope and access before testing it.
- **iPad:** pair Recall Pad once. Paper-session tools are also available inside each assistant’s setup; copying the start prompt does not send it for you.
- **Speech:** save your API key once. Both the compact answer strip and Speak use this setup. Feedback requests remain explicit.

![Connections hub with assistant, knowledge, iPad and speech options](images/connections-hub.png)

## Prepare without leaving your flow

**Connections → Open preparation queue → Prepare in background** previews up to eight captures. Review the selected context, then start. You can leave settings and study while the app works. Existing ready cards remain available immediately.

The queue uses your chosen assistant account with tools disabled. It resolves one capture at a time and reuses the updated library between items. Ready results enter through Recall’s sole database writer. Independent checks that cannot finish remain visible with **Finish with assistant**. A slow model can still take time; the app does not hide failures or invent completion.

**Stop preparation** cancels the active request and keeps its source. Capture pause stops further work. Interrupted batches never silently retry after restart; preview the remaining items before continuing. Preparation does not start a test, rate cards or change schedules.

Routine authoring verification uses hidden, disposable windows and saved screenshots. Your live app stays on its current card. Unchanged verification can be reused only for the same content, scenarios, runtime and dependencies. [Contributor verification instructions](../skills/recall-source/references/invisible-verification.md)

## See where to practice next

Open **Progress** for your **Review journal**. Choose 7, 28 or 90 days. Select a day in the activity chart to inspect its counts and open that day’s review history. The journal uses your configured time zone and never records a review merely because you opened it.

- **Study rhythm:** switch between the four ratings and first/repeat reviews. “First” means a card’s first surviving scored review in all recorded history, not its creation or import date. “Repeat” includes subsequent reviews of that card, including same-day attempts.
- **Seven-day recall trend:** each point divides successful ratings by all scored reviews in the trailing seven calendar days. It weights reviews equally rather than averaging daily percentages. The first visible point can include up to six days before the selected period. No reviews means no estimate, not 0% recall.
- **Scheduled reviews:** today and the following six days show the current due dates of available, previously studied cards. Older overdue cards appear separately. This is a snapshot of existing schedules; it does not predict the new reviews that future ratings may create. It is independent of the selected activity period.
- **Formats and topics:** compare where your recorded practice went. Counts are activity, not a measure of topic mastery.
- **Worth another look:** available cards whose latest scored result was Again or Hard, across all dates. Due cards appear first. Opening a card keeps its answer hidden; continuing study preserves any unfinished session.

“Recalled” includes **Hard, Good and Easy**; Hard still deserves practice. Skips, undone ratings and practice runs are excluded from these scored-review charts. Practice ratings remain a separate count. These are self-ratings, not independently measured retention or a prediction of permanent mastery.

Use **Knowledge → My Brain** for the topic graph, relationships and the provisional review-based expertise index. Atlas is no longer a second dashboard tab. Removing that view does not remove its underlying recorded reviews, explanations, code attempts or handwriting evidence. [My Brain and its evidence boundaries](CONSTELLATION.md)
