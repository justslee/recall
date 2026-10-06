# Security

Report a vulnerability through [GitHub's private vulnerability reporting](https://github.com/justslee/recall/security/advisories/new). Use [Issues](https://github.com/justslee/recall/issues) for ordinary bugs or setup questions. Keep credentials, private profiles, transcripts and executable payloads out of public reports; describe sensitive findings privately while a fix is being coordinated.

Important boundaries: widgets have no privileged APIs; native code requires explicit local review and runs within the supported macOS sandbox; inbox submissions cannot grant execution trust; preparation exposes a previewed context with model tools disabled; KB operations stay within configured scope; external documents cannot issue tool instructions; profile writes and restore require exclusive access. See docs/PRIVACY.md for supported limitations.
