const { _electron: electron, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  { Store } = require("../electron/store.cjs"),
  { saveConfig, config } = require("../electron/config.cjs");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-setup-ui-")),
    folder = path.join(root, "profile"),
    notes = path.join(root, "notes"),
    vault = path.join(root, "vault"),
    evidence = path.resolve(__dirname, "../evidence");
  fs.mkdirSync(notes);
  fs.mkdirSync(vault);
  fs.mkdirSync(evidence, { recursive: true });
  const note = "# A study note\n\nA useful source example.\n";
  fs.writeFileSync(path.join(notes, "study.md"), note);
  fs.writeFileSync(path.join(vault, "vault.md"), note);
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
  try {
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
    const panel = page.locator(".knowledge-setup");
    await expect(
      panel.getByText("A home for your knowledge", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Add knowledge source" }).click();
    await expect(
      panel.getByRole("heading", { name: "Where do your notes live?" }),
    ).toBeFocused();
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1320, height: 980 });
      await panel.screenshot({
        path: path.join(evidence, `knowledge-source-${theme}.png`),
        animations: "disabled",
      });
    }
    await panel.getByRole("button", { name: /^Markdown/ }).click();
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [chosen],
      });
    }, notes);
    await panel
      .getByRole("button", { name: "Choose folder", exact: true })
      .click();
    await expect(
      panel.getByText(fs.realpathSync(notes), { exact: true }),
    ).toBeVisible();
    await panel.getByLabel("Source name", { exact: true }).fill("Study notes");
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "Save source", exact: true }),
    ).toBeDisabled();
    await panel
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      panel.getByText("Local connection checked", { exact: true }),
    ).toBeVisible();
    assert.equal(config(folder).sources.length, 0);
    await panel.getByRole("radio", { name: /^Scoped authoring/ }).check();
    await expect(
      panel.getByRole("button", { name: "Save source", exact: true }),
    ).toBeDisabled();
    await panel
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Save source", exact: true }),
    ).toBeEnabled();
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await panel.screenshot({
        path: path.join(evidence, `knowledge-access-${theme}.png`),
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
      path: path.join(evidence, "knowledge-access-narrow.png"),
      animations: "disabled",
    });
    await panel
      .getByRole("button", { name: "Save source", exact: true })
      .click();
    await expect(panel.getByText("Study notes", { exact: true })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Add knowledge source" }),
    ).toBeFocused();
    assert.equal(config(folder).sources[0].write, true);
    assert.equal(fs.readFileSync(path.join(notes, "study.md"), "utf8"), note);

    await panel.getByRole("button", { name: "Add knowledge source" }).click();
    await panel.getByRole("button", { name: /^Obsidian/ }).click();
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [chosen],
      });
    }, vault);
    await panel
      .getByRole("button", { name: "Choose folder", exact: true })
      .click();
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await panel
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Save source", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "Save source", exact: true })
      .click();
    await expect(
      panel.getByText("Obsidian knowledge", { exact: true }),
    ).toBeVisible();
    assert.equal(config(folder).sources[1].write, false);

    await panel.getByRole("button", { name: "Add knowledge source" }).click();
    await panel.getByRole("button", { name: /^Notion/ }).click();
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await panel
      .getByLabel("Notion page or database link")
      .fill("https://www.notion.so/Concepts-12345678abcd43211234123456789abc");
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await panel
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      panel.getByText("Scope ready for your assistant", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Save source", exact: true })
      .click();
    await expect(
      panel.getByText("Connect Codex or Claude below first.", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Verify with assistant" }),
    ).toHaveCount(0);
    const notionSource = config(folder).sources.find(
      (source) => source.type === "notion",
    );
    await assert.rejects(
      page.evaluate(
        (id) => window.recall.knowledgeSourcePrompt(id),
        notionSource.id,
      ),
      /Connect Codex or Claude/,
    );
    // Install the actual launcher and skill kit into a disposable assistant
    // home; no real Codex/Claude instructions or provider access are changed.
    require("../electron/connections.cjs").connect(folder, "codex", {
      apply: true,
      home: path.join(root, "assistant-home"),
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("recall-connections-changed")),
    );
    await expect(
      panel.getByText("Needs assistant verification", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Verify with assistant" }).click();
    await panel
      .getByRole("button", { name: "Copy verification prompt" })
      .click();
    await expect(
      panel.getByRole("button", { name: "Copied", exact: true }),
    ).toBeVisible();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert(copied.includes("12345678-abcd-4321-1234-123456789abc"));
    assert.match(copied, /Do not write to Notion/);
    await panel
      .getByRole("button", { name: "Close verification prompt" })
      .click();
    await panel
      .getByRole("button", { name: "Remove", exact: true })
      .first()
      .click();
    await panel
      .getByRole("button", { name: "Disconnect source", exact: true })
      .click();
    await expect(panel.getByText("Study notes", { exact: true })).toHaveCount(
      0,
    );
    assert.equal(fs.readFileSync(path.join(notes, "study.md"), "utf8"), note);
    assert.equal(config(folder).marker, "preserved");
    assert.equal(config(folder).captureEnabled, false);
    const after = await page.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.cards, before.cards);
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.session, before.session);
    assert.deepEqual(errors, []);
    console.log(
      "PASS knowledge wizard: Markdown, Obsidian, scoped authoring, explicit bounded checks, honest Notion readiness and copied prompt, disconnect preservation, light/dark/narrow, unchanged cards/history/session.",
    );
  } finally {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
