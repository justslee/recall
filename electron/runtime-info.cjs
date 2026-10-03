const path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  { Runner } = require("./runner.cjs");

function diagnostics(folder, { runner, execute = spawnSync } = {}) {
  runner ||= new Runner({
    scientificPython: path.join(folder, "python/bin/python3"),
  });

  function probe(resolve) {
    let executable;
    try {
      executable = resolve();
      const result = execute(executable, ["--version"], {
        encoding: "utf8",
        timeout: 10000,
        env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
      });
      return {
        available: result.status === 0,
        path: executable,
        version: (result.stdout || result.stderr || "Not available").split(
          "\n",
        )[0],
        ...(result.status === 0
          ? {}
          : { error: result.error?.message || "Runtime version check failed" }),
      };
    } catch (error) {
      return {
        available: false,
        ...(executable ? { path: executable } : {}),
        error: error.message,
      };
    }
  }

  return {
    python3: probe(() => runner.tool("python3")),
    "clang++": probe(() => runner.tool("clang++")),
    "scientific-python": {
      ...probe(() => runner.scientificPythonPath()),
      configuredPath: path.join(folder, "python/bin/python3"),
      dependenciesChecked: false,
    },
  };
}

module.exports = { diagnostics };
