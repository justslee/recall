const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-public-ui-"));
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [path.join(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: folder },
    });
    const page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("button", { name: "Try demo", exact: true }),
    ).toBeVisible();
    assert.equal(
      (await page.evaluate(() => window.recall.snapshot())).cards.length,
      0,
    );
    await expect(
      page.getByRole("button", { name: "Import cards", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect learning", exact: true }),
    ).toBeVisible();
    fs.mkdirSync(path.join(__dirname, "../evidence"), { recursive: true });
    await page.setViewportSize({ width: 1320, height: 980 });
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        path: path.join(__dirname, `../evidence/welcome-${theme}.png`),
        animations: "disabled",
      });
    }
    await page
      .getByRole("button", { name: "Connect learning", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Learning connections", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Add knowledge source", exact: true }),
    ).toBeVisible();
    assert.equal(
      (await page.evaluate(() => window.recall.profileInfo())).captureEnabled,
      false,
    );
    await page.getByRole("button", { name: "Study desk", exact: true }).click();
    await app.evaluate(({ dialog }) => {
      globalThis.__recallOriginalOpenDialog = dialog.showOpenDialog;
      globalThis.__recallImportDialogSeen = false;
      dialog.showOpenDialog = async (window, options) => {
        globalThis.__recallImportDialogSeen =
          options.properties.includes("openFile");
        return { canceled: true, filePaths: [] };
      };
    });
    await page
      .getByRole("button", { name: "Import cards", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Library", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("status")).toContainText("Import cancelled");
    assert.equal(
      await app.evaluate(() => globalThis.__recallImportDialogSeen),
      true,
    );
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = globalThis.__recallOriginalOpenDialog;
      delete globalThis.__recallOriginalOpenDialog;
      delete globalThis.__recallImportDialogSeen;
    });
    assert.equal(
      (await page.evaluate(() => window.recall.snapshot())).cards.length,
      0,
    );
    await page.getByRole("button", { name: "Study desk", exact: true }).click();
    await page.getByRole("button", { name: "Try demo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Try demo", exact: true }),
    ).toHaveCount(0);
    assert.equal(
      (await page.evaluate(() => window.recall.snapshot())).cards.length,
      3,
    );
    fs.mkdirSync(path.join(__dirname, "../evidence"), { recursive: true });
    await page.setViewportSize({ width: 1320, height: 880 });
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        path: path.join(__dirname, `../evidence/study-desk-${theme}.png`),
        animations: "disabled",
      });
    }
    await page
      .locator(".formats button")
      .filter({ hasText: "Concepts" })
      .click();
    await page
      .getByRole("button", { name: "Start review", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Reveal answer", exact: true }),
    ).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Reveal answer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Load interactive", exact: true })
      .click();
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#mean")).toHaveText("60.0");
    await frame.locator("#w").fill("100");
    await expect(frame.locator("#mean")).toHaveText("90.0");
    fs.mkdirSync(path.join(__dirname, "../evidence"), { recursive: true });
    for (const theme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: null });
      await app.evaluate(
        ({ nativeTheme }, theme) => (nativeTheme.themeSource = theme),
        theme,
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => matchMedia("(prefers-color-scheme: dark)").matches,
          ),
        )
        .toBe(theme === "dark");
      await expect(frame.locator("#w")).toHaveValue("100");
      await page.screenshot({
        path: path.join(__dirname, "../evidence/demo-" + theme + ".png"),
        fullPage: true,
        style: ".titlebar,.sidebar,.toast{visibility:hidden!important}",
      });
    }
    assert.equal(
      await frame.locator("body").evaluate(() => typeof window.recall),
      "undefined",
    );
    await page.getByRole("button", { name: /^Good/ }).click();
    await page.getByRole("button", { name: "Study desk", exact: true }).click();
    await page.locator(".formats button").filter({ hasText: "Math" }).click();
    await page
      .getByRole("button", { name: "Start review", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Reveal worked solution", exact: true }),
    ).toBeVisible();
    assert.equal(
      (await page.evaluate(() => window.recall.snapshot())).session.revealed,
      false,
    );
    await page
      .getByRole("button", { name: "Reveal worked solution", exact: true })
      .click();
    await expect(page.locator(".katex").first()).toBeVisible();
    await page.getByRole("button", { name: /^Good/ }).click();
    await page.getByRole("button", { name: "Study desk", exact: true }).click();
    await page.locator(".formats button").filter({ hasText: "Coding" }).click();
    await page
      .getByRole("button", { name: "Start review", exact: true })
      .click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    const codeCard = require("../examples/cards.json").find(
      (c) => c.kind === "code",
    );
    const run = await page.evaluate(
      (c) => window.recall.run(c.id, "python", c.code.python.solution),
      codeCard,
    );
    assert.equal(run.status, "passed");
    await page
      .getByRole("button", { name: "Pause session", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Learning connections", exact: true })
      .click();
    await page
      .getByLabel("Allow learning capture from my configured skills")
      .check();
    await page
      .getByRole("button", { name: "Save learning settings", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Saved.");
    assert.deepEqual(errors, []);
    console.log(
      "PASS public app: three welcome paths, Library import routing/cancellation, guided learning entry, empty profile, demo, both themes, widget behavior/isolation, hidden math, Monaco/Python, capture opt-in",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
