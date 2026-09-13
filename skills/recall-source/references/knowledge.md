# Knowledge sources and writing

Configure the profile with a JSON file and `recall config FILE --apply`. Each source has `id`, `type` (markdown, obsidian, notion), `root` (absolute local scope), and `write` (default false). Notion uses `scopeId` and a propertyMap instead of root. Authoring permission applies only to that selected source; a separate vault/database is not automatically authorized.

Use `recall kb scan SOURCE` or `recall kb search SOURCE TERMS`. Scan results include stable IDs, paths, revisions, metadata, body, links and asset references. Inspect matches before creating. A same-title match may be adjacent rather than identical: resolve the identity deliberately. Local sources skip hidden paths and reject paths/symlinks outside scope. Markdown and Obsidian use filesystem operations; use the host's required Obsidian workflow instead where applicable instructions require it. Never broaden scope to work around a permission failure.

A KnowledgeRecord JSON file contains id, title, body (Markdown), aliases[], topics[], sources[], related[]. Preview with `recall kb save SOURCE FILE`; apply with `--apply`. Existing notes require `--revision HASH` from a fresh scan. Managed explanation blocks update independently of user prose/frontmatter. Backups are kept in the profile. Dollar signs, display equations, links and attachments must survive exactly. IDs live in frontmatter so renames retain identity. Search aliases and verify links after writes.

`recall kb asset SOURCE NOTE_PATH RELATIVE_ASSET` resolves bounded PNG/JPEG/WebP into a data URI for an authored card. Keep file references in the KB; card assets must be embedded/local rather than remote hotlinks. Review formulas with KaTeX/MathJax as appropriate; compute numeric examples independently. Never silently rewrite source math merely to pass a renderer.

## Notion through the user's connected tools

The app does not contain a Notion OAuth client. The agent uses its connected Notion tools to search/read only the configured scope. Fetch the actual schema and map the user's properties; never assume a fixed Name/Title field. Without a connection, use an authorized local export or report the unavailable connection.

Normalize fetched pages into an array: `{id,scopeId,title,body,revision,canonicalId?,aliases?}`. Revision is the remote edit token/time from the fetch. Retain snapshots with `recall kb ingest SOURCE SNAPSHOTS --apply`; scope mismatches are rejected. Before creating, search the live scoped KB, not only cached snapshots. Before updating, fetch the page again and check its current revision.

`recall kb save SOURCE RECORD --apply [--revision REV]` creates a pending outbox request, not a successful remote write. Inspect its operation, scope, propertyMap and remoteId. Use the connected Notion tool to execute the authorized change, preserving unrelated properties and user content. Fetch the resulting page, extract the exact authored body and canonical ID, then `recall kb ack REQUEST_ID FETCHED_RESULT --apply`. Acknowledgment verifies scope, identity, title and body; it is never a substitute for a fresh remote fetch. For an uncertain create result, reconcile by canonical ID before retrying.

For optional mirroring, choose one canonical KB. After a verified canonical write, copy the same KnowledgeRecord ID into the configured mirror using its existing expected revision. Keep the verified outbox receipt when a mirror fails and report 'canonical saved; mirror pending'. A retry starts by inspecting both sides; do not redo a successful create. Concurrent user edits require reconciliation. Automatic background bidirectional sync is not provided.
