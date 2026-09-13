---
name: recall-self-test
description: "Capture substantive learning checkpoints and prepare daily Recall self-tests from exact relevant card IDs. Use when logging learning, wrapping up a learning session or preparing a day's test after opt-in."
---

# Self Test

Read ../recall-source/references/quality.md. Check captureEnabled with `recall doctor` or the selected profile configuration; respect opt-out. Search for exact objectives with `recall cards search`. Write a capture JSON with stable id, sessionId, title, objective, context, actual ISO timestamp at, evidence (discussed/explained/solved), source, optional kbUrl and cardIds. Invoke `recall capture FILE`. Preserve IDs and timestamps on retries. Log an empty cardIds array for a gap, author only the relevant missing objective through recall-cards, then `recall self-test link CAPTURE_ID CARD_ID...`. `recall self-test prepare` regenerates the daily Markdown view. Capture and preparation do not rate questions. Report coverage honestly: only logged sessions are known; nightly preparation cannot recover unlogged conversations. For scheduling, use the agent host's supported automation tool after the user opts in, with their timezone and notification preferences.
