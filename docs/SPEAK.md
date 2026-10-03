# Speak

Speak is a separate practice space for explaining an idea to someone specific. Choose a reference from your library or configured knowledge base, or enter your own topic. Explain it to your chosen audience, review the feedback, then try again with a different listener in mind.

It complements the card-level [spoken answer](VOICE.md) flow. Speaking sessions have their own local history; they do not rate cards, infer mastery or change review schedules.

## Start a session

1. Open **Speak** and choose **From library** for an existing card or configured KB note, or **Your own topic** for a presentation such as your project's architecture. Custom topics can include an optional listener brief and pasted reference notes.
2. Choose an audience: general audience, junior colleague, technical peer, investor or podcast listener. Choose a focus: explain the idea, explain its mechanism, give a concrete example or **Walk through a system** for a broader architecture or presentation.
3. Set a target of **30 seconds, 1, 2, 3, 5, 10 or 15 minutes**. The target is a communication constraint, not a requirement to fill every second. Speak allows up to three minutes for short exercises, or the selected longer target for presentations, with a 15-minute maximum.
4. Start recording and allow microphone access when macOS asks. Stop when finished, review the transcript and correct transcription errors before evaluating.
5. Get feedback on your explanation. With a reference, review how your claims align with that text. Without one, receive communication feedback with accuracy marked **Not assessed**. Review delivery observations separately, then revisit the saved session or practise again.

Set up the optional OpenAI connection once in **Settings & backups → Voice & feedback**. Speak uses the same locally saved key as spoken card answers; it persists across restarts and updates. Someone setting up their own clone/profile saves their own key once. It requires internet and separately billed OpenAI API access. Saving a key confirms local storage; it does not verify model access or billing.

A new, empty library can use **Your own topic** immediately. To choose library material, import or create cards, try the original demo, or [configure a knowledge source](KNOWLEDGE.md). Local Markdown and Obsidian sources use the selected folder scope. Notion uses snapshots previously fetched through the connector workflow; a cached note is not a fresh read from Notion, and an empty cache is not proof that the page does not exist.

Custom topics support a title of up to 300 characters, a listener brief of up to 2,000 and pasted reference notes of up to 24,000. Your setup, drafts and evaluated attempts stay in the local profile. Speak accepts explanations up to 40,000 characters. Ordinary card dictation keeps its separate three-minute and 12,000-character limits.

## Reading the feedback

Content feedback considers the selected audience and drill, with attention to accuracy, depth, clarity and organization. A useful explanation defines the idea, explains the relevant mechanism, gives an appropriate example and identifies limitations when those matter. More words do not automatically demonstrate more understanding. Feedback should distinguish a factual error from a missing detail or a reasonable simplification.

The selected reference is the evaluation basis. It can itself be incomplete or out of date. Pasted notes are labelled as your provided reference, not independently verified KB content. Without reference notes, the result is **Communication feedback only**: accuracy is forced to **Not assessed**, and any sample explanation is a restatement of your own claims, not a verified model answer. Treat feedback as a practice aid; a polished explanation or positive assessment does not establish mastery.

Delivery measurements use the original transcript and recording, so correcting a technical term does not silently rewrite the evidence about how you spoke:

- **Fillers:** direct counts of unambiguous disfluencies such as “um” and “uh,” with contextual candidates such as “like” shown separately. A word used meaningfully is not automatically a filler. Transcription may omit disfluencies, so these are observed counts rather than a complete acoustic audit.
- **Pace:** a word-rate estimate based on the captured transcript and duration. Compare similar exercises; there is no universally correct speaking speed.
- **Pauses:** estimated low-energy intervals in the microphone signal. Quiet speech, background noise and microphone gain affect detection. These measurements do not prove hesitation, and a deliberate pause can improve an explanation.

The current [OpenAI live transcription model](https://developers.openai.com/api/docs/guides/realtime-transcription) does not return word-level timestamps. Recall therefore does not attach pauses to invented word positions or claim exact word alignment. It estimates pauses locally from the PCM audio stream and labels the result accordingly.

Long recordings are transcribed in ordered segments without stopping the microphone: after 60 seconds, Recall looks for a quiet interval of at least 0.8 seconds, or commits the segment at 120 seconds. Final text follows recording order even if segment results arrive out of order. This segmentation is not word alignment.

## What is sent and saved

| Action                                       | Network use                                                                                                                                 | Local result                                                  |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------ |
| Choose a reference or prepare a custom topic | No provider request                                                                                                                         | Selected reference or custom title, brief and notes           |
| Start recording                              | Microphone audio and a generic verbatim-transcription instruction go to OpenAI; the custom title, brief and notes are not sent at this step | Transcript and aggregate delivery measurements; no audio file |
| Correct the transcript                       | No evaluation request                                                                                                                       | Edited text retained separately from the original transcript  |
| Evaluate                                     | Selected reference or pasted notes, topic, listener brief, response, audience, drill, duration and relevant delivery context go to OpenAI   | Structured feedback and session history                       |
| Reopen a past session                        | No automatic provider request                                                                                                               | Saved reference and feedback                                  |

Evaluation sends only the selected reference or the custom material you supplied, together with this attempt's context and response. Recall does not upload the whole knowledge base, fetch an entire Notion workspace, extract card-widget code or attach unrelated learning history. Pasted custom notes preserve their paragraphs and code and are sent as reference text; they are not executed. Sources and transcripts are untrusted content, not instructions that can grant the evaluator tools or access to the computer.

Recall stores no audio recording. Local setup, drafts and session history include custom topic/brief/notes or the selected reference snapshot, transcripts, delivery summary and feedback, and are part of the private profile and its backups. Keep those backups private. The API key is stored as local plaintext in `credentials/openai.key`, with `0600` file permissions inside a `0700` credentials folder. Software running as your OS account can read it. Recall does not use `safeStorage` or access macOS Keychain for this connection. The key is never returned to the renderer after saving and is excluded from Recall's library exports and profile backups; whole-machine backups may include it. See [Voice](VOICE.md) for legacy-key re-entry.

Evaluation uses the OpenAI Responses API with a [structured output schema](https://developers.openai.com/api/docs/guides/structured-outputs), no tools and `store: false`. A schema constrains the response shape; it does not guarantee correct judgment. OpenAI processing still follows your API project's [data controls](https://developers.openai.com/api/docs/guides/your-data). Local audio non-retention is not a promise of zero provider retention.

## Architecture and migration decisions

The migration was evaluated against an earlier personal speaking-practice prototype. Its topic → audience → timed explanation → evaluation/history flow is the foundation. That prototype remains unchanged; this work does not import its past recordings or replace its Speak tab.

Recall adapts that flow in four ways:

1. **Make grounding explicit.** Resolve a selected card or scoped KB record in the main process, or save a custom topic with clearly labelled user-provided notes. An attempt keeps its reference snapshot. No-reference practice supports communication feedback without inventing factual verification.
2. **Separate observation from interpretation.** Count observed fillers deterministically, preserve the original transcript, and calculate approximate pauses from incoming audio. Evaluate the corrected prose separately; do not equate confident delivery with factual accuracy.
3. **Use one optional provider.** Reuse Recall's bounded `gpt-live-transcribe` transport and OpenAI connection, then use structured text evaluation. This removes the prototype's Deepgram requirement. The tradeoff is estimated audio pauses rather than Deepgram's word-aligned pause positions; real audio testing is required to establish quality. The original migration used encrypted credentials; the current connection uses the owner-only plaintext file described above.
4. **Keep practice independent.** Store drafts/history under Speak's own settings namespace. No new hosted service, user account, private source path or preset personal knowledge base is required. Speak writes do not create FSRS ratings or mutate card schedules.

The renderer owns the practice UI and editable transcript; the main process owns scoped reference resolution, credentials, bounded audio transport, delivery measurement, provider calls and local persistence. The evaluation UI follows Recall's Study Index light/dark surfaces, typography and restrained use of color.

## Verification and remaining limits

The initial migration was verified locally on October 2, 2026: all 62 tests, the production build, Electron packaging, source privacy audit and packaged privacy audit passed. Source and packaged Speak desktop checks used a synthetic microphone and mocked API responses. They exercised card/KB source selection, typed and recorded explanations, original-versus-edited transcripts, draft reload, cancellation before a provider request, microphone release on navigation, restart, history and deletion. Existing cards, reviews, schedules, the paused study session and coding draft matched their pre-test state. The existing packaged spoken-card-answer regression also passed. Light, dark and narrow layouts were visually inspected.

The custom-topic and longer-presentation extension passed all 72 tests, build, packaging and both privacy audits. Expanded source and packaged desktop checks each passed with four mocked evaluation calls, including custom setup persistence, longer typed explanations, no-reference accuracy enforcement and explicit user-provided reference notes. Unit tests cover ordered segment completion, duplicate and missing results, partial failures, duration/text bounds and unchanged card-dictation limits. The packaged spoken-card-answer regression passed with two mocked requests. Custom-topic light, dark and narrow layouts were visually inspected.

Run `npm test`, `npm run build` and `npm run test:speak` for the relevant local checks. `npm run test:voice` covers the shared spoken-card-answer flow. The [implementation status](IMPLEMENTATION.md) records the scope of this verification; these checks do not imply a published release or a completed installation on another Mac.

Synthetic microphone and mocked API tests verify plumbing, state and failure handling. They cannot establish real-microphone transcription accuracy, model access, filler recall, pause quality, live evaluation quality or performance over a real 15-minute talk. Those need representative recordings and authenticated provider testing.

This version is a record, inspect and evaluate exercise. Automatic spoken coaching conversations, exact word alignment, pronunciation scoring, audio playback and prototype history import are outside its scope.
