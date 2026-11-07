# Taxonomy plan contract

`taxonomy list` returns `{version, revision, nodes, mappings, relations}` and an optional `rootPolicy`. Plans upsert only the supplied records, preserving other branches and the current root policy. Use stable lowercase slug-like node IDs; a rename keeps its ID and can retain the former label as an alias. `root`, `holding:unclassified`, and `library:guides` are reserved; do not create taxonomy nodes with those IDs. A top-level node has `parentId: null`.

```json
{
  "expectedRevision": 0,
  "nodes": [
    {
      "id": "computing",
      "label": "Computing",
      "parentId": null,
      "type": "topic",
      "weight": 1,
      "aliases": []
    },
    {
      "id": "data-engineering",
      "label": "Data Engineering",
      "parentId": "computing",
      "type": "topic",
      "weight": 1,
      "aliases": []
    },
    {
      "id": "data-storage",
      "label": "Storage",
      "parentId": "data-engineering",
      "type": "topic",
      "weight": 1,
      "aliases": []
    },
    {
      "id": "columnar-storage",
      "label": "Columnar storage",
      "parentId": "data-storage",
      "type": "concept",
      "weight": 1,
      "aliases": []
    }
  ],
  "mappings": [
    {
      "kind": "concept",
      "id": "EXISTING_CONCEPT_ID",
      "nodeId": "columnar-storage"
    },
    {
      "kind": "note",
      "sourceId": "EXISTING_SOURCE_ID",
      "id": "EXISTING_NOTE_ID",
      "nodeId": "columnar-storage"
    }
  ],
  "relations": []
}
```

Replace the example identities with verified local IDs. Card and concept mappings are checked against the selected library. Note mappings require a configured source and exactly one matching identity in its Knowledge index; refresh that source with `kb index SOURCE_ID` if needed. A `card` mapping uses `{kind:"card",id:"EXISTING_CARD_ID",nodeId:"..."}`. A reference has one primary mapping; an upsert changes its organization record without altering the underlying content. Graph and scoring placement is per canonical concept: an explicit `concept` mapping wins over its cards, otherwise a unique shared card-mapping target places the entire concept. Conflicting card targets remain unresolved; card mappings are not independent objective overrides.

For cross-domain administrative guides and library entry pages, a note mapping may target `nodeId: "library:guides"`. This is a reserved navigation shelf outside the domain tree and scoring. Do not map cards or assessed concepts there. A subject-specific index may instead belong to its actual domain branch. Unresolved subjects appear in the application's Unclassified holding area; do not invent a discipline just to eliminate an uncertainty count.

For an explicitly authorized three-domain reorganization, a plan can set:

```json
{
  "expectedRevision": 2,
  "rootPolicy": {
    "mode": "locked",
    "rootIds": ["computing", "mathematics-statistics", "economics-finance"]
  }
}
```

The resulting tree must contain exactly those top-level node IDs. Include any required node creation, reparenting and deliberate removal in the same plan, preserving existing identities and mappings. With a locked policy, routine plans can add children but cannot silently add another root. Omitting `rootPolicy` preserves it. An explicit replacement locked policy or `{ "mode": "open" }` changes the policy; do this only for an authorized domain-organization change. An absent legacy policy is open, not evidence that every imported tag deserves a root.

Nodes have `id`, `label`, required `parentId`, `type` (`topic` or `concept`, default `topic`), `weight` (positive, default `1`) and `aliases` (default empty). The hierarchy rejects cycles, missing parents and ambiguous sibling labels/aliases. Relationships contain `from`, `to`, `type` (`related`, `uses`, `prerequisite`, `applies-to`, `contrasts-with`), `status` (`explicit` or `suggested`), and optional `source`. Explicit relationships require a source reference. For a `prerequisite` edge, `from` is the prerequisite and `to` depends on it. Suggested edges may name the evidence behind the suggestion without presenting it as established.

Remove only explicitly intended organization records:

```json
{
  "expectedRevision": 3,
  "remove": {
    "nodeIds": ["obsolete-empty-branch"],
    "mappings": [{ "kind": "card", "id": "EXISTING_CARD_ID" }],
    "relations": [{ "from": "node-a", "to": "node-b", "type": "related" }]
  }
}
```

Removing a node requires deliberately moving/removing its children, mappings and connections in the same plan. It never deletes notes or cards. Updating a record requires its complete desired fields; omitted node weights/aliases use their defaults, so preserve existing values when renaming or moving it.

Preview is read-only. `apply PLAN.json` also previews unless `--apply` is supplied. With Recall open, a validated plan waits for the app's writer and is checked against the current revision again. Repeating the same request recovers its durable receipt. A blocked request remains blocked; reconcile a new plan from the current taxonomy. Plans and metadata are private profile data, not public examples or learning captures.

Apply and status return `{requestId, mode, receipt, error}`. A queued request has `mode: "queued"`; only `mode: "applied"` with its `receipt` confirms completion. Check `taxonomy status REQUEST_ID` and read the taxonomy again before reporting the classification as applied.
