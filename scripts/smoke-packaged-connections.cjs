const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const exe =
  process.env.RECALL_TEST_EXECUTABLE &&
  path.resolve(process.env.RECALL_TEST_EXECUTABLE);
if (!exe)
  throw Error("Set RECALL_TEST_EXECUTABLE to the packaged Mac executable");
const asar = path.resolve(path.dirname(exe), "../Resources/app.asar"),
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recall-kit-"));
try {
  const script = path.join(tmp, "check.cjs");
  fs.writeFileSync(
    script,
    `const fs=require('fs'),path=require('path'),assert=require('assert/strict');const [asar,tmp]=process.argv.slice(2);const folder=path.join(tmp,'profile');require(path.join(asar,'electron/config.cjs')).saveConfig(folder,{captureEnabled:true});const c=require(path.join(asar,'electron/connections.cjs'));for(const host of ['codex','claude'])c.connect(folder,host,{apply:true,home:tmp});assert(c.status(folder).hosts.codex.connected);const skill=fs.readFileSync(path.join(tmp,'.codex/skills/recall-bridge/SKILL.md'),'utf8');assert(!skill.includes('app.asar/skills'));assert(fs.existsSync(path.join(folder,'connections/skills/recall-source/references/widget-contract.md')));const w=require(path.join(asar,'electron/learning-worker.cjs'));const r=w.request(folder,{id:'test',input:{type:'objective',capture:{title:'Test',objective:'Explain weighted mean',cardIds:[]}}},[]);assert.deepEqual(fs.readdirSync(r.stage),[]);assert(r.prompt.includes('Explain weighted mean'));assert(fs.existsSync(path.join(asar,'shared/validate-card-exercises.cjs')));console.log(JSON.stringify({stage:r.stage,wrapper:path.join(folder,'connections/recall')}));`,
  );
  const r = JSON.parse(
    execFileSync(exe, [script, asar, tmp], {
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }),
  );
  const status = JSON.parse(
    execFileSync(r.wrapper, ["connections", "status"], { encoding: "utf8" }),
  );
  assert(status.hosts.codex.connected && status.hosts.claude.connected);
  console.log(
    "PASS packaged global installers, portable references, bundled CLI wrapper and isolated worker context in temporary home",
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
