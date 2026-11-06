const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const inbox = require("./inbox.cjs"),
  worker = require("./learning-worker.cjs");
const { config, atomic } = require("./config.cjs");
const connections = require("./connections.cjs");
const { context } = require("./learning-context.cjs");
const LIMIT = 8;
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

// One provider request and the app's one DB writer. No autonomous tools, ratings
// or hidden retries. A batch authorizes these exact sources, not future arrivals.
function createQueue(
  store,
  {
    prepare = worker.prepare,
    apply = inbox.applyPending,
    changed = () => {},
  } = {},
) {
  const file = path.join(inbox.root(store.folder), "preparation-batch.json");
  let running = false,
    stopped = false;
  let state = { status: "idle", items: [] };
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(saved.items) || typeof saved.status !== "string")
        throw Error();
      state = saved;
    }
  } catch {
    state = {
      status: "unreadable",
      items: [],
      message:
        "The previous batch record could not be read. Captures remain in the inbox; nothing was retried.",
    };
  }
  const save = () => atomic(file, state);
  if (state.status === "running") {
    state.status = "interrupted";
    state.message =
      "Preparation stopped when Recall closed. Review the remaining captures before restarting.";
    save();
  }
  const pending = () =>
    inbox
      .read(store.folder)
      .items.filter((i) => i.status === "pending" && i.type !== "notebook")
      .reverse()
      .slice(0, LIMIT);
  function preview() {
    if (!config(store.folder).captureEnabled)
      throw Error("Learning capture is paused");
    const items = pending(),
      agent = connections.settings(store.folder).agent;
    const cards = store.cards(),
      selected = items.map((i) => context(store.folder, i, cards));
    return {
      agent,
      limit: LIMIT,
      digest: digest([agent, selected.map((i) => [i.id, i.digest])]),
      items: selected,
    };
  }
  async function drain(ids) {
    try {
      for (const id of ids) {
        if (stopped || !config(store.folder).captureEnabled) break;
        const item = state.items.find((i) => i.id === id);
        const current = inbox.read(store.folder).items.find((i) => i.id === id);
        if (!current || current.status !== "pending") {
          item.status = current?.status || "unavailable";
          save();
          continue;
        }
        if (
          digest(current.input) !== item.sourceDigest ||
          connections.settings(store.folder).agent !== state.agent
        ) {
          stopped = true;
          state.message =
            "Source or assistant changed. Preview the remaining batch again.";
          break;
        }
        item.status = "preparing";
        item.startedAt = new Date().toISOString();
        save();
        const started = performance.now();
        try {
          // Refresh candidates after every import, so later objectives can reuse
          // a card created earlier in the same batch.
          const result = await prepare(store.folder, store.cards(), {
            itemId: id,
          });
          const validationStart = performance.now();
          const applied = apply(store);
          item.applyMs = Math.round(performance.now() - validationStart);
          item.status =
            inbox.read(store.folder).items.find((i) => i.id === id)?.status ||
            result.status ||
            "skipped";
          if (applied.applied) changed();
        } catch {
          item.status = "blocked";
          item.message =
            "Source retained. Inspect this capture or finish with your assistant.";
          const current = inbox
            .read(store.folder)
            .items.find((i) => i.id === id);
          if (current?.status === "pending")
            inbox.update(store.folder, id, {
              status: "blocked",
              error: item.message,
            });
        }
        item.elapsedMs = Math.round(performance.now() - started);
        item.finishedAt = new Date().toISOString();
        save();
        // Yield between items so renderer requests, live imports and cancellation
        // are serviced; never hold a DB transaction during a provider request.
        await new Promise((resolve) => setImmediate(resolve));
      }
      state.status =
        stopped || !config(store.folder).captureEnabled ? "paused" : "complete";
    } finally {
      running = false;
      state.finishedAt = new Date().toISOString();
      save();
      changed();
    }
  }
  function start(expected) {
    if (running) throw Error("A preparation batch is already running");
    if (state.status === "unreadable")
      throw Error(
        "The prior batch record is unreadable and has been preserved. Finish individual captures with your assistant before replacing this record.",
      );
    const selected = preview();
    if (!expected || selected.digest !== expected)
      throw Error(
        "Captures changed. Preview the batch again before preparing.",
      );
    if (!selected.items.length) return status();
    running = true;
    stopped = false;
    state = {
      version: 1,
      status: "running",
      agent: selected.agent,
      startedAt: new Date().toISOString(),
      items: selected.items.map((i) => ({
        id: i.id,
        title: i.title,
        status: "waiting",
        sourceDigest: digest(pending().find((p) => p.id === i.id).input),
      })),
    };
    save();
    // Do not await the provider in the renderer's IPC call.
    setImmediate(() =>
      drain(state.items.map((i) => i.id)).catch(() => {
        running = false;
        state.status = "interrupted";
        state.message =
          "Preparation could not finish. Sources remain in the inbox.";
        try {
          save();
        } catch {}
      }),
    );
    return status();
  }
  function status() {
    return { ...state, items: state.items.map((i) => ({ ...i })), running };
  }
  function stop() {
    stopped = true;
    worker.cancel();
    return status();
  }
  return { preview, start, status, stop };
}
module.exports = { createQueue, LIMIT };
