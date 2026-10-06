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
  const block = `${BEGIN}\n${profileMarker(folder)}\nFor substantive learning across projects, use the Recall bridge skill at ${target.skill}. Capture only discussed learning; reuse suitable cards, assess useful math/coding supplements, queue missing work, and return verified card links. Respect capture opt-out. Never infer mastery or change review schedules from exposure.\n${END}`;
  const instructions = replaceBlock(old, block);
  const skill = `---\nname: recall-bridge\ndescription: Connect substantive learning in any project to the local Recall inbox. Reuse relevant cards, queue missing objectives and return verified card links.\n---\n# Recall connection\n\n${profileMarker(folder)}\nUse this CLI from any directory: \`${wrapper}\`. The selected library is ${folder}.\n\n1. Run \`connections status\`; respect capture pause. Read personal recall-self-test and recall-cards skills when available, otherwise the portable skills at ${kit}. The bundled portable workflow is ${path.join(kit, "recall-source/references/active-reading.md")}.\n2. Search card names, aliases, prompts and answers with \`cards search TERMS\`. Match the specific objective. Reuse ready, unsuspended cards; separately consider useful missing math/coding supplements.\n3. Submit an objective with \`inbox add FILE\`. JSON fields: id (stable session/objective/checkpoint), sessionId, title, objective, context, at (actual ISO timestamp), evidence (discussed/explained/solved), source, kbUrl, cardIds. Use cardIds for verified matches, otherwise an empty array. Include optional needsAuthoring (boolean) and reason for a missing supplement even if concept cards exist. Repeated identical submissions are idempotent.\n4. Existing IDs appear in today's Self Test immediately. Missing work stays visible in the inbox until prepared and validated. Use \`inbox status\` to confirm; do not describe pending work as ready. Do not start an authoring worker during every answer.\n5. Return a brief new/reused/pending receipt with Markdown from \`cards link ID\`. Do not count generated exercises as solved. Do not log routine operations, transcripts, secrets, assistant-only implementation or this worker's own activity. Never change schedules.\n\nFor completed authoring, read ${path.join(kit, "recall-source/references/inbox.md")} and submit a validated result with \`inbox submit ITEM_ID RESULT_FILE\`. The app imports through its existing writer while open; \`inbox apply\` handles queued results while closed. Never bypass the queue with direct database writes.\n`;
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
  return { connected: host, backup, wrapper };
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
module.exports = { settings, save, connect, disconnect, status, replaceBlock };
