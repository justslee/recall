const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { spawnSync } = require("node:child_process"),
  { createKnowledgeBootstrap } = require("../electron/knowledge-bootstrap.cjs"),
  { config, saveConfig } = require("../electron/config.cjs"),
  knowledge = require("../adapters/knowledge.cjs");
const PARENT = "11111111-1111-4111-8111-111111111111",
  DATABASE = "22222222-2222-4222-8222-222222222222",
  DATA_SOURCE = "33333333-3333-4333-8333-333333333333",
  PAGE = "44444444-4444-4444-8444-444444444444";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-bootstrap-")),
    folder = path.join(root, "profile"),
    parent = path.join(root, "documents");
  fs.mkdirSync(parent);
  saveConfig(folder, {
    timeZone: "UTC",
    captureEnabled: false,
    custom: "kept",
    sources: [
      {
        id: "original",
        type: "notion",
        scopeId: "55555555-5555-4555-8555-555555555555",
        write: false,
      },
    ],
  });
  fs.mkdirSync(path.join(folder, "connections"));
  fs.writeFileSync(
    path.join(folder, "connections", "recall"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o700 },
  );
  let currentTime = Date.now();
  const setup = createKnowledgeBootstrap(folder, { now: () => currentTime });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, folder, parent, setup, advance: (ms) => (currentTime += ms) };
}
function draft(
  setup,
  parent,
  types = ["markdown", "obsidian", "notion"],
  primary = "markdown",
) {
  return {
    requestId: crypto.randomUUID(),
    name: "My knowledge",
    primary,
    authoring: false,
    destinations: types.map((type) =>
      type === "notion"
        ? { type, parentScope: PARENT }
        : {
            type,
            selectionId: setup.selectParent(parent).selectionId,
            folderName: `My knowledge ${type}`,
          },
    ),
  };
}
function create(setup, input) {
  const checked = setup.preview(input);
  return setup.create({ ...input, authoring: true }, checked.previewId);
}
function notionResult(setup, id) {
  const inspected = setup.inspect(id);
  return {
    version: 1,
    requestId: id,
    parentScope: PARENT,
    scopeId: DATABASE,
    dataSourceId: DATA_SOURCE,
    title: inspected.name,
    verification: {
      method: "assistant-connector",
      created: true,
      fetched: true,
      challenge: inspected.challenge,
      verifiedAt: new Date().toISOString(),
      databaseId: DATABASE,
      parentScope: PARENT,
      schema: {
        titleProperty: "Name",
        titleType: "title",
        dataSourceId: DATA_SOURCE,
      },
    },
    document: {
      id: PAGE,
      scopeId: DATABASE,
      title: inspected.starter.title,
      body: inspected.starter.body,
      revision: "actual-read-back-revision",
    },
  };
}
function record(setup, id) {
  const inspected = setup.inspect(id);
  return setup.recordNotion(id, {
    version: 1,
    requestId: id,
    parentScope: PARENT,
    scopeId: DATABASE,
    dataSourceId: DATA_SOURCE,
    title: inspected.name,
    challenge: inspected.challenge,
  });
}

test("preview is read-only and final creation requires bound explicit authoring consent", (t) => {
  const { folder, parent, setup } = fixture(t),
    input = draft(setup, parent),
    checked = setup.preview(input);
  assert.equal(checked.authoringRequired, true);
  assert.equal(checked.authoring, false);
  assert.deepEqual(fs.readdirSync(parent), []);
  assert.equal(fs.existsSync(path.join(folder, "knowledge")), false);
  assert.throws(
    () => setup.create(input, checked.previewId),
    /Confirm scoped authoring/,
  );
  assert.throws(
    () =>
      setup.create(
        { ...input, authoring: true, name: "Changed" },
        checked.previewId,
      ),
    /Review the unchanged/,
  );
  assert.throws(
    () => setup.create({ ...input, authoring: true }, "forged"),
    /Review the unchanged/,
  );
  assert.deepEqual(fs.readdirSync(parent), []);
});

test("multi-home creation retains originals, creates new vault and uses explicit primary/mirror roles", (t) => {
  const { folder, parent, setup } = fixture(t),
    input = draft(setup, parent),
    result = create(setup, input),
    current = config(folder);
  assert.equal(result.status, "needs-assistant");
  assert.equal(result.primaryReady, true);
  assert.equal(current.sources.length, 3);
  assert.equal(current.custom, "kept");
  assert.equal(current.captureEnabled, false);
  assert.equal(current.sources[0].id, "original");
  const primary = current.sources.find((s) => s.type === "markdown"),
    mirror = current.sources.find((s) => s.type === "obsidian");
  assert.equal(primary.setupGroup.role, "primary");
  assert.equal(mirror.setupGroup.primarySourceId, primary.id);
  assert.equal(mirror.setupGroup.role, "mirror");
  assert.equal(primary.write, true);
  assert.equal(mirror.write, true);
  for (const source of [primary, mirror]) {
    assert.equal(fs.existsSync(path.join(source.root, "Concepts")), true);
    assert.equal(fs.existsSync(path.join(source.root, "Assets")), true);
    assert.match(
      fs.readFileSync(path.join(source.root, "Knowledge Base.md"), "utf8"),
      /not a learned concept/,
    );
    assert.equal(
      fs.statSync(path.join(source.root, ".recall-kb.json")).mode & 0o777,
      0o600,
    );
  }
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(mirror.root, ".obsidian", "app.json")),
    ),
    {},
  );
  assert.equal(fs.existsSync(path.join(primary.root, ".obsidian")), false);
  assert.equal(
    fs.statSync(path.join(folder, "knowledge/setup", result.id + ".json"))
      .mode & 0o777,
    0o600,
  );
  assert.equal(setup.list().requests.length, 1);
});

test("pending Notion primary never promotes a local mirror; nonmirrored home remains reference-only", (t) => {
  const { folder, parent, setup } = fixture(t),
    input = draft(setup, parent, ["markdown", "obsidian", "notion"], "notion");
  input.destinations[0].mirror = false;
  const result = create(setup, input);
  assert.equal(result.primaryReady, false);
  assert.equal(result.status, "needs-assistant");
  const newSources = config(folder).sources.filter((s) => s.setupGroup);
  assert.equal(newSources.length, 2);
  assert.equal(
    newSources.some((s) => s.setupGroup.role === "primary"),
    false,
  );
  assert.equal(newSources.find((s) => s.type === "markdown").write, false);
  assert.equal(
    newSources.find((s) => s.type === "markdown").setupGroup.role,
    "reference",
  );
  assert.equal(
    newSources.every(
      (s) => s.setupGroup.primarySourceId === result.primarySourceId,
    ),
    true,
  );
});

test("existing folders, escaped names, nested vaults and forged selections are rejected without writes", (t) => {
  const { parent, folder, setup } = fixture(t),
    input = draft(setup, parent, ["markdown"]);
  fs.mkdirSync(path.join(parent, input.destinations[0].folderName));
  fs.writeFileSync(
    path.join(parent, input.destinations[0].folderName, "keep.md"),
    "kept",
  );
  assert.throws(() => setup.preview(input), /already exists/);
  assert.equal(
    fs.readFileSync(
      path.join(parent, input.destinations[0].folderName, "keep.md"),
      "utf8",
    ),
    "kept",
  );
  for (const folderName of [
    "../escaped",
    "/tmp/escaped",
    ".hidden",
    "bad/name",
    "bad\\name",
  ])
    assert.throws(
      () =>
        setup.preview({
          ...input,
          destinations: [{ ...input.destinations[0], folderName }],
        }),
      /folder name/,
    );
  assert.throws(
    () =>
      setup.preview({
        ...input,
        destinations: [{ ...input.destinations[0], selectionId: "forged" }],
      }),
    /selection expired/,
  );
  assert.throws(() => setup.selectParent(folder), /outside Recall/);
  fs.mkdirSync(path.join(parent, ".obsidian"));
  assert.throws(
    () => setup.preview(draft(setup, parent, ["obsidian"], "obsidian")),
    /outside an existing Obsidian/,
  );
});

test("parent redirection, expiration and concurrent source edits invalidate the confirmed plan", (t) => {
  const { root, folder, parent, setup, advance } = fixture(t),
    input = draft(setup, parent, ["markdown"]),
    checked = setup.preview(input);
  saveConfig(folder, {
    sources: [
      ...config(folder).sources,
      {
        id: "concurrent",
        type: "markdown",
        root: path.join(root, "elsewhere"),
        write: false,
      },
    ],
  });
  assert.throws(
    () => setup.create({ ...input, authoring: true }, checked.previewId),
    /sources changed/,
  );
  const fresh = setup.preview(input);
  fs.renameSync(parent, parent + "-old");
  fs.symlinkSync(parent + "-old", parent);
  assert.throws(
    () => setup.create({ ...input, authoring: true }, fresh.previewId),
    /symbolic link/,
  );
  fs.unlinkSync(parent);
  fs.renameSync(parent + "-old", parent);
  const expiring = setup.preview(input);
  advance(16 * 60 * 1000);
  assert.throws(
    () => setup.create({ ...input, authoring: true }, expiring.previewId),
    /selection expired/,
  );
  assert.deepEqual(fs.readdirSync(parent), []);
});

test("repeating a completed local setup never duplicates sources or overwrites edited notes", (t) => {
  const { folder, parent, setup } = fixture(t),
    input = draft(setup, parent, ["markdown"]),
    checked = setup.preview(input),
    authored = { ...input, authoring: true },
    result = setup.create(authored, checked.previewId),
    target = result.destinations[0];
  fs.appendFileSync(
    path.join(target.path, "Knowledge Base.md"),
    "\nMy own notes.\n",
  );
  assert.equal(setup.create(authored, checked.previewId).id, result.id);
  assert.equal(setup.retry(result.id).id, result.id);
  assert.equal(config(folder).sources.length, 2);
  assert.match(
    fs.readFileSync(path.join(target.path, "Knowledge Base.md"), "utf8"),
    /My own notes/,
  );
  assert.throws(
    () => setup.create({ ...authored, name: "Different" }, checked.previewId),
    /different request/,
  );
});

test("partial creation reports specific gaps and retries only owned unfinished work", (t) => {
  const { parent, setup } = fixture(t),
    input = draft(setup, parent, ["markdown", "obsidian"]),
    originalMkdir = fs.mkdirSync;
  fs.mkdirSync = function (file, options) {
    if (
      String(file) ===
      path.join(fs.realpathSync(parent), "My knowledge obsidian")
    )
      throw Object.assign(Error("Simulated permission denied"), {
        code: "EACCES",
      });
    return originalMkdir.call(this, file, options);
  };
  let result;
  try {
    result = create(setup, input);
  } finally {
    fs.mkdirSync = originalMkdir;
  }
  assert.equal(result.status, "partial");
  assert.equal(result.primaryReady, true);
  assert.match(result.destinations[1].error, /permission denied/);
  const first = result.destinations[0].path;
  fs.appendFileSync(path.join(first, "Knowledge Base.md"), "\nPreserve this.");
  const retried = setup.retry(result.id);
  assert.equal(retried.status, "ready");
  assert.match(
    fs.readFileSync(path.join(first, "Knowledge Base.md"), "utf8"),
    /Preserve this/,
  );
});

test("an interrupted starter note is preserved on retry and symlink setup storage is refused", (t) => {
  const { folder, parent, setup } = fixture(t),
    input = draft(setup, parent, ["markdown"]),
    originalWrite = fs.writeFileSync;
  fs.writeFileSync = function (file, ...args) {
    if (
      typeof file === "number" &&
      String(args[0]).includes("Your knowledge base starts here")
    )
      throw Error("Simulated starter-write failure");
    return originalWrite.call(this, file, ...args);
  };
  let result;
  try {
    result = create(setup, input);
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(result.status, "partial");
  fs.writeFileSync(
    path.join(result.destinations[0].path, "Knowledge Base.md"),
    "User content",
  );
  const retried = setup.retry(result.id);
  assert.equal(retried.status, "partial");
  assert.match(retried.destinations[0].error, /starter note changed/);
  assert.equal(
    fs.readFileSync(
      path.join(result.destinations[0].path, "Knowledge Base.md"),
      "utf8",
    ),
    "User content",
  );
  fs.renameSync(
    path.join(folder, "knowledge/setup"),
    path.join(folder, "knowledge/setup-old"),
  );
  fs.symlinkSync(parent, path.join(folder, "knowledge/setup"));
  assert.throws(() => setup.list(), /Unsafe knowledge setup/);
});

test("Notion needs real staged identity and source-linked fresh read-back attestation before registration", (t) => {
  const { folder, parent, setup } = fixture(t),
    result = create(setup, draft(setup, parent, ["notion"], "notion")),
    good = notionResult(setup, result.id);
  assert.equal(result.primaryReady, false);
  assert.match(
    setup.assistantPrompt(result.id).prompt,
    /never create a second one/,
  );
  assert.throws(
    () => setup.completeNotion(result.id, good),
    /Record the created/,
  );
  const recorded = record(setup, result.id);
  assert.equal(recorded.destinations[0].status, "remote-created");
  assert.equal(config(folder).sources.length, 1);
  for (const bad of [
    { ...good, verification: { ...good.verification, fetched: false } },
    {
      ...good,
      verification: { ...good.verification, challenge: crypto.randomUUID() },
    },
    { ...good, verification: { ...good.verification, parentScope: DATABASE } },
    {
      ...good,
      verification: {
        ...good.verification,
        verifiedAt: "2000-01-01T00:00:00Z",
      },
    },
    { ...good, document: { ...good.document, body: "Invented" } },
    { ...good, document: { ...good.document, revision: "" } },
    { ...good, scopeId: PAGE },
  ])
    assert.throws(() => setup.completeNotion(result.id, bad));
  assert.equal(config(folder).sources.length, 1);
  const done = setup.completeNotion(result.id, good);
  assert.equal(done.status, "ready");
  assert.equal(done.primaryReady, true);
  const source = config(folder).sources.find(
    (s) => s.id === done.primarySourceId,
  );
  assert.equal(source.scopeId, DATABASE);
  assert.equal(source.dataSourceId, DATA_SOURCE);
  assert.equal(source.setupTest.liveVerified, false);
  assert.deepEqual(source.propertyMap, { title: "Name" });
  const scanned = knowledge.scan(folder, source.id);
  assert.equal(scanned.documents.length, 1);
  assert.equal(scanned.documents[0].remoteId, PAGE);
  assert.equal(scanned.documents[0].sourceId, source.id);
  assert.equal(setup.completeNotion(result.id, good).id, done.id);
  assert.equal(config(folder).sources.length, 2);
});

test("Notion setup duplicates and wrong remote identities are rejected; pending requests survive a fresh service", (t) => {
  const { folder, parent, setup } = fixture(t),
    input = draft(setup, parent, ["notion"], "notion"),
    result = create(setup, input),
    inspected = setup.inspect(result.id);
  assert.throws(
    () => setup.preview({ ...input, requestId: crypto.randomUUID() }),
    /already exists/,
  );
  assert.throws(
    () =>
      setup.recordNotion(result.id, {
        version: 1,
        requestId: result.id,
        title: inspected.name,
        challenge: inspected.challenge,
        parentScope: PARENT,
        scopeId: DATABASE,
        dataSourceId: DATABASE,
      }),
    /actual data source/,
  );
  record(setup, result.id);
  assert.throws(
    () =>
      setup.recordNotion(result.id, {
        version: 1,
        requestId: result.id,
        title: inspected.name,
        challenge: inspected.challenge,
        parentScope: PARENT,
        scopeId: PAGE,
        dataSourceId: DATA_SOURCE,
      }),
    /already recorded another/,
  );
  const fresh = createKnowledgeBootstrap(folder);
  assert.equal(fresh.list().requests[0].id, result.id);
  assert.equal(
    fresh.list().requests[0].destinations[0].remote.scopeId,
    DATABASE,
  );
  assert.equal(fresh.retry(result.id).primaryReady, false);
  assert.match(
    fresh.assistantPrompt(result.id).prompt,
    /already created or recorded, reuse it/,
  );
});

test("public CLI exposes bounded setup inspection and only applies actual completion receipts explicitly", (t) => {
  const { folder, parent, setup } = fixture(t),
    result = create(setup, draft(setup, parent, ["notion"], "notion")),
    cwd = path.resolve(__dirname, ".."),
    receipt = path.join(parent, "receipt.json"),
    completion = path.join(parent, "completion.json"),
    inspected = setup.inspect(result.id);
  fs.writeFileSync(
    receipt,
    JSON.stringify({
      version: 1,
      requestId: result.id,
      parentScope: PARENT,
      scopeId: DATABASE,
      dataSourceId: DATA_SOURCE,
      title: inspected.name,
      challenge: inspected.challenge,
    }),
  );
  fs.writeFileSync(completion, JSON.stringify(notionResult(setup, result.id)));
  const run = (...args) =>
    spawnSync(
      process.execPath,
      ["cli/recall.cjs", "--data", folder, "kb", "setup", ...args],
      { cwd, encoding: "utf8" },
    );
  assert.equal(run("list").status, 0);
  assert.equal(
    JSON.parse(run("inspect", result.id).stdout).challenge,
    inspected.challenge,
  );
  assert.match(
    JSON.parse(run("prompt", result.id).stdout).prompt,
    /connected Notion tools/,
  );
  assert.notEqual(run("record", result.id, receipt).status, 0);
  assert.equal(config(folder).sources.length, 1);
  assert.equal(run("record", result.id, receipt, "--apply").status, 0);
  assert.equal(run("complete", result.id, completion, "--apply").status, 0);
  assert.equal(JSON.parse(run("inspect", result.id).stdout).status, "ready");
  assert.equal(fs.existsSync(path.join(folder, "recall.sqlite")), false);
});

test("readiness follows current source policy and never restores intentional removal or authoring edits", (t) => {
  const { folder, parent, setup } = fixture(t),
    result = create(setup, draft(setup, parent, ["markdown"])),
    sourceId = result.primarySourceId;
  saveConfig(folder, {
    sources: config(folder).sources.map((source) =>
      source.id === sourceId ? { ...source, write: false } : source,
    ),
  });
  assert.equal(setup.inspect(result.id).primaryReady, false);
  assert.equal(
    setup.inspect(result.id).destinations[0].status,
    "needs-attention",
  );
  assert.equal(setup.retry(result.id).primaryReady, false);
  assert.equal(
    config(folder).sources.find((source) => source.id === sourceId).write,
    false,
  );
  saveConfig(folder, {
    sources: config(folder).sources.filter((source) => source.id !== sourceId),
  });
  assert.equal(setup.inspect(result.id).status, "partial");
  assert.match(setup.inspect(result.id).destinations[0].error, /disconnected/);
  setup.retry(result.id);
  assert.equal(
    config(folder).sources.some((source) => source.id === sourceId),
    false,
  );
});

test("ready local roots and private request ownership reject redirects and hardlinked markers", (t) => {
  const { folder, parent, setup } = fixture(t),
    result = create(setup, draft(setup, parent, ["markdown"])),
    target = result.destinations[0],
    marker = path.join(target.path, ".recall-kb.json");
  fs.linkSync(marker, path.join(parent, "marker-hardlink"));
  assert.equal(setup.inspect(result.id).primaryReady, false);
  assert.match(
    setup.inspect(result.id).destinations[0].error,
    /ownership marker changed/,
  );
  fs.unlinkSync(path.join(parent, "marker-hardlink"));
  const file = path.join(folder, "knowledge/setup", result.id + ".json");
  fs.linkSync(file, path.join(parent, "request-hardlink"));
  assert.throws(() => setup.inspect(result.id), /Unsafe or oversized/);
  assert.equal(setup.list().issues.length, 1);
  assert.equal(setup.list().requests.length, 0);
});

test("assistant CLI examples preserve literal shell metacharacters in private profile paths", (t) => {
  const { root, parent } = fixture(t),
    folder = path.join(
      root,
      "profile $(printf substitution) `printf bad` 'quote",
    );
  saveConfig(folder, {});
  fs.mkdirSync(path.join(folder, "connections"));
  fs.writeFileSync(
    path.join(folder, "connections", "recall"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o700 },
  );
  const setup = createKnowledgeBootstrap(folder),
    result = create(setup, draft(setup, parent, ["notion"], "notion")),
    prompt = setup.assistantPrompt(result.id).prompt,
    quoted = prompt.match(/^First run: (.+) kb setup inspect /m)?.[1];
  assert.ok(quoted);
  const shown = spawnSync("/bin/sh", ["-c", "printf '%s' " + quoted], {
    encoding: "utf8",
  });
  assert.equal(shown.status, 0);
  assert.equal(shown.stdout, path.join(folder, "connections", "recall"));
  assert.match(prompt, /Untrusted setup data/);
});

test("Notion completion binds the starter body and real title-property/data-source schema", (t) => {
  const { parent, setup } = fixture(t),
    result = create(setup, draft(setup, parent, ["notion"], "notion")),
    good = notionResult(setup, result.id);
  record(setup, result.id);
  for (const bad of [
    {
      ...good,
      document: {
        ...good.document,
        body: good.document.body + "Injected unrelated learning.",
      },
    },
    {
      ...good,
      verification: {
        ...good.verification,
        schema: {
          titleProperty: "Wrong",
          titleType: "title",
          dataSourceId: DATA_SOURCE,
        },
      },
    },
    {
      ...good,
      verification: {
        ...good.verification,
        schema: {
          titleProperty: "Name",
          titleType: "text",
          dataSourceId: DATA_SOURCE,
        },
      },
    },
    {
      ...good,
      verification: {
        ...good.verification,
        schema: {
          titleProperty: "Name",
          titleType: "title",
          dataSourceId: DATABASE,
        },
      },
    },
  ])
    assert.throws(() => setup.completeNotion(result.id, bad));
  assert.equal(setup.inspect(result.id).primaryReady, false);
});

test("fresh-clone Notion setup remains pending until the installed assistant bridge is executable", (t) => {
  const { folder, parent, setup } = fixture(t),
    launcher = path.join(folder, "connections", "recall");
  fs.unlinkSync(launcher);
  const result = create(setup, draft(setup, parent, ["notion"], "notion"));
  assert.equal(result.status, "needs-assistant");
  assert.equal(setup.list().launcherReady, false);
  assert.throws(
    () => setup.assistantPrompt(result.id),
    /Connect Codex or Claude.*pending setup is preserved/,
  );
  assert.equal(setup.inspect(result.id).primaryReady, false);
  fs.writeFileSync(launcher, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  assert.equal(setup.list().launcherReady, true);
  assert.match(setup.assistantPrompt(result.id).prompt, /kb setup inspect/);
  fs.chmodSync(launcher, 0o600);
  assert.equal(setup.list().launcherReady, false);
  fs.chmodSync(launcher, 0o700);
  fs.linkSync(launcher, path.join(parent, "hardlinked-launcher"));
  assert.equal(setup.list().launcherReady, false);
});

test("staged Notion identity permits one-way enrichment after fetching the same database", (t) => {
  const { parent, setup } = fixture(t),
    result = create(setup, draft(setup, parent, ["notion"], "notion")),
    inspected = setup.inspect(result.id),
    receipt = {
      version: 1,
      requestId: result.id,
      parentScope: PARENT,
      scopeId: DATABASE,
      title: inspected.name,
      challenge: inspected.challenge,
    };
  setup.recordNotion(result.id, receipt);
  assert.equal(
    setup.inspect(result.id).destinations[0].remote.dataSourceId,
    undefined,
  );
  // A create response may expose only the database; the read-back supplies
  // its actual initial data source before the source becomes usable.
  const good = notionResult(setup, result.id);
  assert.equal(setup.completeNotion(result.id, good).status, "ready");
  assert.equal(
    setup.inspect(result.id).destinations[0].remote.dataSourceId,
    DATA_SOURCE,
  );
  assert.throws(
    () => setup.recordNotion(result.id, receipt),
    /already recorded another/,
  );
  assert.throws(
    () => setup.recordNotion(result.id, { ...receipt, dataSourceId: PAGE }),
    /already recorded another/,
  );
});

test("recorded Notion identities can enrich an absent data source but never replace or drop it", (t) => {
  const { parent, setup } = fixture(t),
    result = create(setup, draft(setup, parent, ["notion"], "notion")),
    inspected = setup.inspect(result.id),
    receipt = {
      version: 1,
      requestId: result.id,
      parentScope: PARENT,
      scopeId: DATABASE,
      title: inspected.name,
      challenge: inspected.challenge,
    };
  setup.recordNotion(result.id, receipt);
  setup.recordNotion(result.id, { ...receipt, dataSourceId: DATA_SOURCE });
  assert.equal(
    setup.inspect(result.id).destinations[0].remote.dataSourceId,
    DATA_SOURCE,
  );
  assert.throws(
    () =>
      setup.recordNotion(result.id, {
        ...receipt,
        scopeId: PAGE,
        dataSourceId: DATA_SOURCE,
      }),
    /already recorded another/,
  );
  assert.throws(
    () => setup.recordNotion(result.id, receipt),
    /already recorded another/,
  );
  assert.throws(
    () => setup.recordNotion(result.id, { ...receipt, dataSourceId: PAGE }),
    /already recorded another/,
  );
  assert.equal(
    setup.completeNotion(result.id, notionResult(setup, result.id)).status,
    "ready",
  );
});

test("completed Notion prompts honor intentional disconnection and changed authoring policy", (t) => {
  const { folder, parent, setup } = fixture(t),
    result = create(setup, draft(setup, parent, ["notion"], "notion"));
  record(setup, result.id);
  const done = setup.completeNotion(result.id, notionResult(setup, result.id));
  assert.match(setup.assistantPrompt(result.id).prompt, /already configured/);
  saveConfig(folder, {
    sources: config(folder).sources.map((source) =>
      source.id === done.primarySourceId ? { ...source, write: false } : source,
    ),
  });
  assert.throws(
    () => setup.assistantPrompt(result.id),
    /authoring policy changed/,
  );
  assert.equal(
    config(folder).sources.find((source) => source.id === done.primarySourceId)
      .write,
    false,
  );
  saveConfig(folder, {
    sources: config(folder).sources.filter(
      (source) => source.id !== done.primarySourceId,
    ),
  });
  assert.throws(() => setup.assistantPrompt(result.id), /disconnected/);
  assert.equal(
    config(folder).sources.some((source) => source.id === done.primarySourceId),
    false,
  );
});
