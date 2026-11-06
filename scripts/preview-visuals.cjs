// Builds a portable, synthetic preview using the actual widget document kit.
const fs = require("node:fs"),
  path = require("node:path");
const { widgetDocument, WIDGET_CSP } = require("../electron/widgets.cjs");
const manifest = require("../examples/visual-benchmarks/manifest.json");
const output = path.resolve(
  process.argv[2] || path.join(__dirname, "../evidence/visual-benchmarks"),
);
fs.mkdirSync(output, { recursive: true });
for (const entry of manifest.benchmarks) {
  const html = fs.readFileSync(
    path.join(__dirname, "../examples/visual-benchmarks", entry.file),
    "utf8",
  );
  const document = widgetDocument({ title: entry.title, html });
  // frame-ancestors and sandbox must be response headers; a portable file uses
  // the wrapper's sandbox plus the equivalent supported meta directives.
  const policy = WIDGET_CSP.replace(/; frame-ancestors [^;]+/, "").replace(
    /; sandbox [^;]+/,
    "",
  );
  fs.writeFileSync(
    path.join(output, entry.file),
    document.replace(
      '<meta charset="utf-8">',
      `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`,
    ),
  );
}
const { theme } = require("../shared/widget-theme.cjs");
fs.writeFileSync(
  path.join(output, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recall · Visual benchmarks</title><style>${theme}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 var(--sans)}header,main{max-width:1100px;margin:auto;padding:32px 24px}header{padding-bottom:0}header small{letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}h1{font:44px/1.1 var(--serif);letter-spacing:-.04em;margin:12px 0}header p{max-width:650px;color:var(--muted)}nav{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}a,button,select{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 13px;text-decoration:none}section{margin:0 0 36px;background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;scroll-margin:20px}.bar{padding:16px 20px;background:var(--sunken);display:flex;justify-content:space-between;gap:16px;align-items:center}.bar h2{font:22px var(--serif);margin:0}.bar p{font-size:12px;color:var(--muted);margin:5px 0 0}iframe{width:100%;border:0;display:block;min-height:680px;background:var(--card)}button{cursor:pointer;font-size:12px}:focus-visible{outline:2px solid var(--accent);outline-offset:3px}footer{color:var(--muted);font-size:12px;padding:0 24px 40px;text-align:center}@media(max-width:500px){h1{font-size:34px}.bar{align-items:flex-start;padding:14px}.bar h2{font-size:19px}main,header{padding:22px 12px}} </style>
<header><small>Recall · A clearer way to see</small><h1>Ideas you can explore.</h1><p>Three focused explorations. Change an input, follow the relationship and explain what changed. These are synthetic previews; your library and review history are untouched.</p><nav>${manifest.benchmarks.map((e) => `<a href="#${e.id}">${e.id === "yield-curve" ? "Yield curves" : e.id === "duration-gap" ? "Duration gap" : "Weak references"}</a>`).join("")}<small>Follows your device appearance</small></nav></header><main>${manifest.benchmarks.map((e) => `<section id="${e.id}"><div class="bar"><div><h2>${e.title}</h2><p>Interactive exploration · Original benchmark</p></div><button data-reset="${e.id}">Reset</button></div><iframe id="frame-${e.id}" sandbox="allow-scripts" src="${e.file}" title="${e.title}"></iframe></section>`).join("")}</main><footer>Works offline · No network, library access or review ratings</footer><script>
const frames=[...document.querySelectorAll('iframe')];
addEventListener('message',e=>{const f=frames.find(f=>f.contentWindow===e.source),m=e.data?.recallWidget;if(f&&m?.version===2&&m.instance==='legacy'&&['ready','height'].includes(m.type)&&Number.isSafeInteger(m.height)&&m.height>0&&m.height<=100000)f.style.height=Math.max(96,Math.min(1400,m.height))+'px'});
document.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>{const f=document.getElementById('frame-'+b.dataset.reset);f.src=f.getAttribute('src').split('?')[0]+'?reset='+Date.now()});
</script></html>`,
);
console.log(path.join(output, "index.html"));
