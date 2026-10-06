# Spoken answers

[Documentation](README.md) · [Speak practice](SPEAK.md)

Use the compact **Answer Strip** to speak or type your answer, get optional feedback, and flip the
card. You choose the recall rating; AI never rates a card or changes its schedule.

## Set up once

Connect your OpenAI API key once in **Settings & backups → Voice & feedback**. A card’s **Set up
voice** button opens that section; **Back to your answer** returns to the same card without
recording a review. Once saved, the compact Answer Strip shows **Speak** and **Type**. Allow the
microphone when macOS asks. No key is required for ordinary study, typed local drafts, coding or
local storage.

Settings shows **Key saved on this Mac** across restarts and updates. Use **Replace key** or
**Remove key** there; the saved secret is never displayed. Someone setting up their own
clone/profile saves their own key once. Saving confirms local storage, not authenticated API access.
Privacy and billing details stay in Settings, with a brief audio notice beside the card’s recording
controls.

If an older profile has only `credentials/openai.enc`, re-enter your key once in this section.
Recall does not automatically migrate or decrypt that legacy file and does not access macOS
Keychain. The old file remains untouched until a replacement key is successfully saved or you
explicitly remove the key.

> Voice and evaluation are optional. They require internet and separately billed OpenAI API access.
> Your ChatGPT subscription does not supply API credits.

## Answer a card

1. Choose **Speak** to dictate, or **Type** to open a small response editor. The editor starts collapsed, including when a previous draft exists. **Your answer · draft** reopens it.
2. **Stop recording**, then correct any words, numbers or symbols. You can also type the whole response, or continue dictating to append more.
3. **Evaluate & flip** compares your response with this card’s text reference, then turns to the back on success. Feedback starts as one expandable line identifying what you got and what needs work. It is formative feedback, not a guaranteed grade. Failed or cancelled evaluations leave your response available without flipping or rating.
4. **Try a follow-up** for a targeted question or application example. You can speak or type the next answer. Follow-up rounds are assisted practice; rate your original recall honestly.
5. **Flip card** (or Space) reveals the reference or worked solution. **Question** turns back; your response and numerical working survive. Choose your own recall rating to advance. AI never rates a card or changes its schedule. Flipping, rating and skipping are disabled while dictation or evaluation is in progress; finish or cancel first.

### Drafts and follow-ups

The current answer and up to four follow-up rounds are kept in the card’s local draft, including
across restarts. Collapse the editor to focus on the card without losing text. **New attempt**
clears this draft. These are not a permanent attempt archive.

The info button opens privacy details and a link to Voice settings. Coding cards keep their local
editor and tests. Paper-photo assessment and automatic voice conversation are separate future
features.

## Connection and privacy

- The current [live transcription API](https://developers.openai.com/api/docs/guides/realtime-transcription) uses `gpt-live-transcribe` over a transcription-only Realtime WebSocket. No spoken assistant is generated. This is distinct from the full [`gpt-live-1` conversational API](https://developers.openai.com/api/docs/guides/live), which is a possible next step.
- Text assessment uses `gpt-6-luna` through Responses with a strict feedback schema, no tools, and `store: false`. API availability depends on your project’s access and billing; a ChatGPT subscription does not supply API credits.
- Audio streams only after you start dictation. Recall does not write audio to disk. Stop, cancel, switching cards, closing the window, or leaving the visible app stops recording. Recordings are limited to three minutes.
- Evaluation sends the current question and text reference, your corrected answer, and any follow-up context for that attempt. It excludes the rest of the library, attachments, source URLs and interactive-widget code. Image-only answers need a text reference before assessment.
- The key is stored in the profile's local plaintext `credentials/openai.key` file. The file uses owner-only `0600` permissions inside a `0700` credentials folder; this is file permission protection, without separate encryption. Software running as your OS account can read it. Recall does not use Electron `safeStorage` or access macOS Keychain for this connection.
- The saved key is never returned to the renderer. Recall's library exports and profile backups exclude credentials; whole-machine backups may include them. Set your own key once on a new profile or Mac. An `OPENAI_API_KEY` environment variable is also supported when launching from that environment.
- Local transcripts and feedback are included in normal profile backups. OpenAI processes transmitted content under your API project’s [data controls](https://developers.openai.com/api/docs/guides/your-data). No claim of zero server retention is implied by Recall storing no audio.

## Troubleshooting

**No microphone:** check System Settings → Privacy & Security → Microphone → Recall. Quit and reopen
after changing the macOS setting. A packaged build includes the microphone usage description. You
can always type an answer.

**Missing key, access error or quota:** save a valid project key, ensure it can use the two
configured models, and check API billing. Recall does not fall back to an older model silently.

**Disconnected or timed out:** partial text remains editable. Check it before retrying; an
incomplete transcript is never automatically evaluated. There are no automatic paid retries. Cancel
closes the local connection; already transmitted work may still incur API usage.

## Development verification

```sh
npm test
npm run test:voice
```

The unit tests cover the transport lifecycle, cancellation, permissions, bounded audio,
structured-feedback validation, reference filtering, secret handling and unchanged review state.

The voice desktop check launches an isolated Electron profile with a synthetic microphone and
stubbed OpenAI transport. It exercises real audio worklet → PCM → IPC flow, Settings-only setup,
returning to the current answer, saved-key persistence across a full restart, editing, feedback,
follow-ups, saved drafts, card changes and both themes. It never uses a real API key or learner
audio.

Authenticated API and real-microphone testing require a user-supplied key and explicit microphone
use. A successful synthetic test is not evidence of live model access or assessment quality.

Continue with [Speak](SPEAK.md) for longer explanations and audience-focused practice, or review
[privacy and execution](PRIVACY.md).
