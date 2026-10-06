# Recall

## Product contract

Read docs/PRODUCT_PLAN.md and docs/IMPLEMENTATION.md before making product changes.
This is a local Mac app; do not add hosting or a required account.

## Content and study

Topics are broad knowledge domains. Decks are collections; tags describe narrow concepts.
Concept, Math and Coding are first-class card formats, chosen by learning objective.
Follow macOS appearance: dark Forest Glass and warm ivory/sage light surfaces. Preserve matching, spacious coding workspaces. Theme changes must not remount editors or reset attempts.
Math solutions must start hidden in Study and Library, with an explicit show/hide toggle.
Use rendered Mermaid or meaningful interactive visuals on card backs where helpful; ASCII diagrams belong only in recoverable source notes, never as the main visual explanation.

## Execution and preservation

Keep imported content separate from privileged APIs. Never execute code on card load.
Interactive widgets run only inside the sandboxed recall://widget frame (allow-scripts only, own strict CSP, no allow-same-origin) and only after the reader clicks Load; keep frame-src limited to that host and keep the 403 for cards without widgetsAllowed. See docs/WIDGETS.md.
Preserve stable card identities, source content and learning history on import/edit.

## Maintenance

Update implementation status with verified evidence; do not label planned features implemented.
Run npm test and npm run build for changes to storage, scheduling, runners or UI.
Use the contributor's configured Git identity when committing. For privacy, use their account-linked GitHub noreply address; never replace attribution with a generic placeholder or publish a personal email without authorization.
