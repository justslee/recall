const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const {
  verifyRelease,
  parseArgs,
  CHECKS,
} = require("../scripts/verify-mac-release.cjs");
const {
  inspectBundleLayout,
  defaultRun,
} = require("../scripts/distribute-mac.cjs");
const { lock } = require("../electron/config.cjs");

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file));

function fixture(t, { state = true } = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "recall-retention-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, "release/distribution");
  fs.mkdirSync(out, { recursive: true });
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    );
  };
  function release(build) {
    const name = `candidate-build${build}`;
    const folder = path.join(out, name);
    const app = path.join(folder, "Recall.app");
    for (const file of [
      "Contents/MacOS/Recall",
      "Contents/Info.plist",
      "Contents/Resources/app.asar",
      "Contents/_CodeSignature/CodeResources",
      "Contents/Resources/app.asar.unpacked/dist-native/RecallPadHandoff",
    ])
      write(path.join(app, file), `synthetic ${build} ${file}`);
    fs.mkdirSync(path.join(app, "Contents/Frameworks"));
    const archive = `Recall-build${build}.zip`;
    const zip = path.join(folder, archive);
    const download = new AdmZip();
    download.addLocalFolder(app, "Recall.app");
    write(zip, download.toBuffer());
    const receipt = {
      schemaVersion: 1,
      buildNumber: String(build),
      version: `0.1.${build}`,
      archive,
      sha256: hash(fs.readFileSync(zip)),
      sourceArchiveSha256: hash(
        fs.readFileSync(path.join(app, "Contents/Resources/app.asar")),
      ),
      signatureVerified: true,
      notarization: "accepted",
      stapled: true,
      gatekeeperAccepted: true,
      releaseQualityVerified: false,
    };
    write(path.join(folder, "release-receipt.json"), receipt);
    write(path.join(folder, "verification.log"), `keep log ${build}`);
    return { name, folder, app, receipt, zip };
  }
  const old = release(1),
    rollback = release(2),
    current = release(3);
  const installed = path.join(root, "Applications/Recall.app");
  fs.cpSync(current.app, installed, { recursive: true });
  const reference = (value) => ({
    candidate: value.name,
    buildNumber: value.receipt.buildNumber,
    sha256: value.receipt.sha256,
  });
  if (state)
    write(path.join(out, "retention.json"), {
      schemaVersion: 1,
      current: reference(rollback),
      rollback: reference(old),
    });
  const evidence = path.join(root, "private/quality.json");
  write(evidence, {
    schemaVersion: 1,
    sha256: current.receipt.sha256,
    checks: Object.fromEntries(CHECKS.map((name) => [name, true])),
  });
  const execute = (extra = {}) =>
    verifyRelease({
      root,
      candidate: current.folder,
      evidence,
      installedApp: installed,
      platform: "darwin",
      activeFiles: () => [],
      run(command, args) {
        assert.equal(command, "/usr/bin/ditto");
        assert.deepEqual(args.slice(0, 2), ["-x", "-k"]);
        new AdmZip(args[2]).extractAllTo(args[3]);
        return { stdout: "", stderr: "" };
      },
      checkApp: (app) => inspectBundleLayout(app),
      ...extra,
    });
  return {
    root,
    out,
    old,
    rollback,
    current,
    installed,
    evidence,
    execute,
    release,
    write,
    reference,
  };
}

test("Release verification automatically retains one rollback and preserves learning and release evidence", (t) => {
  const f = fixture(t);
  const newer = f.release(4);
  const profile = path.join(f.old.folder, "profile/recall.sqlite");
  const qa = path.join(
    f.root,
    "release/submission/private/profile/recall.sqlite",
  );
  f.write(profile, "historical learning");
  f.write(qa, "QA learning");
  const result = f.execute();
  assert.equal(result.verified, true);
  assert.deepEqual(result.cleanup.removed, [f.old.name]);
  assert.equal(result.rollback.candidate, f.rollback.name);
  assert(fs.existsSync(f.current.app));
  assert(fs.existsSync(f.rollback.app));
  assert(fs.existsSync(newer.app));
  assert(!fs.existsSync(f.old.app));
  assert(!fs.existsSync(f.old.zip));
  assert.equal(fs.readFileSync(profile, "utf8"), "historical learning");
  assert.equal(fs.readFileSync(qa, "utf8"), "QA learning");
  assert.equal(
    fs.readFileSync(path.join(f.old.folder, "verification.log"), "utf8"),
    "keep log 1",
  );
  assert.deepEqual(
    read(path.join(f.old.folder, "release-receipt.json")),
    f.old.receipt,
  );
  assert.equal(
    read(path.join(f.current.folder, "release-receipt.json"))
      .releaseQualityVerified,
    true,
  );
  assert.equal(
    read(path.join(f.current.folder, "quality-verification.json")).sha256,
    f.current.receipt.sha256,
  );
});

test("Incomplete, mismatched or changed release verification never starts cleanup", (t) => {
  const changes = [
    (f) =>
      f.write(f.evidence, {
        schemaVersion: 1,
        sha256: f.current.receipt.sha256,
        checks: {},
      }),
    (f) =>
      f.write(f.evidence, {
        schemaVersion: 1,
        sha256: "0".repeat(64),
        checks: Object.fromEntries(CHECKS.map((name) => [name, true])),
      }),
    (f) => f.write(f.current.zip, "mutated current archive"),
    (f) =>
      f.write(
        path.join(f.installed, "Contents/Resources/app.asar"),
        "different installed app",
      ),
    (f) =>
      f.write(path.join(f.current.folder, "release-receipt.json"), {
        ...f.current.receipt,
        notarization: "submitted-or-uncertain",
      }),
    (f) => f.write(f.rollback.zip, "mutated rollback archive"),
  ];
  for (const change of changes) {
    const f = fixture(t);
    change(f);
    assert.throws(() => f.execute());
    assert(fs.existsSync(f.old.app));
    assert(fs.existsSync(f.rollback.app));
    assert.equal(
      read(path.join(f.current.folder, "release-receipt.json"))
        .releaseQualityVerified,
      false,
    );
  }
});

test("Verification rejects an archive or evidence mutation during external checks", (t) => {
  for (const mutate of [
    (f) => f.write(f.current.zip, "changed while checking signatures"),
    (f) => f.write(f.evidence, { changed: true }),
  ]) {
    const f = fixture(t);
    assert.throws(
      () =>
        f.execute({
          checkApp(app) {
            inspectBundleLayout(app);
            if (app.includes("recall-release-verification-")) mutate(f);
          },
        }),
      /changed during verification/,
    );
    assert(fs.existsSync(f.old.app));
    assert.equal(
      read(path.join(f.current.folder, "release-receipt.json"))
        .releaseQualityVerified,
      false,
    );
  }
});

test("Pruning an older stapled app retains its ticket-verification requirement", (t) => {
  const f = fixture(t);
  const calls = [];
  f.execute({
    checkApp(app, options) {
      inspectBundleLayout(app);
      calls.push({ app, stapled: options.stapled });
    },
  });
  assert.equal(calls.find((call) => call.app === f.old.app).stapled, true);
});

test("Repeated verification keeps the same rollback and cleanup is idempotent", (t) => {
  const f = fixture(t);
  f.execute();
  const second = f.execute();
  assert.deepEqual(second.cleanup.removed, []);
  assert.equal(second.rollback.candidate, f.rollback.name);
  assert(fs.existsSync(f.rollback.zip));
  assert.equal(
    read(path.join(f.old.folder, "artifact-pruning.json")).complete,
    true,
  );
});

test("The next verified release advances rollback once and prunes the superseded rollback", (t) => {
  const f = fixture(t);
  f.execute();
  const next = f.release(4);
  fs.rmSync(f.installed, { recursive: true });
  fs.cpSync(next.app, f.installed, { recursive: true });
  f.write(f.evidence, {
    schemaVersion: 1,
    sha256: next.receipt.sha256,
    checks: Object.fromEntries(CHECKS.map((name) => [name, true])),
  });
  const result = f.execute({ candidate: next.folder });
  assert.equal(result.rollback.candidate, f.current.name);
  assert(fs.existsSync(f.current.app));
  assert(!fs.existsSync(f.rollback.app));
  assert(fs.existsSync(path.join(f.rollback.folder, "release-receipt.json")));
  assert.equal(
    read(path.join(f.out, "retention.json")).current.candidate,
    next.name,
  );
});

test("Busy and open release candidates remain protected", (t) => {
  const f = fixture(t);
  const unlock = lock(f.old.folder);
  try {
    const result = f.execute();
    assert(result.cleanup.protected.includes(f.old.name));
    assert(fs.existsSync(f.old.app));
  } finally {
    unlock();
  }
  const result = f.execute({
    activeFiles: () => [path.join(f.old.app, "Contents/MacOS/Recall")],
  });
  assert(result.cleanup.protected.includes(f.old.name));
  assert(fs.existsSync(f.old.app));
});

test("A partial deletion can be retried without losing receipts or rotating rollback", (t) => {
  const f = fixture(t);
  const interrupted = f.execute({
    remove(file, options) {
      if (file === f.old.app) {
        fs.unlinkSync(path.join(file, "Contents/Info.plist"));
        throw Error("synthetic interrupted deletion");
      }
      fs.rmSync(file, options);
    },
  });
  assert.deepEqual(interrupted.cleanup.failed, [f.old.name]);
  assert.equal(
    read(path.join(f.old.folder, "artifact-pruning.json")).complete,
    false,
  );
  const retried = f.execute();
  assert.deepEqual(retried.cleanup.failed, []);
  assert.deepEqual(retried.cleanup.removed, [f.old.name]);
  assert.equal(retried.rollback.candidate, f.rollback.name);
  assert(fs.existsSync(path.join(f.old.folder, "verification.log")));
});

test("Learning data added during interrupted cleanup blocks any subsequent deletion", (t) => {
  const f = fixture(t);
  f.execute({
    remove() {
      throw Error("synthetic interruption");
    },
  });
  const learning = path.join(f.old.app, "recall.sqlite");
  f.write(learning, "new learning must survive");
  const result = f.execute();
  assert.deepEqual(result.cleanup.failed, [f.old.name]);
  assert.equal(fs.readFileSync(learning, "utf8"), "new learning must survive");
  assert(fs.existsSync(f.old.zip));
});

test("Private learning content in an old app bundle prevents automatic pruning", (t) => {
  const f = fixture(t);
  const learning = path.join(f.old.app, "Contents/Resources/personal.sqlite");
  f.write(learning, "keep this private learning");
  const result = f.execute();
  assert.deepEqual(result.cleanup.failed, [f.old.name]);
  assert(fs.existsSync(learning));
  assert(fs.existsSync(f.old.zip));
});

test("Aliased files and directories cannot redirect verification or pruning", (t) => {
  const f = fixture(t);
  const external = path.join(f.root, "outside.zip");
  fs.renameSync(f.old.zip, external);
  fs.symlinkSync(external, f.old.zip);
  const result = f.execute();
  assert.deepEqual(result.cleanup.failed, [f.old.name]);
  assert(fs.existsSync(external));
  assert(fs.existsSync(f.old.app));
  assert.throws(() => f.execute({ candidate: path.join(f.root, "private") }));
});

test("The first verified release defers pruning until a verified rollback exists", (t) => {
  const f = fixture(t, { state: false });
  const result = f.execute();
  assert.equal(result.cleanup.deferred, true);
  assert.equal(result.rollback, null);
  assert(fs.existsSync(f.old.app));
  assert(fs.existsSync(f.rollback.app));
});

test("Invalid retention records and failed active-file checks preserve all old artifacts", (t) => {
  const f = fixture(t);
  f.write(path.join(f.out, "retention.json"), { schemaVersion: 99 });
  assert.throws(() => f.execute(), /retention record/);
  assert(fs.existsSync(f.old.app));
  f.write(path.join(f.out, "retention.json"), {
    schemaVersion: 1,
    current: f.reference(f.rollback),
    rollback: f.reference(f.old),
  });
  assert.throws(() =>
    f.execute({
      activeFiles() {
        throw Error("inspection unavailable");
      },
    }),
  );
  assert(fs.existsSync(f.old.app));
  assert(fs.existsSync(f.rollback.app));
  assert.equal(
    read(path.join(f.current.folder, "release-receipt.json"))
      .releaseQualityVerified,
    true,
  );
  assert.deepEqual(f.execute().cleanup.removed, [f.old.name]);
});

test("A stale verification cannot replace a newer retained release", (t) => {
  const f = fixture(t);
  const newer = f.release(4);
  f.write(path.join(f.out, "retention.json"), {
    schemaVersion: 1,
    current: f.reference(newer),
    rollback: f.reference(f.rollback),
  });
  assert.throws(() => f.execute(), /older release/);
  assert(fs.existsSync(f.old.app));
});

test("The verification CLI requires an artifact and evidence and rejects unknown flags", () => {
  assert.deepEqual(
    parseArgs([
      "--candidate",
      "release/distribution/candidate-test",
      "--evidence",
      "private/qa.json",
    ]),
    {
      candidate: "release/distribution/candidate-test",
      evidence: "private/qa.json",
    },
  );
  for (const args of [
    [],
    ["--candidate", "x"],
    ["--apply"],
    ["--candidate", "x", "--candidate", "y", "--evidence", "z"],
  ])
    assert.throws(() => parseArgs(args));
});

test("A candidate opened during validation is protected before deletion", (t) => {
  const f = fixture(t);
  let inUse = false;
  const result = f.execute({
    activeFiles: () =>
      inUse ? [path.join(f.old.app, "Contents/MacOS/Recall")] : [],
    checkApp(app) {
      inspectBundleLayout(app);
      if (app === f.old.app) inUse = true;
    },
  });
  assert(result.cleanup.protected.includes(f.old.name));
  assert(fs.existsSync(f.old.app));
  assert(fs.existsSync(f.old.zip));
});

test("A retained current release cannot be rebound to a different archive", (t) => {
  const f = fixture(t);
  f.write(path.join(f.out, "retention.json"), {
    schemaVersion: 1,
    current: { ...f.reference(f.current), sha256: "0".repeat(64) },
    rollback: f.reference(f.rollback),
  });
  assert.throws(() => f.execute(), /identity|retention/);
  assert(fs.existsSync(f.old.app));
});

test("Verification binds the staged and installed app to the final downloadable ZIP", (t) => {
  const f = fixture(t);
  for (const folder of [f.current.app, f.installed])
    f.write(
      path.join(folder, "Contents/MacOS/Recall"),
      "another signed build with the same app.asar",
    );
  assert.throws(() => f.execute(), /differs from the final release ZIP/);
  assert(fs.existsSync(f.old.app));
  assert.equal(
    read(path.join(f.current.folder, "release-receipt.json"))
      .releaseQualityVerified,
    false,
  );
});

test("Unsafe ZIP paths and symbolic links fail before extraction or cleanup", (t) => {
  const mutations = [
    (zip) => {
      zip.addFile(
        "Recall.app/Contents/INFO.plist",
        Buffer.from("case collision"),
      );
    },
    (zip) => {
      zip.addFile("Recall.app/link", Buffer.from("."));
      zip.getEntry("Recall.app/link").attr = (0o120777 << 16) >>> 0;
      zip.addFile("Recall.app/LINK/child", Buffer.from("case alias traversal"));
    },
    (zip) => {
      zip.addFile("Recall.app/escape", Buffer.from("../../outside"));
      zip.getEntry("Recall.app/escape").attr = (0o120777 << 16) >>> 0;
    },
    (zip) => {
      zip.addFile("Recall.app/link", Buffer.from("."));
      zip.getEntry("Recall.app/link").attr = (0o120777 << 16) >>> 0;
      zip.addFile(
        "Recall.app/link/child",
        Buffer.from("unsafe alias traversal"),
      );
    },
    (zip) => {
      zip.addFile("Recall.app/escape", Buffer.from("unsafe parent traversal"));
      zip.getEntry("Recall.app/escape").entryName = "../outside";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture(t);
    const zip = new AdmZip(f.current.zip);
    mutate(zip);
    const bytes = zip.toBuffer();
    f.write(f.current.zip, bytes);
    f.write(path.join(f.current.folder, "release-receipt.json"), {
      ...f.current.receipt,
      sha256: hash(bytes),
    });
    f.write(f.evidence, {
      schemaVersion: 1,
      sha256: hash(bytes),
      checks: Object.fromEntries(CHECKS.map((name) => [name, true])),
    });
    assert.throws(
      () =>
        f.execute({
          run() {
            assert.fail("Unsafe ZIP reached extraction");
          },
        }),
      /ZIP|archive/,
    );
    assert(fs.existsSync(f.old.app));
    assert.equal(
      read(path.join(f.current.folder, "release-receipt.json"))
        .releaseQualityVerified,
      false,
    );
  }
});

test(
  "The macOS extraction path preserves framework symlinks and cleans up its temporary directory",
  {
    skip: process.platform !== "darwin",
  },
  (t) => {
    const f = fixture(t);
    const framework = path.join(
      f.current.app,
      "Contents/Frameworks/Electron Framework.framework",
    );
    f.write(
      path.join(framework, "Versions/A/Electron Framework"),
      "synthetic framework",
    );
    fs.symlinkSync("A", path.join(framework, "Versions/Current"));
    fs.symlinkSync(
      "Versions/Current/Electron Framework",
      path.join(framework, "Electron Framework"),
    );
    fs.rmSync(f.installed, { recursive: true });
    fs.cpSync(f.current.app, f.installed, {
      recursive: true,
      verbatimSymlinks: true,
    });
    fs.unlinkSync(f.current.zip);
    defaultRun("/usr/bin/ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      f.current.app,
      f.current.zip,
    ]);
    const sha256 = hash(fs.readFileSync(f.current.zip));
    f.write(path.join(f.current.folder, "release-receipt.json"), {
      ...f.current.receipt,
      sha256,
    });
    f.write(f.evidence, {
      schemaVersion: 1,
      sha256,
      checks: Object.fromEntries(CHECKS.map((name) => [name, true])),
    });
    let temporary;
    const result = f.execute({
      run(command, args, options) {
        temporary = args[3];
        return defaultRun(command, args, options);
      },
    });
    assert.equal(result.verified, true);
    assert(fs.existsSync(f.rollback.app));
    assert(!fs.existsSync(temporary));
  },
);
