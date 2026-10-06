# Security

[Documentation](docs/README.md) · [Privacy and execution](docs/PRIVACY.md)

## Report a problem

| What you found                       | Where to report it                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| A vulnerability or sensitive finding | [GitHub private vulnerability reporting](https://github.com/justslee/recall/security/advisories/new) |
| An ordinary bug or setup question    | [GitHub Issues](https://github.com/justslee/recall/issues)                                           |

> Keep credentials, private profiles, transcripts and executable payloads out of public reports.
> Describe sensitive findings privately while a fix is being coordinated.

## Security boundaries

- **Widgets:** no privileged app APIs.
- **Native code:** explicit local review and execution within the supported macOS sandbox.
- **Learning inbox:** submissions cannot grant execution trust.
- **Preparation:** previewed context, with model tools disabled.
- **Knowledge bases:** operations stay within configured scope.
- **External documents:** content cannot issue tool instructions.
- **Profile writes and restore:** exclusive access is required.

The [privacy and execution guide](docs/PRIVACY.md) explains these boundaries and their supported
limitations.
