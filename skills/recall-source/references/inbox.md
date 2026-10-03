# Cross-project learning inbox

Use the installed recall-bridge CLI to connect to the selected profile. Capture pause applies to scanning, preparation and import. Only connected assistants and explicitly enabled catch-up scopes are inspected. This is a local queue, not a promise of coverage for unavailable conversations. `inbox preview` shows the exact source, bounded matching card excerpts, and same-session objectives selected for preparation. Preparing uses the selected CLI's default provider with existing authentication, restricted tools/configuration and a macOS filesystem boundary. It does not load arbitrary personal hooks, plugins or provider configuration. Do not widen permissions to work around a failed isolation check.

`inbox add FILE` accepts a LearningCapture with optional `needsAuthoring: true` and `reason` for missing objectives or useful supplements. Reuse verified cards immediately. Stable capture identity and timestamp must survive retries. No direct SQLite writes; the running app applies submitted results through its writer. With the app closed, use `inbox apply`.

`catch-up scan` reads only opted-in local session records incrementally. `inbox status` shows pending, processing, submitted, ready, dismissed and blocked items, plus source read errors. `inbox preview` prints the exact context and its digest; `inbox prepare DIGEST` runs ONE pending item using the selected signed-in CLI and refuses a stale or missing digest, so read the preview before preparing. Repeated calls are bounded explicit work; it does not recursively launch more agents. The desktop's Prepare next button does the same. `inbox inspect ID` exposes one item for the current assistant to prepare directly, without another worker. `inbox retry ID` retries blocked work. Do not retry unchanged failures forever.

To resolve a genuine gap, read the cards skill and shared quality reference; apply visuals, math and coding references where useful. Precise general definition, source/topic connection and concrete examples are expected. Purpose-built interactive diagrams should test understanding where appropriate. Do not force a math/code variant for every concept. Check rendered content and interactions in an isolated profile. Validate code with the reference passing, stub failing and meaningful mutants rejected; include the exact-content ValidationReport. If a required tool/check is unavailable, leave the item blocked with the specific gap. Do not assert validation based on schema checks alone.

Submit `inbox submit ITEM_ID RESULT.json`. Result shape:

```json
{
  "captures": [
    {
      "title": "Concept",
      "objective": "The particular capability to test",
      "context": "What the user actually asked or discussed",
      "at": "actual source message ISO timestamp",
      "cardIds": ["verified-id"]
    }
  ],
  "reason": "Optional coverage/exclusion explanation"
}
```

For a captured objective, return exactly one capture with cardIds; its original metadata is preserved. For a session, every timestamp must occur in source.json and the objectives must be grounded in that turn. Exclude routine operations, assistant-only implementation, secret values and explicit capture opt-outs. Reuse objectives already captured in the same session rather than duplicating them. A session with no substantive learning uses `captures: []` and a reason.

New cards additionally require `pack: {schemaVersion: 1, id, title, cards}` and `quality: {reviewedCardIds: [...], evidence: "checks actually performed"}`. Every new card must be referenced by a capture. Coding cards may be imported for study but remain locked for execution: submitted `codeReport` claims never grant trust. After inspecting executable content and performing the coding checks, use the explicit local `cards trust ID REPORT --apply` workflow; it independently runs the reference/starter inside the macOS sandbox and records approval outside the worker. Keep existing approvals and schedules intact. Conflicting existing IDs are blocked; never duplicate a concept to bypass a conflict. Quality evidence is an author attestation, not proof of teaching quality. The restricted preparation worker cannot execute tests or inspect a browser; never claim those checks occurred. If unfinished, return `{"blocked":"specific remaining work"}` or report the gap when working interactively.

Return links only after `cards link ID` confirms the card exists. An imported exercise is not a solved exercise; capture and import never rate cards or change review schedules. Notion/Obsidian writes remain separate, scoped workflows using their configured connectors and authoring skills.
