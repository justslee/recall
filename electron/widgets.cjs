// Interactive widgets are fenced ```widget blocks inside a card answer. Each one
// runs in a sandboxed iframe served from recall://widget with its own strict CSP.
// This module owns the fence grammar, the forest theme kit and the document
// envelope, so the renderer never touches widget markup directly.

const FENCE = /```widget[^\S\n]*([^\n]*)\r?\n([\s\S]*?)```/g;

/** Every widget in an answer, in document order. */
function widgetsOf(answer) {
  const widgets = [];
  for (const match of String(answer || "").matchAll(FENCE))
    widgets.push({
      title: match[1].trim() || "Interactive widget",
      html: match[2],
    });
  return widgets;
}

// The app build and isolated frame share the packaged canonical palette.
const { theme, tokens, lightTokens } = require("../shared/widget-theme.cjs");
const {
  installVisualRuntime,
  installWidgetBridge,
} = require("../shared/widget-runtime.cjs");

const kit = `${theme}
/* Aliases so widgets written for other Claude surfaces pick up the theme. */
:root{--foreground:var(--text);--primary:var(--accent);--background:var(--card);--muted-foreground:var(--muted);--color-background:var(--card);--color-surface:var(--sunken);--color-surface-raised:var(--raised);--color-text:var(--text);--color-text-primary:var(--text);--color-text-secondary:var(--muted);--color-text-tertiary:var(--faint);--color-border:var(--border);--color-accent:var(--accent);--color-accent-foreground:var(--accent-ink);--color-warning:var(--warm);--font-sans:var(--sans);--font-serif:var(--serif);--font-mono:var(--mono)}
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light dark;height:auto}
body{margin:0;padding:18px 20px;background:var(--card);color:var(--text);font:14px/1.6 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden;height:auto}
::selection{background:var(--selection);color:var(--text)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
h1,h2,h3{margin:0 0 .4em;font-family:var(--serif);font-weight:400;letter-spacing:-.02em;line-height:1.25}
h1{font-size:24px}h2{font-size:20px}h3{font-size:17px}
p{margin:.5em 0;line-height:1.7}
small,.muted{color:var(--muted);font-size:12px}
.eyebrow{display:inline-block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:600}
strong,b{font-weight:600}
a{color:var(--accent)}
code,kbd,pre{font-family:var(--mono);font-size:.92em}
pre{background:var(--sunken);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;white-space:pre-wrap}
label{display:block;color:var(--muted);font-size:12px;margin:10px 0;line-height:1.5}
label strong,label b{color:var(--text)}
label input[type=range],label select,label textarea,label input:not([type=range]):not([type=checkbox]):not([type=radio]){display:block;width:100%;margin-top:6px}
input[type=range]{width:100%;accent-color:var(--accent);margin:4px 0}
input[type=checkbox],input[type=radio]{accent-color:var(--accent)}
input:not([type=range]):not([type=checkbox]):not([type=radio]),select,textarea{background:var(--sunken);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;font:inherit}
button{cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:var(--raised);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 12px;font:inherit;font-size:13px}
button:hover{border-color:var(--border-strong)}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
.row{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:12px 0}
.metric{padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--sunken)}
.metric small{display:block}
.metric strong{display:block;font:24px var(--serif);margin-top:6px;font-variant-numeric:tabular-nums}
.panel{border:1px solid var(--border);border-radius:var(--radius);background:var(--sunken);padding:14px 16px}
table{border-collapse:collapse;font-size:13px}td,th{border:1px solid var(--border);padding:6px 10px;text-align:left}
svg{max-width:100%;height:auto;display:block}
svg text:not([fill]){fill:var(--text)}
svg text:not([font-family]){font-family:var(--sans)}`;

// No network, no navigation targets, no embedding except by the app. The
// sandbox directive holds even if the URL were ever opened outside an iframe.
const WIDGET_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'; frame-ancestors recall://app; sandbox allow-scripts";

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function widgetDocument({ title, html }, { instance = "legacy" } = {}) {
  if (typeof instance !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(instance))
    throw Error("Invalid widget instance.");

  // Trusted helpers and diagnostics install before authored scripts. No eval,
  // external module loading, host bridge, or storage capability is introduced.
  const runtime = `(${installVisualRuntime.toString()})();(${installWidgetBridge.toString()})(${JSON.stringify(instance)});`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${kit}</style><script>${runtime}</script></head><body>${html}</body></html>`;
}

module.exports = {
  widgetsOf,
  widgetDocument,
  WIDGET_CSP,
  tokens,
  lightTokens,
  kit,
};
