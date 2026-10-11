// Inspect the actual archive, without extracting private content into the checkout.
const path = require("node:path");
const fs = require("node:fs"),
  crypto = require("node:crypto"),
  { spawnSync } = require("node:child_process");
const { inspectFile, displayName } = require("../shared/privacy-audit.cjs");
(async () => {
  const asar = await import("@electron/asar");
  const archive = path.resolve(
    process.argv[2] ||
      "release/Recall-darwin-arm64/Recall.app/Contents/Resources/app.asar",
  );
  const allowed = new Set([
    ".codex-plugin",
    ".github",
    ".gitignore",
    ".nvmrc",
    ".mailmap",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "adapters",
    "cli",
    "dist",
    "dist-native",
    "electron",
    "examples",
    "index.html",
    "node_modules",
    "package.json",
    "schemas",
    "shared",
    "skills",
    "vite.config.js",
  ]);
  const failures = [],
    entries = asar.listPackage(archive);
  let scanned = 0,
    assets = 0;
  for (const entry of entries) {
    const name = entry.replace(/^\//, "");
    if (!allowed.has(name.split("/")[0]))
      failures.push(displayName(name) + ": unexpected archive root");
    const stat = asar.statFile(archive, name, false);
    if (stat.files) continue;
    if (name.startsWith("node_modules/")) continue;
    if (name.startsWith("dist-native/")) {
      if (name !== "dist-native/RecallPadHandoff" || !stat.unpacked) {
        failures.push(displayName(name) + ": unexpected native artifact");
        continue;
      }
      const built = path.resolve(__dirname, "../dist-native/RecallPadHandoff"),
        shipped = path.join(path.dirname(archive), "app.asar.unpacked", name);
      try {
        const data = fs.readFileSync(shipped),
          source = fs.readFileSync(built),
          hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
        if (
          !data.length ||
          data.length > 5 * 1024 * 1024 ||
          hash(data) !== hash(source)
        )
          throw Error();
        const signature = spawnSync(
          "/usr/bin/codesign",
          ["--verify", "--strict", shipped],
          { encoding: "utf8" },
        );
        if (signature.status !== 0) throw Error();
        const metadata = spawnSync(
          "/usr/bin/codesign",
          ["-d", "--verbose=2", shipped],
          { encoding: "utf8" },
        );
        if (
          metadata.status !== 0 ||
          !/^Identifier=com\.recall\.pad-handoff$/m.test(metadata.stderr)
        )
          throw Error();
        for (const failure of require("../shared/privacy-audit.cjs").inspectText(
          data.toString("utf8"),
        ))
          failures.push(displayName(name) + ": " + failure);
        assets++;
      } catch {
        failures.push(
          displayName(name) +
            ": native build/signature audit failed or incomplete",
        );
      }
      continue;
    }
    if (stat.link) {
      failures.push(displayName(name) + ": first-party symlink");
      continue;
    }
    const result = inspectFile(name, asar.extractFile(archive, name));
    for (const category of result.failures)
      failures.push(displayName(name) + ": " + category);
    if (result.binary) assets++;
    else scanned++;
  }
  if (failures.length) {
    const error = Error("Packaged privacy findings");
    error.privacyFindings = failures;
    throw error;
  }
  console.log(
    `PASS packaged privacy checks: ${entries.length} archive entries, ${scanned} first-party text files and ${assets} binary assets; third-party code and image pixels not audited`,
  );
})().catch((error) => {
  // Archive access errors may contain private paths. Only print our finding list.
  console.error(
    error.privacyFindings
      ? error.privacyFindings.join("\n")
      : "Packaged privacy audit failed or is incomplete",
  );
  process.exitCode = 1;
});
