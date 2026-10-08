#!/usr/bin/env node
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
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
  "recall [--data DIR] init | doctor | config FILE | demo | cards validate/import/import-status/search/link/trust | kb scan/search/save/asset/ingest/ack/setup | connections status/connect/disconnect/config | catch-up scan | inbox status/add/inspect/preview/prepare DIGEST/submit/apply/retry | capture FILE | self-test status/prepare | backup [DIR] | restore DIR --apply | skills install DIR";
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
(async () => {
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
        captureEnabled: config(folder).captureEnabled,
        runtimes: require("../electron/runtime-info.cjs").diagnostics(folder),
        sources: config(folder).sources.map((s) => ({
          id: s.id,
          type: s.type,
          write: !!s.write,
          available:
            s.type === "notion"
              ? !!s.scopeId
              : !!s.root && fs.existsSync(s.root),
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
        const pack = json(rest[0]);
        try {
          result = withStore((s) =>
            bundles.importPack(s, pack, { apply, widgets }),
          );
        } catch (error) {
          if (error.code !== "RECALL_WRITER_BUSY") throw error;

          result = apply
            ? require("../electron/card-imports.cjs").enqueue(folder, pack, {
                widgets,
              })
            : readonly((db) =>
                bundles.preview(
                  { db },
                  {
                    ...bundles.normalizePack(pack),
                    cards: bundles
                      .normalizePack(pack)
                      .cards.map((c) => ({
                        ...c,
                        widgetsAllowed: widgets && c.widgetsAllowed === true,
                      })),
                  },
                ),
              );
        }
      } else if (action === "import-status") {
        result = require("../electron/card-imports.cjs").status(
          folder,
          rest[0],
        );
      } else if (action === "search")
        result = readonly((db) =>
          db
            .prepare("SELECT content,suspended FROM cards")
            .all()
            .map((r) => ({
              ...JSON.parse(r.content),
              suspended: !!r.suspended,
            }))
            .filter((c) =>
              rest
                .join(" ")
                .toLowerCase()
                .split(/\s+/)
                .every((t) =>
                  `${c.id} ${c.conceptId} ${c.title} ${c.prompt} ${c.answer} ${c.tags?.join(" ")} ${c.source}`
                    .toLowerCase()
                    .includes(t),
                ),
            ),
        );
      else if (action === "link") {
        if (rest.length !== 1) throw Error("Usage: recall cards link CARD_ID");
        result = readonly((db) => {
          const row = db
            .prepare("SELECT content,suspended FROM cards WHERE id=?")
            .get(rest[0]);
          if (!row) throw Error("Card not found in this library");
          const card = JSON.parse(row.content);
          const url = require("../electron/card-links.cjs").cardLink(card.id);
          return {
            id: card.id,
            title: card.title,
            url,
            markdown: `[Open in Recall](${url})`,
            available: card.status === "ready" && !row.suspended,
          };
        });
      } else if (action === "trust") {
        if (!apply)
          throw Error(
            "Review the exercise and validation report, then use --apply to trust this exact code",
          );
        const { Store } = require("../electron/store.cjs");
        const store = new Store(folder);
        try {
          result = await bundles.reviewCode(store, rest[0], json(rest[1]));
        } finally {
          store.close();
        }
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
      if (action === "setup") {
        const setup =
            require("../electron/knowledge-bootstrap.cjs").createKnowledgeBootstrap(
              folder,
            ),
          [operation, id, file] = rest;
        if (operation === "list") result = setup.list();
        else if (operation === "inspect") result = setup.inspect(id);
        else if (operation === "prompt") result = setup.assistantPrompt(id);
        else if (operation === "record" || operation === "complete") {
          if (!apply)
            throw Error(
              "Use --apply only after a real connector creation or read-back.",
            );

          const input = JSON.parse(
            require("../electron/private-files.cjs").read(
              path.resolve(file),
              256 * 1024,
            ),
          );
          result =
            operation === "record"
              ? setup.recordNotion(id, input)
              : setup.completeNotion(id, input);
        } else
          throw Error(
            "kb setup list | inspect ID | prompt ID | record ID RECEIPT.json --apply | complete ID RESULT.json --apply",
          );
      } else if (action === "scan") result = kb.scan(folder, rest[0]);
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
        if (!apply)
          throw Error("Use --apply to retain fetched Notion snapshots");
        result = kb.ingestNotion(folder, rest[0], json(rest[1]));
      } else if (action === "ack") {
        if (!apply)
          throw Error(
            "Use --apply after fetching and verifying the written page",
          );
        result = kb.acknowledge(folder, rest[0], json(rest[1]));
      } else throw Error(usage);
    } else if (command === "connections") {
      const c = require("../electron/connections.cjs");
      if (action === "status") result = c.status(folder);
      else if (action === "connect")
        result = c.connect(folder, rest[0], { apply });
      else if (action === "disconnect") {
        if (!apply) throw Error("Use --apply to disconnect");
        result = c.disconnect(folder, rest[0]);
      } else if (action === "config")
        result = apply
          ? c.save(folder, json(rest[0]))
          : { mode: "preview", patch: json(rest[0]) };
      else
        throw Error(
          "connections status | connect codex/claude [--apply] | disconnect codex/claude --apply | config FILE --apply",
        );
    } else if (command === "catch-up" && action === "scan") {
      result = require("../electron/catch-up.cjs").scan(folder);
    } else if (command === "inbox") {
      const inbox = require("../electron/inbox.cjs");
      const cards = () =>
        readonly((db) =>
          db
            .prepare("SELECT content,suspended FROM cards")
            .all()
            .map((r) => ({
              ...JSON.parse(r.content),
              suspended: !!r.suspended,
            })),
        );
      if (action === "status") result = inbox.summary(folder);
      else if (action === "inspect") {
        result = inbox.read(folder).items.find((i) => i.id === rest[0]);
        if (!result) throw Error("Inbox item not found");
      } else if (action === "add")
        result = inbox.add(folder, json(rest[0]), cards());
      else if (action === "submit")
        result = inbox.submit(folder, rest[0], json(rest[1]));
      else if (action === "apply")
        result = withStore((s) => inbox.applyPending(s));
      else if (action === "retry") result = inbox.retry(folder, rest[0]);
      else if (action === "preview")
        result = require("../electron/learning-worker.cjs").preview(
          folder,
          cards(),
        );
      else if (action === "prepare") {
        // Same rule as the desktop: the context is sent to a provider only
        // after it was previewed, proven by the preview's digest.
        if (!/^[a-f0-9]{64}$/.test(rest[0] || ""))
          throw Error(
            "inbox prepare DIGEST: run `inbox preview`, read the selected context and pass its digest",
          );
        result = await require("../electron/learning-worker.cjs").prepare(
          folder,
          cards(),
          { expectedDigest: rest[0] },
        );
      } else
        throw Error(
          "inbox status | inspect ID | add FILE | submit ID FILE | apply | preview | prepare DIGEST | retry ID",
        );
    } else if (command === "capture") {
      if (!config(folder).captureEnabled)
        throw Error(
          "Learning capture is disabled. Enable captureEnabled in your profile configuration to opt in.",
        );
      result = require("../electron/self-test.cjs").capture(
        folder,
        json(action),
      );
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
        rest[0] ||
          path.join(
            process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
            "skills",
          ),
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
          require("../shared/copy-tree.cjs").copyTree(
            path.join(source, name),
            path.join(destination, name),
            {
              recursive: true,
            },
          );
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
})();
