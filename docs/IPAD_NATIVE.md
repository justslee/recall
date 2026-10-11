# Build Recall Pad

[Documentation](README.md) / [Handwriting](HANDWRITING.md) / Native iPad app

Recall Pad is an optional native iPad companion. Ordinary Recall setup does not require Xcode, an iPad or an Apple Developer account. The source includes a real SwiftUI/PencilKit app and a checked-in Xcode project; no project generator or hosted service is required.

**Invited testers can use TestFlight instead.** See the [installation and update guide](SETUP.md#optional-ipad-companion). This page is for people building their own app; there is no public TestFlight invitation yet.

## Requirements

- A Mac with **full Xcode**, including the iOS SDK. Command Line Tools alone cannot build an iPad app.
- An iPad running **iPadOS 17 or later**. Apple Pencil is the writing input; fingers scroll and zoom.
- Recall’s existing locked Node dependencies, installed with `npm ci` or the normal setup flow.
- A local network shared by the iPad and the Mac for pairing and transfer. Offline writing requires neither the network nor an awake Mac.

Use the active Xcode installation, or prefix the commands below with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` if your command-line tools still select Command Line Tools. Do not change the system-wide developer selection just to build this app.

## Build locally

Run these commands from the cloned repository:

```sh
npm ci
node scripts/build-ipad.cjs
```

The script copies **the installed locked versions** of KaTeX, DOMPurify, fonts and their licenses into ignored app resources, then builds an unsigned Debug device app under `apps/ipad/.build/Build/Products/Debug-iphoneos/RecallPad.app`. It does not install the app, publish anything, download a simulator, request signing credentials or call OpenAI. Add `--simulator` to compile the Debug simulator SDK app instead.

To prepare resources and build in Xcode yourself:

```sh
node scripts/build-ipad.cjs --resources-only
open apps/ipad/RecallPad.xcodeproj
```

Choose the shared **RecallPad** scheme. The project rejects a build with missing offline question resources and prints the preparation command.

The committed AppIcon uses Recall’s existing public SVG brand on an opaque warm-paper canvas. To regenerate it after changing the public brand asset, run `node_modules/.bin/electron apps/ipad/generate-icon.cjs`. Ordinary builds use the committed 1024-pixel RGB PNG and do not depend on the icon-rendering machine’s fonts. Debug bundles that PNG directly, so SDK compilation works without a simulator runtime. Release/archive builds use the full AppIcon catalog. In the verified Xcode 26.5 environment, its asset-catalog compiler also required an installed simulator runtime when compiling for a physical device; complete that environment setup before release verification.

## Install on your iPad

1. Create `apps/ipad/Local.xcconfig`, which is ignored by Git:

   ```xcconfig
   DEVELOPMENT_TEAM = YOUR_APPLE_TEAM_ID
   RECALL_PAD_BUNDLE_IDENTIFIER = your.unique.namespace.RecallPad
   ```

2. In Xcode, add your Apple account, connect the iPad and select it as the destination. Enable Developer Mode on the iPad when requested by Apple.
3. Build and Run. Automatic signing uses the local configuration. Keep team identifiers, provisioning files, archives and credentials out of commits.
4. Open Recall on the Mac → **Settings → iPad & handwriting**, enable the local connection and show its pairing QR code.
5. Scan it in Recall Pad, grant local-network access and approve that iPad on the Mac. Pairing persists across ordinary restarts and app updates.

The scanner shows camera permission and interruption messages instead of silently failing. Use **Open Settings** if camera access is denied, or open Recall Pad full screen if another foreground app prevents camera access. You can also close the scanner and paste the pairing code. An ordinary app update does not require pairing again.

Free personal development signing can expire and require reinstalling through Xcode. Distributing your own TestFlight beta needs a paid Apple Developer membership and App Store Connect configuration. Ordinary invited testers need neither; this repository does not itself grant a beta invitation.

## Updating an existing development installation

Tap **Done** to save an open sheet and export important work. Update the source and locked dependencies, prepare the resources again, then build and install with Xcode using the **same team and bundle identifier** as the existing app. Install over the app rather than deleting it. A different bundle identifier creates a separate app with a separate local library.

Keep `Local.xcconfig` private and retain the existing Mac profile. Normal app updates preserve sheets and pairing. For an app installed through TestFlight, use **TestFlight → Recall Pad → Update** instead of Xcode. [All update steps](SETUP.md#update-an-existing-installation)

## What stays on each device

The iPad saves editable PencilKit drawings, thumbnails, immutable submitted pages and a durable delivery outbox in its application-support directory. It caches only issued question fronts; starting Tutor Pad does not discard the last downloaded study session. References, worked solutions, scheduling and evaluation feedback remain on the Mac.

**Recall Study** follows issued concept or math questions, with feedback and rating in Recall. **Tutor Pad** is a separate writing workspace alongside any conversation or application. An optional [paper-learning session](PAPER_LEARNING.md) lets a connected assistant publish the current prompt and read submitted page images into its invoking chat. Tutoring stays in that chat; no reference solution is sent with a published problem. Tapping Tutor Pad opens saved work or a blank sheet when needed. **New sheet** starts a fresh page. There is no chat-app selector; existing editable ink and submission history remain saved.

Open the separate **Tutor Pad** window from Recall’s Mac menu to receive pages. Tap **Send to Mac** on the iPad, then explicitly **Copy page** from the Mac tray and paste into the chat you choose. PNG/PDF export and system sharing are also available on the iPad. Sending keeps the sheet open and shows a compact delivery receipt. Tutor feedback remains in its chat; no card, Recall assessment or Accessibility permission is required. The local Mac receiver is still needed for delivery. See [Tutor page transfer](PAD_HANDOFF.md).

Recent sheets distinguish **Recall Study** and **Tutor Pad**. Use the row’s **…** menu or editor options to delete a sheet after confirmation; the editor also supports renaming. Deletion removes the iPad’s ink, local submissions and pending outbox items. It does not remove copies already received on your Mac or attached to a chat. Active transfers must finish before deletion, and canceling keeps all work.

The per-device Mac credential and pinned public-key fingerprint stay in this iPad’s Keychain. Bonjour discovers the paired Mac after address changes; the advertised installation identity is not trusted until the TLS public-key pin and certificate checks pass. Removing the pairing on the iPad does not revoke its old Mac credential: remove that device in Recall’s Mac settings too.

Background iPadOS suspension is not continuous delivery. Reopen Recall Pad to resume discovery, transfer and receipt updates. Tutor sheets started before pairing or while the Mac is unavailable can transfer into the Mac tray later. Receiving them never changes the clipboard, controls another application, wakes an idle assistant or replaces a Study session. A retained session capability allows an invoked assistant tool to read the selected paper-session pages; otherwise manual copying remains available. Earlier immutable submissions retain their original metadata and hashes, including any legacy chat-specific destination. Study and Tutor sessions remain independent.

Unreadable saved indexes are preserved and block new writes rather than silently replacing earlier work. Recover the application-support files through Xcode’s device tools before clearing app data.

## Verification

Portable Swift model, pairing-code, pagination and outbox identity checks run on the Mac:

```sh
swift test --package-path apps/ipad --scratch-path apps/ipad/.core-build
```

The native XCTest target additionally covers blank Tutor Pad presentation and reopening, erasing all ink, finite canvas geometry, bounded grid rendering on long sheets, PencilKit draft reload, immutable image submissions, saved front-only sessions and corrupt-index preservation. Install an iPad simulator runtime through **Xcode → Settings → Components**, then run:

```sh
node scripts/build-ipad.cjs --test
```

The default simulator destination is `iPad (A16)`. Choose another installed destination with `RECALL_IPAD_TEST_DESTINATION`, for example:

```sh
RECALL_IPAD_TEST_DESTINATION='platform=iOS Simulator,name=iPad Pro 13-inch (M4)' node scripts/build-ipad.cjs --test
```

The normal build is an unsigned device compilation; `--device` is an explicit equivalent. Neither command installs a signed app.

### Current paper-learning verification

On October 11, 2026, 53 native simulator tests and 12 portable Swift tests passed, along with a signed device build. The signed update installed in place on a physical iPad; its saved index, drawing and thumbnail bytes were unchanged. The user subsequently opened the app, saw the published note, wrote a line and sent it.

The local Electron/MCP journey used synthetic pairing and uploads and returned saved prompt/image content in both source and the packaged Mac app. A live one-page roundtrip also passed from the physical iPad through durable Mac storage and the installed MCP connection, with the assistant inspecting the returned image in the existing Codex chat through an explicit CLI/MCP fallback. The original prompt/revision remained associated with the work. No personal content is included in public examples. Fresh-client native MCP discovery/rendering, Claude/ChatGPT delivery, extended device behavior and grading quality remain separate checks. See [Paper learning](PAPER_LEARNING.md).

### Earlier development verification

The dated records below describe earlier development builds. References to desktop draft adapters are historical: current Tutor Pad uses scoped assistant tool reads or a Mac page tray and explicit copying, with a Bonjour-only native helper. No automatic paste compatibility gate applies to either workflow.

**Verified locally on October 10, 2026:** the signed Debug app installed and paired on a ninth-generation iPad running iPadOS 18.7.8. The user confirmed Tutor Pad stays open, previously saved ink is visible, and new Apple Pencil strokes work after the update; existing sheet records were retained. Thirty-two native XCTest methods execute successfully on the iPad (A16) simulator, and eight portable Swift tests pass. These include regressions for infinite empty-drawing bounds, blank/erased sheet persistence, phantom edits, bounded grid rendering, and a connection refresh arriving before a finalized Pencil callback. Scanner tests cover preview sizing before delayed permission, dismissal during permission/configuration, reopening, foreground return, permission denial, camera failures, interruptions and accepting one code. Camera capture is mocked in these tests. After the scanner update, the user confirmed the live camera preview works, including closing and reopening it; all three saved sheet records and the existing submission were unchanged. Fresh QR recognition and physical interruption recovery were not retested. The writing surface follows system light/dark appearance. Native tests render both paper colors with contrasting ink, switch appearance without replacing the canvas or changing saved strokes, preserve a matching pen, and retain ink through a pending drawing callback. Export tests verify dark ink on white pages and thumbnails under either appearance. The signed adaptive-appearance update installed on the physical iPad and all previously saved sheet and submission records remained present. The user subsequently confirmed that paper adapts to iPad appearance and new ink stays visible when switching light/dark with a sheet open. The Debug bundle contains its opaque app icon. Extended Pencil/palm testing, real-device scroll/zoom alignment, interrupted transfers, Release asset-catalog compilation and both desktop-client adapters still require verification before public distribution. Mocked evaluation tests do not establish live grading quality.

**Latest tool-controls verification:** 36 native tests and eight portable Swift tests pass. New coverage checks pen colors/thickness, fixed-diameter partial erasing, finite/clamped preferences, pending drawing preservation, editable colored-ink storage, white-paper exports under both appearances and visible colored ink through live appearance changes. Simulator interaction confirmed the compact popovers and selection controls. The signed update installed and launched on the physical iPad, retaining all six saved sheet records and five submission records unchanged. Physical Pencil testing of these new tool settings remains to be confirmed.

**Latest deletion verification:** 41 native XCTest methods pass. Four rendered tests verify the actual confirmation card is centered and readable in light/dark appearance and portrait/landscape, without changing a populated sheet’s saved ink or submissions. Simulator interaction verified Cancel and successful deletion from both Recent sheets and the editor. The confirmation overlays the existing canvas rather than presenting a new writing screen; Follow Mac pauses while it is open. Existing deletion tests cover immediate offline row removal, persistence and rejection of stale autosaves. The signed update installed and launched on the physical iPad, retaining all five sheet records and five submission records unchanged. Physical interaction with the new confirmation card remains to be confirmed.

**Next:** [Handwriting workflow](HANDWRITING.md) · [Protocol](PAD_PROTOCOL.md) · [Privacy](PRIVACY.md)
