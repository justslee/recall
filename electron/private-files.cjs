const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");

function directory(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Unsafe private directory");
  fs.chmodSync(folder, 0o700);
  return folder;
}
function write(file, data) {
  directory(path.dirname(file));
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
}
function atomicText(file, text) {
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  write(temp, text);
  try {
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
function read(file, limit = 2_000_000) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit)
      throw Error("Invalid or oversized private file");
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}
function protectTree(folder) {
  if (!fs.existsSync(folder)) return;
  const stat = fs.lstatSync(folder);
  // Existing links are preserved, never followed or chmodded.
  if (stat.isSymbolicLink()) return;
  fs.chmodSync(folder, stat.isDirectory() ? 0o700 : 0o600);
  if (stat.isDirectory())
    for (const name of fs.readdirSync(folder))
      protectTree(path.join(folder, name));
}
module.exports = { directory, write, atomicText, read, protectTree };
