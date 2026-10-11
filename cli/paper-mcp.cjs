const { paperRequest } = require("../electron/paper-connection.cjs");
const Ajv = require("ajv");
const binding = {
  sessionId: { type: "string", minLength: 36, maxLength: 36 },
  capability: { type: "string", minLength: 16, maxLength: 128 },
};
const schema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const tools = [
  {
    name: "paper_start_session",
    operation: "start",
    title: "Start paper learning",
    description:
      "Start a paper session for this conversation. Retain its sessionId and private capability in this chat. The iPad shows this session; ordinary tutoring discussion can continue between writing prompts. Does not assign or grade a question.",
    inputSchema: schema(
      { title: { type: "string", minLength: 1, maxLength: 200 } },
      ["title"],
    ),
  },
  {
    name: "paper_publish_prompt",
    operation: "publish",
    title: "Show a writing prompt on iPad",
    description:
      "Publish a problem or note to this paper session. Include only what the learner should see, never hidden solutions. Each publish creates an immutable revision/sheet; hints and chat discussion do not require publishing. Use expectedRevision to avoid overwriting a newer prompt.",
    inputSchema: schema(
      {
        ...binding,
        title: { type: "string", minLength: 1, maxLength: 200 },
        prompt: { type: "string", minLength: 1, maxLength: 40000 },
        kind: { type: "string", enum: ["problem", "note"] },
        expectedRevision: { type: "integer", minimum: 0 },
      },
      ["sessionId", "capability", "title", "prompt", "kind"],
    ),
  },
  {
    name: "paper_session_status",
    operation: "status",
    title: "Check paper session",
    description:
      "Read this session's current prompt and durable submission cursor. Does not read images, claim feedback, advance problems or change Recall reviews.",
    inputSchema: schema(
      { ...binding, after: { type: "integer", minimum: 0 } },
      ["sessionId", "capability"],
    ),
  },
  {
    name: "paper_wait_submission",
    operation: "wait",
    title: "Wait for paper work",
    description:
      "Wait up to 30 seconds for work in this conversation's session, after the last processed cursor. Returns submission metadata; then use paper_read_submission for images. Timeout keeps work saved. This does not wake an idle chat or insert a draft attachment.",
    inputSchema: schema(
      {
        ...binding,
        after: { type: "integer", minimum: 0 },
        timeoutMs: { type: "integer", minimum: 0, maximum: 30000 },
      },
      ["sessionId", "capability"],
    ),
  },
  {
    name: "paper_read_submission",
    operation: "read",
    title: "Read handwritten pages",
    description:
      "Return ordered page images to this conversation for tutoring feedback. Match the exact saved prompt/revision, including work submitted late for an earlier problem. Read nextPageIndexes until all necessary pages are seen; don't grade pages you have not read. This sends selected images to the assistant provider, not a separate Recall evaluator.",
    inputSchema: schema(
      {
        ...binding,
        submissionId: { type: "string", minLength: 36, maxLength: 36 },
        pageIndexes: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: { type: "integer", minimum: 0, maximum: 19 },
        },
      },
      ["sessionId", "capability", "submissionId"],
    ),
  },
  {
    name: "paper_end_session",
    operation: "end",
    title: "End paper session",
    description:
      "End this conversation's paper session without deleting prompts, ink or submissions. Previously issued offline work stays recoverable. End only when the learner asks to finish, not after each feedback exchange.",
    inputSchema: schema(binding, ["sessionId", "capability"]),
  },
];
const validators = new Map(
  tools.map((tool) => [
    tool.name,
    new Ajv({ strict: true }).compile(tool.inputSchema),
  ]),
);
function toolResult(operation, result) {
  if (operation !== "read")
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  const { pages, ...metadata } = result;
  return {
    structuredContent: metadata,
    content: [
      { type: "text", text: JSON.stringify(metadata) },
      ...pages.flatMap((page) => [
        {
          type: "text",
          text: `Page ${page.index + 1} of ${result.pageCount}: ${page.name}`,
        },
        { type: "image", mimeType: page.mime, data: page.data },
      ]),
    ],
  };
}
function servePaperMcp(
  folder,
  {
    input = process.stdin,
    output = process.stdout,
    client = "codex",
    request = paperRequest,
  } = {},
) {
  if (!["codex", "claude", "chatgpt"].includes(client))
    throw Error("Choose a supported paper client.");
  let buffer = "",
    initialized = false,
    stopped = false;
  const pending = new Map();
  const send = (message) => {
    if (!stopped && !output.destroyed)
      output.write(JSON.stringify(message) + "\n");
  };
  const error = (id, code, message) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });
  async function receive(message) {
    const id = message?.id;
    if (
      !message ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string"
    )
      return error(id ?? null, -32600, "Invalid JSON-RPC request.");
    if (id === undefined) {
      if (message.method === "notifications/cancelled")
        pending.get(message.params?.requestId)?.abort();
      return;
    }
    if (typeof id !== "string" && typeof id !== "number")
      return error(null, -32600, "Invalid request identifier.");
    if (message.method === "initialize") {
      initialized = true;
      const versions = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: versions.includes(message.params?.protocolVersion)
            ? message.params.protocolVersion
            : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "recall-paper", version: "1.0.0" },
          instructions:
            "Use this connection only for an explicitly requested paper-learning session. The initiating chat retains sessionId and capability. Discuss normally; publish a writing prompt only when useful. Send returns durable pages to tools in this chat, not a draft. Read the exact prompt and ordered pages before feedback. Keep bindings private; never infer mastery, rate Recall cards or scan other conversations. If a wait times out, work remains saved; the learner can say Check my paper to resume.",
        },
      });
    }
    if (!initialized)
      return error(id, -32000, "Initialize the paper connection first.");
    if (message.method === "ping")
      return send({ jsonrpc: "2.0", id, result: {} });
    if (message.method === "tools/list")
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map(({ operation, ...tool }) => ({
            ...tool,
            annotations: {
              readOnlyHint: ["status", "wait"].includes(operation),
              destructiveHint: false,
              openWorldHint: false,
            },
          })),
        },
      });
    if (message.method !== "tools/call")
      return error(id, -32601, "Unknown MCP method.");
    const tool = tools.find((entry) => entry.name === message.params?.name),
      args = message.params?.arguments ?? {};
    if (!tool || !validators.get(tool.name)(args))
      return error(id, -32602, "Invalid paper tool or arguments.");
    if (pending.has(id))
      return error(id, -32600, "Duplicate in-flight request identifier.");
    const controller = new AbortController();
    pending.set(id, controller);
    try {
      const result = await request(
        folder,
        tool.operation,
        tool.operation === "start" ? { ...args, client } : args,
        { signal: controller.signal },
      );
      send({ jsonrpc: "2.0", id, result: toolResult(tool.operation, result) });
    } catch (failure) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: String(failure.message || "Paper operation failed.").slice(
                0,
                512,
              ),
            },
          ],
        },
      });
    } finally {
      pending.delete(id);
    }
  }
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    // Bound one inbound frame, not the total of independent complete requests.
    if (Buffer.byteLength(buffer) > 384 * 1024) {
      error(null, -32600, "MCP input is too large.");
      stop();
      return;
    }
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        receive(JSON.parse(line));
      } catch {
        error(null, -32700, "Invalid JSON.");
      }
    }
  });
  function stop() {
    stopped = true;
    for (const controller of pending.values()) controller.abort();
    input.pause();
  }
  input.on("end", stop);
  input.on("error", stop);
  return { stop };
}
module.exports = { servePaperMcp, toolResult, tools };
