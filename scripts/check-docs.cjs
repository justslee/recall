// Fast, offline documentation checks. No personal profile or network access.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const files = [];
function collect(folder) {
  for (const name of fs.readdirSync(folder)) {
    const file = path.join(folder, name);
    if (fs.statSync(file).isDirectory()) collect(file);
    else if (name.endsWith(".md")) files.push(file);
  }
}
collect(path.join(root, "docs"));
for (const name of [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "AGENTS.md",
])
  files.push(path.join(root, name));
const outsideCode = (text) =>
  text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
function anchors(file) {
  const text = outsideCode(fs.readFileSync(file, "utf8"));
  const result = new Set(),
    seen = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const plain = match[1]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+#+\s*$/, "");
    const slug = plain
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(slug) || 0;
    seen.set(slug, count + 1);
    result.add(slug + (count ? "-" + count : ""));
  }
  for (const match of text.matchAll(
    /<(?:a|[a-z]+)\b[^>]*\bid=["']([^"']+)["']/g,
  ))
    result.add(match[1]);
  return result;
}
const failures = [],
  cache = new Map();
let links = 0,
  images = 0;
function check(file, target, image) {
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) return;
  links++;
  if (image) images++;
  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    failures.push([file, target, "invalid URL encoding"]);
    return;
  }
  const [name, fragment] = decoded.split("#");
  const destination = name
    ? path.resolve(path.dirname(file), name.split("?")[0])
    : file;
  if (destination !== root && !destination.startsWith(root + path.sep)) {
    failures.push([file, target, "local link leaves public repository"]);
    return;
  }
  if (!fs.existsSync(destination)) {
    failures.push([file, target, "missing file"]);
    return;
  }
  if (image && !fs.statSync(destination).isFile()) {
    failures.push([file, target, "image is not a file"]);
    return;
  }
  if (fragment && destination.endsWith(".md")) {
    if (!cache.has(destination)) cache.set(destination, anchors(destination));
    if (!cache.get(destination).has(fragment))
      failures.push([file, target, "missing heading or anchor"]);
  }
}
for (const file of files) {
  const text = outsideCode(fs.readFileSync(file, "utf8"));
  for (const match of text.matchAll(
    /(!?)\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g,
  ))
    check(file, match[2].replace(/^<|>$/g, ""), !!match[1]);
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/g))
    check(file, match[1], true);
}
if (failures.length) {
  for (const [file, target, reason] of failures)
    console.error(`${path.relative(root, file)}: ${reason}: ${target}`);
  process.exitCode = 1;
} else
  console.log(
    `PASS documentation: ${files.length} Markdown files, ${links} local links/anchors, ${images} image references`,
  );
