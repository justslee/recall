// Electron's fs.cpSync does not traverse ASAR directories. Use the patched read APIs.
const fs = require("node:fs"),
  path = require("node:path");
function copyTree(source, target) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink())
    throw Error("Refusing a symbolic link in copied resources");
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
    throw Error("Unsafe resource destination");
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source))
      copyTree(path.join(source, name), path.join(target, name));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(
      target,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_TRUNC |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.writeFileSync(fd, fs.readFileSync(source));
    } finally {
      fs.closeSync(fd);
    }
  }
}
module.exports = { copyTree };
