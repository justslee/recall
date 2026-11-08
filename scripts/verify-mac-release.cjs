const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { atomic, lock } = require("../electron/config.cjs");
const { read } = require("../electron/private-files.cjs");
const {
  hashFile,
  defaultRun,
  directory,
  regular,
  validateApp,
  inspectMacArchive,
  sameApp,
  tree,
} = require("../skills/recall-upgrade/scripts/mac-release.cjs");

const CHECKS = [
  "cleanMacInstallation",
  "study",
  "learningPreservation",
  "companion",
];
const SHA256 = /^[a-f0-9]{64}$/;
const CANDIDATE = /^candidate-[A-Za-z0-9_-]+$/;

function json(file) {
  return JSON.parse(read(file, 8 * 1024 * 1024));
}

function candidate(out, name) {
  if (!CANDIDATE.test(name)) throw Error("Invalid release candidate name.");
  const folder = path.join(out, name);
  directory(folder);
  const receipt = json(path.join(folder, "release-receipt.json"));
  if (
    receipt.schemaVersion !== 1 ||
    !/^[1-9]\d{0,8}$/.test(String(receipt.buildNumber)) ||
    typeof receipt.archive !== "string" ||
    !/^[A-Za-z0-9_.-]+\.zip$/.test(receipt.archive) ||
    !SHA256.test(receipt.sha256)
  )
    throw Error("The release receipt is incomplete.");

  return { name, folder, receipt, zip: path.join(folder, receipt.archive) };
}

function reference(value) {
  return {
    candidate: value.name,
    buildNumber: String(value.receipt.buildNumber),
    sha256: value.receipt.sha256,
  };
}

function app(value) {
  const apps = fs
    .readdirSync(value.folder)
    .filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw Error("Expected one staged release app.");
  return path.join(value.folder, apps[0]);
}

function validateArtifact(value, { run, checkApp }) {
  const receipt = value.receipt;
  if (
    receipt.signatureVerified !== true ||
    receipt.notarization !== "accepted" ||
    receipt.stapled !== true ||
    receipt.gatekeeperAccepted !== true
  )
    throw Error("Release signing and notarization gates are incomplete.");

  regular(value.zip);
  if (hashFile(value.zip) !== receipt.sha256)
    throw Error("The release archive checksum changed.");

  const staged = app(value);
  checkApp(staged, { stapled: true, run });
  const archive = path.join(staged, "Contents/Resources/app.asar");
  regular(archive);
  if (hashFile(archive) !== receipt.sourceArchiveSha256)
    throw Error("The staged app differs from its release receipt.");

  return staged;
}

function prune(value, { run, checkApp, activeFiles, remove }) {
  const marker = path.join(value.folder, "artifact-pruning.json");
  let plan;
  if (fs.existsSync(marker)) {
    plan = json(marker);
    if (plan.complete) return false;
    if (plan.sha256 !== value.receipt.sha256)
      throw Error("A pending cleanup belongs to another artifact.");
  } else {
    regular(value.zip);
    if (hashFile(value.zip) !== value.receipt.sha256)
      throw Error("An older archive changed before cleanup.");

    const staged = app(value);
    checkApp(staged, { stapled: value.receipt.stapled === true, run });
    plan = {
      schemaVersion: 1,
      sha256: value.receipt.sha256,
      payloads: [path.basename(staged), value.receipt.archive],
      files: tree(value.folder, [path.basename(staged), value.receipt.archive]),
      complete: false,
    };
    atomic(marker, plan);
  }
  if (
    plan.schemaVersion !== 1 ||
    !Array.isArray(plan.payloads) ||
    plan.payloads.length !== 2 ||
    !plan.payloads.some((name) => name === value.receipt.archive) ||
    !plan.payloads.some((name) => /^[A-Za-z0-9 _-]+\.app$/.test(name)) ||
    plan.payloads.some((name) => path.basename(name) !== name)
  )
    throw Error("Invalid pending release cleanup.");

  const remaining = tree(value.folder, plan.payloads);
  for (const [name, identity] of Object.entries(remaining)) {
    if (JSON.stringify(identity) !== JSON.stringify(plan.files[name]))
      throw Error("An older payload changed during cleanup.");
  }
  for (const name of plan.payloads) {
    if (
      activeFiles(run).some(
        (file) =>
          file === value.folder || file.startsWith(value.folder + path.sep),
      )
    ) {
      const error = Error("An older release is now in use.");
      error.code = "RECALL_WRITER_BUSY";
      throw error;
    }
    remove(path.join(value.folder, name), { recursive: true, force: true });
  }
  atomic(marker, { ...plan, complete: true });
  return true;
}

function openFiles(run) {
  return run("/usr/sbin/lsof", ["-nP", "-Fn"], {
    maxBuffer: 16 * 1024 * 1024,
    releaseError: "Active release files could not be checked.",
  })
    .stdout.split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = {
      "--candidate": "candidate",
      "--evidence": "evidence",
      "--installed-app": "installedApp",
    }[args[i]];
    if (!key || result[key] || !args[i + 1] || args[i + 1].startsWith("--"))
      throw Error(
        "Use --candidate FOLDER --evidence FILE [--installed-app APP].",
      );

    result[key] = args[++i];
  }
  if (!result.candidate || !result.evidence)
    throw Error("Supply the release candidate and its quality evidence.");

  return result;
}

function verifyRelease({
  root = path.resolve(__dirname, ".."),
  candidate: selected,
  evidence,
  installedApp = "/Applications/Recall.app",
  platform = process.platform,
  run = defaultRun,
  checkApp = validateApp,
  activeFiles = openFiles,
  remove = fs.rmSync,
} = {}) {
  if (platform !== "darwin")
    throw Error("Mac release verification requires macOS.");
  root = fs.realpathSync(root);
  const out = path.join(root, "release/distribution");
  directory(path.join(root, "release"));
  directory(out);
  const stage = path.resolve(root, selected);
  if (path.dirname(stage) !== out)
    throw Error("Choose a candidate directly under release/distribution.");

  const unlock = lock(out);
  let unlockStage;
  let unlockRollback;
  let extracted;
  try {
    candidate(out, path.basename(stage));
    unlockStage = lock(stage);
    const current = candidate(out, path.basename(stage));
    const proofFile = path.resolve(root, evidence);
    regular(proofFile);
    const proofText = read(proofFile);
    const proof = JSON.parse(proofText);
    const proofSha256 = crypto
      .createHash("sha256")
      .update(proofText)
      .digest("hex");
    if (
      proof.schemaVersion !== 1 ||
      proof.sha256 !== current.receipt.sha256 ||
      !CHECKS.every((name) => proof.checks?.[name] === true)
    )
      throw Error("Artifact-bound release quality evidence is incomplete.");

    const options = { run, checkApp };
    const staged = validateArtifact(current, options);
    installedApp = path.resolve(installedApp);
    if (installedApp.startsWith(out + path.sep))
      throw Error(
        "Verify an installed app separately from the staged candidate.",
      );
    checkApp(installedApp, { stapled: true, run });
    const archiveApp = inspectMacArchive(current.zip);
    extracted = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "recall-release-verification-")),
    );
    fs.chmodSync(extracted, 0o700);
    run("/usr/bin/ditto", ["-x", "-k", current.zip, extracted], {
      releaseError: "The final release ZIP could not be inspected.",
    });
    const downloaded = path.join(extracted, archiveApp);
    checkApp(downloaded, { stapled: true, run });
    sameApp(downloaded, staged);
    sameApp(downloaded, installedApp);

    const stateFile = path.join(out, "retention.json");
    const state = fs.existsSync(stateFile) ? json(stateFile) : null;
    if (state && (state.schemaVersion !== 1 || !state.current))
      throw Error("The release retention record is invalid.");
    if (
      state?.current.candidate === current.name &&
      (state.current.sha256 !== current.receipt.sha256 ||
        String(state.current.buildNumber) !==
          String(current.receipt.buildNumber))
    )
      throw Error("The retained current release identity changed.");
    if (
      state &&
      Number(state.current.buildNumber) > Number(current.receipt.buildNumber)
    )
      throw Error(
        "An older release cannot supersede a newer verified release.",
      );

    let rollback =
      state?.current.candidate === current.name
        ? state.rollback
        : state?.current;
    if (!rollback) {
      const previous = fs
        .readdirSync(out)
        .filter((name) => CANDIDATE.test(name))
        .map((name) => {
          try {
            return candidate(out, name);
          } catch {
            return null;
          }
        })
        .filter(
          (value) =>
            value?.receipt.releaseQualityVerified === true &&
            Number(value.receipt.buildNumber) <
              Number(current.receipt.buildNumber),
        )
        .sort(
          (a, b) =>
            Number(b.receipt.buildNumber) - Number(a.receipt.buildNumber),
        );
      rollback = previous.length ? reference(previous[0]) : null;
    }
    if (rollback) {
      if (
        !CANDIDATE.test(rollback.candidate) ||
        rollback.candidate === current.name
      )
        throw Error("The rollback retention record is invalid.");
      directory(path.join(out, rollback.candidate));
      unlockRollback = lock(path.join(out, rollback.candidate));
      const previous = candidate(out, rollback.candidate);
      if (
        previous.receipt.sha256 !== rollback.sha256 ||
        String(previous.receipt.buildNumber) !== String(rollback.buildNumber) ||
        Number(previous.receipt.buildNumber) >=
          Number(current.receipt.buildNumber)
      )
        throw Error(
          "The rollback artifact no longer matches its retention record.",
        );
      validateArtifact(previous, options);
    }

    if (
      hashFile(current.zip) !== current.receipt.sha256 ||
      hashFile(proofFile) !== proofSha256
    )
      throw Error(
        "The release artifact or quality evidence changed during verification.",
      );

    const verifiedAt = new Date().toISOString();
    atomic(path.join(stage, "quality-verification.json"), {
      schemaVersion: 1,
      sha256: current.receipt.sha256,
      checks: Object.fromEntries(CHECKS.map((name) => [name, true])),
      evidenceSha256: proofSha256,
      verifiedAt,
    });
    atomic(path.join(stage, "release-receipt.json"), {
      ...current.receipt,
      releaseQualityVerified: true,
      verifiedAt,
    });
    atomic(stateFile, {
      schemaVersion: 1,
      current: reference(current),
      rollback,
    });

    const result = {
      verified: true,
      current: current.name,
      rollback,
      cleanup: { removed: [], protected: [], failed: [], deferred: !rollback },
    };
    if (rollback) {
      const active = activeFiles(run);
      for (const name of fs
        .readdirSync(out)
        .filter((name) => CANDIDATE.test(name))) {
        if (name === current.name || name === rollback.candidate) continue;
        let release;
        let releaseUnlock;
        try {
          directory(path.join(out, name));
          releaseUnlock = lock(path.join(out, name));
          release = candidate(out, name);
          if (
            Number(release.receipt.buildNumber) >=
            Number(current.receipt.buildNumber)
          ) {
            result.cleanup.protected.push(name);
            continue;
          }
          if (
            active.some(
              (file) =>
                file === release.folder ||
                file.startsWith(release.folder + path.sep),
            )
          ) {
            result.cleanup.protected.push(name);
            continue;
          }
          if (
            !fs.existsSync(release.zip) &&
            !fs.existsSync(path.join(release.folder, "artifact-pruning.json"))
          )
            continue;
          if (prune(release, { run, checkApp, activeFiles, remove }))
            result.cleanup.removed.push(name);
        } catch (error) {
          if (error.code === "RECALL_WRITER_BUSY" || !release)
            result.cleanup.protected.push(name);
          else result.cleanup.failed.push(name);
        } finally {
          releaseUnlock?.();
        }
      }
    }
    atomic(path.join(stage, "retention-result.json"), result);
    return result;
  } finally {
    try {
      if (extracted) fs.rmSync(extracted, { recursive: true, force: true });
    } finally {
      unlockRollback?.();
      unlockStage?.();
      unlock();
    }
  }
}

if (require.main === module) {
  try {
    const result = verifyRelease(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    if (result.cleanup.failed.length) process.exitCode = 1;
  } catch {
    console.error(
      "Release verification or cleanup needs attention. Review the release evidence and retained artifacts.",
    );
    process.exitCode = 1;
  }
}

module.exports = { verifyRelease, parseArgs, CHECKS, inspectMacArchive };
