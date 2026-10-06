# Knowledge-base connections

The learning skills can create a KB from scratch or enrich existing concepts. They use the source adapter and stable KnowledgeRecord IDs. Configure scoped access first; write-enabled configuration authorizes that workflow, not unrelated folders or databases.

## Create your first knowledge base

Open **Settings & backups → Learning connections → Knowledge sources → Create my first knowledge base** (**Create knowledge base** if you already have sources). The guide follows **Destinations → Homes → Review**. Choose **Local Markdown**, **Obsidian**, **Notion**, or any combination. Choose one primary home for your concepts. Other destinations receive mirrors when **Mirror notes to…** is selected; turn that off to create a read-only reference instead. This saves an explicit writing plan rather than treating several copies as independent concepts.

For Markdown or Obsidian, choose where the new folder will live and review its name. Recall creates a dedicated folder with **Knowledge Base.md**, **Concepts/** and **Assets/**. Obsidian also gets a minimal `.obsidian` configuration folder; open it using Obsidian's **Open folder as vault**. It does not install Obsidian, plugins or a sync subscription. [Obsidian's vault guide](https://obsidian.md/help/Getting+started/Create+a+vault) explains how to open a folder as a vault. Use **Add knowledge source** for an existing folder instead of creating another vault inside it.

For Notion, select an existing parent page and name the new KB. Install your Codex or Claude Recall connection under **Learning connections** before using **Finish Notion with assistant → Copy setup prompt**. Your assistant also needs a working Notion connector with access to that parent. Paste the prompt into a fresh session. The assistant must inspect the parent, create the database once, retain its real IDs, read back its schema and starter page, and submit the actual result. Choose **Refresh setup** afterward. Recall has no Notion login, API token field or built-in OAuth flow. A setup request is **pending** until the assistant returns a valid read-back receipt; a selected URL alone is not a created database or a live connection. Recall checks the receipt's consistency; the remote read-back is verified through the assistant's connector, not a separate Recall API request.

**Review creation** checks the proposed destinations without writing. On the final review, select **Let my assistants build this knowledge base**, then **Create knowledge base**. This authorizes creating the new scaffolding and scoped authoring in your primary/mirror destinations; reference destinations stay read-only afterward. It does not grant access to sibling folders, other databases or existing sources. Existing source permissions, capture settings, cards and review history are retained. Creating the scaffolding adds no learning cards and does not turn on capture; enable learning capture separately if wanted.

If Notion is your primary source and remains pending, local mirrors can be ready without becoming primary. Finish Notion setup before asking the assistant to author and mirror concepts. If a local source is primary, it can be used while an optional Notion mirror remains pending. Once the primary is ready, try this with your connected assistant:

> Use my configured primary knowledge base and only its selected mirrors. Search names and aliases before creating. Save substantive concepts under broad topics, link related ideas, and mirror the same concept ID only after a verified primary write. Reuse suitable Recall cards, assess useful math or coding supplements, and report new, reused and pending outcomes separately. Respect source permissions and capture pause.

Saved source roles guide the assistant. They do not run a background sync service. Mirrors are updated through the learning skills after successful writes; edits made independently on both sides need reconciliation.

You can create more than one KB. Each primary belongs to its own setup; tell the assistant which KB a learning session should use when context does not make that clear. Disconnecting a source or restricting its access can mark its old setup **Needs attention**. Review or reconnect it explicitly if wanted; retry does not restore your removed connection or undo the access change.

## Connect an existing source

Open **Settings & backups → Learning connections → Knowledge sources → Add knowledge source**. The setup guide has three steps:

1. **Source:** choose Markdown, Obsidian or Notion.
2. **Scope:** name the connection and select an existing notes folder/KB subfolder, or enter a selected Notion page/database scope.
3. **Access & check:** choose **Read-only** to reference existing notes or **Scoped authoring** to permit note creation and updates within that scope. Use **Test connection**, inspect the concrete result, correct any issue and save the source. Adding one source retains your other configured sources and learning preferences.

For Markdown and Obsidian, the test checks a bounded sample within the selected local root and reports readable note access. It is not a complete KB audit. An empty readable folder is valid, or use the creation guide above to make a new one. Authoring access stays within that root; the check does not create a concept or change your notes. For Notion, Recall can check saved scope configuration and fetched snapshots, but it does not include a Notion login or client. A real scoped search through your assistant's connector is the live connection check. A cached note is not proof of authentication or complete coverage.

Use the source's assistant prompt to finish a Notion check or ask your connected assistant to help with a blocked local source. In a new setup, connect Codex or Claude below first; Notion's verification action appears once the local bridge is installed. No token or password belongs in a source configuration. Keep read-only access until you actually want KB authoring. Cards and reviews are separate from source connection settings; a missing or removed source does not remove them.

### Optional CLI configuration

The in-app guide is the simplest path. For scripted setup, save a `config.local.json` with a selected existing notes folder:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "my-kb",
      "type": "markdown",
      "root": "/absolute/path/to/selected/notes",
      "write": false
    }
  ]
}
```

Replace the root with your real absolute path; use `obsidian` for a selected vault/subfolder. The local configuration file is ignored by Git. Unlike adding a source in the app, CLI configuration replaces the source list, so include every source you want to retain. Omitted profile options, such as capture and timezone, keep their current values.

```sh
node cli/recall.cjs config config.local.json
node cli/recall.cjs config config.local.json --apply
node cli/recall.cjs kb scan my-kb
node cli/recall.cjs kb search my-kb "weighted mean"
```

The first command previews the configuration; the second applies it. The scan reads the selected notes. Use `write:true` only when you want the assistant to create/update notes there. For a new KB, create its folder first. You can ask your connected assistant to help configure and verify this scope. No tokens or passwords belong in configuration.

Below, `recall` is the installed profile launcher or the optional short command from `npm link`; `node cli/recall.cjs` also works from the checkout. The [workflow guide](WORKFLOW.md#3-choose-your-knowledge-source) explains canonical sources and optional mirroring.

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

In the setup guide, select Notion, enter the chosen scope and start read-only. Your assistant must use its own connected Notion tool to confirm live access and inspect the real schema. Advanced configuration has this shape: `{ "id":"notion-kb", "type":"notion", "scopeId":"your-selected-scope", "write":false, "propertyMap":{"title":"Your title property"} }`.

If you know your selected Notion URL but not its scope ID or property names, ask your connected assistant:

> Connect this selected Notion KB URL: [paste URL]. Use its live connector to verify access and resolve the page/database scope and actual title property. Also configure this existing Obsidian KB subfolder as an optional mirror: [paste absolute folder path]. Preserve my timezone, capture preferences and other sources. Preview the proposed configuration; start both sources read-only, then apply that scoped configuration and verify a real scoped search. Do not create or change any notes yet. If the connector is unavailable, report it rather than claiming a connection.

The assistant's Notion connector must be enabled and granted access to the selected scope. Recall configuration does not perform that authentication. A copyable two-source configuration has this shape:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "notion-kb",
      "type": "notion",
      "scopeId": "replace-with-selected-page-or-database-id",
      "propertyMap": { "title": "replace-with-actual-title-property" },
      "write": false
    },
    {
      "id": "kb-mirror",
      "type": "obsidian",
      "root": "/absolute/path/to/selected/kb-subfolder",
      "write": false
    }
  ]
}
```

Resolve the placeholders before applying; omit the mirror if unwanted and retain any other existing sources in the array. Use the same preview/apply commands above. Doctor can confirm a Notion scope is configured; only an actual connector search confirms authenticated access. Enable write permission separately for any requested canonical/mirror authoring.

The connected agent searches and reads the selected Notion scope, inspects the actual schema, then produces normalized fetched snapshots: `[{id, scopeId, title, body, revision, canonicalId?}]`. Save them with `recall kb ingest notion-kb snapshots.json --apply`. Never assume cached snapshots cover all pages: search the live scope before creation.

`recall kb save notion-kb record.json --apply [--revision HASH]` creates a **pending request** under `knowledge/outbox`. It does not write Notion. The agent executes the authorized request through its connected tool, preserving unrelated properties and user sections. It then re-fetches the page and acknowledges the normalized result with `recall kb ack REQUEST_ID result.json --apply`. Verification binds scope, canonical identity, title, authored body and revision to the request. An uncertain create requires reconciliation before retrying. Missing connections are reported, never simulated.

Local Notion exports can be configured as Markdown sources. No direct API credential/client is bundled. The portable connector bridge is tested with fixtures; live connection behavior must be verified with the user's actual connector and schema.

## Primary source and mirrors

The creation guide saves the selected primary and mirror roles together. An existing source can also be canonical when you explicitly tell the assistant which selected destinations to mirror. Each destination needs its own scoped write permission. Reuse the same KnowledgeRecord ID, read the destination revision before applying, and acknowledge the canonical write independently. If the mirror fails, retain its pending status and retry only that step after reconciliation. Concurrent edits must be surfaced. The skills document this procedure; continuous automatic bidirectional syncing is not implemented.
