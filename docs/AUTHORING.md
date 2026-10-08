# Authoring and content packs

[Documentation](README.md) · [Interactive visuals](WIDGETS.md)

Create one clear learning objective per card. Add math or coding when it tests that objective;
record each disposition and its rationale rather than forcing all three formats.

Read the shared [quality contract](../skills/recall-source/references/quality.md), the specialist
references and versioned [schemas](../schemas/). These source files are authoritative. Skills use a
single supported CLI rather than raw database edits.

## Start with a content pack

A pack is `{schemaVersion:1,id,title,cards:[...]}`. The original [demo pack](../examples/demo.json)
is a complete sample; [its card-array form](../examples/cards.json) is used by the exercise
validator.

Validate and preview the import:

```sh
recall cards validate examples/demo.json
recall cards import examples/demo.json
```

Card IDs must remain stable across imports. Source/objective identity matters more than title
equality. Preview defaults are additive: changed content under an existing ID is rejected for
review, and missing upstream cards are retained.

Recall can stay open during imports. With `--apply`, the CLI queues an import for
the running app's writer when that library is in use. The app applies it within
about five seconds and refreshes the shelf and Library, preserving active study
and drafts. When the app is closed, imports apply immediately.

A queued request is not yet an imported card. Use the returned `requestId` to
confirm the receipt:

```sh
recall cards import-status REQUEST_ID
```

Expect `mode: "imported"` with inserted/unchanged counts before returning card
links. A blocked receipt preserves the specific conflict or validation error.
Bulk source imports do not create learning captures or daily Self Tests.

After inspecting and testing the actual widget code, an import can explicitly allow widgets:

```sh
recall cards import examples/demo.json --allow-widgets --apply
```

> Widgets remain disabled unless the local import explicitly allows them. A pack cannot grant
> native-code execution trust.

## Validate coding exercises

For authored coding exercises, review all supplied code, then run:

```sh
node scripts/validate-card-exercises.cjs examples/cards.json examples/mutants.json /tmp/validation.json
recall cards trust demo:weighted-mean:code /tmp/validation.json --apply
```

Validation executes the reference/stub/mutants with local permissions. Inspect unknown code before
running it. A downloaded report alone is not a trust review. The original welcome demo has
prevalidated code approved as part of the app's own demo action; arbitrary imports never inherit
that approval.

## Check math and visuals

| Content             | Required checks                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Numeric math        | Value, tolerance and unit, plus a complete hidden worked answer; independently calculate examples before publishing |
| Static visuals      | SVG, KaTeX or Mermaid; inspect light, dark and narrow layouts                                                       |
| Interactive visuals | Self-contained widgets; test outputs against independently calculated values                                        |

See [interactive widgets](WIDGETS.md) for the rendering and permission contract.
Inspect math and interactive cards in light, dark and narrow layouts as well.

## Catalog updates

Catalog packs may use `{schemaVersion:1,catalogId,title,manifest,cards,contentHash}` through the
shared catalog service. Existing legacy catalog IDs/metadata remain readable. Three-way updates
preserve local changes and report conflicts; absence upstream is not deletion. Catalog metadata does
not grant code trust. All coding cards carry `catalog.id` when they belong to a catalog; the view
derives its title and provider from metadata/source and supports legacy curriculum fields.

Return to the [documentation guide](README.md), or review [privacy and execution](PRIVACY.md) before
sharing a pack.
