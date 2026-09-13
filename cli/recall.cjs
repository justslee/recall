#!/usr/bin/env node
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { spawnSync } = require("node:child_process");
const {
  dataDir,
  config,
  saveConfig,
  atomic,
} = require("../electron/config.cjs");
const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf("--" + name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--"))
    throw Error("Missing --" + name + " value");
  args.splice(i, 2);
  return value;
}
function flag(name) {
  const i = args.indexOf("--" + name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
const folder = dataDir(option("data"));
const apply = flag("apply"),
  json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const usage =
  "recall [--data DIR] init | doctor | config FILE | demo | cards validate/import/search/trust | kb scan/search/save/asset/ingest/ack | capture FILE | self-test status/prepare | backup [DIR] | restore DIR --apply | skills install DIR";
function withStore(fn) {
  const { Store } = require("../electron/store.cjs");
  const s = new Store(folder);
  try {
    return fn(s);
  } finally {
    s.close();
  }
}
function readonly(fn) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(folder, "recall.sqlite"), {
    readOnly: true,
  });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
try {
  const [command, action, ...rest] = args;
  let result;
  if (command === "init") {
    result = withStore((s) => ({ folder, cards: s.cards().length }));
    if (!fs.existsSync(path.join(folder, "config.json")))
      saveConfig(folder, {});
  } else if (command === "doctor")
    result = {
      folder,
      configExists: fs.existsSync(path.join(folder, "config.json")),
      libraryExists: fs.existsSync(path.join(folder, "recall.sqlite")),
      node: process.version,
      platform: process.platform,
      runtimes: Object.fromEntries(
        ["python3", "clang++"].map((c) => {
          const r = spawnSync("/usr/bin/" + c, ["--version"], {
            encoding: "utf8",
          });
          return [
            c,
            {
              available: r.status === 0,
              version: (r.stdout || r.stderr || "Not available").split("\n")[0],
            },
          ];
        }),
      ),
      sources: config(folder).sources.map((s) => ({
        id: s.id,
        type: s.type,
        write: !!s.write,
        available:
          s.type === "notion" ? !!s.scopeId : !!s.root && fs.existsSync(s.root),
      })),
    };
  else if (command === "config") {
    const next = json(action);
    if (
      next.sources?.some(
        (s) =>
          !s.id ||
          !["markdown", "obsidian", "notion"].includes(s.type) ||
          (s.type === "notion" && !s.scopeId) ||
          (s.type !== "notion" && !path.isAbsolute(s.root || "")),
      )
    )
      throw Error(
        "Each source needs an ID, supported type, and absolute root or Notion scopeId",
      );
    result = apply
      ? saveConfig(folder, next)
      : { mode: "preview", configuration: next };
  } else if (command === "demo")
    result = withStore((s) =>
      require("../electron/bundles.cjs").importPack(
        s,
        require("../examples/demo.json"),
        { apply, widgets: true },
      ),
    );
  else if (command === "cards") {
    const bundles = require("../electron/bundles.cjs");
    if (action === "validate") {
      const pack = bundles.normalizePack(json(rest[0]));
      result = { valid: true, cards: pack.cards.length };
    } else if (action === "import") {
      const widgets = flag("allow-widgets");
      result = withStore((s) =>
        bundles.importPack(s, json(rest[0]), { apply, widgets }),
      );
    } else if (action === "search")
      result = readonly((db) =>
        db
          .prepare("SELECT content,suspended FROM cards")
          .all()
          .map((r) => ({ ...JSON.parse(r.content), suspended: !!r.suspended }))
          .filter((c) =>
            rest
              .join(" ")
              .toLowerCase()
              .split(/\s+/)
              .every((t) =>
                `${c.title} ${c.answer} ${c.source}`.toLowerCase().includes(t),
              ),
          ),
      );
    else if (action === "trust") {
      if (!apply)
        throw Error(
          "Review the exercise and validation report, then use --apply to trust this exact code",
        );
      result = withStore((s) => bundles.trustCode(s, rest[0], json(rest[1])));
    } else throw Error(usage);
  } else if (command === "catalog" && action === "import") {
    const raw = json(rest[0]),
      catalog = require("../electron/catalog.cjs");
    catalog.validateBundle(raw);
    result = withStore((store) => {
      if (!apply)
        return {
          ...require("../electron/bundles.cjs").preview(store, {
            schemaVersion: 1,
            id: raw.catalogId,
            title: raw.title,
            cards: raw.cards,
          }),
          mode: "preview",
        };
      const backup = store.backup();
      return { ...catalog.syncCatalog(store, raw), backup };
    });
  } else if (command === "kb") {
    const kb = require("../adapters/knowledge.cjs");
    if (action === "scan") result = kb.scan(folder, rest[0]);
    else if (action === "search")
      result = kb.search(folder, rest[0], rest.slice(1).join(" "));
    else if (action === "save")
      result = kb.save(folder, rest[0], json(rest[1]), {
        apply,
        expectedRevision: option("revision"),
      });
    else if (action === "asset")
      result = kb.asset(folder, rest[0], rest[1], rest[2]);
    else if (action === "ingest") {
      if (!apply) throw Error("Use --apply to retain fetched Notion snapshots");
      result = kb.ingestNotion(folder, rest[0], json(rest[1]));
    } else if (action === "ack") {
      if (!apply)
        throw Error(
          "Use --apply after fetching and verifying the written page",
        );
      result = kb.acknowledge(folder, rest[0], json(rest[1]));
    } else throw Error(usage);
  } else if (command === "capture") {
    if (!config(folder).captureEnabled)
      throw Error(
        "Learning capture is disabled. Enable captureEnabled in your profile configuration to opt in.",
      );
    result = require("../electron/self-test.cjs").capture(folder, json(action));
  } else if (command === "self-test") {
    const st = require("../electron/self-test.cjs");
    if (action === "prepare") result = st.prepare(folder);
    else if (action === "status") result = st.read(folder);
    else if (action === "link")
      result = st.link(folder, rest[0], rest.slice(1));
    else throw Error(usage);
  } else if (command === "backup")
    result = withStore((s) =>
      require("../electron/backup.cjs").backup(s, action),
    );
  else if (command === "restore") {
    if (!apply)
      throw Error(
        "Restore replaces this profile after saving its current state; use --apply",
      );
    result = require("../electron/backup.cjs").restore(folder, action);
  } else if (command === "skills" && action === "install") {
    const destination = path.resolve(
      rest[0] || path.join(os.homedir(), ".codex/skills"),
    );
    const source = path.join(__dirname, "../skills");
    const names = fs
      .readdirSync(source)
      .filter((n) => fs.existsSync(path.join(source, n, "SKILL.md")));
    for (const name of names)
      if (fs.existsSync(path.join(destination, name)))
        throw Error(
          "Skill already exists; preserve/reconcile it explicitly: " + name,
        );
    if (apply) {
      fs.mkdirSync(destination, { recursive: true });
      for (const name of names)
        fs.cpSync(path.join(source, name), path.join(destination, name), {
          recursive: true,
        });
    }
    result = {
      mode: apply ? "installed" : "preview",
      destination,
      skills: names,
    };
  } else throw Error(usage);
  console.log(JSON.stringify(result ?? { ok: true }, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
