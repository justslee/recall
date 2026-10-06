const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
const { Runner } = require("../electron/runner.cjs"),
  { Store } = require("../electron/store.cjs"),
  bundles = require("../electron/bundles.cjs"),
  { exerciseHash, canRunExercise } = require("../electron/exercise-trust.cjs");
(async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-native-security-"),
  );
  let store;
  try {
    const canary = path.join(root, "outside.txt");
    fs.writeFileSync(canary, "protected canary");
    const runner = new Runner(),
      demo = structuredClone(
        require("../examples/demo.json").cards.find((c) => c.kind === "code"),
      );
    for (const language of ["python", "cpp"])
      assert.equal(
        (await runner.run(demo, language, demo.code[language].solution)).status,
        "passed",
      );
    const probe = `import os, socket, subprocess\np=${JSON.stringify(canary)}\nfor mode in ['r','w']:\n    try: open(p, mode)\n    except PermissionError: pass\n    else: raise AssertionError('outside file accessible')\ntry:\n    socket.create_connection(('127.0.0.1',9),1)\nexcept PermissionError: pass\nelse: raise AssertionError('network not denied')\nassert 'RECALL_SYNTHETIC_SECRET' not in os.environ\n# System utilities (pasteboard, LaunchServices, shells) must not run from card code.\nfor cmd in (['/usr/bin/pbpaste'], ['/usr/bin/open', '--help'], ['/bin/sh', '-c', 'true'], ['/usr/bin/true']):\n    try: subprocess.run(cmd, capture_output=True, timeout=5)\n    except OSError: pass\n    else: raise AssertionError('execution escaped: ' + cmd[0])\ntry: os.fork()\nexcept OSError: pass\nelse: raise AssertionError('fork allowed')\nprint('file, network, execution and fork boundaries held')`;
    process.env.RECALL_SYNTHETIC_SECRET = "unrelated fixture";
    const result = await runner.run(
      { kind: "code", code: { python: { harness: "" } } },
      "python",
      probe,
    );
    delete process.env.RECALL_SYNTHETIC_SECRET;
    assert.equal(result.status, "passed", result.output);
    assert.equal(fs.readFileSync(canary, "utf8"), "protected canary");
    // Compiled programs get the same run-phase policy: no children, no utilities.
    const cppProbe = await runner.run(
      { kind: "code", code: { cpp: { harness: "" } } },
      "cpp",
      `#include <unistd.h>\n#include <cstdio>\n#include <cstdlib>\nint main(){ pid_t p = fork(); if (p == 0) _exit(0); if (p > 0) { std::puts("fork allowed"); return 1; } if (system("/usr/bin/true") == 0) { std::puts("system allowed"); return 1; } std::puts("fork and exec denied"); return 0; }`,
    );
    assert.equal(cppProbe.status, "passed", cppProbe.output);
    assert.match(cppProbe.output, /fork and exec denied/);
    store = new Store(path.join(root, "profile"));
    const bad = {
      ...demo,
      id: "unvalidated",
      code: {
        python: {
          stub: "raise NotImplementedError",
          solution: "raise AssertionError('failed reference')",
          harness: "print('not reached')",
        },
      },
    };
    store.import([bad]);
    const report = {
      version: 1,
      validatedAt: "claimed",
      exercises: [
        {
          id: bad.id,
          sha256: exerciseHash(bad),
          languages: {
            python: {
              reference: "passed",
              stub: "failed",
              rejectedMutants: ["claimed"],
            },
          },
        },
      ],
    };
    await assert.rejects(
      () => bundles.reviewCode(store, bad.id, report),
      /reference validation failed/,
    );
    assert(!canRunExercise(bad, (k) => store.get(k)));
    store.import([demo]);
    await bundles.reviewCode(
      store,
      demo.id,
      require("../examples/validation.json"),
    );
    assert(canRunExercise(demo, (k) => store.get(k)));

    const sandbox = require("../electron/process-sandbox.cjs");
    const stage = path.join(root, "provider-job");
    fs.mkdirSync(stage);
    const python = runner.tool("python3"),
      // Match Runner's selected-tool runtime scope. Hosted Macs may select a
      // versioned Xcode bundle instead of Command Line Tools in /Library.
      runtimeDirectory = path.dirname(path.dirname(path.dirname(python)));
    assert.notEqual(
      runtimeDirectory,
      path.parse(runtimeDirectory).root,
      "The selected Python tool must not grant a filesystem-root scope",
    );
    const policy = sandbox.command(
      python,
      [
        "-I",
        "-c",
        `from pathlib import Path\ntry: Path(${JSON.stringify(canary)}).read_text()\nexcept PermissionError: print('outside read blocked')\nelse: raise AssertionError('outside read succeeded')`,
      ],
      {
        directory: stage,
        network: true,
        readDirectories: [runtimeDirectory],
        executionDirectories: [runtimeDirectory],
      },
    );
    const child = spawnSync(policy.binary, policy.args, {
      cwd: stage,
      encoding: "utf8",
      timeout: 10000,
      env: { PATH: "/usr/bin:/bin", HOME: stage, TMPDIR: stage },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /outside read blocked/);
    console.log(
      "PASS Python/C++ execution, blocked outside reads/writes, network, system utilities and forking, minimal environment, rejected false validation, explicit local trust, provider filesystem boundary",
    );
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
