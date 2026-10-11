const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { execFile } = require("node:child_process");
const privateFiles = require("./private-files.cjs");
const { resolveExecutable } = require("./assistant-readiness.cjs");
const { runtimeStatus } = require("./paper-connection.cjs");
const NAME = "recall-paper";
const marker = (folder) =>
  `<!-- recall-paper-profile:${require("node:crypto").createHash("sha256").update(path.resolve(folder)).digest("hex")} -->`;
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function execute(binary, args, options) {
  return new Promise((resolve) =>
    execFile(binary, args, options, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr }),
    ),
  );
}
function locations(
  folder,
  host,
  { home = os.homedir(), environment = process.env } = {},
) {
  if (!["codex", "claude"].includes(host))
    throw Error("Choose Codex or Claude Code.");
  const root =
    host === "codex" && environment.CODEX_HOME
      ? path.resolve(environment.CODEX_HOME)
      : path.join(home, "." + host);
  return {
    root,
    skill: path.join(root, "skills", "paper-learning"),
    wrapper: path.join(folder, "connections", "recall-paper"),
    config:
      host === "codex"
        ? path.join(root, "config.toml")
        : path.join(home, ".claude.json"),
  };
}
async function installedServer(host, binary, target, options) {
  if (host === "claude") {
    if (!fs.existsSync(target.config)) return null;
    const value = JSON.parse(
      privateFiles.read(target.config, 16 * 1024 * 1024),
    );
    return value.mcpServers?.[NAME] ?? null;
  }
  const result = await options.run(
    binary,
    ["mcp", "get", NAME, "--json"],
    options.execOptions,
  );
  if (result.code !== 0) {
    if (
      /not found|no mcp server|does not exist/i.test(
        result.stderr + result.stdout,
      )
    )
      return null;
    throw Error(
      "Codex's MCP configuration could not be checked. No paper settings were changed.",
    );
  }
  const value = JSON.parse(result.stdout);
  return value.transport
    ? { ...value.transport, enabled: value.enabled }
    : value;
}
function matching(server, target, host) {
  return (
    !!server &&
    server.command === target.wrapper &&
    JSON.stringify(server.args || []) ===
      JSON.stringify(["mcp", "--client", host])
  );
}
async function connectPaper(folder, host, options = {}) {
  const {
    apply = false,
    home = os.homedir(),
    environment = options.home ? {} : process.env,
    runtime = process.execPath,
    cli = path.resolve(__dirname, "../cli/recall.cjs"),
    run = execute,
  } = options;
  const target = locations(folder, host, { home, environment }),
    binary = (options.resolveExecutable || resolveExecutable)(host, {
      home,
      environment,
    }),
    source = path.resolve(__dirname, "../skills/paper-learning");
  if (!binary)
    throw Error(
      `Install ${host === "codex" ? "Codex" : "Claude Code"} before connecting paper sessions.`,
    );
  const settings = {
    run,
    execOptions: {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ...environment },
      cwd: home,
    },
  };
  const current = await installedServer(host, binary, target, settings);
  if (current && !matching(current, target, host))
    throw Error(
      "An unrelated recall-paper MCP server is already configured. Preserve it or remove it explicitly before connecting this library.",
    );
  const skillFile = path.join(target.skill, "SKILL.md");
  if (
    fs.existsSync(skillFile) &&
    !privateFiles.read(skillFile).includes(marker(folder))
  )
    throw Error(
      "An unrelated paper-learning skill already exists. It was preserved.",
    );
  if (!apply)
    return {
      mode: "preview",
      host,
      command: target.wrapper,
      args: ["mcp", "--client", host],
      skill: target.skill,
      configuration: target.config,
      requiresFreshSession: true,
      disabled: current?.enabled === false,
    };
  if (current?.enabled === false)
    throw Error(
      "The recall-paper server is disabled in Codex. Enable it in Codex Settings → MCP servers, then refresh the tools.",
    );
  const backup = privateFiles.directory(
    path.join(folder, "connections", "backups", `paper-${host}-${Date.now()}`),
  );
  if (fs.existsSync(target.config))
    privateFiles.write(
      path.join(backup, "assistant-config"),
      privateFiles.read(target.config, 16 * 1024 * 1024),
    );
  if (fs.existsSync(target.skill))
    require("../shared/copy-tree.cjs").copyTree(
      target.skill,
      path.join(backup, "skill"),
    );
  if (fs.existsSync(target.wrapper))
    privateFiles.write(
      path.join(backup, "launcher"),
      privateFiles.read(target.wrapper),
    );
  privateFiles.atomicText(
    target.wrapper,
    `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(runtime)} ${quote(cli)} --data ${quote(folder)} paper "$@"\n`,
  );
  fs.chmodSync(target.wrapper, 0o700);
  require("../shared/copy-tree.cjs").copyTree(source, target.skill);
  privateFiles.atomicText(
    skillFile,
    privateFiles.read(skillFile) +
      `\n${marker(folder)}\nSelected library launcher: \`${target.wrapper}\`. It already selects this profile and the paper command. For CLI fallback use \`${quote(target.wrapper)} start JSON_FILE\` (or publish, status, wait, read, end); do not add another paper argument. The stdio command is \`${quote(target.wrapper)} mcp --client ${host}\`.\n`,
  );
  if (!current) {
    const args =
      host === "codex"
        ? ["mcp", "add", NAME, "--", target.wrapper, "mcp", "--client", host]
        : [
            "mcp",
            "add",
            "--scope",
            "user",
            "--transport",
            "stdio",
            NAME,
            "--",
            target.wrapper,
            "mcp",
            "--client",
            host,
          ];
    const result = await run(binary, args, settings.execOptions);
    if (result.code !== 0)
      throw Error(
        `The paper skill was saved, but ${host} did not accept the MCP configuration. Its previous settings are backed up. Run paper connect again after resolving the CLI setup.`,
      );
  }
  const verified = await installedServer(host, binary, target, settings);
  if (!matching(verified, target, host))
    throw Error(
      "The paper MCP registration could not be verified. Start a fresh session only after connection-status passes.",
    );
  return {
    installed: true,
    host,
    backup,
    command: target.wrapper,
    skill: target.skill,
    requiresFreshSession: true,
    ...runtimeStatus(folder),
    message:
      "Start a fresh assistant session to load the paper tools. This check verifies registration, not image delivery or live tutoring.",
  };
}
async function paperConnectionStatus(folder, options = {}) {
  const home = options.home || os.homedir(),
    environment = options.environment || (options.home ? {} : process.env),
    hosts = {};
  for (const host of ["codex", "claude"]) {
    const target = locations(folder, host, { home, environment }),
      binary = (options.resolveExecutable || resolveExecutable)(host, {
        home,
        environment,
      });
    let registered = false,
      disabled = false;
    try {
      if (binary) {
        const server = await installedServer(host, binary, target, {
          run: options.run || execute,
          execOptions: {
            timeout: 10000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, ...environment },
            cwd: home,
          },
        });
        disabled = matching(server, target, host) && server.enabled === false;
        registered = matching(server, target, host) && !disabled;
      }
    } catch {}
    const skill = path.join(target.skill, "SKILL.md");
    hosts[host] = {
      cliAvailable: !!binary,
      registered,
      disabled,
      skillInstalled:
        fs.existsSync(skill) &&
        privateFiles.read(skill).includes(marker(folder)),
      requiresFreshSession: true,
      liveDeliveryVerified: false,
    };
  }
  return { ...runtimeStatus(folder), hosts };
}
module.exports = { connectPaper, paperConnectionStatus, locations };
