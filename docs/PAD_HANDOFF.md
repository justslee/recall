# Tutor Pad: iPad to Mac

Tutor Pad is a writing workspace beside **any conversation or application** you use for learning. With the optional [paper-learning connection](PAPER_LEARNING.md), Codex can publish the current problem and read your submitted pages in the same active chat. That tool-based flow is separate from the manual route described here: **copy a page from the Mac tray, paste it into your chosen chat and press Send yourself.**

No Recall card, Recall reference answer, separate handwriting assessment or review rating is involved. Recall Study and Tutor Pad share saved sheets and the local Mac receiver; Tutor Pad has its own window. Publishing prompts or reading submissions through assistant tools does not paste into a draft, send a message or wake an idle assistant.

## Manual route: write, receive, copy

1. On the iPad, tap **Tutor Pad** to continue your latest saved Tutor sheet, or open a blank sheet if you have none. There is no chat-app selector. Open the conversation you want on your Mac and ask for a problem.
2. On the Mac, open **File → Tutor Pad** (or the Recall Pad receiver menu) and choose **Start receiving pages** if the tray is not already ready.
3. Write on the iPad and tap **Send to Mac**. The sheet stays open; **Received on Mac** confirms that the complete submission was saved.
4. In the Mac tray, choose **Copy page**, switch to your chosen chat’s message input and paste with **⌘V**. Check the attachment, then press Send yourself. For multiple pages, copy and attach each page in order. The iPad’s export preview and system share sheet provide PNG/PDF files when copying is unsuitable.
5. Continue on the same sheet or choose **New sheet** for another problem. Earlier sheets and submissions stay saved; tutor feedback remains in your conversation.

Keep Recall’s local receiver running on the Mac. With the companion enabled, closing the main Recall window keeps the receiver available; explicitly quitting Recall stops it. Writing and local saving work offline. Foreground reconnection transfers queued work into the Mac tray without changing the clipboard, opening another app or sending a message.

## Delivery results

| Result | Meaning |
| :----- | :------ |
| **Saved offline / Waiting for Mac** | Your work is saved on the iPad and has not been acknowledged by the Mac. |
| **Received on Mac** | The complete submission is durably saved and available in the Tutor Pad tray. |
| **Copied (Mac action)** | You explicitly copied the selected page. Paste it into the application you choose. |

Arrival is storage only. New, delayed and restored work cannot automatically copy itself, attach to a chat or start a Recall assessment. An active paper-learning tool call can read submitted pages into its invoking chat, scoped to that session; otherwise the user asks the assistant to check. No Accessibility permission, countdown, armed draft or desktop-client adapter is needed.

## Manage saved sheets

**Tutor Pad** resumes the Tutor sheet with the most recently saved changes; it does not create another sheet each time you open it. Choose an older sheet from **Recent sheets**, or use **New sheet** in the editor for a fresh page. Existing drawings and earlier submissions remain intact.

Use the visible **…** beside a recent sheet, or the sheet’s own options menu, to delete work. The editor also supports renaming. A centered confirmation card names the sheet, with **Cancel** and **Delete sheet** actions. Confirming immediately removes its Recent sheets row, ink, local submissions and queued delivery from this iPad, including while offline. A sheet currently transferring must finish before deletion. Copies already received on the Mac, exported or attached to a chat remain there; deleting locally does not retract them. Canceling leaves the sheet untouched and keeps its writing canvas in place.

## Native discovery helper

On macOS, build the native Bonjour helper with Apple’s Command Line Tools:

```sh
node scripts/build-pad-helper.cjs
```

The build retains the development executable name `dist-native/RecallPadHandoff`. Packaged builds place it outside the ASAR archive. It advertises `_recall-pad._tcp` with the public installation identifier and protocol version, never credentials or pairing secrets. Bonjour discovers the Mac; the iPad still verifies the pinned TLS identity. macOS may request local-network permission when advertising starts.

Recall starts the helper directly, without a shell, using a minimal environment. Bounded newline-delimited JSON requests and replies use version `1` and a unique request ID. Its commands are `status`, `advertise` and `stopAdvertising`. It does not handle images, control applications or request Accessibility access. Explicit page copying belongs to Recall’s Mac process.

## Verification boundary

Verify ordered page delivery, explicit copying, iPad export/sharing, retry behavior, offline recovery and preserved existing work. A receipt proves storage, not that a chat accepted the image. Attachment formats and manual paste support depend on the application you choose; inspect the draft before sending.

Run the focused receiver and native discovery checks with:

```sh
node --test tests/pad-handoff.test.cjs
swift test --package-path native/mac-handoff --scratch-path dist-native/swift-tests
```

Native XCTest checks require full Xcode; if the active developer directory points to Command Line Tools, prefix the test command with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. This selects Xcode only for that command. In a development sandbox that prohibits SwiftPM’s nested sandbox, `swift test --disable-sandbox` still runs inside the outer sandbox.
