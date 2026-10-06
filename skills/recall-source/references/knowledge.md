# Knowledge sources and writing

For a new KB, use **Settings & backups → Learning connections → Knowledge sources → Create my first knowledge base**. The user can select Markdown, Obsidian, Notion or several together and choose a primary home. For existing notes, use **Add knowledge source**: select the existing folder or page/database scope, choose **Read-only** or **Scoped authoring**, and **Test connection** before saving. Local checks read a bounded sample without editing notes. Notion scope/snapshot checks are local preflight; a real scoped search through the assistant's connected tool is required to verify live access.

## New knowledge-base setup

The app creates only the new local destinations shown in the user's creation preview. Obsidian is a Markdown folder with minimal `.obsidian` configuration; the user opens that folder as a vault. Do not install plugins, modify the user's global Obsidian settings, or initialize another vault inside an existing vault. Existing notes belong in the existing-source flow. Creating scaffolding does not create concepts/cards or enable learning capture.

Inspect configured source roles before authoring. A created source's `setupGroup` identifies its group, `role` (`primary`, `mirror` or `reference`) and `primarySourceId`. Use the user's selected primary for canonical writes and only `mirror` destinations for copying. `reference` destinations are read-only after creation. Other configured sources are not automatically mirrors. A local mirror must not become primary merely because the selected Notion primary is pending. Preserve unrelated source configurations, timezone and capture preferences.

If several setup groups or independent sources exist, resolve the intended KB from the user's current learning scope and session context. A group's primary is not a global primary for every project. Ask for the intended scope when context cannot distinguish it; do not merge groups or mirror to all configured sources. If a source was removed or its access policy changed, retain that choice. A setup reporting **Needs attention** requires explicit source review/reconnection; retry must not restore removed sources or undo authoring restrictions.

Notion creation is an assistant handoff, not an app-side remote write. The user must install a Codex or Claude Recall connection first, then use a fresh session with a working Notion connector authorized for the selected parent. A missing local bridge blocks the copyable handoff prompt; it does not discard the pending setup. Use the saved setup request and its generated prompt:

```sh
recall kb setup list
recall kb setup inspect REQUEST_ID
recall kb setup prompt REQUEST_ID
```

The request binds the new KB name and selected parent. Fetch that actual parent using the connected Notion tool and confirm creation permission. Create one new database within that parent; do not repurpose an unrelated database or search the whole workspace. Include the request's unique setup marker in its description and create a title property named `Name`. Inspect the connector's current database/data-source schema. Modern Notion separates a database container from its data sources: use the real initial data-source ID for queries and page creation when the connector requires it. Immediately retain the returned IDs with the generated prompt's identity receipt:

```sh
recall kb setup record REQUEST_ID RECEIPT.json --apply
```

This records identity, not successful completion or source registration. Create or reuse the starter index using the exact `inspect.starter` title and body. Re-fetch the database, parent relation, schema and starter index. The completion attestation must identify the actual `Name` property as type `title`, bind its data-source ID to the recorded identity, and include the exact fetched starter body and edit revision. If a legacy connector cannot expose a data-source ID, report that explicit limitation in the generated contract rather than substituting the database ID. Use the exact completion contract in the generated prompt:

```sh
recall kb setup complete REQUEST_ID RESULT.json --apply
```

This applies a validated receipt; `--apply` is required. Inspect the request and generated contract before submitting. Only a completed request registers the new Notion source. The receipt must represent the connector's actual create/read-back result, never invented IDs, copied configuration or a sample fixture. Recall validates the receipt's consistency; it does not independently authenticate to Notion or verify a remote response. Describe success as an assistant-verified read-back.

If creation may have succeeded but its response was lost, reconcile the exact selected parent's children and saved IDs before retrying; do not create a duplicate. A missing connector, insufficient permission, unsupported schema or uncertain result stays pending and is reported. Local destinations may be ready independently. A failed Notion setup does not delete local notes or existing Recall learning.

After setup, grow the selected KB from actual discussed learning: search names and aliases, assign broad topics, link related concepts and reuse suitable Recall objectives. Mirror only verified canonical writes, retaining the same concept ID and each destination's own revision. Respect each source's authoring permission and capture pause.

## Reading and authoring configured sources

For advanced assistant-driven setup, preview a JSON configuration with `recall config FILE` before applying it with `--apply`. Each source has `id`, `type` (markdown, obsidian, notion), `root` (absolute local scope), and `write` (default false). Notion uses `scopeId` and a propertyMap instead of root. CLI configuration replaces the source list, so retain every existing source and preserve unrelated profile preferences. Authoring permission applies only to that selected source; a separate vault/database is not automatically authorized.

Use `recall kb scan SOURCE` or `recall kb search SOURCE TERMS`. Scan results include stable IDs, paths, revisions, metadata, body, links and asset references. Inspect matches before creating. A same-title match may be adjacent rather than identical: resolve the identity deliberately. Local sources skip hidden paths and reject paths/symlinks outside scope. Markdown and Obsidian use filesystem operations; use the host's required Obsidian workflow instead where applicable instructions require it. Never broaden scope to work around a permission failure.

A KnowledgeRecord JSON file contains id, title, body (Markdown), aliases[], topics[], sources[], related[]. Preview with `recall kb save SOURCE FILE`; apply with `--apply`. Existing notes require `--revision HASH` from a fresh scan. Managed explanation blocks update independently of user prose/frontmatter. Backups are kept in the profile. Dollar signs, display equations, links and attachments must survive exactly. IDs live in frontmatter so renames retain identity. Search aliases and verify links after writes.

`recall kb asset SOURCE NOTE_PATH RELATIVE_ASSET` resolves bounded PNG/JPEG/WebP into a data URI for an authored card. Keep file references in the KB; card assets must be embedded/local rather than remote hotlinks. Review formulas with KaTeX/MathJax as appropriate; compute numeric examples independently. Never silently rewrite source math merely to pass a renderer.

## Notion through the user's connected tools

The app does not contain a Notion OAuth client. The agent uses its connected Notion tools to search/read only the configured scope. Fetch the actual schema and map the user's properties; never assume a fixed Name/Title field. Retain the created database ID and its actual data-source ID when available; use each where the connected tool expects it. Without a connection, use an authorized local export or report the unavailable connection.

Normalize fetched pages into an array: `{id,scopeId,title,body,revision,canonicalId?,aliases?}`. Revision is the remote edit token/time from the fetch. Retain snapshots with `recall kb ingest SOURCE SNAPSHOTS --apply`; scope mismatches are rejected. Before creating, search the live scoped KB, not only cached snapshots. Before updating, fetch the page again and check its current revision.

`recall kb save SOURCE RECORD --apply [--revision REV]` creates a pending outbox request, not a successful remote write. Inspect its operation, scope, propertyMap and remoteId. Use the connected Notion tool to execute the authorized change, preserving unrelated properties and user content. Fetch the resulting page, extract the exact authored body and canonical ID, then `recall kb ack REQUEST_ID FETCHED_RESULT --apply`. Acknowledgment verifies scope, identity, title and body; it is never a substitute for a fresh remote fetch. For an uncertain create result, reconcile by canonical ID before retrying.

For optional mirroring, follow the explicit primary/mirror roles from setup, or the user's selected canonical and mirror sources for an existing setup. After a verified canonical write, copy the same KnowledgeRecord ID into each selected mirror using its existing expected revision. Keep the verified outbox receipt when a mirror fails and report 'canonical saved; mirror pending'. A retry starts by inspecting both sides; do not redo a successful create. Concurrent user edits require reconciliation. Automatic background bidirectional sync is not provided.
