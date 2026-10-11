# Learn on paper, in the same chat

[Documentation](README.md) · [Recall Pad setup](HANDWRITING.md) · [Privacy](PRIVACY.md#ipad-and-handwriting)

**Detailed reference.** Start with [illustrated setup](SETUP.md) and [Write on Recall Pad](demos/PAPER.md). This page explains tool readiness, session scope and what has been verified.

**Ask in your chat. Work on your iPad. Discuss your handwritten steps in that same chat.**

Paper learning connects a Tutor Pad session to the assistant that starts it. The assistant can put the current problem on your iPad and read the pages you submit through a local MCP connection. Your tutor's hints, follow-up questions and explanations stay in the conversation.

This is a Codex-first development workflow. The repository includes the shared `paper-learning` skill and local paper MCP tools. Verification covers local Electron/MCP operations, native builds and simulator checks, plus one physical-iPad submission inspected in an existing Codex chat through an explicit CLI/MCP fallback. Fresh-client native MCP discovery/rendering, Claude/ChatGPT delivery and extended device behavior still need separate verification. One successful roundtrip is not evidence that every client works.

## What it feels like

1. Pair Recall Pad with your Mac once and leave Recall’s local receiver enabled.
2. In the Codex conversation you are learning in, ask: **“Start a paper-learning session for linear algebra.”** Continue your normal discussion; ask for a problem or writing prompt when useful.
3. The assistant publishes that prompt when requested. Open it in Tutor Pad and work on its own sheet; the reference solution is not part of the published prompt.
4. Submit your pages from the iPad. If the assistant is waiting for work, the tool can return them to that same active conversation. Otherwise say **“Check my paper.”**
5. Discuss your reasoning as usual. Ask for a hint, clarification or review of a particular step. Publishing another problem is a deliberate tutoring choice, not an automatic queue.
6. End the paper session when finished. Your sheets and earlier submissions remain saved.

Submitting does not paste an image into the draft, send a chat message or wake an idle assistant. A bounded tool wait can receive work while the assistant is active; it can otherwise check when you ask. The Mac page tray remains available for explicit copying into any application, and the iPad supports PNG/PDF export and sharing.

With **Follow tutor** on, a new published prompt saves the previous work before switching sheets.
Hints and conversation do not create another sheet. Reconnection leaves the current sheet open;
turn **Follow tutor** back on when ready. **Blank sheet** is a separate manual workspace, not a way
to reassign work from one prompt to another.

## Connect the tools

The assistant needs the shared [paper-learning skill](../skills/paper-learning/SKILL.md) and Recall's paper MCP server. Install both from the app:

1. Open **Settings & backups → iPad & handwriting → Learn on paper with your tutor**.
2. Choose **Connect Codex** or **Connect Claude Code**. An existing connection offers **Refresh … tools** instead; review a disabled registration in the assistant's own settings.
3. Start a **fresh assistant chat** to load the installed tools and skill. Ask it to start a paper session, then verify a submitted page in that chat.

These paper tools are separate from learning-capture connections. Pairing an iPad or signing in to an assistant does not install them. **Local connection ready** establishes Recall's running receiver; installed tools alone do not establish live image delivery.

<details>
<summary>Advanced: CLI setup and other compatible clients</summary>

From the installed Recall bridge, preview the managed Codex connection, then apply it:

```sh
recall paper connect codex
recall paper connect codex --apply
recall paper connection-status
```

Use the actual installed bridge path from your Recall connection, including quotes for paths containing spaces. It selects your local profile; a path copied from someone else’s machine is not a portable setup. The preview identifies the managed skill and stdio MCP configuration to be installed. Review it before applying, then start a fresh assistant session so its tools and skill are discoverable. CLI `connection-status` reports registration and private endpoint metadata; the app separately identifies its running main receiver. Neither proves successful image delivery to a live chat. If the Codex registration is disabled, enable it in Codex's MCP settings; setup preserves that choice rather than overriding it.

Equivalent Claude configuration is available through `recall paper connect claude --apply`, with a preview if you omit `--apply`. Its real-client tool flow still needs separate verification. On a supported shared Codex host, ChatGPT desktop can reuse the Codex MCP registration in `~/.codex/config.toml`; its Settings → MCP Servers controls can restart or add servers. This local registration does not connect ordinary ChatGPT web chats. Verify image delivery in the actual desktop client before relying on it. [Official MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

For a separate compatible client profile, the stdio server command is `recall paper mcp --client chatgpt` using your installed bridge; use `--client codex` or `--client claude` for their separate launchers. The client label is descriptive metadata, not authorization. Keep the managed local configuration and capabilities out of public repository files. Neither signing in to an assistant nor pairing an iPad installs its MCP tools.

</details>

To verify readiness, ask the assistant to start a disposable paper session, publish one synthetic problem, receive a one-page submission and read that page. Confirm the page arrived in the intended chat. Merely seeing the skill or MCP server listed does not establish the complete flow. End the test session afterward; do not send messages to another conversation as a test.

## Tools and session scope

| Tool                    | Purpose                                                                        |
| :---------------------- | :----------------------------------------------------------------------------- |
| `paper_start_session`   | Start a session in the invoking chat and return its ID and capability.         |
| `paper_publish_prompt`  | Put the current problem or writing prompt on the iPad, using a revision check. |
| `paper_session_status`  | Inspect that session’s current prompt and submitted-work metadata.             |
| `paper_wait_submission` | Wait up to 30 seconds for new submitted work. A timeout leaves work unchanged. |
| `paper_read_submission` | Read selected saved page images into the invoking assistant turn.              |
| `paper_end_session`     | Close the session while keeping saved work.                                    |

MCP `paper_start_session` accepts only `{title}`; its configured launcher supplies client metadata. The local CLI also supports `recall paper start|publish|status|wait|read|end [JSON_FILE]`, with CLI start input `{title,client:"codex"|"claude"|"chatgpt",conversationId?}`. Later operations require the returned `sessionId` and `capability`. Publishing accepts `{title,prompt,kind:"problem"|"note",expectedRevision?}`; waiting accepts `{after?,timeoutMs}`; reading accepts `{submissionId,pageIndexes?}`. Select at most three zero-based page indexes; the default reads up to two pages within the byte limit and returns `nextPageIndexes` for progressive reads. Neither interface accepts `maxPages`. The live MCP schemas describe the remaining response fields and limits.

The capability authorizes access only to its paper session. It is retained in the assistant’s session context, not reconstructed from conversation logs or stored in global instructions. Do not put it in screenshots, exported notes or public examples. CLI input files containing it should be private and temporary. An optional conversation ID is descriptive context supplied by the client, not a way to read arbitrary chats.

## Feedback and learning capture

Paper feedback is ordinary tutoring in your chat, using only the pages you choose to expose. It should recognize alternative methods, separate arithmetic and conceptual errors, and ask about unreadable notation rather than guess. You can request a hint instead of a complete solution. The assistant should not claim it reviewed pages it did not read.

Tutor Pad does not invoke Recall’s separate handwriting assessor, require a separate OpenAI API key, rate a card or modify spaced-repetition schedules. Your assistant account’s usual access and billing apply when it reads images. Substantive learning can still be captured through your separately configured KB and Recall skills; starting a sheet is not itself a learning capture.

## Recovery and boundaries

Offline sheets remain editable and submissions queue for the paired Mac. Reconnection saves them without copying into a clipboard or controlling another app. If a session capability is unavailable, start a new session when requested or use the page-tray/manual-attachment route; do not scan previous conversations to recover it. Earlier sheets and submissions keep their original prompt binding; a new session does not adopt that old work.

A session has no countdown and can survive an ordinary Mac restart while its chat retains the capability. Start a new session after 1,000 published prompts or after restoring a profile backup. Backups preserve sheets, pages and prompt revisions, but exclude paper-session authority. Restore invalidates old capabilities and disables the companion; it never resumes tool reads or assessments automatically.

Keep the Mac receiver running for transfer and the assistant connection available for tool reads. Ending a session, a timed-out wait or failed image read must preserve work. A page receipt confirms durable Mac storage, not provider processing or grading. Verification must cover prompt revisions, stale submissions, interrupted delivery, session isolation and image reads in the intended client.

## Verified implementation boundary

On October 11, 2026, the local checks passed 237 Node tests, six focused connection checks, the web build, 53 native simulator tests and 12 portable Swift tests. A signed device build compiled and installed as an update on a physical iPad; its saved index, drawing and thumbnail bytes were unchanged. The user subsequently opened Tutor Pad and confirmed the published note was visible.

A real Electron/stdio MCP journey with synthetic paired-device uploads returned the original prompt and ordered image bytes. The same journey and Tutor UI checks passed against the packaged Mac app; source handwriting and receiver lifecycle journeys also passed. Skill syntax validation and source/history/package privacy audits passed.

The Mac package was installed locally, both Codex and Claude Code registrations were enabled and their matching skills installed, and a note was published through the installed MCP server to the running receiver. Existing cards, schedules, reviews, coding attempts and paper work were unchanged. Fresh assistant sessions are still needed to discover the installed tools.

One live roundtrip was also verified: the user wrote a line on the physical iPad and submitted it; the Mac saved the page and editable drawing, the installed MCP connection returned its original prompt/revision and complete one-page image, and the assistant inspected that image in the existing Codex chat through an explicit CLI/MCP fallback. The returned page's SHA-256 matched its stored hash, and the durable submission retained the original problem binding. Existing cards, reviews and coding state/attempts matched the preinstall baseline. No draft attachment or chat message was sent automatically. The real image and its contents are not included in public documentation.

The broader tool journeys used disposable profiles and synthetic submissions. The live check proves this one-page physical transfer and explicit same-chat image inspection; it does not establish fresh-client native MCP discovery/rendering, Claude or ChatGPT image delivery, sustained tutoring behavior or grading quality. Those remain separate checks.
