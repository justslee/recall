# Privacy and execution

Recall stores its library locally. No account, telemetry, hosted database or network AI provider is required to study. Authoring through a connected AI agent may send the explicitly selected notes to that provider under its own settings. The desktop app does not make that provider offline.

KB access uses selected sources. Capture is opt-in and instruction-driven; it is not a complete transcript recorder. Logs may contain learning context and source references, so treat profile backups as private. Imports/exports do not automatically publish anything.

Card HTML and SVG are sanitized. Interactive widgets require an explicit Load action and run in an opaque sandbox with no network, filesystem, storage or privileged app APIs. Native code runs only on explicit Run for a locally trusted exercise digest. Python/C++ subprocesses use local user permissions; time/output limits are not an OS security sandbox. Do not run unknown community code simply because it has tests or a validation report.

CLI profile writes require the app to be closed. Knowledge updates use expected revisions, scoped paths and local backups. Connector writes and partial mirrors must be verified through their actual connected service. Automated code execution and broad filesystem scanning are not implicit authoring permissions.
