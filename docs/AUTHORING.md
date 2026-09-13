# Authoring and content packs

Read `skills/recall-source/references/quality.md`, the specialist references and versioned schemas in `schemas/`. The source files are the authoritative shared quality contract. Skills use a single supported CLI rather than raw database edits.

A pack is `{schemaVersion:1,id,title,cards:[...]}`. `examples/demo.json` is a complete original sample; `examples/cards.json` is its card-array form for the exercise validator. Card IDs must remain stable across imports. Source/objective identity matters more than title equality. Record each math/code disposition and its rationale; no forced trio.

```sh
recall cards validate examples/demo.json
recall cards import examples/demo.json
recall cards import examples/demo.json --allow-widgets --apply
```

Preview defaults are additive. Changed content under an existing ID is rejected for review, not overwritten. Missing upstream cards are retained. Widgets remain disabled unless their actual code was inspected/tested and the local import explicitly allows them. Packs cannot grant native execution trust.

For authored coding exercises, review all supplied code, then run:

```sh
node scripts/validate-card-exercises.cjs examples/cards.json examples/mutants.json /tmp/validation.json
recall cards trust demo:weighted-mean:code /tmp/validation.json --apply
```

Validation executes the reference/stub/mutants with local permissions. Inspect unknown code before running it. A downloaded report alone is not a trust review. The original welcome demo has prevalidated code approved as part of the app's own demo action; arbitrary imports never inherit that approval.

Numeric math includes value/tolerance/unit plus a complete hidden worked answer. Independently calculate examples before publishing. Static SVG, KaTeX, Mermaid and self-contained widgets are supported; see WIDGETS.md. Inspect light/dark and narrow layouts, and test interaction outputs against independent values.

Catalog packs may use `{schemaVersion:1,catalogId,title,manifest,cards,contentHash}` through the shared catalog service. Existing legacy catalog IDs/metadata remain readable. Three-way updates preserve local changes and report conflicts; absence upstream is not deletion. Catalog metadata does not grant code trust. All coding cards carry `catalog.id` when they belong to a catalog; the view derives its title and provider from metadata/source and supports legacy curriculum fields.
