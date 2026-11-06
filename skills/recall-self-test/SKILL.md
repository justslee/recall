---
name: recall-self-test
description: "Queue substantive learning after answering, reuse ready Recall cards and prepare daily self-tests with validated cards when requested."
---

# Self Test

For ordinary learning questions, follow [active reading](../recall-source/references/active-reading.md). Answer first, reuse exact ready cards or queue the missing objective, and stop after the local receipt.

Check `captureEnabled` in the bridge's `connections status` or the selected profile. Submit capture JSON via `recall inbox add FILE` with `id`, `sessionId`, `title`, `objective`, `context`, actual ISO timestamp `at`, `evidence` (discussed, explained or solved), `source`, optional `kbUrl` and `cardIds`. Use empty `cardIds` for a gap. Keep IDs and timestamps stable on retries.

For explicit or scheduled preparation, read the [inbox contract](../recall-source/references/inbox.md) and [quality rules](../recall-source/references/quality.md). Inspect opted-in catch-up items within saved scope. Reuse exact objectives, assess math and coding suitability, and author and validate meaningful gaps through recall-cards. Apply through Recall's writer before claiming readiness. Run `recall self-test prepare` to regenerate the daily Markdown view. Preserve review schedules and incomplete items. Report only coverage supported by captured or explicitly inspected sessions. Use the host's supported automation tools for requested scheduling and honor the user's timezone and notification preferences.
