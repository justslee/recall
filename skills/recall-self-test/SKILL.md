---
name: recall-self-test
description: "Capture substantive reading questions and learning checkpoints into daily Recall self-tests. Reuse cards, fill meaningful gaps and return direct card links after opt-in."
---

# Self Test

For substantive questions while reading, follow ../recall-source/references/active-reading.md in the same turn. Evaluate useful math/coding supplements even when a concept card already exists. Capture only observed learning, and return verified card links after successful writes.

Read ../recall-source/references/quality.md. Check captureEnabled with `recall doctor` or the selected profile configuration; respect opt-out. Search for exact objectives with `recall cards search`. Write a capture JSON with stable id, sessionId, title, objective, context, actual ISO timestamp at, evidence (discussed/explained/solved), source, optional kbUrl and cardIds. Prefer `recall inbox add FILE` through the installed global recall-bridge; it works while the app is open. Set needsAuthoring when a relevant missing supplement remains. Legacy `recall capture FILE` remains supported. Preserve IDs and timestamps on retries. Log an empty cardIds array for a gap, author only the relevant missing objective through recall-cards, then `recall self-test link CAPTURE_ID CARD_ID...`. `recall self-test prepare` regenerates the daily Markdown view. Capture and preparation do not rate questions. Report coverage honestly: only captured or explicitly inspected local sessions are known. For opted-in catch-up and queued authoring, read ../recall-source/references/inbox.md. `recall catch-up scan` is incremental and respects configured date/project scope; inspect and prepare pending items before regenerating Markdown. For scheduling, use the agent host's supported automation tool after the user opts in, with their timezone and notification preferences.
