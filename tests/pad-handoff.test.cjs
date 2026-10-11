const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  { EventEmitter } = require("node:events"),
  { PassThrough, Writable } = require("node:stream");
const {
  createPadHandoff,
  safeEnvironment,
  resolveHelper,
} = require("../electron/pad-handoff.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-pad-discovery-")),
    helperPath = path.join(root, "fixture-helper");
  fs.writeFileSync(helperPath, "fixture", { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, helperPath };
}

function mockNative(handler = () => ({})) {
  const calls = [],
    children = [];
  return {
    calls,
    children,
    spawnImpl(binary, args, options) {
      assert.equal(options.shell, false);
      assert.deepEqual(args, []);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({
        write(bytes, encoding, done) {
          const request = JSON.parse(bytes.toString());
          calls.push(request);
          const result = handler(request, child);
          if (result !== undefined)
            queueMicrotask(() =>
              child.stdout.write(
                JSON.stringify({ id: request.id, ok: true, result }) + "\n",
              ),
            );
          done();
        },
      });
      child.killed = false;
      child.kill = () => {
        child.killed = true;
      };
      children.push(child);
      return child;
    },
  };
}

test("native discovery is optional and exposes no draft or permission API", async (t) => {
  const fixtureValue = fixture(t),
    mock = mockNative(() => ({
      available: true,
      advertising: false,
      trusted: true,
      armed: { target: "codex" },
      accessibility: "granted",
    })),
    helper = createPadHandoff({ ...fixtureValue, ...mock, platform: "darwin" });
  t.after(() => helper.dispose());
  assert.deepEqual(await helper.status(), {
    available: true,
    advertising: false,
  });
  assert.deepEqual(
    mock.calls.map((r) => r.command),
    ["status"],
  );
  assert.equal(mock.calls[0].version, 1);
  for (const method of [
    "requestAccessibility",
    "arm",
    "paste",
    "disarm",
    "copy",
  ])
    assert.equal(helper[method], undefined);
  assert.deepEqual(await createPadHandoff({ platform: "linux" }).status(), {
    available: false,
    advertising: false,
  });
});

test("only bounded Bonjour requests and sanitized discovery events cross native IPC", async (t) => {
  const fixtureValue = fixture(t),
    events = [],
    mock = mockNative((request, child) => {
      child.stdout.write(
        JSON.stringify({
          event: "bonjour",
          state: "advertising",
          secret: "private-details",
        }) + "\n",
      );
      child.stdout.write(
        JSON.stringify({ event: "disarmed", reason: "mac-asleep" }) + "\n",
      );
      child.stdout.write(
        JSON.stringify({ event: "unknown", secret: "private-details" }) + "\n",
      );
      return {
        state: request.command === "advertise" ? "starting" : "stopped",
        path: "/private/image.png",
        pages: 1,
        copiedPage: 0,
      };
    }),
    helper = createPadHandoff({
      ...fixtureValue,
      ...mock,
      platform: "darwin",
      onEvent: (event) => events.push(event),
    });
  t.after(() => helper.dispose());
  const advertisement = { port: 43210, installationId: "fixture-installation" };
  assert.deepEqual(await helper.advertise(advertisement), {
    state: "starting",
  });
  assert.deepEqual(mock.calls[0].args, advertisement);
  assert.deepEqual(events, [{ event: "bonjour", state: "advertising" }]);
  assert.deepEqual(await helper.stopAdvertising(), { state: "stopped" });
  for (const invalid of [
    { port: 80, installationId: "example" },
    { port: 65536, installationId: "example" },
    { port: 43210, installationId: "secret\nvalue" },
    { port: 43210, installationId: "a".repeat(129) },
  ])
    await assert.rejects(helper.advertise(invalid), /Invalid/);
  assert.equal(mock.calls.length, 2);
});

test("a stalled or malformed discovery helper fails without exposing raw diagnostics", async (t) => {
  const fixtureValue = fixture(t),
    mock = mockNative(() => undefined),
    helper = createPadHandoff({
      ...fixtureValue,
      ...mock,
      platform: "darwin",
      timeoutMs: 50,
    });
  t.after(() => helper.dispose());
  await assert.rejects(
    helper.advertise({ port: 43210, installationId: "fixture" }),
    /stopped/,
  );
  assert.equal(mock.children[0].killed, true);
  const broken = mockNative((request, child) => {
    queueMicrotask(() => child.stdout.write("private malformed payload\n"));
  });
  const second = createPadHandoff({
    ...fixtureValue,
    ...broken,
    platform: "darwin",
  });
  t.after(() => second.dispose());
  assert.deepEqual(await second.status(), {
    available: false,
    advertising: false,
  });
  assert.equal(broken.children[0].killed, true);
});

test("the helper environment has no API credentials or code injection options", () => {
  assert.deepEqual(
    safeEnvironment({
      HOME: "/synthetic/home",
      USER: "fixture",
      PATH: "/bad/path",
      OPENAI_API_KEY: "secret",
      NODE_OPTIONS: "--require=malicious",
      DYLD_INSERT_LIBRARIES: "/bad/lib",
      TMPDIR: "/tmp/fixture",
    }),
    {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
      HOME: "/synthetic/home",
      TMPDIR: "/tmp/fixture",
      USER: "fixture",
    },
  );
});

test("native source has no Accessibility, clipboard, synthesized-input or chat-destination implementation", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "../native/mac-handoff/Sources/RecallPadHandoff/main.swift",
    ),
    "utf8",
  );
  for (const forbidden of [
    "AXUIElement",
    "AXIsProcessTrusted",
    "CGEvent",
    "NSPasteboard",
    "NSAppleScript",
    "frontmostApplication",
    "com.openai",
    'case "arm"',
    'case "paste"',
    'case "requestAccessibility"',
  ])
    assert(!source.includes(forbidden), forbidden);
  assert(source.includes('case "advertise"'));
  assert(source.includes('case "stopAdvertising"'));
  assert(source.includes("HandoffPolicy.commands.contains(command)"));
  const buildSource = fs.readFileSync(
    path.join(__dirname, "../scripts/build-pad-helper.cjs"),
    "utf8",
  );
  assert(buildSource.includes('"-sectcreate"'));
  assert(buildSource.includes('"__info_plist"'));
});
