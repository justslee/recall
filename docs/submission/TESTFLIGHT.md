# Recall Pad · TestFlight drafts

[Submission packet](README.md) · [Privacy worksheet](APP_PRIVACY.md)

**Draft only.** Paste the approved text into App Store Connect after verifying it against the distributed candidate. Replace owner-needed fields privately; the owner must never submit placeholders.

## App information

**Writing input:** a compatible Apple Pencil is required for drawing; fingers scroll and zoom.

| Field                    | Draft or action                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Name                     | Recall Pad                                                                                                                |
| Subtitle                 | Write. Think. Recall.                                                                                                     |
| Primary category         | Education, subject to the owner's choice.                                                                                 |
| Platforms                | iPad. Do not advertise an independently tested Mac/iPhone build.                                                          |
| Minimum system           | iPadOS 17 or later; verify against the archive.                                                                           |
| Support URL              | `https://github.com/justslee/recall/blob/main/docs/submission/SUPPORT.md` — verify public availability after publication. |
| Privacy URL              | `https://github.com/justslee/recall/blob/main/docs/PRIVACY.md` — verify the final policy loads publicly.                  |
| Marketing URL            | `https://github.com/justslee/recall`                                                                                      |
| Feedback email           | **Owner needed:** a monitored address, entered privately in App Store Connect.                                            |
| Review contact           | **Owner needed:** name, phone and email, entered privately in App Store Connect.                                          |
| Copyright / seller       | **Owner needed:** approve the legal publisher identity.                                                                   |
| Sign-in required         | No Recall account. Pairing is local and optional for blank writing.                                                       |
| Age rating / territories | **Owner needed:** answer the current questionnaires from the actual features; do not infer from the Education category.   |

Apple requires a beta description and feedback email for external testing. Test information can differ from the eventual App Store listing. [Provide test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/).

## Beta app description draft

Recall Pad gives you space to work through a problem by hand.

Write with a compatible Apple Pencil on a scrollable sheet, choose plain, ruled or squared paper, and keep editable work saved on your iPad. Apple Pencil is required for writing; fingers scroll and zoom. The paper follows your device's light or dark appearance. Preview and share ordered PNG/PDF pages when you're ready.

Pair once with the optional Recall Mac app on your local network. In Recall Study, a math or concept question appears above your writing sheet while its solution stays on the Mac. Send a version of your work to the Mac without replacing earlier submissions.

Tutor Pad works beside a conversation you already use for learning. Copy received pages from the Mac tray and paste them into your chosen tutor. A separately configured paper-learning connection can let a supported assistant publish a prompt and read your submitted pages when you ask it to check your work. It does not send a chat message or wake an idle tutor automatically.

No Recall account or cloud library is required. Blank writing and saved work are available offline; queued transfers resume while both apps are open and connected. AI feedback is optional, happens on the Mac or through your chosen assistant, and uses that provider's access and billing. Recall Pad does not include an OpenAI API key or a tutor subscription.

This beta focuses on writing, recovery, export and reliable local transfer. Refer to the release notes for the exact supported Mac and assistant versions.

## What to test draft

Use original, nonsensitive sample work. Do not submit private pairing codes, API keys or learning notes in feedback screenshots.

1. Open **Tutor Pad** without pairing. Write, scroll, change ink color and thickness, use the eraser, undo/redo and try each paper style.
2. Close the app and reopen the sheet from **Recent sheets**. Confirm the drawing is editable and light/dark appearance keeps all ink visible.
3. Use **… → Export current work**. Check ordered pages, offscreen ink and PNG/PDF sharing. In-app export shares the submission limits: 20 pages, 12 MiB per image and 64 MiB total including editable drawing data.
4. Delete a disposable sheet through **… → Delete sheet…**. Cancel once, then confirm; the Recent sheets row should disappear. Copies already transferred or shared remain at their destination.
5. Open **Help & Privacy** from the home screen. Confirm the privacy, setup and support links open the public pages without including pairing or session information.
6. With the tested Mac companion, pair, transfer a short sheet, then interrupt/reconnect the local connection. Confirm work remains saved and appears once in the Mac tray. Arrival must not change the clipboard or send a chat message.
7. For Recall Study, confirm the iPad shows only the question. Changing questions preserves unfinished work; sending does not flip or rate the Mac card.

Report the Recall/Recall Pad version, device model, OS version, steps and expected/actual behavior. TestFlight's feedback may include screenshots and diagnostic information under Apple's service; review it before submitting. [TestFlight feedback](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

## Beta review notes draft

Recall Pad has no Recall sign-in, subscription or in-app purchase. No demo credentials are required for its offline writing mode. A compatible Apple Pencil is required to draw; fingers scroll and zoom. Please review on an iPad with Apple Pencil available.

**Without a Mac:** open **Tutor Pad**, write with Apple Pencil, select **Done**, reopen it under **Recent sheets**, then use **… → Export current work** for PNG/PDF sharing. A blank sheet works before granting camera or local-network permission. Camera access is used only to scan a temporary pairing QR code; it is not used as a document camera or retained recording.

**Privacy and help:** choose **Help & Privacy** on the home screen for the public privacy policy, setup guide and support links.

**Companion features:** these require Recall for Mac on the same local network. The exact tested, signed and notarized Mac download must be supplied here before submission: **owner/release operator must add the actual candidate download URL and checksum**. Setup instructions are at `https://github.com/justslee/recall/blob/main/docs/demos/PAPER.md`.

Open Recall on the Mac and choose **Settings & backups → iPad & handwriting → Enable companion**. Generate a pairing QR, open **Pair with Mac → Scan pairing QR code** on the iPad, allow local-network/camera access when asked, and approve the iPad on the Mac. Each QR expires after five minutes and can be used once; generate it locally rather than using an embedded sample credential.

For manual transfer, open **File → Tutor Pad** on the Mac and choose **Start receiving pages**. On the iPad, write in a manual Tutor sheet and choose **Send to Mac**. Received pages remain in the Mac tray. **Copy page** is explicit; the user chooses an external destination and sends any chat message themselves.

For Recall Study, choose **Try demo** on a fresh Mac profile, open the math card and choose **Write on iPad**. The front appears on the iPad with the answer hidden. The Mac owns the reference and review schedule. Handwriting AI assessment requires explicit Mac consent and the user's own OpenAI API account; ordinary writing, local transfer and export need no API key.

Paper-learning tools and AI assessment are optional integrations. Reviewers must be able to inspect every shipped feature, including these integrations; omitting a feature from marketing does not remove that requirement. Supply verified client instructions and safe test access before submitting. Do not claim assessment quality or client compatibility merely because setup exists. No reviewer should need the developer's personal account, private KB, pairing secret or live paper-session capability.

## Store description later

Use the beta description as a starting point only after stability gates close. Remove beta language for the production listing, confirm all claims against that exact build, and keep the same-network Mac requirement conspicuous. No approval, unlimited handwriting capacity, automatic grading, cloud synchronization or universal chat integration is promised by this draft.
