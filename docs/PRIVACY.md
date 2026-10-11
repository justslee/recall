# Privacy and execution

[Documentation](README.md) · [Security reporting](../SECURITY.md)

Recall stores its library locally. No account, telemetry, hosted database or network AI provider is
required to study.

> Keep profile backups private. They can include learning logs, source configuration, drafts,
> transcripts and Speak reference snapshots. Imports and exports do not automatically publish them.

## Optional voice and evaluation

Optional spoken answers use OpenAI live transcription and text assessment. Only deliberate recording
sends microphone audio; Evaluate sends the current card’s text reference, response and follow-up
context. Audio is not saved by Recall. Transcripts and feedback are local drafts included in profile
backups. Provider processing follows the API project’s data controls; local storage does not imply
zero provider retention. Feedback cannot rate cards or change schedules. See [Voice
setup](VOICE.md).

### API key storage

The OpenAI key is stored locally as plaintext in the profile's `credentials/openai.key`, with
owner-only `0600` file permissions inside a `0700` credentials folder. Recall does not use Electron
`safeStorage` or access macOS Keychain for this connection, and makes no separate encryption claim.
Software running as your OS account can read the file.

The key is never returned to the renderer after saving and is excluded from Recall's library exports
and profile backups; whole-machine backups may include it. Save your own key once in **Settings &
backups → Voice & feedback** on a new profile or Mac; restarts and updates preserve it. A legacy
`credentials/openai.enc` is not automatically migrated or decrypted and remains untouched until a
replacement key is successfully saved or you explicitly remove the key.

### Speak practice

The separate **Speak** practice tab uses the same optional OpenAI connection. Preparing a library or
custom topic saves it locally without a provider request. Recording sends microphone audio and a
generic transcription instruction, not the custom title, listener brief or reference notes.
Evaluation sends this attempt's selected card/KB snapshot or pasted notes, topic, listener brief,
response, audience, drill, duration and relevant delivery context; it does not upload the whole
knowledge base. Notion references come from locally fetched connector snapshots, not an automatic
live workspace crawl. Pasted notes are user-provided material, not independently verified KB
content. With no reference, accuracy remains Not assessed and feedback is limited to communication.

Speak retains the original transcript for observed filler counts and corrected text for content
evaluation. Pause measurements are approximate low-energy intervals calculated locally from the
audio stream, not word-aligned timestamps or proof of hesitation. No audio is retained. Custom
setup, drafts, reference snapshots, transcripts, delivery summaries and feedback remain in the local
profile and its backups. Recordings are bounded at up to 15 minutes; longer talks are transcribed in
ordered segments. Ordinary card dictation remains limited to three minutes. Speak does not change
card schedules or ratings. See [Speak](SPEAK.md) for measurement and verification limits.

## iPad and handwriting

Recall Pad is optional. Its local HTTPS/WSS receiver starts only when the companion is enabled; no hosted Recall service or port forwarding is required. Bonjour advertises a public installation identifier and protocol version, never credentials. Discovery is not authentication: the iPad verifies the Mac's pinned public key and scoped TLS certificate, and each paired device uses its own revocable credential.

Pairing requires a private, single-use, five-minute QR code and explicit Mac confirmation. The iPad stores its credential in its device-only Keychain; the Mac stores the credential hash. TLS private keys and pairing credentials are excluded from Recall exports and profile backups. Ordinary app updates preserve pairing; replacing identities or removing a device requires pairing again. The iPad requests camera access for QR scanning and local-network access for the connection. No system-wide certificate installation is required.

Editable drawings, thumbnails, downloaded question fronts and pending submissions live in the iPad app's local storage. Received pages, editable drawing data, question/reference snapshots and feedback live in the Mac profile and its backups. The iPad receives no worked solutions, reference answers, OpenAI keys or review-scheduling authority. Operating-system/device backups may include saved work; Recall does not add a cloud-sync service.

Handwriting assessment sends only the explicitly selected pages, question and original reference snapshot to OpenAI. It uses the existing Mac-owned API key and requires separate consent, internet and API billing. Requests use `store: false`; this does not override the API project's provider retention controls. The configured model is never silently substituted. Interrupted requests require manual retry because provider processing may already have occurred. Feedback remains on the Mac and never changes ratings or schedules. Correctness and handwriting interpretation require separate quality verification.

Tutor Pad saves incoming submissions in an ordered Mac page tray. Only an explicit **Copy page** action changes the Mac clipboard; you choose the application and paste/send yourself. Received or delayed work never automatically copies, pastes or starts an assessment. The native helper advertises Bonjour discovery only; it requests no Accessibility permission and has no access to external application windows, composers or conversations. Clipboard contents become accessible to applications permitted by macOS, and attaching/sending pages in an external chat follows that service's data controls. iPad PNG/PDF export and sharing use the destinations you select through the system share sheet.

The optional paper-learning MCP connection gives the invoking assistant access to a scoped paper session: its published prompts, submitted-work metadata and selected image pages. Images returned through `paper_read_submission` become context in that active assistant turn and follow the client's provider/data controls; they are not attachments automatically pasted into a draft. Tool calls do not send a chat message or wake an idle assistant. The session ID and capability are returned to the caller's session context; optional conversation IDs are descriptive metadata, not authorization to read another chat. The server uses authority hashes rather than persisted raw capabilities. Its private authority and runtime-discovery files are excluded from profile backups, alongside existing pairing/TLS secrets. Restore preserves documents, prompts and submissions while requiring new session authorization; it does not resume old access or dispatch a clipboard/API operation. Do not publish capability-bearing tool output or store it in global instructions. The workflow never scans conversation transcripts to recover a binding.

A study assessment deliberately requested on the iPad may run after reconnecting if assessment consent is enabled on the Mac. Interrupted assessments require manual retry; restored pending operations require explicit resubmission. Ordinary foreground reconnection may transfer queued work to its paired Mac; the receipt means it was durably saved, not that an assessment or chat dispatch succeeded. Tutor sheets do not automatically create KB notes, cards or learning captures. Earlier chat-specific sheet metadata and submission hashes are retained for recovery; they grant no application-control permission. See [Recall Pad](HANDWRITING.md) and [Tutor page transfer](PAD_HANDOFF.md).

## Assistant preparation

Optional preparation sends the previewed source excerpt, up to 12 relevant card excerpts and up to
30 objectives from the same session to the selected CLI's default provider using existing
authentication. Original import metadata and unrelated learning history are excluded.

CLI preparation uses restricted tools/configuration rather than arbitrary personal hooks, plugins,
connectors or custom provider settings. Authentication remains local; Codex file credentials may be
copied into an owner-only temporary runtime home and removed with the job. Keyring-only Codex
login/custom providers may require separate setup. The desktop does not make an AI provider offline.

## Capture and knowledge-base scope

KB access uses selected sources. Active capture is opt-in and instruction-driven. Separately enabled
catch-up reads supported local session files within the chosen date/project scope and stores
selected question/response excerpts in the private learning inbox. Tool output is excluded;
sensitive-text pattern redaction (common provider keys, cloud and chat tokens, JWTs, HTTP
authorization values and inline password/key assignments) is best-effort. Excerpts reach a provider
only after the exact context was previewed: the desktop and the CLI both require the preview's
digest. It cannot cover unavailable conversations. Logs may contain learning context and source
references, so treat profile backups as private. Imports/exports do not automatically publish
anything.

## Cards, widgets and native code

Card HTML and SVG are sanitized; SVG figures render as image documents so their CSS cannot affect
app controls. Interactive widgets require an explicit **Load** action and run in an opaque sandbox
with no network, filesystem, storage or privileged app APIs. Cards imported through the inbox arrive
with widgets off until you enable them per card, and coding cards do not receive execution trust.

### Native execution limits

Native code runs only on explicit **Run** for a locally reviewed digest; trust is never read from a
profile file or restored from a backup. Validation and Python/C++ execution require a macOS sandbox:

- Reads are restricted to the scratch directory and runtime files; writes are restricted to scratch.
- Network and Mach service lookups are denied: no LaunchServices, pasteboard or other system services.
- Execution is limited to the selected interpreter, compiler toolchain and scratch output.
- Forking is forbidden except while compiling.
- Time and output limits apply. Memory limits are not enforced.

There is no unrestricted fallback. A report proves neither safety nor authorization.

## Local files and preparation cleanup

New profiles, captures, jobs and backups use owner-only permissions; opening a profile tightens its
core private files without following existing symlinks.

Successful and failed preparation attempts remove temporary context and credentials, retaining the
original source and result/error in the inbox. Worker failures retain locally authored categories
and safe exit/signal details, without saving raw provider stderr, malformed response text or
model-supplied blocked messages. Use **Finish with assistant** to inspect the retained learning and
resolve missing checks.

Interrupted or legacy staging can remain owner-only until separately cleaned; backups exclude job
staging. Project includes/excludes use canonical filesystem paths and fail closed when a scope path
is unavailable.

## Writes and restore

Direct CLI card imports, backups and restore require the app to be closed. Inbox capture/submission
works while open; the app applies validated results through its writer. Knowledge updates use
expected revisions, scoped paths and local backups. Connector writes and partial mirrors must be
verified through their actual connected service. Automated code execution and broad filesystem
scanning are not implicit authoring permissions.

Restoring a profile removes its saved native-code execution approvals after verifying the original
backup. Cards, schedules, reviews, drafts and attempts remain intact; code exercises need explicit
local review again before Run. Ordinary app updates preserve existing live approvals, and
restoration does not alter the backup itself.

## Sharing the source safely

```sh
npm run audit:release
npm run audit:package
```

The release audit checks the candidate source and reachable committed file history for private
artifact types, SQLite headers, unsupported binary files, personal paths and common credential
patterns. It also inspects commit metadata and reports the number of public author/committer
identities without printing them. The package audit applies the same first-party checks to the
actual app archive.

Neither check proves that arbitrary prose, image pixels, attribution or dependency source is safe to
publish; review them separately.

Share original content packs and demo screenshots, not profile backups. Backups include local
learning logs, source configuration, drafts and Speak reference snapshots. Ignored files are not
included in a normal Git clone, but can still be accidentally published in a manually created ZIP or
release artifact. Use the documented packaging command and audit its output. See the
[public-readiness review](PUBLIC_REVIEW.md) and [launch checklist](LAUNCH.md).

Continue with [migration and restore](MIGRATION.md), or return to the [documentation
guide](README.md).
