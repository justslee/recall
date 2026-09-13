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

// Keep in sync with src/tokens.css. tests/core.test.cjs fails if they drift.
const tokens = {
  "--bg": "#111915",
  "--bg-deep": "#151f19",
  "--sunken": "#17221c",
  "--card": "#1a2520",
  "--raised": "#24312a",
  "--text": "#e8eee6",
  "--muted": "#acb9ad",
  "--faint": "#8c9e8f",
  "--border": "#2c3b31",
  "--border-strong": "#536957",
  "--accent": "#b6d2aa",
  "--accent-strong": "#c9dfbf",
  "--accent-soft": "#2a3d2e",
  "--accent-ink": "#19291b",
  "--warm": "#e4b98b",
  "--warm-bg": "#382e24",
  "--warm-border": "#83674b",
  "--editor": "#18231e",
  "--selection": "#405841",
  "--glass": "#1c2a21e8",
  "--sheen": "#e2f0d70b",
  "--radius-sm": "10px",
  "--radius": "16px",
  "--radius-lg": "22px",
  "--shadow": "0 16px 48px -30px #02080380",
  "--fast": "0.15s",
  "--ease": "cubic-bezier(0.2, 0.7, 0.2, 1)",
  "--sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "--serif": '"New York", Georgia, "Times New Roman", serif',
  "--mono": '"SF Mono", Menlo, monospace',
  "--titlebar": "52px",
  "--sidebar": "220px",
};
const lightTokens = {
  "--bg": "#f3f4ed",
  "--bg-deep": "#e9eee5",
  "--sunken": "#edf1e8",
  "--card": "#fcfcf7",
  "--raised": "#e3eadc",
  "--text": "#26382d",
  "--muted": "#526657",
  "--faint": "#5f7162",
  "--border": "#d6dfd0",
  "--border-strong": "#8da184",
  "--accent": "#446a43",
  "--accent-strong": "#30552f",
  "--accent-soft": "#dfead7",
  "--accent-ink": "#ffffff",
  "--warm": "#8c5529",
  "--warm-bg": "#f4e8d9",
  "--warm-border": "#c0976b",
  "--editor": "#f7f8ef",
  "--selection": "#d3e2c8",
  "--glass": "#eff3e9ed",
  "--sheen": "#ffffffb3",
  "--shadow": "0 18px 46px -30px #3b553b33",
};

const kit = `:root{${Object.entries(tokens)
  .map(([k, v]) => `${k}:${v}`)
  .join(";")}}
@media (prefers-color-scheme:light){:root{${Object.entries(lightTokens)
  .map(([k, v]) => `${k}:${v}`)
  .join(";")}}}
/* Aliases so widgets written for other Claude surfaces pick up the theme. */
:root{--color-background:var(--card);--color-surface:var(--sunken);--color-surface-raised:var(--raised);--color-text:var(--text);--color-text-primary:var(--text);--color-text-secondary:var(--muted);--color-text-tertiary:var(--faint);--color-border:var(--border);--color-accent:var(--accent);--color-accent-foreground:var(--accent-ink);--color-warning:var(--warm);--font-sans:var(--sans);--font-serif:var(--serif);--font-mono:var(--mono)}
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

// Reports content height to the host so the frame can size itself. Nothing else
// crosses the boundary; the host ignores any other message shape.
const bridge = `(() => {
  const root = document.documentElement;
  let last = 0;
  const send = () => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height !== last) {
      last = height;
      parent.postMessage({ recallWidget: { height } }, "*");
    }
  };
  new ResizeObserver(send).observe(root);
  addEventListener("load", send);
  send();
})();`;

// No network, no navigation targets, no embedding except by the app. The
// sandbox directive holds even if the URL were ever opened outside an iframe.
const WIDGET_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'; frame-ancestors recall://app; sandbox allow-scripts";

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function widgetDocument({ title, html }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${kit}</style></head><body>${html}<script>${bridge}</script></body></html>`;
}

module.exports = {
  widgetsOf,
  widgetDocument,
  WIDGET_CSP,
  tokens,
  lightTokens,
  kit,
};
