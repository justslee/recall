const fs = process.versions.electron
  ? require("original-fs")
  : require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mac = require("./mac-release.cjs");

const REPOSITORY = "justslee/recall";
const API = `https://api.github.com/repos/${REPOSITORY}/releases`;
const MAX_DOWNLOAD = 512 * 1024 * 1024;

function version(value) {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?(?:\+[A-Za-z0-9.-]+)?$/.exec(
      value,
    );
  if (!match || match.slice(1, 4).some((n) => !Number.isSafeInteger(Number(n))))
    return null;
  const pre = match[4]?.split(".") || [];
  if (pre.some((n) => /^\d+$/.test(n) && n.length > 1 && n[0] === "0"))
    return null;
  return { numbers: match.slice(1, 4).map(Number), pre };
}

function compareVersions(a, b) {
  a = version(a);
  b = version(b);
  if (!a || !b) throw Error("The release version is unsupported.");
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] - b.numbers[i];
  }
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i];
    if (x === undefined || y === undefined) return a.pre.length - b.pre.length;
    if (x === y) continue;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn) return x.length - y.length || (x < y ? -1 : 1);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function atomic(file, value) {
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  const parent = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}

function read(file) {
  mac.regular(file);
  if (fs.statSync(file).size > 1024 * 1024)
    throw Error("Upgrade metadata exceeds its size limit.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function lock(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  mac.directory(folder);
  const file = path.join(folder, ".lock");
  const owner = JSON.stringify({ pid: process.pid, id: crypto.randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, owner, { flag: "wx", mode: 0o600 });
      return () => {
        if (fs.readFileSync(file, "utf8") === owner) fs.unlinkSync(file);
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const previous = fs.readFileSync(file, "utf8");
      const pid = JSON.parse(previous).pid;
      if (!Number.isInteger(pid) || pid <= 0)
        throw Error("An upgrade lock needs manual review.");
      let dead = false;
      try {
        process.kill(pid, 0);
      } catch (error) {
        dead = error.code === "ESRCH";
      }
      if (!dead || fs.readFileSync(file, "utf8") !== previous)
        throw Error("Another Recall upgrade is running.");
      fs.unlinkSync(file);
    }
  }
  throw Error("The upgrade lock could not be acquired.");
}

async function bounded(response, maximum) {
  if (!response.ok || !response.body)
    throw Error(`The release request failed (${response.status}).`);
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum)
        throw Error("Release metadata exceeds its size limit.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

function official(url, metadata = false) {
  const value = new URL(url);
  const allowed = metadata
    ? value.hostname === "api.github.com"
    : value.hostname === "github.com" ||
      value.hostname.endsWith(".githubusercontent.com");
  if (
    value.protocol !== "https:" ||
    value.port ||
    value.username ||
    value.password ||
    !allowed
  )
    throw Error("A release URL is outside GitHub's download service.");
  return value;
}

async function assetResponse(url, fetchImpl) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    official(url);
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(600000),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const next = response.headers.get("location");
    await response.body?.cancel();
    if (!next) throw Error("The release download redirect is incomplete.");
    url = new URL(next, url).href;
  }
  throw Error("The release download has too many redirects.");
}

async function releases(fetchImpl) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${API}?per_page=100&page=${page}`;
    official(url, true);
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Recall-upgrade",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const value = JSON.parse(
      (await bounded(response, 4 * 1024 * 1024)).toString(),
    );
    if (!Array.isArray(value)) throw Error("The release listing is invalid.");
    all.push(...value);
    if (!response.headers.get("link")?.includes('rel="next"')) return all;
  }
  throw Error("The release listing exceeds the automatic lookup limit.");
}

function chooseRelease(list, installedVersion) {
  const beta = version(installedVersion)?.pre.length > 0;
  const published = list.filter(
    (release) =>
      !release.draft &&
      release.published_at &&
      version(release.tag_name) &&
      (beta || (!release.prerelease && !version(release.tag_name).pre.length)),
  );
  published.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  if (!published.length)
    throw Error("No published release is available for this channel.");
  return published[0];
}

function asset(release, name) {
  const matches = release.assets.filter(
    (value) => value.name === name && value.state === "uploaded",
  );
  if (matches.length !== 1)
    throw Error("The published release asset is missing or ambiguous.");
  const value = matches[0];
  const url = official(value.browser_download_url);
  const prefix = `/${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/`;
  if (
    url.hostname !== "github.com" ||
    url.pathname !== prefix + encodeURIComponent(name) ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > MAX_DOWNLOAD
  )
    throw Error("The published asset identity is invalid.");
  return value;
}

async function checksum(release, download, fetchImpl) {
  if (/^sha256:[a-f0-9]{64}$/.test(download.digest || ""))
    return download.digest.slice(7);
  const name = ["SHA256SUMS.txt", "SHA256SUMS"].find((n) =>
    release.assets.some((a) => a.name === n),
  );
  if (!name) throw Error("The release has no verifiable SHA-256 checksum.");
  const file = asset(release, name);
  const text = (
    await bounded(
      await assetResponse(file.browser_download_url, fetchImpl),
      65536,
    )
  ).toString();
  const matches = text
    .split(/\r?\n/)
    .map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line))
    .filter((match) => match && match[2] === download.name);
  if (matches.length !== 1)
    throw Error("The release checksum file is incomplete.");
  return matches[0][1];
}

async function downloadAsset(asset, expected, destination, fetchImpl) {
  const response = await assetResponse(asset.browser_download_url, fetchImpl);
  if (!response.ok || !response.body)
    throw Error(`The release download failed (${response.status}).`);
  const reader = response.body.getReader();
  const fd = fs.openSync(destination, "wx", 0o600);
  const hash = crypto.createHash("sha256");
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > asset.size || size > MAX_DOWNLOAD)
        throw Error("The release download exceeded its expected size.");
      const bytes = Buffer.from(value);
      hash.update(bytes);
      fs.writeFileSync(fd, bytes);
    }
    if (size !== asset.size || hash.digest("hex") !== expected)
      throw Error("The release download size or checksum did not match.");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
    await reader.cancel();
  }
}

function freshArchive(app, legacyIdentity = false, run = mac.defaultRun) {
  const script = legacyIdentity
    ? 'const m=require(process.argv[1]);console.log(JSON.stringify(m.hashApp(process.argv[2],require("node:fs"))));'
    : 'console.log(require("node:fs").readFileSync(process.argv[2]+"/Contents/Resources/app.asar/package.json","utf8"));';
  return JSON.parse(
    run(
      process.execPath,
      ["-e", script, require.resolve("./mac-release.cjs"), app],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        maxBuffer: 1024 * 1024,
        releaseError:
          "The app archive could not be inspected in a fresh Recall runtime.",
      },
    ).stdout,
  );
}

function inspectApp(app, { run, notarized = false }) {
  const stapled =
    notarized || fs.existsSync(path.join(app, "Contents/CodeResources"));
  mac.directory(app);
  // Consumer installs use Gatekeeper. Publisher-only stapler requires Xcode.
  mac.inspectBundleLayout(app, {
    verifyStapledTicket: stapled,
    requireStapler: false,
    run,
  });
  const team = mac.verifySigned(app, run);
  if (stapled) {
    const assessment = run(
      "/usr/sbin/spctl",
      ["--assess", "--verbose=2", "--type", "execute", app],
      {
        releaseError: "Apple could not verify the app's notarization.",
      },
    );
    if (
      !/^source=Notarized Developer ID$/m.test(
        assessment.stdout + "\n" + assessment.stderr,
      )
    )
      throw Error("The app has no verified Apple notarization.");
  }
  const info = mac.plistJSON(path.join(app, "Contents/Info.plist"), run);
  // A fresh runtime cannot reuse the old package at the replaced app path.
  const pkg = freshArchive(app, false, run);
  const build = Number(info.CFBundleVersion);
  if (
    info.CFBundleIdentifier !== mac.BUNDLE_ID ||
    !version(pkg.version) ||
    !Number.isSafeInteger(build) ||
    build <= 0
  )
    throw Error("The installed app version or identity is invalid.");
  const executable = path.join(app, "Contents/MacOS/Recall");
  mac.regular(executable);
  const fd = fs.openSync(executable, "r");
  const header = Buffer.alloc(8);
  try {
    if (
      fs.readSync(fd, header, 0, 8, 0) !== 8 ||
      header.readUInt32LE(0) !== 0xfeedfacf ||
      header.readUInt32LE(4) !== 0x0100000c
    )
      throw Error("This upgrade requires an Apple Silicon application.");
  } finally {
    fs.closeSync(fd);
  }
  return { version: pkg.version, build, team, identity: mac.hashApp(app) };
}

function running(app, run) {
  const text = run("/usr/sbin/lsof", ["-nP", "-Fpn"], {
    maxBuffer: 16 * 1024 * 1024,
    releaseError: "Running applications could not be checked.",
  }).stdout;
  let pid;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (
      line.startsWith("n") &&
      pid !== process.pid &&
      line.slice(1).startsWith(app + "/")
    )
      return true;
  }
  return false;
}

async function quit(app, run) {
  if (!running(app, run)) return;
  run(
    "/usr/bin/osascript",
    [
      "-e",
      `if application id "${mac.BUNDLE_ID}" is running then tell application id "${mac.BUNDLE_ID}" to quit`,
    ],
    {
      releaseError:
        "Recall could not quit gracefully. Finish saving and quit it, then retry.",
    },
  );
  for (let i = 0; i < 60; i++) {
    if (!running(app, run)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(
    "Recall is still running. Finish saving and quit it before retrying.",
  );
}

function transactionPaths(state, transaction) {
  if (
    transaction.schemaVersion !== 1 ||
    !/^work-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      transaction.work,
    )
  )
    throw Error("The interrupted upgrade record needs manual review.");
  const work = path.join(state, transaction.work);
  if (fs.existsSync(work)) mac.directory(work);
  return {
    work,
    previous: path.join(work, "previous.app"),
    obsolete: path.join(work, "obsolete.app"),
    rollback: path.join(state, "rollback.app"),
  };
}

async function recover(app, state, options) {
  const journal = path.join(state, "transaction.json");
  if (!fs.existsSync(journal)) return;
  let transaction = read(journal);
  const p = transactionPaths(state, transaction);
  if (transaction.identityFormat !== "physical-v1") {
    if (transaction.identityFormat !== undefined)
      throw Error("The interrupted upgrade identity format is unsupported.");

    // Authenticate legacy journal identities before converting to disk hashes.
    const identities = new Map();
    for (const file of [app, p.previous, p.rollback, p.obsolete]) {
      if (!fs.existsSync(file)) continue;
      mac.directory(file);
      const legacy = process.versions.electron
        ? freshArchive(file, true, options.run)
        : mac.hashApp(file);
      const verified = options.inspect(file, { run: options.run });
      if (
        identities.has(legacy) &&
        identities.get(legacy) !== verified.identity
      )
        throw Error(
          "The legacy upgrade identities are ambiguous; saved copies were retained.",
        );

      identities.set(legacy, verified.identity);
    }
    const convert = (value) => identities.get(value) || value;
    transaction = {
      ...transaction,
      identityFormat: "physical-v1",
      original: {
        ...transaction.original,
        identity: convert(transaction.original.identity),
      },
      next: transaction.next && {
        ...transaction.next,
        identity: convert(transaction.next.identity),
      },
      priorRollback: convert(transaction.priorRollback),
      ...(transaction.receipt && {
        receipt: {
          ...transaction.receipt,
          identity: convert(transaction.receipt.identity),
        },
      }),
    };
    atomic(journal, transaction);
  }
  const identity = (file) =>
    fs.existsSync(file) ? (mac.directory(file), mac.hashApp(file)) : null;
  if (transaction.next === null) {
    if (
      identity(app) !== transaction.original.identity ||
      fs.existsSync(p.previous) ||
      fs.existsSync(p.obsolete)
    )
      throw Error(
        "The app changed while a download was interrupted. Saved files were retained.",
      );
    fs.rmSync(p.work, { recursive: true, force: true });
    fs.unlinkSync(journal);
    return true;
  }
  if (transaction.committed) {
    if (
      identity(app) !== transaction.next.identity ||
      identity(p.rollback) !== transaction.original.identity
    )
      throw Error(
        "The committed upgrade no longer matches its saved identities.",
      );
    atomic(path.join(state, "receipt.json"), transaction.receipt);
    if (
      fs.existsSync(p.obsolete) &&
      (identity(p.obsolete) !== transaction.priorRollback ||
        options.active(p.obsolete, options.run))
    )
      return false;
    fs.rmSync(p.work, { recursive: true, force: true });
    fs.unlinkSync(journal);
    return true;
  }
  const target = identity(app);
  if (
    target !== null &&
    target !== transaction.next.identity &&
    target !== transaction.original.identity
  )
    throw Error(
      "The app changed after an interrupted upgrade. Saved copies were retained.",
    );
  if (target !== transaction.original.identity) {
    const source =
      identity(p.previous) === transaction.original.identity
        ? p.previous
        : identity(p.rollback) === transaction.original.identity
          ? p.rollback
          : null;
    if (!source)
      throw Error("The previous app could not be located for recovery.");
    if (target) {
      await options.quitApp(app, options.run);
      fs.renameSync(app, path.join(p.work, "rejected.app"));
    }
    fs.renameSync(source, app);
  }
  if (fs.existsSync(p.obsolete)) {
    if (
      fs.existsSync(p.rollback) ||
      identity(p.obsolete) !== transaction.priorRollback
    )
      throw Error("The older rollback needs manual review.");
    fs.renameSync(p.obsolete, p.rollback);
  }
  if (identity(p.rollback) !== transaction.priorRollback)
    throw Error(
      "The saved rollback changed during recovery. Saved copies were retained.",
    );

  fs.rmSync(p.work, { recursive: true, force: true });
  fs.unlinkSync(journal);
  return true;
}

async function upgrade({
  app = "/Applications/Recall.app",
  apply = false,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  run = mac.defaultRun,
  inspect = inspectApp,
  quitApp = quit,
  active = running,
  launch = (target) =>
    run("/usr/bin/open", [target], {
      releaseError: "The upgraded app could not be opened.",
    }),
  rename = fs.renameSync,
} = {}) {
  if (platform !== "darwin" || arch !== "arm64")
    throw Error("Recall upgrades currently support Apple Silicon macOS.");
  app = path.join(
    fs.realpathSync(path.dirname(path.resolve(app))),
    path.basename(app),
  );
  if (!/^[A-Za-z0-9 _-]+\.app$/.test(path.basename(app)))
    throw Error("Choose a Recall application bundle.");
  const state = path.join(
    path.dirname(app),
    ".recall-upgrade-" + path.basename(app, ".app"),
  );
  const options = { run, quitApp, active, inspect };
  let unlock;
  if (apply) {
    mac.loadZip();
    unlock = lock(state);
  }
  try {
    if (fs.existsSync(path.join(state, "transaction.json"))) {
      if (!apply) return { status: "recovery_required", app };
      if ((await recover(app, state, options)) === false)
        return { status: "cleanup_pending", app };
    }
    mac.directory(app);
    const installed = inspect(app, { run });
    const release = chooseRelease(await releases(fetchImpl), installed.version);
    const available = release.tag_name.replace(/^v/, "");
    const comparison = compareVersions(available, installed.version);
    const summary = {
      app,
      installedVersion: installed.version,
      installedBuild: installed.build,
      availableVersion: available,
    };
    if (comparison < 0) return { ...summary, status: "newer_local_build" };
    const file = asset(release, `Recall-${available}-macos-arm64.zip`);
    const expected = await checksum(release, file, fetchImpl);
    const receiptFile = path.join(state, "receipt.json");
    const previousReceipt = fs.existsSync(receiptFile)
      ? read(receiptFile)
      : null;
    if (
      !comparison &&
      previousReceipt?.sha256 === expected &&
      previousReceipt.identity === installed.identity
    )
      return { ...summary, status: "up_to_date" };
    if (!apply)
      return {
        ...summary,
        status: comparison > 0 ? "update_available" : "artifact_check_required",
      };

    const work = path.join(state, "work-" + crypto.randomUUID());
    fs.mkdirSync(work, { mode: 0o700 });
    const zip = path.join(work, "release.zip");
    const extract = path.join(work, "download");
    let journalWritten = false;
    try {
      atomic(path.join(state, "transaction.json"), {
        schemaVersion: 1,
        identityFormat: "physical-v1",
        work: path.basename(work),
        original: installed,
        next: null,
        committed: false,
      });
      journalWritten = true;
      await downloadAsset(file, expected, zip, fetchImpl);
      const name = mac.inspectMacArchive(zip);
      fs.mkdirSync(extract, { mode: 0o700 });
      run("/usr/bin/ditto", ["-x", "-k", zip, extract], {
        releaseError: "The verified download could not be extracted.",
      });
      const candidate = path.join(extract, name);
      const next = inspect(candidate, { run, notarized: true });
      if (next.team !== installed.team || next.version !== available)
        throw Error(
          "The downloaded app publisher or version does not match the release.",
        );
      if (comparison === 0 && next.build < installed.build) {
        await recover(app, state, options);
        return { ...summary, status: "newer_local_build" };
      }
      if (comparison === 0 && next.build === installed.build) {
        if (next.identity !== installed.identity)
          throw Error(
            "This build differs from the published artifact. Review it before replacing it.",
          );
        atomic(receiptFile, {
          ...summary,
          identity: installed.identity,
          sha256: expected,
          version: available,
        });
        await recover(app, state, options);
        return { ...summary, status: "up_to_date" };
      }
      const rollback = path.join(state, "rollback.app");
      const priorRollback = fs.existsSync(rollback)
        ? inspect(rollback, { run }).identity
        : null;
      await quitApp(app, run);
      if (
        active(app, run) ||
        inspect(app, { run }).identity !== installed.identity
      )
        throw Error(
          "The installed app is busy or changed during download. Retry after it is idle.",
        );
      const transaction = {
        schemaVersion: 1,
        identityFormat: "physical-v1",
        work: path.basename(work),
        original: installed,
        next,
        priorRollback,
        committed: false,
        receipt: {
          ...summary,
          version: available,
          build: next.build,
          identity: next.identity,
          sha256: expected,
          rollbackVersion: installed.version,
        },
      };
      atomic(path.join(state, "transaction.json"), transaction);
      journalWritten = true;
      rename(app, path.join(work, "previous.app"));
      rename(candidate, app);
      if (inspect(app, { run, notarized: true }).identity !== next.identity)
        throw Error("The installed replacement did not pass verification.");
      if (fs.existsSync(rollback))
        rename(rollback, path.join(work, "obsolete.app"));
      rename(path.join(work, "previous.app"), rollback);
      await launch(app);
      atomic(path.join(state, "transaction.json"), {
        ...transaction,
        committed: true,
      });
      const cleaned = await recover(app, state, options);
      return {
        ...summary,
        status: "upgraded",
        installedVersion: available,
        installedBuild: next.build,
        rollbackVersion: installed.version,
        cleanupPending: cleaned === false,
      };
    } catch (error) {
      if (journalWritten) await recover(app, state, options);
      throw error;
    } finally {
      if (!journalWritten && fs.existsSync(work))
        fs.rmSync(work, { recursive: true });
    }
  } finally {
    unlock?.();
  }
}

function parseArgs(args) {
  const result = {};
  let mode = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply" || args[i] === "--check") {
      if (mode) throw Error("Choose one upgrade mode.");
      mode = true;
      result.apply = args[i] === "--apply";
    } else if (
      args[i] === "--app" &&
      !result.app &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      result.app = args[++i];
    else
      throw Error(
        "Use recall-upgrade with --check or --apply and optional --app PATH.",
      );
  }
  return result;
}

if (require.main === module) {
  Promise.resolve()
    .then(() => upgrade(parseArgs(process.argv.slice(2))))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.releaseMessage || error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  upgrade,
  compareVersions,
  chooseRelease,
  parseArgs,
  freshArchive,
};
