# Security

Do not include credentials, private profiles or executable payloads in public reports. For a sensitive vulnerability, use the repository owner's private reporting channel once configured; avoid public exploit details while a fix is being coordinated.

Important boundaries: widgets have no privileged APIs; native code is explicitly trusted and run with user permissions; KB operations stay within configured scope; external documents cannot issue tool instructions; profile writes and restore require exclusive access. See docs/PRIVACY.md for supported limitations.
