const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
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
]);
const excluded = new Set([
  "node_modules",
  "dist",
  "release",
  "evidence",
  ".git",
]);
const failures = [];
let count = 0;
function scan(file, relative) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    failures.push(relative + ": symlink");
    return;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(file))
      scan(path.join(file, name), path.join(relative, name));
    return;
  }
  if (
    /\.(sqlite(?:-wal|-shm)?|apkg|anki|log)$|(?:^|\/)\.env|(?:^|\/)(config\.local\.json|presentations\.json|legacy-trust\.json|seed\.json)$/.test(
      relative,
    )
  )
    failures.push(relative + ": private artifact type");
  if (stat.size > 5 * 1024 * 1024)
    failures.push(relative + ": oversized source file");
  if (/\.(?:png|jpg|jpeg|woff2?|webp)$/.test(relative)) return;
  const text = fs.readFileSync(file, "utf8");
  if (/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(text))
    failures.push(relative + ": personal absolute path");
  if (
    /(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)/.test(
      text,
    )
  )
    failures.push(relative + ": possible credential");
  count++;
}
for (const name of fs.readdirSync(root)) {
  if (excluded.has(name)) continue;
  if (!allowed.has(name) && !rootFiles.has(name)) {
    failures.push(name + ": not in release allowlist");
    continue;
  }
  scan(path.join(root, name), name);
}
// Check reachable committed files too; deleted private content must not hide in history.
if (fs.existsSync(path.join(root, ".git"))) {
  const history = spawnSync("git", ["rev-list", "--objects", "--all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (history.status === 0)
    for (const line of history.stdout.trim().split("\n").filter(Boolean)) {
      const [oid, ...parts] = line.split(" ");
      const name = parts.join(" ");
      if (!name) continue;
      if (
        /(?:^|\/)(?:tasks|private|evidence)\/|\.(?:sqlite|apkg|anki)$/.test(
          name,
        )
      )
        failures.push("history: " + name);
      const type = spawnSync("git", ["cat-file", "-t", oid], {
        cwd: root,
        encoding: "utf8",
      });
      if (type.stdout.trim() === "blob") {
        const blob = spawnSync("git", ["cat-file", "blob", oid], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        if (/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(blob.stdout))
          failures.push("history personal path: " + name);
      }
    }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `PASS: ${count} source files reviewed against release allowlist and privacy checks`,
  );
