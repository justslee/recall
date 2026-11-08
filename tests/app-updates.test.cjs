const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { execFileSync } = require("node:child_process");
const {
  AppUpdates,
  refreshConnections,
} = require("../electron/app-updates.cjs");
const {
  inspectSource,
  updateSource,
} = require("../electron/update-source.cjs");
const { atomic } = require("../electron/config.cjs");

test("Detached update worker finishes after the UI process exits and retains the selected profile", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-restart-fixture-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(
    path.resolve(__dirname, "../electron/update-worker.cjs"),
    path.join(root, "update-worker.cjs"),
  );
  fs.writeFileSync(
    path.join(root, "update-source.cjs"),
    "exports.updateSource=async()=>({status:'updated'});",
  );
  fs.writeFileSync(
    path.join(root, "upgrade.cjs"),
    `exports.upgrade=async o=>{o.progress({phase:'verifying'});await o.quitApp();await o.beforeLaunch({installedVersion:'1.0.0'});await o.launch(o.app);return {status:'upgraded',installedVersion:'1.0.0'};};`,
  );
  fs.writeFileSync(
    path.join(root, "mac-release.cjs"),
    `exports.defaultRun=(cmd,args)=>{const fs=require('node:fs'),path=require('node:path');fs.writeFileSync(path.join(__dirname,'launch.json'),JSON.stringify({cmd,args}));fs.writeFileSync(path.join(__dirname,'ready.json'),JSON.stringify({id:'test',app:'/fixture/Recall.app',version:'1.0.0'}));};`,
  );
  const parent = path.join(root, "parent.cjs");
  fs.writeFileSync(
    parent,
    `const fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process');const input=path.join(__dirname,'request.json');fs.writeFileSync(input,JSON.stringify({id:'test',app:'/fixture/Recall.app',apply:true,parentPid:process.pid,profile:'/fixture/custom profile',hosts:{}}));const child=fork(path.join(__dirname,'update-worker.cjs'),[input],{detached:true,stdio:['ignore','ignore','ignore','ipc']});child.on('message',m=>{if(m.type==='request-restart')child.send({type:'restart-approved'},()=>process.exit(0));});setTimeout(()=>process.exit(1),8000);`,
  );
  await new Promise((resolve, reject) => {
    const child = require("node:child_process").spawn(
      process.execPath,
      [parent],
      { stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Synthetic parent did not quit")),
    );
  });
  let state;
  for (let i = 0; i < 80; i++) {
    state = JSON.parse(fs.readFileSync(path.join(root, "state.json")));
    if (["complete", "error"].includes(state.phase)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(state.phase, "complete", state.error);
  assert.equal(state.result.status, "upgraded");
  const launched = JSON.parse(fs.readFileSync(path.join(root, "launch.json")));
  assert.equal(launched.cmd, "/usr/bin/open");
  assert(launched.args.includes("RECALL_DATA_DIR=/fixture/custom profile"));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, "refresh.json"))).id,
    "test",
  );
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-update-ui-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, "profile"),
    appPath = path.join(root, "Recall.app");
  fs.mkdirSync(profile);
  fs.mkdirSync(appPath);
  fs.writeFileSync(
    path.join(profile, "recall.sqlite"),
    "existing cards, reviews and drafts",
  );
  const events = [],
    children = [];
  let busy = false,
    quits = 0;
  const service = new AppUpdates({
    profile,
    appPath,
    packaged: true,
    platform: "darwin",
    arch: "arm64",
    emit: (state) => events.push(state),
    busy: () => busy,
    quit: () => quits++,
    spawnWorker: (executable, args, options) => {
      const child = new EventEmitter();
      Object.assign(child, {
        executable,
        args,
        options,
        messages: [],
        unref() {},
        kill() {},
        send(v, callback) {
          this.messages.push(v);
          callback?.();
        },
      });
      children.push(child);
      return child;
    },
  });
  return {
    root,
    profile,
    service,
    children,
    events,
    setBusy: (v) => (busy = v),
    quits: () => quits,
  };
}
test("UI updates use only bundled workers, preserve profile bytes and request a graceful quit", (t) => {
  const f = fixture(t);
  assert.equal(f.service.status().busy, false);
  f.service.start(true);
  assert.throws(() => f.service.start(false), /already in progress/);
  const child = f.children[0],
    request = JSON.parse(fs.readFileSync(child.args[1]));
  assert.equal(request.apply, true);
  assert.equal(request.app, path.join(f.root, "Recall.app"));
  assert.equal(request.profile, f.profile);
  assert.equal(child.options.detached, true);
  assert.equal(child.options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(child.options.env.NODE_OPTIONS, undefined);
  assert(fs.existsSync(path.join(f.service.folder, "worker/upgrade.cjs")));
  child.emit("message", { type: "request-restart" });
  assert.equal(f.quits(), 1);
  assert.equal(child.messages[0].type, "restart-approved");
  assert.equal(
    fs.readFileSync(path.join(f.profile, "recall.sqlite"), "utf8"),
    "existing cards, reviews and drafts",
  );
});
test("Active work blocks installation and is checked again at restart", (t) => {
  const f = fixture(t);
  f.setBusy(true);
  assert.throws(() => f.service.start(true), /Finish the active/);
  f.setBusy(false);
  f.service.start(true);
  f.setBusy(true);
  f.children[0].emit("message", { type: "request-restart" });
  assert.equal(f.quits(), 0);
  assert.equal(f.children[0].messages[0].type, "restart-blocked");
});
test("Cancelled updates cannot restart even if the worker sends a late message", (t) => {
  const f = fixture(t);
  f.service.start(true);
  f.service.cancel();
  f.children[0].emit("message", { type: "request-restart" });
  assert.equal(f.quits(), 0);
  assert.equal(f.service.status().state.phase, "cancelled");
});
test("A stopped worker becomes retryable and unsupported source runs cannot replace themselves", (t) => {
  const f = fixture(t);
  f.service.start(false);
  f.children[0].emit("exit", 1);
  assert.equal(f.service.status().state.phase, "interrupted");
  assert.equal(f.service.status().busy, false);
  f.service.supported = false;
  assert.throws(() => f.service.start(true), /signed Apple Silicon/);
});
test("Startup reports interrupted work without automatically installing a release", (t) => {
  const f = fixture(t);
  assert.equal(f.service.refreshAfterRestart(), undefined);
  assert.equal(f.children.length, 0);
  assert(!fs.existsSync(f.service.folder));
  atomic(f.service.stateFile, { phase: "downloading", pid: 2147483647 });
  assert.equal(f.service.status().state.phase, "interrupted");
  assert.equal(f.children.length, 0);
});

test("Replacement readiness is tied to the requested version and exact app; failed installs never refresh skills", (t) => {
  const f = fixture(t);
  atomic(path.join(f.service.folder, "refresh.json"), {
    id: "job",
    app: f.service.appPath,
    version: "1.0.0",
    hosts: {},
  });
  f.service.confirmReady("0.9.0");
  assert(!fs.existsSync(path.join(f.service.folder, "ready.json")));
  f.service.confirmReady("1.0.0");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.service.folder, "ready.json"))).id,
    "job",
  );
  f.service.version = "1.0.0";
  atomic(f.service.stateFile, {
    id: "job",
    phase: "error",
    result: { status: "upgraded" },
  });
  f.service.refreshAfterRestart();
  assert(
    !fs.existsSync(path.join(f.service.folder, "connections-result.json")),
  );
  atomic(f.service.stateFile, {
    id: "job",
    phase: "complete",
    result: { status: "upgraded" },
  });
  f.service.refreshAfterRestart();
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.service.folder, "connections-result.json")),
    ).id,
    "job",
  );
});
test("Connection refresh preserves custom homes and refuses changed ownership", () => {
  const expected = {
    codex: {
      connected: true,
      instructions: "/custom/codex/AGENTS.md",
      skill: "/custom/codex/skills/recall-bridge/SKILL.md",
    },
    claude: {
      connected: true,
      instructions: "/fixture/account/.claude/CLAUDE.md",
      skill: "/fixture/account/.claude/skills/recall-bridge/SKILL.md",
    },
  };
  const calls = [];
  const api = {
    settings: () => ({ hosts: expected }),
    ownsConnection: (_p, value) => value === expected.codex,
    connect: (_p, host, options) => {
      calls.push({ host, options });
      return expected[host];
    },
  };
  const outcomes = refreshConnections("/profile", expected, api);
  assert.equal(outcomes[0].status, "refreshed");
  assert.equal(outcomes[1].status, "attention");
  assert.equal(calls.filter((c) => c.options.apply).length, 1);
  assert.equal(calls[0].options.environment.CODEX_HOME, "/custom/codex");
});
function repository(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "recall-source-update-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync("/usr/bin/git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(["init", "-b", "main"]);
  git(["config", "user.name", "Synthetic Tester"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["remote", "add", "origin", "https://github.com/justslee/recall.git"]);
  fs.writeFileSync(path.join(root, "README.md"), "Original\n");
  git(["add", "."]);
  git(["commit", "-m", "Original", "--no-gpg-sign"]);
  return { root, git };
}
test("Source preflight accepts the official clean clone and rejects dirty or custom-hook configuration", async (t) => {
  const f = repository(t);
  assert.equal((await inspectSource(f.root)).folder, f.root);
  fs.writeFileSync(path.join(f.root, "README.md"), "Keep my changes\n");
  await assert.rejects(inspectSource(f.root), /local changes/);
  f.git(["restore", "README.md"]);
  f.git(["config", "filter.evil.smudge", "touch SHOULD_NOT_RUN"]);
  await assert.rejects(inspectSource(f.root), /custom Git configuration/);
  assert(!fs.existsSync(path.join(f.root, "SHOULD_NOT_RUN")));
});
test("Source update fast-forwards only, skips remote hooks and never resets local work", async (t) => {
  const f = repository(t),
    before = f.git(["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(f.root, "README.md"), "Published revision\n");
  f.git(["commit", "-am", "Next", "--no-gpg-sign"]);
  const next = f.git(["rev-parse", "HEAD"]);
  f.git(["reset", "--hard", before]); // Disposable fixture only.
  const calls = [];
  const fake = async (_folder, args) => {
    calls.push(args);
    if (args[0] === "fetch") {
      fs.writeFileSync(path.join(f.root, ".git/FETCH_HEAD"), `${next}\n`);
      return "";
    }
    return f.git(["-c", "core.hooksPath=/dev/null", ...args]);
  };
  const result = await updateSource(f.root, fake);
  assert.equal(result.status, "updated");
  assert.equal(f.git(["rev-parse", "HEAD"]), next);
  assert.equal(
    calls.find((c) => c[0] === "fetch")[3],
    "https://github.com/justslee/recall.git",
  );
  assert(!calls.some((c) => ["reset", "stash", "checkout"].includes(c[0])));
  assert(calls.find((c) => c[0] === "merge").includes("--no-overwrite-ignore"));
});
