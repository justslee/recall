const fs = require("node:fs"),
  path = require("node:path");
const quote = (s) => JSON.stringify(String(s));
const rule = (kind, paths) =>
  paths
    .filter(fs.existsSync)
    .map((p) => `(${kind} ${quote(fs.realpathSync(p))})`)
    .join(" ");
function command(
  binary,
  args,
  {
    directory,
    read = [],
    readDirectories = [],
    write = [],
    network = false,
    executables = [],
    executionDirectories = [],
    // Forking lets a program spawn children; compilers need it, card code
    // does not. Mach lookups reach LaunchServices, the pasteboard and other
    // system services, so they stay denied unless a caller needs them.
    fork = true,
    machLookup = false,
  } = {},
) {
  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec"))
    throw Error(
      "Restricted execution requires the supported macOS sandbox; no unrestricted fallback is used",
    );
  const work = fs.realpathSync(directory);
  const system = [
    "/System",
    "/usr/bin",
    "/usr/lib",
    "/usr/share",
    "/bin",
    "/sbin",
    "/Library/Apple",
    "/Library/Developer",
    "/private/etc",
    "/private/var/db",
    "/dev",
  ];
  const policy = `(version 1)
(deny default)
${fork ? "(allow process-fork)" : ""}
(allow signal (target self))
(allow process-info* sysctl-read${machLookup ? " mach-lookup" : ""})
(allow file-read-metadata)
(allow file-read* (literal "/") ${rule("subpath", [...system, work, ...readDirectories])} ${rule("literal", read)})
(allow file-write* (subpath ${quote(work)}) ${rule("literal", write)} (literal "/dev/null") (literal "/dev/tty"))
(allow process-exec ${rule("literal", [binary, ...executables])} ${rule("subpath", executionDirectories)} (subpath ${quote(work)}))
${network ? "(allow network-outbound)" : ""}`;
  return {
    binary: "/usr/bin/sandbox-exec",
    args: ["-p", policy, binary, ...args],
    policy,
  };
}
module.exports = { command };
