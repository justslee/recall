# Recall Pad protocol

This document is the implementation contract, not evidence of device compatibility.

## Transport and identity

HTTPS and WSS on an opt-in local listener. Bonjour service `_recall-pad._tcp.` advertises `version=1` and a stable `installationId`, never credentials. Pair payload is JSON `{version:1, installationId, endpoint, spkiSha256, bootstrapSecret, expiresAt}`. `spkiSha256` is standard Base64 SHA-256 of DER SubjectPublicKeyInfo, using a P-256 key. QR encodes this JSON directly. Certificate verification requires that pinned public key and a valid server certificate; it is never a trust-all callback. Credentials use `Authorization: Bearer TOKEN`.

## Pairing

- `POST /v1/pair/request`: `{version:1, bootstrapSecret, deviceId, deviceName}` returns `202 {requestId, expiresAt}`. Bootstrap is consumed once, valid for five minutes. Mac confirmation is required.
- `GET /v1/pair/requests/REQUEST_ID` with `X-Pair-Secret: BOOTSTRAP`: returns `{state:"pending"}` or `{state:"approved",credential,deviceId,installationId}` or `{state:"rejected"}`. Approved credential is ephemeral until the client stores it in its Keychain.
- `POST /v1/pair/requests/REQUEST_ID/ack` with new bearer credential discards the ephemeral plaintext credential.
- No other route accepts the bootstrap secret. Rate-limit unauthenticated requests.

## Authenticated session

`GET /v1/session/study` and `GET /v1/session/tutor` return independent sessions: `{version:1,installationId,mode:"study"|"tutor"|"idle",handoffId,currentQuestionId,questions:[...],target?}`. Manual Tutor sessions use `target:"clipboard"` and no questions; this denotes the Mac page tray, without automatic clipboard authority. Assistant paper sessions use `target:"assistant"` and additional `{tutorTitle,currentProblemId,problems:[{id,sessionId,revision,title,prompt,kind,createdAt}]}`. Problem kind is `problem` or `note`; published prompts contain no hidden reference solution. The legacy `GET /v1/session` prefers active Study, otherwise Tutor. Starting or ending Tutor never replaces Study. Each Study question contains `{id,cardId,title,prompt,topic,kind,referenceHash}`. Front content is sanitized and contains no answer, numeric result, solutions, widget source, schedules or credentials. Reference snapshots stay on the Mac. Study kind is `concept` or `math`.

Fronts contain escaped text/LaTeX and validated inline PNG/JPEG/WebP images only (at most four figures of 2 MiB each). No external images, SVG or executable widgets load. A session contains up to 200 fronts and 16 MiB of front content. Unsupported figures fail with a Mac/Tutor Pad fallback rather than silently losing part of the question.

Study sessions also include `pendingQuestionIds`, the ordered eligible current/remaining question IDs. The iPad desk displays at most three of these; `questions` retains issued fronts so previously saved work and offline submissions remain valid. An upcoming-only buffer may have `currentQuestionId:null` while the Mac is on coding. An ended session is idle and clears the visible buffer. Older caches without the field use their saved cursor rather than showing all fronts.

`POST /v1/tutor/start` with `{target:"clipboard"}` or an empty object starts the generic page receiver and returns the session; an already active Tutor session reuses its handoff. Historical `chatgpt`/`codex` start requests are accepted for older clients but return a `clipboard` session. `POST /v1/tutor/arm` returns `410`: draft pasting has been removed. `POST /v1/tutor/end` ends only Tutor. No route controls an external application or dispatches a message.

## Submission

Manifest fields: `{version:1|2,id,documentId,revision,mode:"study"|"tutor",questionId:null|string,handoffId,createdAt,pages:[{index,hash,mime,name,width,height}],drawing:null|{hash,bytes},evaluate:boolean}`. IDs are UUIDs except issued question IDs. SHA-256 hashes are lowercase hex. `evaluate` applies only to Study and only after explicit user submission; server additionally checks local assessment consent. Drawing bytes are opaque PencilKit data, never evaluated or decoded on the Mac. Maximum 20 pages, 12 MiB per image, 64 MiB for all assets including drawing. Client retains oversized work.

Manual Tutor manifests retain version `1` and immutable `target:"clipboard"`; Study cannot include a target. Historical `chatgpt`/`codex` targets and manifests without a target remain accepted unchanged. Assistant-bound Tutor submissions use version `2`, `target:"assistant"`, `handoffId` equal to the paper session ID and `questionId` equal to the published problem ID; they always have `evaluate:false`. The Mac validates their issued session/problem binding. Retries use the original manifest, including its original target or omitted field, to preserve its content hash. Earlier metadata grants no application-control capability. Deleting an iPad sheet removes its local outbox and saved assets, without a remote deletion request; an active upload must finish first.

- `POST /v1/attempts/ID/manifest` with manifest returns `{id,missing:[HASH],state:"staging"|"received"}`.
- `PUT /v1/attempts/ID/assets/HASH` sends binary bytes and returns `{hash,stored:true}`. Server verifies hash, declared MIME, actual image format/dimensions and bounds. Partial assets are staged privately.
- `POST /v1/attempts/ID/commit` returns `{id,state:"received",receivedAt}` only after a durable SQLite transaction. Same ID/content is idempotent; conflicting content returns 409.
- `GET /v1/attempts/ID` returns only `{id,state,receivedAt}` for that device. Never feedback or references. A committed Tutor submission reports durable `received`; it does not imply a clipboard copy or chat attachment. Study states additionally include `queued`, `evaluating`, `feedback_ready` and `needs_attention`. An uncommitted submission is `staging`. Historical delivery states remain recoverable without enabling their removed draft-paste behavior.

Tutor submissions received after a disconnect/sleep or with a stale handoff are stored in the Mac page tray. Receipt, reconnection and opening the tray never change the clipboard. Only an explicit Mac **Copy page** action copies an image. Existing documents and submitted revisions remain saved on iPad.

An offline blank Tutor sheet may use a client-created UUID handoff. Its authenticated manifest registers an archive-only grant for that device, without changing the active Mac session. Study questions always require a previously issued per-device grant. Repeated page hashes are supported with consistent format/dimensions; storage deduplicates the bytes while preserving ordered page positions.

`WSS /v1/events` delivers `{type:"session",channel:"study"|"tutor",session}` or `{type:"receipt",receipt}` or `{type:"status",state}`. It never delivers reference answers or feedback. Client reconnects in foreground and polls both sessions/receipts as fallback. Device revocation closes connections.

## Trusted Mac renderer IPC

- `padStatus()` -> `{version,enabled,endpoint,installationId,devices:[{id,name,lastSeen,connected}],pendingPairings:[{id,name,expiresAt}],model,assessmentConsent,loginAtStartup,study,helper,assessmentBusy}`.
- `padConfigure({enabled?,model?,assessmentConsent?,loginAtStartup?})` -> status.
- `padPairing()` -> `{payload,qrDataUrl,expiresAt}`. `padConfirmPairing({id,allow})`; `padRevokeDevice(id)`.
- `padStartStudy({cardId,sessionId?,cardIds?})`; `padFollowStudy({cardId,sessionId?,cardIds?})`. Follow is a no-op without an active study handoff.
- `paperAttempts(cardId)` -> array `{id,documentId,cardId,mode,status,createdAt,pageCount,feedback,error}`. `paperPage(attemptId,index)` -> `{url,name,index}`. Legacy images remain under existing attachments API.
- `paperImport({cardId,pages:[{name,mime,bytes}]})` accepts ArrayBuffer/Uint8Array image bytes and creates a new immutable local attempt. `paperAttach(cardId)` uses a file picker. Both return an attempt.
- `paperEvaluate({attemptId})` -> refreshed attempt with feedback. `paperCancelAssessment()` preserves the attempt.
- `tutorStatus()` -> `{enabled,receiving,manualReady,target:"clipboard",lastState:"receiving"|"idle"}`. `tutorStart()` starts the generic receiver with no destination argument. `tutorCopyPage({attemptId,index})` explicitly copies one saved Tutor page and returns `{state:"copied",copiedPage:index}`; it does not change the durable receipt or dispatch a chat message. There are no renderer configure, arm or resume APIs.
- `tutorOpen()` opens the separate sandboxed Tutor Pad window. Its IPC allows only Tutor controls and Tutor pages; Study/evaluation APIs are denied. Its events are payload-free refresh signals and contain no Study fronts.
- `onPadEvent(callback)` receives sanitized `{type:"status"|"attempt"|"session"|"tutor",...}`; consumers refresh the relevant panel without reveal, navigation or review changes.

Feedback: `{verdict:"solid"|"partial"|"needs_work"|"unclear",summary,strengths:[string],findings:[{page,category:"arithmetic"|"method"|"concept"|"unclear",expression,explanation}],firstMistake:null|{page,expression,explanation},followUp}`. Pages are one-based. Feedback is Mac-only and never changes review ratings.

## Assistant paper sessions

The optional stdio MCP server runs through `recall paper mcp`. It connects an invoking assistant to a scoped paper session; it is distinct from device pairing, manual clipboard copying and Recall's handwriting assessor. See [Paper learning](PAPER_LEARNING.md) for setup and use.

| MCP tool | Input beyond session authorization |
| :------- | :--------------------------------- |
| `paper_start_session` | `{title}`; returns `sessionId` and `capability`. Client metadata comes from the configured launcher. |
| `paper_publish_prompt` | `{title,prompt,kind:"problem"|"note",expectedRevision?}`. |
| `paper_session_status` | Inspect the current prompt and submitted-work metadata. |
| `paper_wait_submission` | `{after?,timeoutMs}`; `timeoutMs` is bounded to at most 30,000. |
| `paper_read_submission` | `{submissionId,pageIndexes?}`; up to three selected zero-based indexes, or up to two pages by default within the byte limit, with `nextPageIndexes` for progressive reads. |
| `paper_end_session` | End the active session while preserving saved work. |

All operations after start require both `sessionId` and its `capability`. A capability scopes authorization to that paper session; conversation metadata cannot grant cross-session reads. The caller retains the raw capability privately in its session context. The Mac stores authority hashes in private `paper-authority/` files and local runtime discovery/authentication in `paper-runtime/`; neither folder belongs in profile backups. No transcript scanning reconstructs a binding. Restores clear active session authority and require new authorization while retaining prompts, drawings and submissions.

Publishing sends only the current problem or writing prompt and necessary assumptions, without a reference answer or hidden solution. Revision checks protect against replacing a prompt from stale context. Submissions retain their prompt binding so later prompts do not silently change what an earlier page answers.

An image read returns MCP image blocks to the invoking assistant turn. It does not attach anything to a draft, send a message, grade the work or wake an idle assistant. A bounded wait can deliver work to an already active tool invocation; timeout preserves the session and pages. The user can ask **Check my paper** for a fresh status/read. Tutor receipts mean durable storage; tool availability and image reads are distinct from assessment completion.

The CLI mirrors these operations as `recall paper start|publish|status|wait|read|end [JSON_FILE]`; CLI start additionally accepts descriptive `client` and optional `conversationId` metadata. Neither MCP nor CLI read accepts `maxPages`. `recall paper connect codex|claude` previews managed skill/MCP configuration, and `--apply` installs it. `recall paper connection-status` reports registration and endpoint metadata; app status separately identifies the running main receiver. Neither establishes live-client image rendering. Custom clients can configure `recall paper mcp --client codex|claude|chatgpt` directly. ChatGPT desktop on a supported shared Codex host can reuse its `~/.codex/config.toml` MCP registration; ordinary web chats do not inherit local stdio tools. Real Codex, Claude and ChatGPT image delivery must be verified and reported per client. [Official MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
