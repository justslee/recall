const fs = require("node:fs");
const path = require("node:path");
const privateFiles = require("./private-files.cjs");

function validKey(value) {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    /^sk-[A-Za-z0-9_-]{10,}$/.test(value)
  );
}

// Device-local storage deliberately avoids Keychain. Permissions, not separate
// encryption, protect this file. Never return its contents through an IPC API.
class LocalCredentials {
  constructor(folder) {
    this.folder = path.join(folder, "credentials");
    this.file = path.join(this.folder, "openai.key");
    this.legacyFile = path.join(this.folder, "openai.enc");
  }
  check(file, directory = false) {
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch (error) {
      if (error.code === "ENOENT") return false;

      throw error;
    }
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    )
      throw Error("Unsafe credential file");

    fs.chmodSync(file, directory ? 0o700 : 0o600);
    return true;
  }
  state() {
    try {
      const folder = this.check(this.folder, true);
      return {
        saved: folder && this.check(this.file),
        legacy: folder && fs.existsSync(this.legacyFile),
      };
    } catch {
      throw Error(
        "The local OpenAI connection cannot be accessed. Check this profile’s file permissions.",
      );
    }
  }
  read() {
    try {
      if (!this.state().saved) throw Error();

      const key = privateFiles.read(this.file, 2048);
      if (!validKey(key)) throw Error();

      return key;
    } catch {
      throw Error(
        "The saved OpenAI key cannot be read. Save it again in Voice settings.",
      );
    }
  }
  save(key) {
    if (typeof key !== "string" || key.length > 2048)
      throw Error("Invalid API key.");

    const value = key.trim();
    if (value && !validKey(value)) throw Error("Enter a valid OpenAI API key.");

    // Preflight before creating/replacing anything; never follow linked paths.
    this.state();
    try {
      if (value) privateFiles.atomicText(this.file, value);
      else fs.rmSync(this.file, { force: true });
    } catch {
      throw Error(
        "The OpenAI key could not be saved. Check this profile’s file permissions.",
      );
    }
    // A legacy encrypted key remains untouched until a successful replacement
    // or explicit removal. Cleanup failure must not misreport a successful save.
    // No automatic decrypt can trigger an OS dialog.
    try {
      fs.rmSync(this.legacyFile, { force: true });
      return { legacyCleanupPending: false };
    } catch {
      return { legacyCleanupPending: true };
    }
  }
}

module.exports = { LocalCredentials };
