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
const { cardLink, parseCardLink } = require("./card-links.cjs");
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
let store, win, pendingCardLink, voice, speak;
function acceptCardLink(url) {
  try {
    pendingCardLink = { id: parseCardLink(url) };
  } catch {
    pendingCardLink = {
      error: "This Recall link is invalid. Open the card from your library.",
    };
  }
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send("recall:card-link");
  }
}
// macOS can deliver a URL before ready or before the renderer subscribes.
app.on("open-url", (event, url) => {
  event.preventDefault();
  acceptCardLink(url);
});
const launchLink = process.argv.find((arg) => arg.startsWith("recall://"));
if (launchLink) acceptCardLink(launchLink);
const runner = new Runner({
  scientificPython: path.join(app.getPath("userData"), "python/bin/python3"),
});
app.on("second-instance", (_event, argv) => {
  const url = argv?.find((arg) => arg.startsWith("recall://"));
  if (url) acceptCardLink(url);
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
  // Packaged builds carry the icon in the bundle; `npm start` needs it set.
  if (process.platform === "darwin" && !app.isPackaged)
    app.dock?.setIcon(path.join(__dirname, "../packaging/icon.png"));
  // Isolated test profiles and development builds must not steal the OS handler.
  if (app.isPackaged && !process.env.RECALL_DATA_DIR)
    app.setAsDefaultProtocolClient("recall");
  store = new Store(app.getPath("userData"));
  const { VoiceService, allowsMicrophone } = require("./voice.cjs");
  voice = new VoiceService({
    folder: store.folder,
    card: (id) =>
      presentationFor(JSON.parse(store.card(id).content), store.presentations),
    emit: (event) => {
      if (win && !win.isDestroyed())
        win.webContents.send("recall:voice-event", event);
    },
  });
  const { SpeakService } = require("./speak.cjs");
  speak = new SpeakService({ store, voice });
  handle("speakSources", (query) => speak.sources(query));
  handle("speakPreview", (config) => speak.preview(config));
  handle("speakDraft", () => speak.draft());
  handle("speakSaveDraft", (draft) => speak.saveDraft(draft));
  handle("speakPrepare", (config) => speak.prepare(config));
  handle("speakStart", (config, token) => speak.start(config, token));
  handle("speakEvaluate", (input, token) => speak.evaluate(input, token));
  handle("speakHistory", () => speak.history());
  handle("speakAttempt", (id) => speak.attempt(id));
  handle("speakDelete", (id) => speak.delete(id));
  handle("voiceStatus", () => voice.status());
  handle("voiceConfigure", (key) => {
    speak.cancel();
    return voice.configure(key);
  });
  handle("voicePrepare", (id) => voice.prepare(id));
  handle("voiceStart", (id, token) => {
    if (speak.assessment)
      throw Error("An explanation evaluation is already running.");
    return voice.start(id, token);
  });
  handle("voiceAudio", (token, bytes) => voice.append(token, bytes));
  handle("voiceFinish", (token) => voice.finish(token));
  handle("voiceCancel", (token) => {
    speak.cancel(token);
    return voice.cancel(token);
  });
  handle("voiceEvaluate", (id, text, history, token) => {
    if (speak.assessment || voice.active?.id === "speak")
      throw Error(
        "Finish the current explanation recording or evaluation first.",
      );
    return voice.evaluate(id, text, history, token);
  });
  handle("consumeCardLink", () => {
    const link = pendingCardLink;
    pendingCardLink = null;
    return link || null;
  });
  handle("copyCardLink", async (id) => {
    store.card(id);
    const url = cardLink(id);
    await clipboard.writeText(url);
    return url;
  });
  if (!store.get("seeded")) store.set("seeded", true);
  // Execution trust is never imported from a profile file; it is granted only
  // by a local review (`recall cards trust --apply`) or the bundled demo.
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
    (wc, permission, callback, details) =>
      callback(
        allowsMicrophone({
          trustedWindow: wc === win?.webContents,
          armed: voice.micArmed,
          permission,
          details,
        }),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, origin, details) =>
      allowsMicrophone({
        trustedWindow: wc === win?.webContents,
        armed: voice.micArmed,
        permission,
        origin,
        details,
      }),
  );
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel: !["recall:", "data:", "blob:", "devtools:"].includes(
        new URL(details.url).protocol,
      ),
    }),
  );
  handle("snapshot", () => store.snapshot());
  handle("reviewHistory", (options) =>
    require("./review-history.cjs").page(store, options),
  );
  handle("progress", (options) =>
    require("./progress.cjs").snapshot(store, options),
  );
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
  const knowledgeSetup = require("./knowledge-setup.cjs").createKnowledgeSetup(
    store.folder,
  );
  handle("knowledgeSources", () => knowledgeSetup.list());
  handle("knowledgeChooseFolder", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Choose your knowledge folder",
      properties: ["openDirectory"],
    });
    return result.canceled
      ? null
      : knowledgeSetup.selectFolder(result.filePaths[0]);
  });
  handle("knowledgeTestSource", (draft) => knowledgeSetup.testSource(draft));
  handle("knowledgeSaveSource", (draft, testId) =>
    knowledgeSetup.saveSource(draft, testId),
  );
  handle("knowledgeRemoveSource", (id) => knowledgeSetup.removeSource(id));
  handle("knowledgeSourcePrompt", (id) => knowledgeSetup.assistantPrompt(id));
  const knowledgeBootstrap =
    require("./knowledge-bootstrap.cjs").createKnowledgeBootstrap(store.folder);
  handle("knowledgeBootstrapState", () => knowledgeBootstrap.list());
  handle("knowledgeBootstrapChooseParent", async (type) => {
    if (!["markdown", "obsidian"].includes(type))
      throw Error("Choose a local knowledge destination");

    const result = await dialog.showOpenDialog(win, {
      title: `Choose a home for your ${type === "obsidian" ? "Obsidian vault" : "Markdown knowledge base"}`,
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled
      ? null
      : knowledgeBootstrap.selectParent(result.filePaths[0]);
  });
  handle("knowledgeBootstrapPreview", (input) =>
    knowledgeBootstrap.preview(input),
  );
  handle("knowledgeBootstrapCreate", (input, previewId) =>
    knowledgeBootstrap.create(input, previewId),
  );
  handle("knowledgeBootstrapPrompt", (id) =>
    knowledgeBootstrap.assistantPrompt(id),
  );
  handle("knowledgeBootstrapRetry", (id) => knowledgeBootstrap.retry(id));
  handle("copyLearningText", async (text) => {
    if (typeof text !== "string" || !text.trim() || text.length > 250000)
      throw Error("Choose a setup or learning prompt to copy");
    await clipboard.writeText(text);
    return { copied: true };
  });
  const connections = require("./connections.cjs"),
    readiness = require("./assistant-readiness.cjs"),
    inbox = require("./inbox.cjs"),
    catchUp = require("./catch-up.cjs"),
    worker = require("./learning-worker.cjs");
  let learningError = null,
    catchUpPending = false;
  worker.recover(store.folder);
  handle("learningConnections", () => ({
    ...connections.status(store.folder, { cards: store.cards() }),
    inbox: inbox.summary(store.folder),
    error: learningError,
  }));
  handle("checkLearningReadiness", (host) =>
    readiness.check(store.folder, host),
  );
  handle("learningVerificationPrompt", (host, topic = "") =>
    readiness.verificationPrompt(store.folder, host, topic),
  );
  handle("finishLearningWithAssistant", (id, host) =>
    readiness.handoff(store.folder, id, host, store.cards()),
  );
  handle("openLearningCard", (id) => {
    if (typeof id !== "string" || !id || id.length > 10000 || !store.card(id))
      throw Error("This learning card is not available in your library");
    acceptCardLink(cardLink(id));
    return { id };
  });
  handle("connectLearning", (host, apply = false) =>
    connections.connect(store.folder, host, { apply }),
  );
  handle("disconnectLearning", (host) =>
    connections.disconnect(store.folder, host),
  );
  handle("configureConnections", (patch) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw Error("Invalid connection settings");

    const selected = {};
    for (const key of ["agent", "catchUp"])
      if (Object.hasOwn(patch, key)) selected[key] = patch[key];

    return connections.save(store.folder, selected);
  });
  handle("chooseLearningProject", async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle("scanLearning", () => catchUp.scan(store.folder));
  handle("previewLearning", () => worker.preview(store.folder, store.cards()));
  handle("prepareLearning", async (expectedDigest) => {
    if (
      typeof expectedDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedDigest)
    )
      throw Error("Preview the learning context before preparing it");
    const r = await worker.prepare(store.folder, store.cards(), {
      expectedDigest,
    });
    if (store) inbox.applyPending(store);
    return r;
  });
  handle("retryLearning", (id) => inbox.retry(store.folder, id));
  const pollLearning = (scan = false) => {
    if (!store) return;
    try {
      if (scan || catchUpPending)
        catchUpPending = !!catchUp.scan(store.folder).remainingFiles;
      inbox.applyPending(store);
      learningError = null;
    } catch (e) {
      learningError = e.message;
    }
  };
  setTimeout(() => pollLearning(true), 2000).unref();
  setInterval(() => pollLearning(), 5000).unref();
  setInterval(() => pollLearning(true), 300000).unref();
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
  handle("codeTrust", (id) =>
    canRunExercise(JSON.parse(store.card(id).content), (key) => store.get(key)),
  );
  handle("copyChallengeCode", async (id, language, part) => {
    const card = JSON.parse(store.card(id).content);
    if (!card.code?.[language] || !["stub", "solution"].includes(part))
      throw Error("Unsupported code copy");
    await clipboard.writeText(card.code[language][part]);
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
    const cancelSpeech = () => {
      voice.cancel();
      speak.cancel();
    };
    win.webContents.on("render-process-gone", cancelSpeech);
    win.webContents.on(
      "did-start-navigation",
      (_e, _url, _inPlace, isMainFrame) => {
        if (isMainFrame) cancelSpeech();
      },
    );
    win.on("closed", cancelSpeech);
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.on("will-frame-navigate", (e) => {
      // A widget frame loads its own document once. It may not navigate
      // itself afterwards, including to another card's widget.
      if (
        !e.isMainFrame &&
        (!e.url.startsWith("recall://widget/") ||
          (e.frame?.url || "").startsWith("recall://widget/"))
      )
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
  voice?.cancel();
  speak?.cancel();
  runner.cancel();
  require("./learning-worker.cjs").cancel();
  store?.close();
  store = null;
});
