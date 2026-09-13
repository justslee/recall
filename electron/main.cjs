const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  dialog,
  session,
  shell,
  clipboard,
  nativeTheme,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Store } = require("./store.cjs");
const { Runner } = require("./runner.cjs");
const { canRunExercise } = require("./exercise-trust.cjs");
const { readAnki } = require("./importer.cjs");

const { presentationFor } = require("./presentation.cjs");
const { widgetsOf, widgetDocument, WIDGET_CSP } = require("./widgets.cjs");
app.setName("Recall");
app.setPath(
  "userData",
  process.env.RECALL_DATA_DIR || path.join(app.getPath("appData"), "Recall"),
);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "recall",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
let store, win;
const runner = new Runner({
  scientificPython: path.join(app.getPath("userData"), "python/bin/python3"),
});
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
const handle = (name, fn) =>
  ipcMain.handle("recall:" + name, async (event, ...args) => {
    if (
      event.senderFrame !== win.webContents.mainFrame ||
      !event.senderFrame.url.startsWith("recall://app/")
    )
      throw Error("Untrusted request");
    return fn(...args);
  });
app.whenReady().then(() => {
  store = new Store(app.getPath("userData"));
  if (!store.get("seeded")) store.set("seeded", true);
  const legacyFile = path.join(store.folder, "legacy-trust.json");
  if (fs.existsSync(legacyFile)) {
    for (const [id, sha256] of Object.entries(
      JSON.parse(fs.readFileSync(legacyFile, "utf8")),
    )) {
      if (!store.get("validated-code:" + id))
        store.set("validated-code:" + id, { sha256 });
    }
  }
  store.backup();
  protocol.handle("recall", (request) => {
    try {
      const url = new URL(request.url);
      if (url.host === "widget") return widgetResponse(url);
      if (url.host !== "app") return new Response("Not found", { status: 404 });
      const root = path.join(__dirname, "../dist");
      const file = path.resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!file.startsWith(root + path.sep))
        return new Response("Forbidden", { status: 403 });
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
        ".png": "image/png",
      };
      return new Response(fs.readFileSync(file), {
        headers: {
          "Content-Type":
            types[path.extname(file)] || "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  // Widgets are card content. They are served from their own origin with a
  // strict CSP so the sandboxed frame can run its script and nothing else.
  function widgetResponse(url) {
    const [, rawId, index] = url.pathname.split("/");
    let card;
    try {
      card = JSON.parse(store.card(decodeURIComponent(rawId)).content);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (card.widgetsAllowed !== true)
      return new Response(
        "Interactive widgets are not enabled for this card.",
        {
          status: 403,
        },
      );
    const shown = presentationFor(card, store.presentations);
    const widget = widgetsOf(shown.presentation?.answer ?? card.answer)[
      Number(index)
    ];
    if (!widget) return new Response("Not found", { status: 404 });
    return new Response(widgetDocument(widget), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": WIDGET_CSP,
        "Cache-Control": "no-store",
      },
    });
  }
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel: !["recall:", "data:", "blob:", "devtools:"].includes(
        new URL(details.url).protocol,
      ),
    }),
  );
  handle("snapshot", () => store.snapshot());
  handle("demo", () => {
    if (store.cards().length)
      throw Error(
        "The welcome demo is for an empty library. Use CLI import to add examples to an existing library.",
      );
    const result = require("./bundles.cjs").importPack(
      store,
      require("../examples/demo.json"),
      { apply: true, widgets: true },
    );
    const report = require("../examples/validation.json");
    for (const exercise of report.exercises)
      require("./bundles.cjs").trustCode(store, exercise.id, report);
    return result;
  });
  handle("profileInfo", () => {
    const c = require("./config.cjs").config(store.folder);
    return {
      timeZone: c.timeZone,
      captureEnabled: c.captureEnabled,
      sources: c.sources.map((s) => ({
        id: s.id,
        type: s.type,
        write: !!s.write,
      })),
    };
  });
  handle("configureLearning", (patch) => {
    if (
      typeof patch.captureEnabled !== "boolean" ||
      typeof patch.timeZone !== "string"
    )
      throw Error("Invalid learning settings");
    return require("./config.cjs").saveConfig(store.folder, {
      captureEnabled: patch.captureEnabled,
      timeZone: patch.timeZone,
    });
  });
  const selfTest = require("./self-test.cjs");
  handle("selfTests", () => selfTest.snapshot(store));
  handle("startSelfTest", (options) => selfTest.start(store, options));
  handle("showLearningLog", () => {
    fs.mkdirSync(selfTest.root(store.folder), { recursive: true });
    return shell.openPath(selfTest.root(store.folder));
  });
  handle("setting", (key, value) => {
    if (!["selection", "session"].includes(key) && !key.startsWith("draft:"))
      throw Error("Unsupported setting");
    if (JSON.stringify(value).length > 250000) throw Error("Setting too large");
    return store.set(key, value);
  });
  handle("draft", (key) => {
    if (!key.startsWith("draft:")) throw Error("Invalid draft");
    return store.get(key);
  });
  handle("intervals", (id) => store.intervals(id));
  handle("rate", (request) => store.rate(request));
  handle("undo", () => store.undo());
  handle("saveCard", (card) => store.saveCard(card));
  handle("suspend", (id, value) => store.suspend(id, value));
  handle("newDeck", (name) => {
    name = String(name).trim();
    if (!name || name.length > 80)
      throw Error("Use a deck name of 1–80 characters.");
    const decks = store.get("decks", []);
    if (decks.some((d) => d.toLowerCase() === name.toLowerCase()))
      throw Error("Deck already exists.");
    store.set("decks", [...decks, name]);
  });
  handle("run", async (id, language, code) => {
    const card = JSON.parse(store.card(id).content);
    if (!canRunExercise(card, (key) => store.get(key)))
      throw Error(
        "This exercise needs local authoring validation before it can run.",
      );
    const result = await runner.run(card, language, code);
    store.recordChallengeAttempt(card, language, code, result);
    return result;
  });
  handle("stop", () => runner.cancel());
  handle("copyChallengeCode", (id, language, part) => {
    const card = JSON.parse(store.card(id).content);
    if (!card.code?.[language] || !["stub", "solution"].includes(part))
      throw Error("Unsupported code copy");
    clipboard.writeText(card.code[language][part]);
    return true;
  });
  handle("challengeState", (id, patch) => store.challengeState(id, patch));
  handle("challengeAttempts", (id) => store.challengeAttempts(id));
  handle("challengeSource", (id) => {
    const card = JSON.parse(store.card(id).content);
    const url = new URL(card.source);
    if (!["https:", "http:"].includes(url.protocol))
      throw Error("This source is a local reference.");
    return shell.openExternal(url.href);
  });
  handle("attachments", (id) => store.attachments(id));
  handle("attach", async (id) => {
    const result = await dialog.showOpenDialog(win, {
      title: "Attach paper solution",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    for (const filename of result.filePaths) {
      const ext = path.extname(filename).toLowerCase(),
        mime =
          ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : "image/jpeg";
      store.attach(
        id,
        path.basename(filename),
        mime,
        fs.readFileSync(filename),
      );
    }
    return store.attachments(id);
  });
  handle("removeAttachment", (id) =>
    store.db.prepare("DELETE FROM attachments WHERE id=?").run(id),
  );
  handle("importAnki", async () => {
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: "Anki archive", extensions: ["apkg"] }],
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const cards = readAnki(result.filePaths[0]);
    store.backup();
    return {
      ...store.import(cards),
      drafts: cards.filter((c) => c.status === "draft").length,
    };
  });
  handle("backup", () => require("./backup.cjs").backup(store).backup);
  handle("export", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Choose a folder for your complete Recall backup",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    const destination = path.join(
      result.filePaths[0],
      "Recall-library-" + Date.now(),
    );
    return require("./backup.cjs").backup(store, destination).backup;
  });
  handle("exportAttempt", async (id) => {
    const card = JSON.parse(store.card(id).content);
    const result = await dialog.showSaveDialog(win, {
      title: "Export paper assessment packet",
      defaultPath: "Recall-attempt.json",
      filters: [{ name: "Assessment packet", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    const packet = {
      version: 1,
      card,
      attachments: store.attachments(id),
      createdAt: new Date().toISOString(),
      instructions:
        "Assess the attached work against the question and worked solution. Credit alternate valid methods. Distinguish method and arithmetic errors; flag unreadable writing. Do not invent missing steps.",
    };
    fs.writeFileSync(result.filePath, JSON.stringify(packet, null, 2));
    return result.filePath;
  });
  handle("showData", () => shell.openPath(store.folder));
  function createWindow() {
    win = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 760,
      minHeight: 620,
      title: "Recall",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#111915" : "#f3f4ed",
      titleBarStyle: "hiddenInset",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.on("will-frame-navigate", (e) => {
      if (!e.isMainFrame && !e.url.startsWith("recall://widget/"))
        e.preventDefault();
    });
    win.loadURL("recall://app/");
  }
  createWindow();
  nativeTheme.on("updated", () => {
    if (win && !win.isDestroyed())
      win.setBackgroundColor(
        nativeTheme.shouldUseDarkColors ? "#111915" : "#f3f4ed",
      );
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  runner.cancel();
  store?.close();
  store = null;
});
