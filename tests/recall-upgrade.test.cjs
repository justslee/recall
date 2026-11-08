const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const { spawnSync } = require("node:child_process");
const helper = path.resolve(
  __dirname,
  "../skills/recall-upgrade/scripts/upgrade.cjs",
);
const { upgrade, compareVersions, chooseRelease, parseArgs } = require(helper);
const mac = require("../skills/recall-upgrade/scripts/mac-release.cjs");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function fixture(t, options = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "recall-upgrade-test-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "Applications/Recall.app");
  const source = path.join(root, "download/Recall.app");
  const profile = path.join(root, "learning-profile");
  fs.mkdirSync(profile);
  fs.writeFileSync(
    path.join(profile, "recall.sqlite"),
    "preserve cards, schedules and reviews",
  );
  fs.writeFileSync(
    path.join(profile, "notes.md"),
    "preserve all learning notes",
  );
  const original = {
    version: "0.1.0-beta.1",
    build: 1,
    team: "SYNTHETIC1",
    notarized: true,
    ...options.original,
  };
  const next = {
    version: "0.2.0-beta.1",
    build: 2,
    team: "SYNTHETIC1",
    notarized: true,
    ...options.next,
  };
  for (const [folder, info] of [
    [app, original],
    [source, next],
  ]) {
    fs.mkdirSync(path.join(folder, "Contents"), { recursive: true });
    fs.writeFileSync(
      path.join(folder, "Contents/Info.plist"),
      JSON.stringify(info),
    );
    fs.writeFileSync(
      path.join(folder, "Contents/code.bin"),
      "synthetic app " + info.version + " " + info.build,
    );
  }
  const zip = new AdmZip();
  zip.addLocalFolder(source, "Recall.app");
  const bytes = zip.toBuffer();
  const name = `Recall-${next.version}-macos-arm64.zip`;
  const asset = {
    name,
    state: "uploaded",
    size: bytes.length,
    digest: "sha256:" + hash(bytes),
    browser_download_url: `https://github.com/justslee/recall/releases/download/v${next.version}/${name}`,
  };
  const release = {
    tag_name: "v" + next.version,
    published_at: "2026-11-07T00:00:00Z",
    draft: false,
    prerelease: next.version.includes("-"),
    assets: [asset],
  };
  const inspect = (folder, { notarized = false } = {}) => {
    const info = JSON.parse(
      fs.readFileSync(path.join(folder, "Contents/Info.plist")),
    );
    if (notarized && !info.notarized)
      throw Error("synthetic failed notarization");
    return { ...info, identity: mac.hashApp(folder) };
  };
  const calls = { quit: 0, launched: 0, downloads: 0 };
  const fetchImpl = async (url) => {
    if (
      url.startsWith("https://api.github.com/repos/justslee/recall/releases?")
    )
      return new Response(JSON.stringify([release]));
    assert.equal(url, asset.browser_download_url);
    calls.downloads++;
    return new Response(bytes);
  };
  const run = (command, args) => {
    assert.equal(command, "/usr/bin/ditto");
    assert.deepEqual(args.slice(0, 2), ["-x", "-k"]);
    new AdmZip(args[2]).extractAllTo(args[3]);
    return { stdout: "", stderr: "" };
  };
  const execute = (extra = {}) =>
    upgrade({
      app,
      platform: "darwin",
      arch: "arm64",
      fetchImpl,
      run,
      inspect,
      quitApp: async () => {
        calls.quit++;
      },
      active: () => false,
      launch: async () => {
        calls.launched++;
      },
      ...extra,
    });
  return {
    root,
    app,
    source,
    profile,
    original,
    next,
    release,
    asset,
    bytes,
    inspect,
    calls,
    fetchImpl,
    run,
    execute,
    state: path.join(root, "Applications/.recall-upgrade-Recall"),
  };
}

test("Versions follow semantic prerelease ordering and the installed channel", () => {
  assert(compareVersions("0.6.0-beta.10", "0.6.0-beta.9") > 0);
  assert(compareVersions("1.0.0", "1.0.0-rc.1") > 0);
  assert(compareVersions("2.0.0-beta.1", "1.9.9") > 0);
  assert.equal(compareVersions("v1.0.0+build.1", "1.0.0+build.2"), 0);
  assert.throws(() => compareVersions("1.0.0-beta.01", "1.0.0"));
  const base = { published_at: "2026-11-07", draft: false };
  const list = [
    { ...base, tag_name: "v1.0.0", prerelease: false },
    { ...base, tag_name: "v1.1.0-beta.1", prerelease: true },
    { ...base, tag_name: "v2.0.0", draft: true },
  ];
  assert.equal(chooseRelease(list, "1.0.0").tag_name, "v1.0.0");
  assert.equal(chooseRelease(list, "1.0.0-beta.1").tag_name, "v1.1.0-beta.1");
});

test("A public version check is read-only and avoids downloading an available update", async (t) => {
  const f = fixture(t);
  const before = mac.hashApp(f.profile);
  const result = await f.execute();
  assert.equal(result.status, "update_available");
  assert.equal(f.calls.downloads, 0);
  assert.equal(f.calls.quit, 0);
  assert(!fs.existsSync(f.state));
  assert.equal(mac.hashApp(f.profile), before);
});

test("An upgrade verifies the download, replaces the app and keeps one rollback without touching learning", async (t) => {
  const f = fixture(t);
  const before = mac.hashApp(f.profile);
  const result = await f.execute({ apply: true });
  assert.equal(result.status, "upgraded");
  assert.equal(f.inspect(f.app).version, f.next.version);
  assert.equal(
    f.inspect(path.join(f.state, "rollback.app")).version,
    f.original.version,
  );
  assert.equal(f.calls.quit, 1);
  assert.equal(f.calls.launched, 1);
  assert.equal(mac.hashApp(f.profile), before);
  assert(!fs.existsSync(path.join(f.state, "transaction.json")));
  assert(!fs.readdirSync(f.state).some((name) => name.startsWith("work-")));
  const second = await f.execute({ apply: true });
  assert.equal(second.status, "up_to_date");
  assert.equal(f.calls.downloads, 1);
  assert.equal(f.calls.quit, 1);
});

test("A later upgrade rotates the previous app and retires the older rollback", async (t) => {
  const f = fixture(t);
  await f.execute({ apply: true });
  f.next.version = "0.3.0-beta.1";
  f.next.build = 3;
  fs.writeFileSync(
    path.join(f.source, "Contents/Info.plist"),
    JSON.stringify(f.next),
  );
  const zip = new AdmZip();
  zip.addLocalFolder(f.source, "Recall.app");
  const bytes = zip.toBuffer();
  const name = `Recall-${f.next.version}-macos-arm64.zip`;
  const release = {
    ...f.release,
    tag_name: "v" + f.next.version,
    assets: [
      {
        ...f.asset,
        name,
        browser_download_url: `https://github.com/justslee/recall/releases/download/v${f.next.version}/${name}`,
        size: bytes.length,
        digest: "sha256:" + hash(bytes),
      },
    ],
  };
  const result = await f.execute({
    apply: true,
    fetchImpl: async (url) =>
      new Response(
        url.startsWith("https://api.github.com/")
          ? JSON.stringify([release])
          : bytes,
      ),
  });
  assert.equal(result.status, "upgraded");
  assert.equal(
    f.inspect(path.join(f.state, "rollback.app")).version,
    "0.2.0-beta.1",
  );
  assert(!fs.readdirSync(f.state).some((name) => name.startsWith("work-")));
});

test("Newer local versions and builds are protected from downgrade", async (t) => {
  const newer = fixture(t, {
    original: { version: "0.9.0-beta.1", build: 90 },
  });
  assert.equal(
    (await newer.execute({ apply: true })).status,
    "newer_local_build",
  );
  assert.equal(newer.calls.quit, 0);
  const build = fixture(t, { original: { version: "0.2.0-beta.1", build: 8 } });
  assert.equal(
    (await build.execute({ apply: true })).status,
    "newer_local_build",
  );
  assert.equal(build.calls.quit, 0);
});

test("A matching public artifact is cached after comparison without replacing or reopening the app", async (t) => {
  const f = fixture(t, { original: { version: "0.2.0-beta.1", build: 2 } });
  assert.equal((await f.execute({ apply: true })).status, "up_to_date");
  assert.equal(f.calls.quit, 0);
  assert.equal(f.calls.launched, 0);
  assert.equal((await f.execute()).status, "up_to_date");
  assert.equal(f.calls.downloads, 1);
});

test("Checksum, publisher and notarization failures preserve the installed app", async (t) => {
  for (const mode of ["checksum", "publisher", "notarization", "size"]) {
    const f = fixture(t, {
      next:
        mode === "publisher"
          ? { team: "OTHERTEAM1" }
          : mode === "notarization"
            ? { notarized: false }
            : {},
    });
    const before = mac.hashApp(f.app);
    if (mode === "checksum") f.asset.digest = "sha256:" + "0".repeat(64);
    if (mode === "size") f.asset.size--;
    await assert.rejects(f.execute({ apply: true }));
    assert.equal(mac.hashApp(f.app), before);
    assert.equal(f.calls.quit, 0);
    assert(!fs.readdirSync(f.state).some((name) => name.startsWith("work-")));
  }
});

test("Unsafe download locations, insecure redirects and unpublished releases stop safely", async (t) => {
  for (const mode of ["asset", "redirect", "draft"]) {
    const f = fixture(t);
    const before = mac.hashApp(f.app);
    if (mode === "asset")
      f.asset.browser_download_url = "https://example.invalid/installer.zip";
    if (mode === "draft") f.release.draft = true;
    const fetchImpl =
      mode === "redirect"
        ? async (url) =>
            url.startsWith("https://api.github.com/")
              ? new Response(JSON.stringify([f.release]))
              : new Response(null, {
                  status: 302,
                  headers: { location: "http://example.invalid/file" },
                })
        : f.fetchImpl;
    await assert.rejects(f.execute({ apply: true, fetchImpl }));
    assert.equal(mac.hashApp(f.app), before);
    assert.equal(f.calls.quit, 0);
  }
});

test("A normal replacement failure restores the original app and preserves learning", async (t) => {
  const f = fixture(t);
  const appBefore = mac.hashApp(f.app),
    learningBefore = mac.hashApp(f.profile);
  let count = 0;
  await assert.rejects(
    f.execute({
      apply: true,
      rename(from, to) {
        if (++count === 2) throw Error("synthetic replacement failure");
        fs.renameSync(from, to);
      },
    }),
  );
  assert.equal(mac.hashApp(f.app), appBefore);
  assert.equal(mac.hashApp(f.profile), learningBefore);
  assert(!fs.existsSync(path.join(f.state, "transaction.json")));
  assert.equal((await f.execute({ apply: true })).status, "upgraded");
});

test("A failed launch restores both the installed app and its prior rollback", async (t) => {
  const f = fixture(t);
  const rollback = path.join(f.state, "rollback.app");
  fs.mkdirSync(f.state);
  fs.cpSync(f.app, rollback, { recursive: true });
  fs.writeFileSync(
    path.join(rollback, "Contents/code.bin"),
    "older rollback code",
  );
  const old = mac.hashApp(f.app),
    backup = mac.hashApp(rollback);
  await assert.rejects(
    f.execute({
      apply: true,
      launch: async () => {
        throw Error("synthetic launch failure");
      },
    }),
  );
  assert.equal(mac.hashApp(f.app), old);
  assert.equal(mac.hashApp(rollback), backup);
});

test("An active installation or changed app prevents replacement", async (t) => {
  const f = fixture(t);
  const before = mac.hashApp(f.app);
  await assert.rejects(
    f.execute({ apply: true, active: () => true }),
    /busy|changed/,
  );
  assert.equal(mac.hashApp(f.app), before);
  assert(!fs.existsSync(path.join(f.state, "rollback.app")));
});

test("An interrupted replacement is recovered by the next process", async (t) => {
  const f = fixture(t);
  const archive = path.join(f.root, "fixture.zip");
  fs.writeFileSync(archive, f.bytes);
  const child = `
    const fs=require('node:fs'),path=require('node:path'),Zip=require('adm-zip');
    const {upgrade}=require(process.argv[1]);
    const mac=require(path.join(path.dirname(process.argv[1]),'mac-release.cjs'));
    const [app,zip,release]=[process.argv[2],process.argv[3],JSON.parse(process.argv[4])];
    upgrade({app,apply:true,platform:'darwin',arch:'arm64',
      fetchImpl:async url=>new Response(url.startsWith('https://api.github.com/')?JSON.stringify([release]):fs.readFileSync(zip)),
      inspect:folder=>({...JSON.parse(fs.readFileSync(path.join(folder,'Contents/Info.plist'))),identity:mac.hashApp(folder)}),
      run:(cmd,args)=>{new Zip(args[2]).extractAllTo(args[3]);return {stdout:'',stderr:''};},
      quitApp:async()=>{},active:()=>false,launch:async()=>{},
      rename:(from,to)=>{fs.renameSync(from,to);process.kill(process.pid,'SIGKILL');}
    }).catch(()=>process.exit(2));
  `;
  const killed = spawnSync(
    process.execPath,
    ["-e", child, helper, f.app, archive, JSON.stringify(f.release)],
    { timeout: 10000 },
  );
  assert.equal(killed.signal, "SIGKILL");
  assert(!fs.existsSync(f.app));
  assert(fs.existsSync(path.join(f.state, "transaction.json")));
  assert.equal((await f.execute()).status, "recovery_required");
  assert.equal((await f.execute({ apply: true })).status, "upgraded");
  assert.equal(
    f.inspect(path.join(f.state, "rollback.app")).version,
    f.original.version,
  );
});

test("The helper parser keeps check-only requests separate from explicit upgrades", () => {
  assert.deepEqual(
    parseArgs(["--app", "/Applications/Recall.app", "--apply"]),
    { app: "/Applications/Recall.app", apply: true },
  );
  assert.deepEqual(parseArgs(["--check"]), { apply: false });
  assert.throws(() => parseArgs(["--force"]));
  assert.throws(() => parseArgs(["--app"]));
});

test("A newer build of the same release version can replace an older local build", async (t) => {
  const f = fixture(t, { original: { version: "0.2.0-beta.1", build: 1 } });
  const result = await f.execute({ apply: true });
  assert.equal(result.status, "upgraded");
  assert.equal(result.installedBuild, 2);
});

test("Legacy releases can use the published checksum file", async (t) => {
  const f = fixture(t);
  delete f.asset.digest;
  const checksumName = "SHA256SUMS.txt";
  const text = hash(f.bytes) + "  " + f.asset.name + "\n";
  const checksum = {
    name: checksumName,
    state: "uploaded",
    size: Buffer.byteLength(text),
    browser_download_url: `https://github.com/justslee/recall/releases/download/${f.release.tag_name}/${checksumName}`,
  };
  f.release.assets.push(checksum);
  const result = await f.execute({
    apply: true,
    fetchImpl: async (url) =>
      url === checksum.browser_download_url
        ? new Response(text)
        : f.fetchImpl(url),
  });
  assert.equal(result.status, "upgraded");
});

test("Unknown data added to an obsolete rollback is preserved for review", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.state);
  const rollback = path.join(f.state, "rollback.app");
  fs.cpSync(f.app, rollback, { recursive: true });
  fs.writeFileSync(path.join(rollback, "Contents/code.bin"), "older rollback");
  let learned;
  const result = await f.execute({
    apply: true,
    launch: async () => {
      const work = fs
        .readdirSync(f.state)
        .find((name) => name.startsWith("work-"));
      learned = path.join(
        f.state,
        work,
        "obsolete.app/private-learning.sqlite",
      );
      fs.writeFileSync(learned, "retain newly added learning data");
    },
  });
  assert.equal(result.status, "upgraded");
  assert.equal(result.cleanupPending, true);
  assert.equal(
    fs.readFileSync(learned, "utf8"),
    "retain newly added learning data",
  );
  assert.equal((await f.execute({ apply: true })).status, "cleanup_pending");
});

test("An interrupted download is bounded by a recoverable work journal", async (t) => {
  const f = fixture(t);
  let once = false;
  await assert.rejects(
    f.execute({
      apply: true,
      fetchImpl: async (url) => {
        if (!url.startsWith("https://api.github.com/") && !once) {
          once = true;
          const journal = JSON.parse(
            fs.readFileSync(path.join(f.state, "transaction.json")),
          );
          assert.equal(journal.next, null);
          throw Error("synthetic connection failure");
        }
        return f.fetchImpl(url);
      },
    }),
  );
  assert(!fs.existsSync(path.join(f.state, "transaction.json")));
  assert(!fs.readdirSync(f.state).some((name) => name.startsWith("work-")));
  assert.equal((await f.execute({ apply: true })).status, "upgraded");
});

test("CLI modes cannot override a version-only request through duplicate flags", () => {
  assert.throws(() => parseArgs(["--check", "--apply"]));
  assert.throws(() => parseArgs(["--apply", "--check"]));
  assert.throws(() => parseArgs(["--app", "first.app", "--app", "second.app"]));
});

test("Recovery can finish after temporary files were already removed", async (t) => {
  for (const committed of [false, true]) {
    const f = fixture(t);
    const work = "work-" + crypto.randomUUID();
    fs.mkdirSync(f.state);
    const original = f.inspect(f.app);
    const next = f.inspect(f.source);
    const receipt = {
      identity: committed ? next.identity : original.identity,
      sha256: f.asset.digest.slice(7),
      version: f.next.version,
    };
    if (committed) {
      fs.renameSync(f.app, path.join(f.state, "rollback.app"));
      fs.cpSync(f.source, f.app, { recursive: true });
    }
    fs.writeFileSync(
      path.join(f.state, "transaction.json"),
      JSON.stringify({
        schemaVersion: 1,
        work,
        original,
        next,
        priorRollback: null,
        committed,
        receipt,
      }),
    );
    const result = await f.execute({ apply: true });
    assert.equal(result.status, committed ? "up_to_date" : "upgraded");
    assert.equal(f.inspect(f.app).version, f.next.version);
    assert(!fs.existsSync(path.join(f.state, "transaction.json")));
  }
});

test("Consumer inspection needs no Xcode tools and rejects non-notarized or wrong-architecture apps", async (t) => {
  const f = fixture(t);
  const write = (name, value) => {
    const file = path.join(f.app, "Contents", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  fs.rmSync(path.join(f.app, "Contents/code.bin"));
  fs.mkdirSync(path.join(f.app, "Contents/Frameworks"));
  write(
    "Resources/app.asar/package.json",
    JSON.stringify({ version: f.original.version }),
  );
  write(
    "Resources/app.asar.unpacked/dist-native/RecallPadHandoff",
    "synthetic helper",
  );
  const ticket = Buffer.alloc(32);
  ticket.write("s8ch");
  write("CodeResources", ticket);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0xfeedfacf);
  header.writeUInt32LE(0x0100000c, 4);
  write("MacOS/Recall", header);
  let notarized = true;
  const run = (command, args, options = {}) => {
    if (command === "/usr/sbin/spctl")
      return {
        stdout: "",
        stderr:
          "source=" + (notarized ? "Notarized Developer ID" : "Developer ID"),
      };
    if (command === "/usr/bin/plutil")
      return {
        stdout: JSON.stringify(
          options.input
            ? {
                "com.apple.security.cs.allow-jit": true,
                "com.apple.security.device.audio-input": true,
              }
            : { CFBundleIdentifier: mac.BUNDLE_ID, CFBundleVersion: "1" },
        ),
        stderr: "",
      };
    assert.equal(command, "/usr/bin/codesign");
    const native = args.at(-1).endsWith("RecallPadHandoff");
    if (args.includes("--entitlements"))
      return { stdout: native ? "" : "<plist><dict/></plist>", stderr: "" };
    return {
      stdout: "",
      stderr: `Identifier=${native ? "com.recall.pad-handoff" : mac.BUNDLE_ID}\nTeamIdentifier=SYNTHETIC1\nAuthority=Developer ID Application: Synthetic\nCodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=Synthetic timestamp\n`,
    };
  };
  assert.equal(
    (await f.execute({ inspect: undefined, run })).status,
    "update_available",
  );
  notarized = false;
  await assert.rejects(f.execute({ inspect: undefined, run }), /notarization/);
  notarized = true;
  header.writeUInt32LE(0x01000007, 4);
  write("MacOS/Recall", header);
  await assert.rejects(f.execute({ inspect: undefined, run }), /Apple Silicon/);
});
