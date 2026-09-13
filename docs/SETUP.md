# Setup

Run the app once or `recall init`. The default Mac profile is `~/Library/Application Support/Recall`; pass `--data /absolute/profile` or set RECALL_DATA_DIR to isolate another profile. Existing profiles bypass the welcome demo. Quit the app before a CLI operation that writes the library; read-only card search is available while it is open.

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
      "write": true
    }
  ]
}
```

`recall config config.json` previews; `recall config config.json --apply` saves. Source roots must already exist; `write:false` is the default for reading existing notes. Choose `obsidian` for a selected vault/folder, or `notion` with scopeId/propertyMap as described in KNOWLEDGE.md. No passwords/tokens belong in this file. Sources do not need to be inside the Recall repository. The CLI does not download remote assets automatically.

Use `recall doctor` to check the active profile, sources and runtime availability. Missing compilers do not prevent concept study. Scientific Python exercises can use the optional profile `python/bin/python3` environment; installing its dependencies is an explicit separate operation.

## Learning capture

Enable capture in Settings or set captureEnabled to true in configuration. Install the skills into your agent's supported skill location and explicitly opt into checkpoint capture in that agent's instructions if desired. Use its supported automation tool to schedule `recall self-test prepare` and authorized card-gap authoring. There is no always-on conversation watcher or built-in background AI service.

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
