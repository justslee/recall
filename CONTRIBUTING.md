# Contributing

[Documentation](docs/README.md) · [Security reporting](SECURITY.md)

## Use shareable examples

Use original, redistributable examples and synthetic fixtures. Never commit personal KB exports,
private card collections, credentials, user profiles, screenshots of personal libraries or task
logs.

## Check your change

```sh
npm test
npm run build
npm run audit:release
```

UI, runner and widget changes also need the desktop check on supported macOS:

```sh
npm run test:desktop
```

Validate every changed exercise with its reference, unfinished stub and representative wrong
implementations. Preserve stable identities, actual review history, local edits and answer-reveal
boundaries.

## Keep the learning contract consistent

Keep the skill quality rules in recall-source references rather than duplicating policy. Test
meaningful outcomes: source retries, revision conflicts, math correctness, runnable code, actual
widget behavior and backup recovery. Schema/skill linting alone is insufficient. Do not introduce
mandatory cloud dependencies into study.

See [authoring and content packs](docs/AUTHORING.md) for the shared quality and validation workflow.
