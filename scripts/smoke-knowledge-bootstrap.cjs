const { _electron: electron, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  { Store } = require("../electron/store.cjs"),
  { config, saveConfig } = require("../electron/config.cjs");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-bootstrap-ui-")),
    folder = path.join(root, "profile"),
    parent = path.join(root, "new-notes"),
    evidence = path.resolve(__dirname, "../evidence"),
    notionParent = "12345678-abcd-4321-1234-123456789abc";
  fs.mkdirSync(parent);
  fs.mkdirSync(evidence, { recursive: true });
  saveConfig(folder, {
    captureEnabled: false,
    timeZone: "UTC",
    marker: "preserved",
  });
  const store = new Store(folder);
  store.import(require("../examples/demo.json").cards);
  const before = JSON.parse(JSON.stringify(store.snapshot()));
  store.close();
  let app;
  const errors = [];
  const launch = async () => {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [path.resolve(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: folder },
    });
    const page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Learning connections", exact: true })
      .click();
    return page;
  };
  const chooseParent = async (panel, type) => {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [chosen],
      });
    }, parent);
    await panel
      .getByRole("button", { name: `Choose ${type} parent`, exact: true })
      .click();
  };
  const shots = async (page, panel, stem) => {
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1320, height: 980 });
      await panel.screenshot({
        path: path.join(evidence, `${stem}-${theme}.png`),
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 760, height: 920 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await panel.screenshot({
      path: path.join(evidence, `${stem}-narrow.png`),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1320, height: 980 });
  };
  try {
    let page = await launch();
    await page
      .getByRole("button", {
        name: "Create my first knowledge base",
        exact: true,
      })
      .click();
    let panel = page.locator(".knowledge-bootstrap");
    await expect(
      panel.getByRole("heading", { name: "A home for what you learn." }),
    ).toBeFocused();
    await expect(
      panel.getByRole("button", { name: /^Local Markdown/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: /^Obsidian/ }).click();
    await panel.getByRole("button", { name: /^Notion/ }).click();
    await panel.getByRole("radio", { name: "Notion", exact: true }).check();
    await panel
      .getByRole("checkbox", { name: /^Mirror notes to Local Markdown/ })
      .uncheck();
    await shots(page, panel, "knowledge-create-destinations");
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      panel.getByRole("heading", { name: "Choose each home." }),
    ).toBeFocused();
    // Choosing and reviewing locations must not create folders or sources.
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await panel
      .getByRole("button", { name: "Choose Markdown parent", exact: true })
      .click();
    assert.deepEqual(fs.readdirSync(parent), []);
    await chooseParent(panel, "Markdown");
    await chooseParent(panel, "Obsidian");
    await panel
      .getByLabel("Notion parent page link", { exact: true })
      .fill(`https://www.notion.so/Study-${notionParent.replaceAll("-", "")}`);
    await panel
      .getByRole("button", { name: "Review creation", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Ready to build your shelf?" }),
    ).toBeFocused();
    assert.deepEqual(fs.readdirSync(parent), []);
    assert.equal(config(folder).sources.length, 0);
    assert.equal(
      (await page.evaluate(() => window.recall.knowledgeBootstrapState()))
        .requests.length,
      0,
    );
    await expect(
      panel.getByRole("button", { name: "Create knowledge base", exact: true }),
    ).toBeDisabled();
    await expect(panel.getByText("Reference", { exact: true })).toBeVisible();
    await shots(page, panel, "knowledge-create-review");
    await panel
      .getByRole("checkbox", {
        name: /^Let my assistants build this knowledge base/,
      })
      .check();
    await panel
      .getByRole("button", { name: "Create knowledge base", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "One more step for Notion." }),
    ).toBeVisible();
    await expect(
      panel.getByText("Created & connected", { exact: true }),
    ).toHaveCount(2);
    await expect(
      panel.getByText("Waiting for your assistant", { exact: true }),
    ).toHaveCount(1);
    await expect(
      panel.getByText(/Your primary copy isn’t ready yet/),
    ).toBeVisible();
    const state = await page.evaluate(() =>
        window.recall.knowledgeBootstrapState(),
      ),
      request = state.requests[0],
      markdown = request.destinations.find((item) => item.type === "markdown"),
      obsidian = request.destinations.find((item) => item.type === "obsidian");
    assert.equal(request.primaryReady, false);
    assert.equal(request.status, "needs-assistant");
    assert.equal(markdown.role, "reference");
    assert.equal(obsidian.role, "mirror");
    assert(fs.existsSync(path.join(markdown.path, "Knowledge Base.md")));
    assert(fs.existsSync(path.join(markdown.path, "Concepts")));
    assert(fs.existsSync(path.join(obsidian.path, ".obsidian", "app.json")));
    const sources = config(folder).sources;
    assert.equal(sources.length, 2);
    assert.equal(sources.find((item) => item.type === "markdown").write, false);
    assert.equal(sources.find((item) => item.type === "obsidian").write, true);
    assert(
      sources.every(
        (item) =>
          item.knowledgeBasePrimaryReady === false ||
          item.primaryReady !== true,
      ),
    );
    await shots(page, panel, "knowledge-create-pending");
    await expect(
      panel.getByRole("button", {
        name: "Finish Notion with assistant",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      panel.getByText(/Connect Codex or Claude below to finish Notion setup/),
    ).toBeVisible();
    await assert.rejects(
      page.evaluate(
        (id) => window.recall.knowledgeBootstrapPrompt(id),
        request.id,
      ),
      /Connect Codex or Claude/,
    );
    // Install the actual bridge into a disposable assistant home; no real
    // assistant instructions, provider credentials or remote workspace are used.
    require("../electron/connections.cjs").connect(folder, "codex", {
      apply: true,
      home: path.join(root, "assistant-home"),
    });
    await panel
      .getByRole("button", { name: "Refresh setup", exact: true })
      .click();
    await expect(
      panel.getByRole("button", {
        name: "Finish Notion with assistant",
        exact: true,
      }),
    ).toBeEnabled();
    await panel
      .getByRole("button", {
        name: "Finish Notion with assistant",
        exact: true,
      })
      .click();
    // Electron 44 clipboard writes are asynchronous. A rejected OS write
    // must reach the guide rather than showing a premature Copied receipt.
    await app.evaluate(({ clipboard }) => {
      globalThis.__originalBootstrapClipboardWrite = clipboard.writeText;
      clipboard.writeText = async () => {
        throw Error("Synthetic clipboard failure");
      };
    });
    await panel
      .getByRole("button", { name: "Copy setup prompt", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "Synthetic clipboard failure",
    );
    await expect(
      panel.getByRole("button", { name: "Copied", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByLabel("Knowledge base setup prompt", { exact: true }),
    ).toHaveValue(new RegExp(request.id));
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = globalThis.__originalBootstrapClipboardWrite;
      delete globalThis.__originalBootstrapClipboardWrite;
    });
    await panel
      .getByRole("button", { name: "Copy setup prompt", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Copied", exact: true }),
    ).toBeVisible();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert(copied.includes(notionParent));
    assert(copied.includes(request.id));
    assert.match(copied, /never create a second one on retry/);
    assert.match(copied, /assistant attestation/);
    assert.match(copied, /do not promote a mirror/i);
    await panel
      .getByRole("button", { name: "Refresh setup", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "One more step for Notion." }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Close for now", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Continue setup", exact: true }),
    ).toBeVisible();
    const originalIndex = fs.readFileSync(
      path.join(obsidian.path, "Knowledge Base.md"),
      "utf8",
    );
    await app.close();
    app = null;
    page = await launch();
    await page
      .getByRole("button", { name: "Continue setup", exact: true })
      .click();
    panel = page.locator(".knowledge-bootstrap");
    await expect(
      panel.getByRole("heading", { name: "One more step for Notion." }),
    ).toBeVisible();
    assert.equal(
      fs.readFileSync(path.join(obsidian.path, "Knowledge Base.md"), "utf8"),
      originalIndex,
    );
    assert.equal(
      (await page.evaluate(() => window.recall.knowledgeBootstrapState()))
        .requests.length,
      1,
    );
    await panel
      .getByRole("button", { name: "Close for now", exact: true })
      .click();
    await page
      .locator(".knowledge-setup")
      .getByRole("button", { name: "Create knowledge base", exact: true })
      .click();
    panel = page.locator(".knowledge-bootstrap");
    await panel
      .getByLabel("Knowledge base name", { exact: true })
      .fill("Solo Study");
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await chooseParent(panel, "Markdown");
    await panel
      .getByRole("button", { name: "Review creation", exact: true })
      .click();
    await panel
      .getByRole("checkbox", {
        name: /^Let my assistants build this knowledge base/,
      })
      .check();
    await panel
      .getByRole("button", { name: "Create knowledge base", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Your knowledge base is ready." }),
    ).toBeVisible();
    await expect(
      panel.getByText("Unfinished setups", { exact: true }),
    ).toBeVisible();
    // A user policy change must remain in place rather than being repaired
    // by retry. The saved setup reflects that its source needs review.
    const readyState = await page.evaluate(() =>
        window.recall.knowledgeBootstrapState(),
      ),
      solo = readyState.requests.find((item) => item.name === "Solo Study");
    saveConfig(folder, {
      sources: config(folder).sources.map((item) =>
        item.id === solo.primarySourceId ? { ...item, write: false } : item,
      ),
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("recall-connections-changed")),
    );
    await expect(
      panel.getByRole("heading", {
        name: "Your setup needs a little attention.",
      }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Retry local setup", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", {
        name: "Finish Notion with assistant",
        exact: true,
      }),
    ).toHaveCount(0);
    assert.equal(
      config(folder).sources.find((item) => item.id === solo.primarySourceId)
        .write,
      false,
    );
    await panel
      .getByRole("button", { name: "Close for now", exact: true })
      .click();
    assert.equal(config(folder).marker, "preserved");
    assert.equal(config(folder).captureEnabled, false);
    const after = await page.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.cards, before.cards);
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.session, before.session);
    assert.deepEqual(errors, []);
    console.log(
      "PASS knowledge-base creation: multi-select, primary/mirror/reference roles, native selection cancellation, no preview writes, explicit authoring, Markdown/Obsidian ready, honest pending Notion primary, required installed bridge, rejected clipboard write surfaced without Copied, successful copy retry, persistent resume, local-only ready, preserved policy edits and attention status, light/dark/narrow, unchanged study data.",
    );
  } finally {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
