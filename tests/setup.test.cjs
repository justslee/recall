const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { requirements, main } = require("../scripts/setup.cjs");
test("setup gives an actionable prerequisite failure before installing anything", () => {
  assert.equal(
    requirements({ version: "22.18.0", platform: "darwin", arch: "arm64" })
      .length,
    0,
  );
  assert.match(
    requirements({ version: "22.17.0", platform: "darwin", arch: "arm64" })[0],
    /Install Node/,
  );
  assert.match(
    requirements({ version: "24.0.0", platform: "linux", arch: "x64" })[0],
    /Other platforms/,
  );
  assert.match(
    requirements({
      version: "22.18.0",
      platform: "darwin",
      arch: "arm64",
      release: "21.6.0",
    })[0],
    /macOS 13 Ventura/,
  );
  assert.equal(
    requirements({
      version: "22.18.0",
      platform: "darwin",
      arch: "arm64",
      release: "22.0.0",
    }).length,
    0,
  );
});
test("setup check and help do not install, while no-launch builds without opening a profile", () => {
  const calls = [],
    run = (exe, args) => {
      calls.push(args);
      return { status: 0 };
    },
    log = () => {},
    environment = { npm_execpath: __filename };
  main(["--help"], { run, log, environment });
  main(["--check"], { run, log, environment });
  assert.equal(calls.length, 0);
  main(["--no-launch"], { run, log, environment });
  assert.deepEqual(
    calls.filter((a) => a[0] === __filename).map((a) => a.slice(1)),
    [["ci"], ["run", "build"]],
  );
  assert.equal(calls.length, 3);
  assert.match(calls[1][0], /node_modules\/electron\/install\.js$/);
});
test("setup stops when the locked desktop runtime cannot be downloaded", () => {
  const calls = [];
  assert.throws(
    () =>
      main(["--no-launch"], {
        run: (_exe, args) => {
          calls.push(args);
          return { status: calls.length === 2 ? 1 : 0 };
        },
        log: () => {},
        environment: { npm_execpath: __filename },
      }),
    /Download the locked desktop runtime did not finish/,
  );
  assert.equal(calls.length, 2);
});
test("setup stops after an installation failure rather than launching a broken app", () => {
  let calls = 0;
  assert.throws(
    () =>
      main([], {
        run: () => {
          calls++;
          return { status: 1 };
        },
        log: () => {},
        environment: { npm_execpath: __filename },
      }),
    /Resolve the error above/,
  );
  assert.equal(calls, 1);
});
