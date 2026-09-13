# Knowledge-base connections

The learning skills can create a KB from scratch or enrich existing concepts. They use the source adapter and stable KnowledgeRecord IDs. Configure scoped access first; write-enabled configuration authorizes that workflow, not unrelated folders or databases.

## Markdown and Obsidian

Choose an existing root directory. Scans read `.md` files, YAML frontmatter, wikilinks, standard Markdown image references and embedded Obsidian image references. Hidden paths are skipped. Root escapes and escaping symlinks are rejected. No Obsidian application/plugin is required for filesystem mode; respect any agent-specific instruction requiring its official CLI.

```sh
recall kb scan my-kb
recall kb search my-kb weighted mean
recall kb save my-kb examples/knowledge.json
recall kb save my-kb examples/knowledge.json --apply
```

The example record is original demo content. Existing notes require `--revision HASH` from a fresh scan. Updates preserve arbitrary frontmatter and prose outside Recall's managed explanation block. File backups precede updates. Repeating identical content is a no-op. A title/alias collision requires inspection rather than creating a second concept. Canonical IDs in frontmatter survive renames; read-only notes use a local identity index.

Image embedding: `recall kb asset SOURCE NOTE_PATH RELATIVE_IMAGE` returns a bounded raster data URI. Do not expose an entire vault to import one note. A renamed source or missing connection never deletes Recall cards. Full Markdown/Obsidian application rendering is not reproduced; unsupported source constructs need explicit conversion by the authoring skill.

## Notion connector workflow

Configure `{ "id":"notion-kb", "type":"notion", "scopeId":"your-selected-scope", "write":true, "propertyMap":{"title":"Your title property"} }`.

The connected agent searches and reads the selected Notion scope, inspects the actual schema, then produces normalized fetched snapshots: `[{id, scopeId, title, body, revision, canonicalId?}]`. Save them with `recall kb ingest notion-kb snapshots.json --apply`. Never assume cached snapshots cover all pages: search the live scope before creation.

`recall kb save notion-kb record.json --apply [--revision HASH]` creates a **pending request** under `knowledge/outbox`. It does not write Notion. The agent executes the authorized request through its connected tool, preserving unrelated properties and user sections. It then re-fetches the page and acknowledges the normalized result with `recall kb ack REQUEST_ID result.json --apply`. Verification binds scope, canonical identity, title, authored body and revision to the request. An uncertain create requires reconciliation before retrying. Missing connections are reported, never simulated.

Local Notion exports can be configured as Markdown sources. No direct API credential/client is bundled. The portable connector bridge is tested with fixtures; live connection behavior must be verified with the user's actual connector and schema.

## Optional mirror

Select a canonical source and a destination with scoped write permission. Reuse the same KnowledgeRecord ID, read the destination revision before applying, and acknowledge the canonical write independently. If the mirror fails, retain its pending status and retry only that step after reconciliation. Concurrent edits must be surfaced. The skills document this procedure; continuous automatic bidirectional syncing is not implemented.
