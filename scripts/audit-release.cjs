const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const {
  inspectText,
  inspectFile,
  displayName,
} = require("../shared/privacy-audit.cjs");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const allowed = new Set([
  "src",
  "electron",
  "schemas",
  "shared",
  "cli",
  "skills",
  "adapters",
  "examples",
  "scripts",
  "tests",
  "docs",
  "public",
  "packaging",
  ".github",
  ".codex-plugin",
]);
const rootFiles = new Set([
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "package-lock.json",
  "vite.config.js",
  "index.html",
  ".gitignore",
  ".nvmrc",
]);
const excluded = new Set([
  "node_modules",
  "dist",
  "release",
  "evidence",
  ".git",
  ".DS_Store",
]);
const failures = [];
let count = 0,
  assets = 0,
  historyFiles = 0,
  commits = 0,
  tags = 0;
const identities = new Set(),
  tagIdentities = new Set();
const maxFile = 5 * 1024 * 1024;
function allowedName(name) {
  // Git tree paths always use '/', even when the host uses another separator.
  // A literal backslash in a root filename must not masquerade as a directory.
  return allowed.has(name.split("/")[0]) || rootFiles.has(name);
}
function report(name, categories, prefix = "") {
  for (const category of categories)
    failures.push(prefix + displayName(name) + ": " + category);
}
function scan(file, relative) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) return report(relative, ["symlink"]);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(file))
      scan(path.join(file, name), path.join(relative, name));
    return;
  }
  if (!stat.isFile()) return report(relative, ["non-regular file"]);
  if (stat.size > maxFile) return report(relative, ["oversized source file"]);

  const result = inspectFile(relative, fs.readFileSync(file));
  report(relative, result.failures);
  if (result.binary) assets++;
  else count++;
}
function git(args, category) {
  const result = spawnSync("git", args, {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    failures.push("Git history: " + category + " failed; audit incomplete");
    return null;
  }

  return result.stdout;
}
try {
  for (const name of fs.readdirSync(root)) {
    if (excluded.has(name)) continue;
    if (!allowedName(name)) {
      report(name, ["not in release allowlist"]);
      continue;
    }
    scan(path.join(root, name), name);
  }
  // Inspect every committed tree, so an unsafe name cannot disappear when a
  // byte-identical blob is renamed, and deleted private files remain visible.
  if (fs.existsSync(path.join(root, ".git"))) {
    // Ignore generated directories only when they are genuinely untracked.
    // Git includes a previously tracked file regardless of .gitignore rules.
    const tracked = git(["ls-files", "-z"], "tracked file enumeration");
    for (const name of (tracked?.toString("utf8") || "")
      .split("\0")
      .filter(Boolean)) {
      if (excluded.has(name.split("/")[0]))
        report(name, ["tracked file in excluded root"]);
    }

    const shallow = git(
      ["rev-parse", "--is-shallow-repository"],
      "history completeness check",
    );
    if (shallow && shallow.toString("utf8").trim() !== "false")
      failures.push("Git history: shallow repository; audit incomplete");

    // Tags and ref names are published alongside commits, but rev-list does
    // not expose annotated tag messages. Follow nested tags without printing
    // their message, tagger identity or a sensitive ref name.
    const checkedTags = new Set();
    function inspectTag(oid) {
      if (checkedTags.has(oid)) return;
      checkedTags.add(oid);
      const metadata = git(["cat-file", "tag", oid], "tag metadata read");
      if (!metadata) return;

      tags++;
      const text = metadata.toString("utf8");
      if (metadata.length > maxFile)
        report(
          "tag " + oid.slice(0, 12),
          ["oversized tag metadata"],
          "Git metadata: ",
        );
      report("tag " + oid.slice(0, 12), inspectText(text), "Git metadata: ");
      for (const match of text.matchAll(/^tagger (.+)$/gm))
        tagIdentities.add(match[1].replace(/ \d+ [+-]\d{4}$/, ""));

      const target = /^object ([a-f0-9]{40,64})\ntype tag\n/.exec(text);
      if (target) inspectTag(target[1]);
    }
    const refs = git(
      ["for-each-ref", "--format=%(refname)%00%(objecttype)%00%(objectname)"],
      "ref enumeration",
    );
    for (const record of (refs?.toString("utf8") || "")
      .split("\n")
      .filter(Boolean)) {
      const match = /^([^\0]+)\0([a-z]+)\0([a-f0-9]{40,64})$/.exec(record);
      if (!match) {
        failures.push("Git history: invalid ref record; audit incomplete");
        continue;
      }

      const [, name, type, oid] = match;
      report(name, inspectText(name), "Git ref: ");
      if (type === "tag") inspectTag(oid);
    }

    const revisions = git(["rev-list", "--all"], "revision enumeration");
    const checked = new Set(),
      blobs = new Map();
    for (const oid of (revisions?.toString("utf8") || "")
      .trim()
      .split("\n")
      .filter(Boolean)) {
      if (!/^[a-f0-9]{40,64}$/.test(oid)) {
        failures.push("Git history: invalid revision record; audit incomplete");
        continue;
      }
      commits++;
      const metadata = git(["cat-file", "commit", oid], "commit metadata read");
      if (metadata) {
        const text = metadata.toString("utf8");
        report(
          "commit " + oid.slice(0, 12),
          inspectText(text),
          "Git metadata: ",
        );
        for (const match of text.matchAll(/^(?:author|committer) (.+)$/gm))
          identities.add(match[1].replace(/ \d+ [+-]\d{4}$/, ""));
      }
      const tree = git(["ls-tree", "-r", "-z", oid], "tree enumeration");
      for (const record of (tree?.toString("utf8") || "")
        .split("\0")
        .filter(Boolean)) {
        const match =
          /^([0-7]{6}) (blob|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(
            record,
          );
        if (!match) {
          failures.push("Git history: invalid tree record; audit incomplete");
          continue;
        }
        const [, mode, type, blobId, name] = match;
        if (!allowedName(name))
          report(name, ["not in release allowlist"], "history: ");
        if (mode === "120000" || type !== "blob") {
          report(name, ["symlink or submodule requires review"], "history: ");
          continue;
        }
        const key = blobId + "\0" + name;
        if (checked.has(key)) continue;
        checked.add(key);
        if (!blobs.has(blobId))
          blobs.set(blobId, git(["cat-file", "blob", blobId], "blob read"));
        const data = blobs.get(blobId);
        if (!data) {
          report(name, ["unreadable blob; audit incomplete"], "history: ");
          continue;
        }
        historyFiles++;
        if (data.length > maxFile)
          report(name, ["oversized historical file"], "history: ");
        report(name, inspectFile(name, data).failures, "history: ");
      }
    }
  }
} catch {
  // Filesystem/Git errors can contain sensitive paths; keep the report bounded.
  failures.push("Source scan failed; audit incomplete");
}
console.log(
  `Git metadata reviewed: ${commits} commits, ${tags} annotated tags, ${identities.size} author/committer identities and ${tagIdentities.size} tagger identities. Names and emails withheld; manually review public attribution.`,
);
if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `PASS: ${count} source text files, ${assets} binary assets and ${historyFiles} historical file versions reviewed against release allowlist and privacy checks; image pixels and identity attribution require manual review`,
  );
}
