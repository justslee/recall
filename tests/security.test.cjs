const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { Store } = require("../electron/store.cjs"),
  { saveConfig } = require("../electron/config.cjs"),
  inbox = require("../electron/inbox.cjs"),
  worker = require("../electron/learning-worker.cjs"),
  st = require("../electron/self-test.cjs"),
  connections = require("../electron/connections.cjs"),
  catchUp = require("../electron/catch-up.cjs");
const {
  exerciseHash,
  canRunExercise,
} = require("../electron/exercise-trust.cjs");
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-security-")),
    folder = path.join(root, "profile");
  saveConfig(folder, { captureEnabled: true, timeZone: "UTC" });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, folder };
}
const objective = (id = "objective") => ({
  id,
  sessionId: "reading",
  title: "Weighted mean",
  objective: "Explain a weighted mean",
  context: "Comparing course grades",
  at: "2026-09-27T15:00:00Z",
  evidence: "discussed",
  cardIds: [],
});

test("inbox reports cannot grant execution trust, and preserve existing approval and history", (t) => {
  const { folder } = setup(t),
    store = new Store(folder);
  t.after(() => store.close());
  const cards = structuredClone(require("../examples/demo.json").cards);
  store.import(cards);
  const trusted = cards.find((c) => c.kind === "code");
  store.set("validated-code:" + trusted.id, {
    sha256: exerciseHash(trusted),
    validatedAt: "previous-review",
  });
  const before = store.cards();
  const card = {
    ...trusted,
    id: "proposed-code",
    code: {
      python: {
        stub: "raise NotImplementedError",
        solution: "raise AssertionError('not validated')",
        harness: "raise AssertionError('cannot pass')",
      },
    },
  };
  inbox.add(folder, objective(), store.cards());
  inbox.submit(folder, "objective", {
    captures: [{ cardIds: [card.id] }],
    pack: {
      schemaVersion: 1,
      id: "proposal",
      title: "Proposal",
      cards: [card],
    },
    quality: { reviewedCardIds: [card.id], evidence: "Proposed content only" },
    codeReport: {
      version: 1,
      validatedAt: "claimed",
      exercises: [
        {
          id: card.id,
          sha256: exerciseHash(card),
          languages: {
            python: {
              reference: "passed",
              stub: "failed",
              rejectedMutants: ["claimed"],
            },
          },
        },
      ],
    },
  });
  assert.equal(inbox.applyPending(store).applied, 1);
  assert.equal(
    canRunExercise(card, (k) => store.get(k)),
    false,
  );
  assert.equal(
    canRunExercise(trusted, (k) => store.get(k)),
    true,
  );
  assert.deepEqual(
    store.cards().filter((c) => c.id !== card.id),
    before,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM reviews").get().n,
    0,
  );
});

test("every preparation attempt has fresh files and bounded, metadata-free context", (t) => {
  const { root, folder } = setup(t);
  st.capture(folder, objective("current"));
  st.capture(folder, {
    ...objective("other"),
    sessionId: "unrelated",
    objective: "UNRELATED_HISTORY_MARKER",
  });
  const item = {
    id: "same-item",
    input: {
      type: "objective",
      capture: objective(),
      source: "PRIVATE_SOURCE_PATH",
    },
  };
  const cards = structuredClone(require("../examples/demo.json").cards);
  cards[0].original = { secret: "ORIGINAL_METADATA_MARKER" };
  cards.push({
    ...cards[0],
    id: "unrelated",
    title: "Photosynthesis",
    prompt: "Explain chloroplasts",
    tags: ["botany"],
    answer: "UNRELATED_LIBRARY_MARKER",
  });
  const first = worker.request(folder, item, cards);
  const canary = path.join(root, "outside.txt");
  fs.writeFileSync(canary, "preserve");
  fs.symlinkSync(canary, path.join(first.stage, "request.md"));
  fs.writeFileSync(
    path.join(first.stage, "CLAUDE.md"),
    "OLD_INSTRUCTION_MARKER",
  );
  const second = worker.request(folder, item, cards);
  assert.notEqual(second.stage, first.stage);
  assert.equal(fs.readFileSync(canary, "utf8"), "preserve");
  assert.deepEqual(fs.readdirSync(second.stage), []);
  for (const marker of [
    "ORIGINAL_METADATA_MARKER",
    "UNRELATED_LIBRARY_MARKER",
    "UNRELATED_HISTORY_MARKER",
    "OLD_INSTRUCTION_MARKER",
    "PRIVATE_SOURCE_PATH",
  ])
    assert(!second.prompt.includes(marker));
  assert(second.selected.payload.candidates.some((c) => c.id === cards[0].id));
  assert.equal(second.selected.captureCount, 1);
  assert.equal(fs.statSync(second.stage).mode & 0o777, 0o700);
});

test("catch-up uses real project identities and fails closed on unavailable exclusions", (t) => {
  const { root: home, folder } = setup(t);
  connections.connect(folder, "codex", { home, apply: true });
  const excluded = path.join(home, "excluded"),
    allowed = path.join(home, "excluded-sibling"),
    alias = path.join(home, "alias");
  fs.mkdirSync(excluded);
  fs.mkdirSync(allowed);
  fs.symlinkSync(excluded, alias);
  const scope = {
    enabled: true,
    allProjects: true,
    projects: [],
    exclude: [excluded],
    since: "2026-09-01T00:00:00Z",
  };
  connections.save(folder, { catchUp: scope });
  const dir = path.join(home, ".codex/sessions");
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, cwd] of [
    ["direct", excluded],
    ["alias", alias],
    ["allowed", allowed],
  ]) {
    const rows = [
      { type: "session_meta", payload: { id, cwd } },
      ...["user", "assistant"].map((role) => ({
        timestamp: "2026-09-27T15:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role,
          channel: role === "assistant" ? "final" : undefined,
          content: [{ type: "text", text: "Explain weighted averages" }],
        },
      })),
    ];
    fs.writeFileSync(
      path.join(dir, id + ".jsonl"),
      rows.map(JSON.stringify).join("\n") + "\n",
    );
  }
  assert.equal(catchUp.scan(folder, { home }).queued, 1);
  assert.equal(
    inbox.read(folder).items[0].input.project,
    fs.realpathSync(allowed),
  );
  connections.save(folder, {
    catchUp: { ...scope, exclude: [path.join(home, "unavailable")] },
  });
  const blocked = catchUp.scan(folder, { home });
  assert.equal(blocked.queued, 0);
  assert(blocked.issues.some((i) => i.error.includes("scope is unavailable")));
  fs.mkdirSync(path.join(home, "unavailable"));
  assert.equal(catchUp.scan(folder, { home }).issues.length, 0);
});

test("private profile, captures, and backups remain owner-only with permissive umask", (t) => {
  const { folder } = setup(t),
    old = process.umask(0);
  let store;
  try {
    store = new Store(folder);
    store.import(require("../examples/demo.json").cards);
    st.capture(folder, objective());
    st.prepare(folder);
    const backup = require("../electron/backup.cjs").backup(store).backup;
    for (const f of [folder, path.join(folder, "self-tests"), backup])
      assert.equal(fs.statSync(f).mode & 0o777, 0o700);
    for (const f of [
      path.join(folder, "recall.sqlite"),
      path.join(backup, "recall.sqlite"),
      path.join(folder, "self-tests/days/2026-09-27.md"),
    ])
      assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    const jobs = path.join(folder, "learning-inbox/jobs");
    fs.mkdirSync(jobs, { recursive: true });
    fs.symlinkSync(folder, path.join(jobs, "old-attempt"));
    const second = require("../electron/backup.cjs").backup(store).backup;
    assert(!fs.existsSync(path.join(second, "learning-inbox/jobs")));
  } finally {
    store?.close();
    process.umask(old);
  }
});

test("provider configuration rejects ambient tools and credentials", (t) => {
  const { root } = setup(t),
    provider = require("../electron/preparation-provider.cjs");
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  for (const agent of ["codex", "claude"]) {
    const stage = path.join(root, agent);
    fs.mkdirSync(stage);
    const invocation = provider.invocation(
      agent,
      "/bin/echo",
      stage,
      "selected data",
      {
        home,
        environment: {
          OPENAI_API_KEY: "synthetic-auth",
          ANTHROPIC_API_KEY: "synthetic-auth",
          NODE_OPTIONS: "unwanted",
          AWS_SECRET_ACCESS_KEY: "unrelated",
        },
      },
    );
    assert.equal(invocation.binary, "/usr/bin/sandbox-exec");
    assert.equal(invocation.env.NODE_OPTIONS, undefined);
    assert.equal(invocation.env.AWS_SECRET_ACCESS_KEY, undefined);
    if (agent === "claude") {
      const args = invocation.argsForProvider;
      assert.equal(args[args.indexOf("--tools") + 1], "");
      assert(args.includes("--restricted"));
      assert(args.includes("--strict-mcp-config"));
    } else {
      assert(invocation.env.CODEX_HOME.startsWith(stage));
      assert(invocation.argsForProvider.includes("--ignore-user-config"));
      for (const flag of [
        "shell_tool",
        "apps",
        "plugins",
        "hooks",
        "browser_use",
        "computer_use",
        "view_image",
      ])
        assert(invocation.argsForProvider.includes(flag));
    }
  }
});

test("Codex preparation uses the saved connection home while keeping credentials and configuration isolated", (t) => {
  const { root } = setup(t);
  const codexHome = path.join(root, "selected-codex"),
    stage = path.join(root, "stage");
  fs.mkdirSync(codexHome);
  fs.mkdirSync(stage);
  fs.writeFileSync(
    path.join(codexHome, "auth.json"),
    JSON.stringify({ login: "synthetic-file-auth" }),
  );
  const invocation = require("../electron/preparation-provider.cjs").invocation(
    "codex",
    "/bin/echo",
    stage,
    "synthetic request",
    {
      home: root,
      environment: { CODEX_HOME: path.join(root, "other-codex") },
      codexHome,
    },
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(invocation.env.CODEX_HOME, "auth.json")),
    ),
    { login: "synthetic-file-auth" },
  );
  assert(invocation.env.CODEX_HOME.startsWith(stage));
  assert(invocation.argsForProvider.includes("--ignore-user-config"));
  assert(!invocation.env.CODEX_HOME.startsWith(codexHome));
});

test("preparation requires the previewed context and removes staging after provider failures", async (t) => {
  const { folder } = setup(t);
  const cards = require("../examples/demo.json").cards;
  inbox.add(folder, objective(), cards);
  const preview = worker.preview(folder, cards);
  const options = {
    resolveExecutable: () => "/bin/echo",
    verifyProvider: () => {},
    createInvocation: () => {
      throw Error("synthetic provider failure");
    },
  };
  await assert.rejects(
    () =>
      worker.prepare(folder, cards, {
        ...options,
        expectedDigest: "0".repeat(64),
      }),
    /context changed/,
  );
  assert.equal(inbox.read(folder).items[0].status, "pending");
  const result = await worker.prepare(folder, cards, {
    ...options,
    expectedDigest: preview.digest,
  });
  assert.match(result.error, /^\[provider-start\]/);
  assert.doesNotMatch(result.error, /synthetic provider failure/);
  assert.equal(inbox.read(folder).items[0].status, "blocked");
  assert.deepEqual(
    fs.readdirSync(path.join(folder, "learning-inbox/jobs")),
    [],
  );
});

test("catch-up redacts common credential shapes before an excerpt is stored", () => {
  // Fixtures are assembled at runtime so the repository never contains a
  // credential-shaped literal (scripts/audit-release.cjs scans for them).
  const run = (n, c = "A") => c.repeat(n);
  const secrets = {
    openai: "sk-" + "proj-" + run(32),
    anthropic: "sk-" + "ant-api03-" + run(32),
    github: "gh" + "p_" + run(36, "B"),
    aws: "AK" + "IA" + "IOSFODNN7EXAMPLE",
    slack: "xo" + "xb-123456789012-" + run(20, "C"),
    google: "AI" + "za" + "SyA-" + run(33, "D"),
    jwt: "eyJ" + run(12, "a") + "." + run(12, "b") + "." + run(12, "c"),
    bearer: run(36, "e"),
    password: "hunter" + run(1, "2") + "hunter" + run(1, "2"),
    apiKey: run(18, "Q"),
  };
  const leak = [
    "openai " + secrets.openai,
    "anthropic " + secrets.anthropic,
    "github " + secrets.github,
    "aws " + secrets.aws,
    "slack " + secrets.slack,
    "google " + secrets.google,
    "jwt " + secrets.jwt,
    "header Authorization: Bearer " + secrets.bearer,
    'config password = "' + secrets.password + '"',
    "config api_key: " + secrets.apiKey,
  ].join("\n");
  const row = {
    timestamp: "2026-09-29T20:00:00Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "text", text: leak }],
    },
  };
  const { text } = catchUp.message(row, "codex");
  for (const [name, secret] of Object.entries(secrets))
    assert.equal(text.includes(secret), false, "leaked " + name);
  assert.match(text, /openai \[credential removed\]/);
  assert.match(text, /Bearer \[credential removed\]/);
  assert.match(text, /password = "\[credential removed\]/);
});

test("inbox packs cannot enable interactive widgets on the cards they add", (t) => {
  const { folder } = setup(t),
    store = new Store(folder);
  t.after(() => store.close());
  const cards = structuredClone(require("../examples/demo.json").cards);
  store.import(cards);
  const card = {
    ...cards.find((c) => c.kind === "concept"),
    id: "proposed-widget",
    answer:
      "<p>Weighted</p>\n```widget Probe\n<script>parent.postMessage(1,'*')</script>\n```",
    widgetsAllowed: true,
  };
  inbox.add(folder, objective(), store.cards());
  inbox.submit(folder, "objective", {
    captures: [{ cardIds: [card.id] }],
    pack: {
      schemaVersion: 1,
      id: "widget-pack",
      title: "Widget",
      cards: [card],
    },
    quality: { reviewedCardIds: [card.id], evidence: "Proposed content only" },
  });
  assert.equal(inbox.applyPending(store).applied, 1);
  const stored = store.cards().find((c) => c.id === card.id);
  assert.ok(stored);
  assert.notEqual(stored.widgetsAllowed, true);
});

test("renderer and main process share one widget fence grammar", () => {
  const grammar = (file, name) => {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const m = source.match(new RegExp("const " + name + " = /(.*)/g;"));
    assert.ok(m, name + " not found in " + file);
    return m[1];
  };
  assert.equal(
    grammar("src/RichContent.jsx", "WIDGET_FENCE"),
    grammar("electron/widgets.cjs", "FENCE"),
  );
});

test("backups never carry an execution-trust file", (t) => {
  const { root, folder } = setup(t),
    store = new Store(folder);
  t.after(() => store.close());
  fs.writeFileSync(
    path.join(folder, "legacy-trust.json"),
    JSON.stringify({ demo: "0".repeat(64) }),
  );
  const target = path.join(root, "backup");
  require("../electron/backup.cjs").backup(store, target);
  assert.equal(fs.existsSync(path.join(target, "legacy-trust.json")), false);
  const manifest = fs.readFileSync(path.join(target, "manifest.json"), "utf8");
  assert.doesNotMatch(manifest, /legacy-trust/);
  assert.equal(
    fs
      .readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8")
      .includes("legacy-trust"),
    false,
  );
});

test("CLI inbox prepare refuses to run without the preview digest", (t) => {
  const { folder } = setup(t);
  const { spawnSync } = require("node:child_process");
  for (const extra of [[], ["not-a-digest"]]) {
    const r = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "../cli/recall.cjs"),
        "--data",
        folder,
        "inbox",
        "prepare",
        ...extra,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /inbox prepare DIGEST/);
  }
});
