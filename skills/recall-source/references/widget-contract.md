# Interactive widgets and SVG figures

_Added September 6, 2026 in Recall 0.2.0. Part one is the authoring contract. Part two is how it works and why._

## Part one: the contract

A card answer can carry two kinds of visual besides Mermaid and KaTeX.

### Static SVG figures

Paste an `<svg>` element anywhere in the answer. It renders in the zoomable figure viewer. Use the theme variables for every color so the figure matches the app:

```html
<svg viewBox="0 0 320 120" role="img" aria-label="Cause leads to effect">
  <style>
    .lbl {
      font: 13px var(--sans);
      fill: var(--muted);
    }
  </style>
  <rect
    x="10"
    y="30"
    width="120"
    height="60"
    rx="10"
    fill="var(--accent-soft)"
    stroke="var(--accent)"
    stroke-width="2"
  />
  <text x="70" y="65" text-anchor="middle" fill="var(--text)">Cause</text>
</svg>
```

Rules: always give a `viewBox` (the viewer scales by it), keep `<style>` inside the `<svg>`, never reference remote images or fonts, and write an `aria-label` that says what the figure shows. Scripts, event handlers and `foreignObject` are removed by the sanitizer.

### Interactive widgets

Wrap plain HTML, CSS and JavaScript in a fenced block. The text after `widget` on the opening line becomes the title.

````text
```widget Explore bond price sensitivity
<label>Yield change <b id="v">20</b> bp
  <input id="m" type="range" min="-100" max="100" value="20"></label>
<div class="grid">
  <div class="metric"><small>Estimated price</small><strong id="p"></strong></div>
</div>
<script>
const m = document.getElementById("m");
const draw = () => {
  document.getElementById("v").textContent = m.value;
  document.getElementById("p").textContent = (100 - 4.5 * m.value / 100).toFixed(2);
};
m.oninput = draw; draw();
</script>
```
````

What a widget can rely on:

- **Theme.** Light and dark palettes follow macOS in place through `prefers-color-scheme`, retaining slider state and the existing sandbox. Use tokens for artwork; fixed-color imported assets retain their authored colors. Canvas authors should redraw on media-query changes. The document already contains the forest tokens (`--bg`, `--card`, `--sunken`, `--raised`, `--text`, `--muted`, `--faint`, `--border`, `--accent`, `--accent-soft`, `--accent-ink`, `--warm`, radii, `--sans`, `--serif`, `--mono`) plus aliases used on other Claude surfaces (`--color-background`, `--color-text-primary`, `--color-text-secondary`, `--color-border`, `--color-accent`, `--font-sans`, and so on). Plain `label`, `input[type=range]`, `button`, `button.primary`, `.grid`, `.metric`, `.panel`, `.row`, `.eyebrow`, `table` and `svg` are styled to match the app.
- **Sizing.** The frame grows and shrinks to fit the content automatically, up to the current 1400 px height limit. Do not set `height: 100vh` on `html` or `body`; let content define the height. Split long articles into focused explorations and recompose diagrams for narrow cards instead of shrinking labels.
- **Isolation.** No network, no fonts from the web, no storage, no access to the app, no navigation, no popups. Everything the widget needs must be inline. `fetch`, `localStorage`, `parent.document` and `window.recall` all fail.
- **Loading.** Nothing runs when a card opens or is revealed. The widget loads only when the reader clicks **Load interactive**. **Reset** reloads it from scratch.

When authoring in Claude, ask for "a Recall widget" and paste this file, or the two rules that matter most: use the theme variables, and keep everything inline. A complete worked example, with math, a two-mode widget and a Mermaid map in one answer, is in `examples/demo.json` in the repository checkout; the installed connection kit includes this contract's inline example instead.

### Permissions

Cards written in the app allow their widgets by default; the edit form has a checkbox to opt out. Cards that arrive through an Anki import or learning inbox have widgets **off** until you edit the card and tick **Allow this card's interactive widgets**. Inbox submissions cannot grant permission through a bundle flag or validation report. After enabling the card, choose **Load interactive** to run a widget. The main process enforces this: a widget request for a disallowed card returns 403, so the switch is not just cosmetic.

## Part two: how it works

### The boundary that shaped everything

Recall has one rule above the rest: card content never touches privileged APIs, and nothing executes when a card loads. The renderer talks to the file system through a narrow IPC bridge exposed as `window.recall`, and the IPC handler rejects any call that does not come from the main frame at `recall://app/`. Card answers are sanitized with DOMPurify before they touch the DOM. Scripts, styles, iframes and forms are stripped.

An interactive widget is, by definition, a script written by someone else. The question was never "can we run it" but "where can it run so that the rule still holds."

### Static SVG was almost free

The existing sanitizer already lets `<svg>` through, and a spike showed that `fill="var(--accent)"` resolves to the theme color inside the card. The only casualty was styling: the prose sanitizer forbids `<style>` elements and `style` attributes, which is right for imported HTML but wrong for a diagram whose labels are styled with a class.

The fix reuses a path that already existed. Mermaid output is sanitized with DOMPurify's SVG profile, which keeps `<style>` and `class` while still removing scripts and `foreignObject`. `RichContent` now lifts `<svg>` blocks out of the prose the same way it lifts Mermaid fences, runs them through that SVG profile, and hands them to the same zoomable viewer. One regular expression grew four alternatives; one viewer component gained a `label` prop.

### Widgets needed their own origin

The obvious approach, an iframe with `srcdoc`, does not work here, and the reason is worth knowing. A document loaded from `srcdoc`, `data:` or `blob:` inherits the Content Security Policy of the page that created it. The app's policy says `script-src 'self'`, so the widget's inline script would be refused. A `<meta>` CSP inside the widget cannot help either; meta policies can only tighten, never loosen.

So the widget has to be a real document with its own headers. The main process already serves the app from a custom `recall://app` origin through `protocol.handle`. It now also answers `recall://widget/<card-id>/<index>`. It loads the card from SQLite, checks `widgetsAllowed`, finds the nth fence, wraps it in a document with the theme kit and a height bridge, and returns it with a `Content-Security-Policy` header of its own:

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none';
frame-ancestors recall://app; sandbox allow-scripts
```

`'unsafe-inline'` sounds alarming until you notice what is around it. There is no `connect-src`, so `fetch` fails. There is no `frame-src`, so the widget cannot embed anything. `frame-ancestors` means only the app may embed it. The `sandbox` directive applies even if the URL were opened outside an iframe.

On the app side, the iframe carries `sandbox="allow-scripts"` and nothing else. Without `allow-same-origin` the frame gets an opaque origin, so `parent.document` throws, storage throws, and cookies do not exist. The app's own CSP relaxed exactly one directive, `frame-src 'none'` becoming `frame-src recall://widget`. Electron's preload runs only in the main frame, so `window.recall` is simply undefined inside the widget. The smoke test asserts that directly.

Two more belts for the braces: the main process refuses any sub-frame navigation away from widget URLs, and the widget response is `Cache-Control: no-store` so an edited card never shows a stale widget.

### The one message that crosses the line

The frame needs a height. The widget document ends with a small bridge script that watches its own root with `ResizeObserver` and posts `{ recallWidget: { height } }` to the parent. The host listens for messages, checks that the sender is its own iframe's `contentWindow`, reads only that one number, clamps it, and ignores everything else. No other message shape is honored in either direction. This is the whole protocol.

### The explicit click

Even a perfectly sandboxed script should not run just because a card was revealed. The product rule says explicit action, and the existing interactive labs already sit behind a disclosure. Widgets follow the same rhythm: a card shows a titled block with **Load interactive** and a one-line note about the sandbox. Only the click creates the iframe. This also keeps the review loop light; a session of forty cards does not spin up forty frames you never touched.

### Why the tokens are duplicated, and why that is safe

The widget kit lives in the main process, in `electron/widgets.cjs`, because it has to be served with the document. The renderer's tokens live in `src/tokens.css`. The packaged app ships without `src/`, so the main process cannot read the CSS at runtime. Rather than invent a build step, the token values are written twice, and a unit test parses `src/tokens.css` and fails if any value differs or if either side has a token the other lacks. Duplication with an enforced invariant is cheaper than a pipeline, and the failure mode is a red test rather than a subtly off-theme widget.

### What went wrong on the way

The first version of the smoke test tried to prove the 403 by calling `fetch("recall://widget/…")` from the app page. It failed with "Failed to fetch". That was the app's own CSP doing its job: `connect-src 'self'` does not include the widget origin. The check now runs in the main process through Electron's `net.fetch`, which exercises the real protocol handler and can also read the response's CSP header. When a security test fails, the first question is whether the failure is the security working.

## Files

- `electron/widgets.cjs`: fence parser, theme kit, CSP string, document envelope, height bridge.
- `electron/main.cjs`: the `recall://widget` route and sub-frame navigation guard.
- `electron/store.cjs`: `widgetsAllowed` on save; imports leave it unset.
- `src/RichContent.jsx`: block splitting for widgets and SVG figures; shared `SvgViewer`.
- `src/WidgetFrame.jsx`: the gate, the iframe, the height listener.
- `src/AuthorForm.jsx`: templates, permission checkbox.
- `index.html`: `frame-src recall://widget`.
- `tests/journey.test.cjs` and `scripts/smoke-public.cjs`: parsing, CSP, token sync, permission defaults, real load, interaction, blocking.
