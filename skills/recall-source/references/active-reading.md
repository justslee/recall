# Active reading to Recall

## Ordinary learning questions

1. Give the useful explanation in the first substantive user-visible message. Verify the facts when the answer itself needs a source check. Keep capture and publishing out of the way of the explanation.
2. If Recall capture is enabled, do one bounded local lookup after answering. Try a distinctive title, known alias or concept ID with `recall cards search`. Use already available note or card identities when useful. Inspect the closest candidates and reuse only ready, unsuspended cards that test the actual objective. An ambiguous match can wait for preparation.
3. Submit a concise objective through `recall inbox add FILE`. Link exact matches immediately. For a gap, queue the objective with empty `cardIds`, or use `needsAuthoring: true` and a reason if it also has a reusable card. Batch closely related objectives at a natural checkpoint. Keep the capture ID and actual timestamp stable on retries.
4. Return one short receipt. Say “Queued for Recall” for pending work. For a reused card, use the verified link from `recall cards link CARD_ID`. If capture fails, report the specific failure briefly and leave the explanation usable.

The quick path ends with local capture. Leave live KB searches for publishing, and leave new cards, supplements, visual checks and exercise validation for preparation. An ordinary question does not request a new KB entry, mirror write or background worker. Honor capture pause and opt-out. Capture only discussed learning, excluding routine operations, raw transcripts, secrets and assistant-only work.

## Explicit publishing or preparation

- **Save to the KB.** Use [knowledge operations](knowledge.md) for the selected source, live scoped deduplication when Notion is primary, revision checks and verified canonical writes. Mirror only the committed result to configured destinations. The Notion outbox records a pending request until a connector-enabled assistant writes and reads it back. Report KB and Recall outcomes separately.
- **Prepare for study.** Use the [inbox contract](inbox.md) for queued or explicitly requested card work. Check for exact reuse first. Assess concept, math and coding separately, including when a concept card already exists. Author only genuine gaps and run the relevant checks before importing. A generated exercise is practice, not evidence of solving. Never start a test, infer mastery, rate cards or change schedules because of exposure.

Verified card links open the receiving local library with answers hidden. If custom links are unsupported, give the exact card title for Library search. The optional catch-up scanner follows its saved scope and supplements direct capture.
