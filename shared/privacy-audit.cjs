const path = require("node:path");
const { TextDecoder } = require("node:util");

// These checks report categories only. Never include a matching value in output.
const credential =
  /(?:\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bxox[abprs]-[A-Za-z0-9_-]{10,}\b|\bAIza[A-Za-z0-9_-]{30,}\b|\b(?:ntn_|secret_)[A-Za-z0-9_-]{20,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9.~+/=-]{16,})/i;
const inlineCredential =
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|aws[_-]?secret[_-]?access[_-]?key|password|passwd)\b["']?\s*[:=]\s*["']([A-Za-z0-9_+/=.~-]{12,})["']/i;
const environmentCredential =
  /\b(?:[A-Z][A-Z0-9]*_)*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PASSWORD|PASSWD)\s*=\s*([A-Za-z0-9_+/=.~-]{16,})(?:\s|$)/;
const personalPath =
  /\/(?:Users|home)\/[A-Za-z0-9_.-]+(?:\/|\b)|\/var\/folders\/[A-Za-z0-9_/-]+|[A-Za-z]:\\Users\\[^\s\\"']+\\/;

function privateArtifact(name) {
  const normalized = name.replaceAll("\\", "/");
  return (
    /(?:^|\/)(?:\.git|evidence|private|tasks|backups|credentials|learning-inbox|self-tests)(?:\/|$)/i.test(
      normalized,
    ) ||
    /\.(?:sqlite(?:3)?(?:-wal|-shm)?|db(?:-wal|-shm)?|apkg|anki|log|enc|bak|backup|zip|tar|tgz|gz|bz2|xz|7z|rar)$/i.test(
      normalized,
    ) ||
    /(?:^|\/)\.env(?:\.[^/]*)?$|(?:^|\/)(?:auth\.json|\.credentials\.json|config\.local\.json|learning-connections\.json|presentations\.json|legacy-trust\.json|seed\.json)$/i.test(
      normalized,
    )
  );
}

const signatures = {
  ".png": (b) =>
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  ".jpg": (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
  ".jpeg": (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
  ".gif": (b) => /^(?:GIF87a|GIF89a)$/.test(b.subarray(0, 6).toString("ascii")),
  ".webp": (b) =>
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP",
  ".icns": (b) => b.subarray(0, 4).toString("ascii") === "icns",
  ".woff": (b) => b.subarray(0, 4).toString("ascii") === "wOFF",
  ".woff2": (b) => b.subarray(0, 4).toString("ascii") === "wOF2",
  ".ttf": (b) =>
    b.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])) ||
    b.subarray(0, 4).toString("ascii") === "true",
  ".otf": (b) => b.subarray(0, 4).toString("ascii") === "OTTO",
};

function inspectText(text) {
  const failures = [];
  if (personalPath.test(text)) failures.push("personal absolute path");
  if (
    credential.test(text) ||
    inlineCredential.test(text) ||
    environmentCredential.test(text)
  )
    failures.push("possible credential");

  return failures;
}

function inspectFile(name, input) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const failures = [
    ...inspectText(name),
    ...inspectText(data.toString("utf8")),
  ];
  if (privateArtifact(name)) failures.push("private artifact type");
  if (data.subarray(0, 16).equals(Buffer.from("SQLite format 3\0")))
    failures.push("SQLite database header");

  const signature = signatures[path.extname(name).toLowerCase()];
  let binary = false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    binary = data.includes(0);
  } catch {
    binary = true;
  }
  if (signature && !signature(data))
    failures.push("invalid binary asset signature");
  else if (binary && !signature)
    failures.push("binary type requires explicit review");

  return { failures: [...new Set(failures)], binary: !!signature || binary };
}

function displayName(name) {
  // Git permits control characters in filenames. Escape them instead of letting
  // an artifact alter the report or terminal, and never print its contents.
  return JSON.stringify(
    inspectText(name).length ? "[redacted filename]" : name,
  );
}

module.exports = { inspectText, inspectFile, privateArtifact, displayName };
