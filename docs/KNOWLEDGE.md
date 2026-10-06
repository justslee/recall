# Connect your knowledge base

[Documentation](README.md) · [Complete workflow](WORKFLOW.md#3-choose-your-knowledge-source) · [Connection help](TROUBLESHOOTING.md#my-knowledge-source-is-configured-but-not-ready)

Create a home for new concepts or connect notes you already keep. Choose the sources, scope and authoring permission; the skills use stable concept IDs to avoid treating copies as new concepts.

[Create a KB](#create-your-first-knowledge-base) · [Connect existing notes](#connect-an-existing-source) · [Primary & mirrors](#primary-source-and-mirrors) · [CLI reference](#optional-cli-configuration)

## Create your first knowledge base

Open **Settings & backups → Learning connections → Knowledge sources → Create my first knowledge base**. With existing sources, the action is **Create knowledge base**.

The guide has three steps: **Destinations → Homes → Review**.

1. **Select destinations.** Choose Local Markdown, Obsidian, Notion or any combination. Pick one primary home. Other destinations receive mirrors when **Mirror notes to…** is selected; turn it off for a read-only reference.
2. **Choose homes.** Select a parent folder and new folder name for local destinations, or an existing Notion parent page and a name for the new KB.
3. **Review creation.** Inspect the plan. This preview does not write anything.
4. **Authorize and create.** Select **Let my assistants build this knowledge base**, then **Create knowledge base**.

| Destination    | What is created                                                         | What you need                                               |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| Local Markdown | A dedicated folder with `Knowledge Base.md`, `Concepts/` and `Assets/`. | A selected parent folder.                                   |
| Obsidian       | The same structure plus a minimal `.obsidian` configuration.            | Open the folder using **Open folder as vault** in Obsidian. |
| Notion         | A new database and starter page, created through your assistant.        | An accessible parent page and a working Notion connector.   |

Recall does not install Obsidian, plugins or a sync subscription. See [Obsidian's vault guide](https://obsidian.md/help/Getting+started/Create+a+vault). Use **Add knowledge source** for an existing vault instead of creating a nested one.

Creation authorizes new scaffolding and scoped authoring in the selected primary and mirror destinations. Reference destinations stay read-only. Other source permissions, capture settings, cards and history are preserved. Creating a KB adds no cards and does not enable capture.

### Finish Notion setup

1. Install a Codex or Claude Recall connection under **Learning connections**.
2. Ensure that assistant has a working Notion connector with access to your selected parent.
3. Choose **Finish Notion with assistant → Copy setup prompt** and paste it into a fresh session.
4. The assistant inspects the parent, creates the database once, retains the real IDs, reads back its schema and starter page, and submits the actual result.
5. Choose **Refresh setup** in Recall.

Recall has no Notion login, API-token field or built-in OAuth flow. It checks the submitted receipt's consistency; the assistant's connector performs the actual remote read-back. A selected URL alone is neither a created database nor a verified live connection.

> [!NOTE]
> A pending Notion primary remains primary. Local mirrors may be ready, but they are not silently promoted. Finish the primary before authoring and mirroring concepts. A local primary can be used while an optional Notion mirror is still pending.

### Write your first concept

Once the primary is ready, try this with your connected assistant:

> Use my configured primary knowledge base and only its selected mirrors. Search names and aliases before creating. Save substantive concepts under broad topics, link related ideas, and mirror the same concept ID only after a verified primary write. Reuse suitable Recall cards, assess useful math or coding supplements, and report new, reused and pending outcomes separately. Respect source permissions and capture pause.

You can create multiple KBs. Each primary belongs to its own setup; tell the assistant which one a session should use when context is unclear.

Removing a source or restricting access can mark its setup **Needs attention**. Review or reconnect it explicitly. Retry does not restore a removed connection or reverse your access change.

## Connect an existing source

Open **Settings & backups → Learning connections → Knowledge sources → Add knowledge source**.

1. **Source:** choose Markdown, Obsidian or Notion.
2. **Scope:** name the connection and select an existing notes folder/KB subfolder or a Notion page/database scope.
3. **Access & check:** choose **Read-only** or **Scoped authoring**. Use **Test connection**, inspect the result, correct any issue and save.

Adding a source preserves other sources and learning preferences. Keep it read-only until you want the assistant to create or update notes within that scope. A missing or removed source never deletes Recall cards.

### What a connection check establishes

| Check                     | What it proves                                                                            | What it does not prove                               |
| ------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Local folder test         | A bounded sample is readable inside the selected root. An empty readable folder is valid. | A complete KB audit; the test does not author notes. |
| Notion preflight          | Scope configuration and available fetched snapshots can be inspected.                     | Authentication, live access or complete coverage.    |
| Assistant's Notion search | A real connector request can access the selected scope.                                   | Access to unselected pages or databases.             |

Use the source's assistant prompt to complete the Notion check. That action appears once the local Recall bridge is installed. Your assistant needs its own connector; Recall configuration does not authenticate it.

## Primary source and mirrors

Choose a canonical source and the destinations that should receive its concepts. The creation guide saves these roles; for an existing setup, tell the assistant which sources are canonical and mirrors.

The workflow is:

1. Search before creating; reuse the existing concept identity.
2. Verify the canonical write independently.
3. Mirror the same `KnowledgeRecord` ID, using each destination's current revision and scoped write permission.
4. Report each destination separately. Retain a failed mirror as pending and retry only that step after reconciliation.

Independent edits on both sides require reconciliation. An uncertain remote create must be inspected before retrying to avoid a duplicate. Saved roles guide the skills; they do not run a background sync service. Automatic bidirectional syncing is not implemented.

## Optional CLI configuration

The in-app guide is the simplest route. For scripted setup, save a `config.local.json` for a selected existing notes folder:

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

Replace the root with its real absolute path; use `obsidian` for a selected vault or subfolder. The local configuration file is ignored by Git. Omitted profile options, such as capture and timezone, retain their values.

> [!IMPORTANT]
> CLI configuration replaces the source list. Include every source you want to retain. Unlike the in-app **Add knowledge source** action, it is not an additive source edit. Never put passwords or tokens in configuration.

Preview, then apply:

```sh
node cli/recall.cjs config config.local.json
node cli/recall.cjs config config.local.json --apply
node cli/recall.cjs kb scan my-kb
node cli/recall.cjs kb search my-kb "weighted mean"
```

Sources must already exist. Use `write:true` only for explicit scoped authoring; create a new local KB through the guide or make its folder first.

In the reference commands below, `recall` means the installed profile launcher or the optional short command from `npm link`. From the checkout, `node cli/recall.cjs …` also works.

## Markdown and Obsidian

The filesystem adapter reads scoped `.md` files, YAML frontmatter, wikilinks and standard/Obsidian image references. Hidden paths are skipped; root escapes and escaping symlinks are rejected.

No Obsidian app or plugin is required for filesystem mode. Respect any assistant-specific instruction that instead requires the official Obsidian CLI. Full Markdown/Obsidian rendering is not reproduced; unsupported constructs need explicit authoring conversion.

```sh
recall kb scan my-kb
recall kb search my-kb "weighted mean"
recall kb save my-kb examples/knowledge.json
recall kb save my-kb examples/knowledge.json --apply
```

The record is original demo content. The apply command requires authoring access. For an existing note, use `--revision HASH` from a fresh scan.

- Updates preserve arbitrary frontmatter and prose outside Recall's managed explanation block.
- Backups precede updates; identical content is a no-op.
- A title or alias collision requires inspection, not a second concept.
- Canonical IDs in frontmatter survive renames. Read-only notes use a local identity index.

For a bounded raster image data URI:

```sh
recall kb asset SOURCE NOTE_PATH RELATIVE_IMAGE
```

Scope the source to the notes you need; do not expose an entire vault merely to import one note.

## Notion connector workflow

Start an existing Notion source read-only. Your assistant uses its connected tool to inspect live access and the actual schema. Local Notion exports can instead be configured as Markdown sources.

### Resolve an existing scope

If you have a KB URL but do not know its scope ID or title property, ask:

> Connect this selected Notion KB URL: [paste URL]. Use its live connector to verify access and resolve the page/database scope and actual title property. Also configure this existing Obsidian KB subfolder as an optional mirror: [paste absolute folder path]. Preserve my timezone, capture preferences and other sources. Preview the proposed configuration; start both sources read-only, then apply that scoped configuration and verify a real scoped search. Do not create or change any notes yet. If the connector is unavailable, report it rather than claiming a connection.

A two-source configuration has this shape:

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

Resolve placeholders before applying. Omit an unwanted mirror and retain other existing sources. Doctor confirms configured scope; only a real connector search confirms authenticated access. Enable authoring separately for the canonical source and each requested mirror.

### Fetch selected notes

The assistant searches and reads the live selected scope, then produces normalized snapshots:

```text
[{id, scopeId, title, body, revision, canonicalId?}]
```

```sh
recall kb ingest notion-kb snapshots.json --apply
```

Cached snapshots may be incomplete. Search the live scope before creating a concept.

### Complete an authorized write

```sh
recall kb save notion-kb record.json --apply --revision HASH
```

For a new page, omit the revision argument. The command creates a **pending request** under `knowledge/outbox`; it does not write Notion.

The assistant executes the authorized request through its connector, preserves unrelated properties and user sections, re-fetches the page, then acknowledges the actual normalized result:

```sh
recall kb ack REQUEST_ID result.json --apply
```

Verification binds scope, canonical identity, title, authored body and revision to that request. Reconcile an uncertain create before retrying. Missing connections must be reported, never simulated.

No direct Notion API client or credential is bundled. The portable bridge is fixture-tested; verify live behavior with the user's actual connector and schema.

**Next:** [Daily workflow](WORKFLOW.md#5-prepare-and-take-the-daily-self-test) · [Authoring cards](AUTHORING.md) · [Troubleshooting](TROUBLESHOOTING.md)
