const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const { KnowledgeIndex } = require("./knowledge-index.cjs");
const files = require("./knowledge-files.cjs");
const index = new KnowledgeIndex(workerData.folder);
const watchers = new Map();
const changed = new Map();
let timer, reconcileTimer;
let closing = false;
const emit = () =>
  parentPort.postMessage({ event: "changed", status: index.status() });
const refresh = async () => {
  await index.refresh();
  watch();
  emit();
};

function watch() {
  if (closing) return;
  const sources = index.sources();
  for (const [id, entry] of watchers)
    if (!sources.some((s) => s.id === id && s.root === entry.root)) {
      entry.watcher.close();
      watchers.delete(id);
    }
  for (const source of sources) {
    if (watchers.has(source.id)) continue;
    try {
      const watcher = fs.watch(
        source.root,
        { recursive: true },
        (_event, name) => {
          if (
            !name ||
            String(name)
              .split(path.sep)
              .some((p) => p.startsWith("."))
          )
            return;
          changed.set(source.id + "/" + name, {
            source,
            relative: String(name),
          });
          clearTimeout(timer);
          timer = setTimeout(() => flush().catch(error => parentPort.postMessage({ event: "error", error: error.message })), 160);
        },
      );
      watcher.on("error", () => {
        watcher.close();
        watchers.delete(source.id);
      });
      watchers.set(source.id, { root: source.root, watcher });
    } catch {
      /* Periodic reconciliation remains available if watching is denied. */
    }
  }
}
async function flush() {
  if (closing) return;
  const batch = [...changed.values()];
  changed.clear();
  let needsScan = false;
  for (const { source, relative } of batch) {
    if (
      !index.sources().some((s) => s.id === source.id && s.root === source.root)
    )
      continue;
    if (!files.supported(relative)) {
      needsScan = true;
      continue;
    }
    try {
      index.update(source, relative, true);
    } catch {
      needsScan = true;
    }
  }
  if (needsScan) await refresh();
  else emit();
}
const methods = {
  close: async () => {
    closing = true;
    index.stopping = true;
    clearInterval(reconcileTimer);
    clearTimeout(timer);
    for (const entry of watchers.values()) entry.watcher.close();
    watchers.clear();
    if (index.pending) await index.pending;
    index.close();
    return true;
  },
  status: () => index.status(),
  search: (input) => index.query(input),
  folders: (id) => index.folders(id),
  refresh: () => refresh(),
  read: (input) => {
    const note = files.readNote(workerData.folder, input.sourceId, input.path);
    return {
      ...note,
      draft: files.draft(workerData.folder, {
        sourceId: input.sourceId,
        path: input.path,
      }),
      backlinks: index.backlinks(note),
    };
  },
  draft: (input) => files.draft(workerData.folder, input),
  discard: (input) => {
    files.readNote(workerData.folder, input.sourceId, input.path);
    fs.rmSync(files.draftPath(workerData.folder, input.sourceId, input.path), {
      force: true,
    });
    return true;
  },
  save: (input) => {
    const note = files.saveNote(workerData.folder, input);
    index.update(
      require("../adapters/knowledge.cjs").source(
        workerData.folder,
        input.sourceId,
      ),
      input.path,
      true,
    );
    emit();
    return note;
  },
  create: (input) => {
    const note = files.createNote(workerData.folder, input);
    index.update(
      require("../adapters/knowledge.cjs").source(
        workerData.folder,
        note.sourceId,
      ),
      note.path,
      true,
    );
    emit();
    return note;
  },
  move: async (input) => {
    const note = files.moveNote(workerData.folder, input);
    await refresh();
    return note;
  },
  asset: (input) =>
    require("../adapters/knowledge.cjs").asset(
      workerData.folder,
      input.sourceId,
      input.path,
      input.reference,
    ),
};
parentPort.on("message", async ({ id, method, input }) => {
  try {
    if (!Object.hasOwn(methods, method))
      throw Error("Unknown knowledge operation.");
    const result = await methods[method](input);
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
refresh().catch((error) =>
  parentPort.postMessage({ event: "error", error: error.message }),
);
reconcileTimer = setInterval(() => refresh().catch(() => {}), 60000);
reconcileTimer.unref();
