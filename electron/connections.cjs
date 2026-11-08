const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { atomic, config } = require("./config.cjs");
const BEGIN = "<!-- recall-connection:begin -->",
  END = "<!-- recall-connection:end -->";
const file = (folder) => path.join(folder, "learning-connections.json");
function settings(folder) {
  const value = fs.existsSync(file(folder))
    ? JSON.parse(fs.readFileSync(file(folder), "utf8"))
    : {};
  return {
    version: 1,
    hosts: {},
    catchUp: {
      enabled: false,
      allProjects: false,
      projects: [],
      exclude: [],
      since: new Date().toISOString(),
    },
    agent: "codex",
    ...value,
  };
}
function save(folder, patch) {
  const next = { ...settings(folder), ...patch };
  if (!["codex", "claude"].includes(next.agent))
    throw Error("Choose Codex or Claude");
  const c = next.catchUp;
  if (
    typeof c.enabled !== "boolean" ||
    typeof c.allProjects !== "boolean" ||
    !Array.isArray(c.projects) ||
    !Array.isArray(c.exclude) ||
    [...c.projects, ...c.exclude].some((p) => !path.isAbsolute(p)) ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(c.since) ||
    !Number.isFinite(Date.parse(c.since))
  )
    throw Error("Invalid catch-up scope");
  if (c.enabled && !c.allProjects && !c.projects.length)
    throw Error("Choose at least one project or all projects");
  atomic(file(folder), next);
  return next;
}
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const profileMarker = (folder) =>
  `<!-- recall-profile:${crypto.createHash("sha256").update(path.resolve(folder)).digest("hex")} -->`;
function ownsConnection(folder, target) {
  if (!fs.existsSync(target.instructions) || !fs.existsSync(target.skill))
    return false;

  const instructions = fs.readFileSync(target.instructions, "utf8"),
    skill = fs.readFileSync(target.skill, "utf8"),
    start = instructions.indexOf(BEGIN),
    end = instructions.indexOf(END),
    marker = profileMarker(folder);
  if (start < 0 || end < start) return false;

  const block = instructions.slice(start, end + END.length);
  if (block.includes(marker) && skill.includes(marker)) return true;

  // Older installations have no ownership marker; their exact launcher and
  // selected-library text still bind the bridge to one local profile.
  return (
    !block.includes("<!-- recall-profile:") &&
    !skill.includes("<!-- recall-profile:") &&
    block.includes(target.skill) &&
    skill.includes(`The selected library is ${folder}.`) &&
    skill.includes(`\`${path.join(folder, "connections", "recall")}\``)
  );
}
function targets(
  host,
  { home = os.homedir(), environment = process.env } = {},
) {
  if (!["codex", "claude"].includes(host)) throw Error("Unknown assistant");
  const root =
    host === "codex" && environment.CODEX_HOME
      ? path.resolve(environment.CODEX_HOME)
      : path.join(home, "." + host);
  return {
    instructions: path.join(root, host === "codex" ? "AGENTS.md" : "CLAUDE.md"),
    skill: path.join(root, "skills", "recall-bridge", "SKILL.md"),
  };
}
function replaceBlock(text, block) {
  const a = text.indexOf(BEGIN),
    b = text.indexOf(END);
  if (
    a < 0 !== b < 0 ||
    (a >= 0 && b < a) ||
    text.indexOf(BEGIN, a + 1) >= 0 ||
    text.indexOf(END, b + 1) >= 0
  )
    throw Error(
      "Recall instruction markers are damaged; repair before updating",
    );
  return a < 0
    ? text.trimEnd() + "\n\n" + block + "\n"
    : text.slice(0, a) + block + text.slice(b + END.length);
}
function installUpgradeSkill(target, kit, backup) {
  const destination = path.join(
    path.dirname(path.dirname(target.skill)),
    "recall-upgrade",
  );
  const file = path.join(destination, "SKILL.md");
  const marker = "<!-- recall-managed:recall-upgrade -->";
  if (fs.lstatSync(destination, { throwIfNoEntry: false })) {
    if (
      fs.lstatSync(destination).isSymbolicLink() ||
      !fs.existsSync(file) ||
      !fs.lstatSync(file).isFile() ||
      !fs.readFileSync(file, "utf8").includes(marker)
    )
      return { installed: false, preservedExisting: true, path: destination };

    require("../shared/copy-tree.cjs").copyTree(
      destination,
      path.join(backup, "upgrade-skill"),
    );
  }
  require("../shared/copy-tree.cjs").copyTree(
    path.join(kit, "recall-upgrade"),
    destination,
  );
  return { installed: true, path: destination };
}
function connect(folder, host, options = {}) {
  const {
    apply = false,
    home = os.homedir(),
    environment = options.home ? {} : process.env,
    runtime = process.execPath,
    cli = path.resolve(__dirname, "../cli/recall.cjs"),
  } = options;
  const target = targets(host, { home, environment }),
    wrapper = path.join(folder, "connections", "recall"),
    kit = path.join(folder, "connections", "skills");
  const old = fs.existsSync(target.instructions)
    ? fs.readFileSync(target.instructions, "utf8")
    : "";
  const block = `${BEGIN}\n${profileMarker(folder)}\nAnswer substantive learning questions first. For enabled capture, use the Recall bridge skill at ${target.skill} for one bounded local lookup and a short capture receipt. Publish KB notes on request and prepare missing cards separately. Honor opt-out and preserve review state.\n${END}`;
  const instructions = replaceBlock(old, block);
  const skill = `---
name: recall-bridge
description: Capture substantive learning in the local Recall inbox after answering. Reuse ready cards and defer missing card work to preparation.
---
# Recall connection

${profileMarker(folder)}
Use this CLI from any directory: \`${wrapper}\`. The selected library is ${folder}.

For ordinary learning questions, follow ${path.join(kit, "recall-source/references/active-reading.md")}. Give the useful answer first. For enabled capture, make one bounded local lookup and submit a concise objective with \`inbox add FILE\`. The command enforces capture pause. Reuse an exact ready, unsuspended match or queue the gap. Use a verified card link for a ready match or a short queued receipt. Leave live KB work and card authoring for their separate workflows.

Capture JSON takes a stable id, sessionId, title, objective, context, actual ISO timestamp at, evidence (discussed/explained/solved), source, optional kbUrl and cardIds. Use an empty cardIds array for a gap. If a reused card leaves a specific gap, include needsAuthoring and a reason. Respect opt-out and exclude routine operations, raw transcripts, secrets and assistant-only work.

For requested KB publishing, read ${path.join(kit, "recall-source/references/knowledge.md")}. For explicit or scheduled preparation, read ${path.join(kit, "recall-source/references/inbox.md")} and use the installed personal authoring skills or the portable kit at ${kit}. Submit validated results with \`inbox submit ITEM_ID RESULT_FILE\`. The open app applies results through its writer. With the app closed, use \`inbox apply\`. Preserve review state.

After an authorized local KB save or card import, use ${path.join(kit, "recall-taxonomy/SKILL.md")} to maintain broader-to-specific placement through the installed taxonomy commands. Keep classification receipts separate from content creation; the app computes expertise from recorded assessments.
`;
  if (
    fs.existsSync(target.skill) &&
    !fs.readFileSync(target.skill, "utf8").includes("# Recall connection")
  )
    throw Error("An unrelated recall-bridge skill already exists; preserve it");
  if (!apply)
    return {
      mode: "preview",
      host,
      ...target,
      wrapper,
      upgradeSkill: path.join(
        path.dirname(path.dirname(target.skill)),
        "recall-upgrade",
      ),
      instructionBlock: block,
    };
  const backup = path.join(
    folder,
    "connections",
    "backups",
    host + "-" + Date.now(),
  );
  fs.mkdirSync(backup, { recursive: true });
  for (const [name, destination] of Object.entries(target))
    if (fs.existsSync(destination))
      fs.copyFileSync(destination, path.join(backup, name + ".md"));
  fs.mkdirSync(path.dirname(target.instructions), { recursive: true });
  fs.mkdirSync(path.dirname(target.skill), { recursive: true });
  fs.writeFileSync(target.instructions, instructions, { mode: 0o600 });
  fs.writeFileSync(target.skill, skill, { mode: 0o600 });
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  if (fs.existsSync(kit))
    fs.cpSync(kit, path.join(backup, "portable-skills"), { recursive: true });
  require("../shared/copy-tree.cjs").copyTree(
    path.resolve(__dirname, "../skills"),
    kit,
  );
  fs.writeFileSync(
    wrapper,
    `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(runtime)} ${quote(cli)} --data ${quote(folder)} "$@"\n`,
    { mode: 0o700 },
  );
  fs.chmodSync(wrapper, 0o700);
  const value = settings(folder);
  save(folder, {
    hosts: {
      ...value.hosts,
      [host]: {
        connected: true,
        ...target,
        connectedAt: new Date().toISOString(),
      },
    },
  });
  const upgradeSkill = installUpgradeSkill(target, kit, backup);
  return { connected: host, backup, wrapper, upgradeSkill };
}
function disconnect(folder, host, options = {}) {
  if (!["codex", "claude"].includes(host)) throw Error("Unknown assistant");
  const saved = settings(folder).hosts[host];
  const t = saved
      ? { instructions: saved.instructions, skill: saved.skill }
      : targets(host, {
          home: options.home || os.homedir(),
          environment: options.environment || (options.home ? {} : process.env),
        }),
    owned = ownsConnection(folder, t),
    old = fs.existsSync(t.instructions)
      ? fs.readFileSync(t.instructions, "utf8")
      : "";
  const backup = path.join(
    folder,
    "connections",
    "backups",
    host + "-disconnect-" + Date.now(),
  );
  fs.mkdirSync(backup, { recursive: true });
  for (const [name, destination] of Object.entries(t))
    if (fs.existsSync(destination))
      fs.copyFileSync(destination, path.join(backup, name + ".md"));
  if (owned && old.includes(BEGIN))
    fs.writeFileSync(t.instructions, replaceBlock(old, ""), { mode: 0o600 });
  if (
    owned &&
    fs.existsSync(t.skill) &&
    fs.readFileSync(t.skill, "utf8").includes("# Recall connection")
  )
    fs.unlinkSync(t.skill);
  const value = settings(folder);
  delete value.hosts[host];
  save(folder, { hosts: value.hosts });
  return { disconnected: host, backup, preservedOtherConnection: !owned };
}
function status(folder, options = {}) {
  const value = settings(folder);
  return {
    ...value,
    captureEnabled: config(folder).captureEnabled,
    hosts: Object.fromEntries(
      ["codex", "claude"].map((host) => {
        const saved = value.hosts[host];
        const installed = !!saved && ownsConnection(folder, saved);
        return [
          host,
          {
            connected: installed,
            ...require("./assistant-readiness.cjs").status(folder, host, {
              ...options,
              installed,
              connectedAt: saved?.connectedAt,
            }),
          },
        ];
      }),
    ),
  };
}
module.exports = { settings, save, connect, disconnect, status, replaceBlock, ownsConnection };
