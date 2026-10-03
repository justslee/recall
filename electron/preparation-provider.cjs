const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { spawnSync } = require("node:child_process");
const sandbox = require("./process-sandbox.cjs");
const privateFiles = require("./private-files.cjs");
const CODEX_DISABLED = [
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "plugins",
  "remote_plugin",
  "hooks",
  "apps",
  "computer_use",
  "browser_use",
  "browser_use_external",
  "in_app_browser",
  "image_generation",
  "view_image",
  "multi_agent",
  "multi_agent_v2",
  "skill_search",
  "skill_mcp_dependency_install",
  "tool_suggest",
];
function verify(agent, binary) {
  const help = spawnSync(
    binary,
    agent === "codex" ? ["exec", "--help"] : ["--help"],
    { encoding: "utf8", timeout: 10000, maxBuffer: 100000 },
  );
  const required =
    agent === "codex"
      ? ["--ignore-user-config", "--ignore-rules", "--strict-config"]
      : [
          "--restricted",
          "--tools",
          "--strict-mcp-config",
          "--disable-slash-commands",
        ];
  if (help.status !== 0 || required.some((flag) => !help.stdout.includes(flag)))
    throw Error(
      `Update ${agent}: this version cannot provide restricted Recall preparation`,
    );
}
function invocation(
  agent,
  binary,
  stage,
  prompt,
  {
    home = os.homedir(),
    environment = process.env,
    codexHome: selectedCodexHome,
  } = {},
) {
  const output = path.join(stage, "last-message.txt");
  const codexHome =
    selectedCodexHome || environment.CODEX_HOME || path.join(home, ".codex");
  const claudeHome = path.join(home, ".claude");
  const env = {
    HOME: home,
    PATH: "/usr/bin:/bin:/usr/sbin:/opt/homebrew/bin",
    TMPDIR: stage,
    LANG: "en_US.UTF-8",
    TERM: "dumb",
  };
  // Only provider authentication is inherited; no NODE_OPTIONS, hooks, proxies,
  // shell startup variables, connector tokens or arbitrary cloud credentials.
  for (const key of agent === "codex"
    ? ["OPENAI_API_KEY", "CODEX_API_KEY"]
    : ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"])
    if (environment[key]) env[key] = environment[key];
  let args, auth;
  if (agent === "codex") {
    // Isolate all configuration, runtime databases, skills and hooks. Only an
    // existing file credential is copied into this owner-only ephemeral home.
    env.CODEX_HOME = privateFiles.directory(path.join(stage, "codex-home"));
    const authFile = path.join(codexHome, "auth.json");
    if (fs.existsSync(authFile))
      privateFiles.write(
        path.join(env.CODEX_HOME, "auth.json"),
        privateFiles.read(authFile, 100000),
      );
    else if (!env.OPENAI_API_KEY && !env.CODEX_API_KEY)
      throw Error(
        "Recall preparation needs a signed-in Codex CLI with file credentials or an API-key environment. Your main Codex configuration is not changed.",
      );
    args = [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--strict-config",
      "--sandbox",
      "read-only",
      "--cd",
      stage,
      "--skip-git-repo-check",
      "--ephemeral",
      "--color",
      "never",
      "--output-last-message",
      output,
    ];
    for (const name of CODEX_DISABLED) args.push("--disable", name);
    for (const setting of [
      'approval_policy="never"',
      'web_search="disabled"',
      "project_doc_max_bytes=0",
      "mcp_servers={}",
      'history.persistence="none"',
      "check_for_update_on_startup=false",
    ])
      args.push("-c", setting);
    args.push("-");
    auth = [];
  } else {
    env.CLAUDE_CONFIG_DIR = claudeHome;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    env.CLAUDE_CODE_TMPDIR = stage;
    const mcp = path.join(stage, "mcp.json");
    privateFiles.write(mcp, '{"mcpServers":{}}');
    args = [
      "-p",
      "--restricted",
      "--tools",
      "",
      "--disallowedTools",
      "mcp__*",
      "--strict-mcp-config",
      "--mcp-config",
      mcp,
      "--disable-slash-commands",
      "--setting-sources",
      "",
      "--settings",
      '{"disableAllHooks":true}',
      "--permission-mode",
      "dontAsk",
      "--no-session-persistence",
      "--output-format",
      "text",
      "--max-turns",
      "1",
      "--system-prompt",
      "You prepare proposed learning content from the supplied data. You have no tools. Return only the requested JSON.",
    ];
    auth = [
      path.join(home, ".claude.json"),
      path.join(claudeHome, ".credentials.json"),
    ];
  }
  // Provider programs are trusted transport. Their model-facing tools are disabled;
  // the outer OS sandbox also denies access to projects, profiles and user files.
  const realBinary = fs.realpathSync(binary);
  const runtime = [];
  // Homebrew/native CLI installations can need adjacent shared libraries.
  if (realBinary.startsWith("/opt/homebrew/"))
    runtime.push("/opt/homebrew/Cellar", "/opt/homebrew/lib");
  else runtime.push(realBinary);
  const run = sandbox.command(realBinary, args, {
    directory: stage,
    read: [...auth, realBinary],
    readDirectories: runtime.filter(
      (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    ),
    network: true,
    executables: ["/usr/bin/security"],
    // Signed-in CLIs may consult the keychain through securityd.
    machLookup: true,
  });
  return { ...run, env, output, prompt, argsForProvider: args };
}
module.exports = { verify, invocation, CODEX_DISABLED };
