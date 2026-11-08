const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { createProfile } = require("../electron/verification-mode.cjs");
const { Store } = require("../electron/store.cjs");
(async () => {
  const profile = createProfile(),
    output = path.resolve(__dirname, "../evidence/app-updates");
  fs.mkdirSync(output, { recursive: true });
  const store = new Store(profile);
  store.import(require("../examples/demo.json").cards);
  store.set("session", {
    id: "unfinished-update-fixture",
    ids: [store.cards()[0].id],
    index: 0,
    revealed: false,
    rated: 0,
    skipped: 0,
    selection: {
      deck: "all",
      topics: [],
      difficulty: "all",
      limit: 10,
      practice: true,
      format: "concept",
    },
  });
  const before = {
    cards: store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    reviews: store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
    session: store.get("session"),
  };
  store.close();
  let app;
  try {
    const executable = process.env.RECALL_TEST_EXECUTABLE;
    await require("./require-invisible-runtime.cjs")(executable);
    app = await electron.launch({
      ...(executable
        ? { executablePath: executable, args: [] }
        : { args: [path.resolve(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: profile, RECALL_VERIFY: "1" },
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    // Fixtures replace handlers only inside this disposable hidden process.
    // Production verification continues to forbid update and installation IPC.
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      let value = {
        supported: true,
        appPath: "/Applications/Recall.app",
        busy: false,
        sourceFolder: null,
        state: null,
      };
      const publish = (next) => {
        value = { ...value, ...next };
        for (const w of BrowserWindow.getAllWindows())
          w.webContents.send("recall:update-event", value);
        return value;
      };
      for (const method of [
        "updateStatus",
        "checkUpdate",
        "installUpdate",
        "cancelUpdate",
        "chooseUpdateSource",
        "clearUpdateSource",
      ])
        ipcMain.removeHandler("recall:" + method);
      ipcMain.handle("recall:updateStatus", () => value);
      ipcMain.handle("recall:checkUpdate", () =>
        publish({
          state: {
            phase: "complete",
            result: { status: "update_available", availableVersion: "0.7.0" },
          },
        }),
      );
      ipcMain.handle("recall:installUpdate", () =>
        publish({
          busy: true,
          state: {
            id: "synthetic-update",
            apply: true,
            phase: "downloading",
            percent: 42,
          },
        }),
      );
      ipcMain.handle("recall:cancelUpdate", () =>
        publish({
          busy: false,
          state: {
            id: "synthetic-update",
            apply: true,
            phase: "cancelled",
            error: "Update cancelled. Your installed app is unchanged.",
          },
        }),
      );
      ipcMain.handle("recall:chooseUpdateSource", () =>
        publish({ sourceFolder: "/example/Projects/recall" }),
      );
      ipcMain.handle("recall:clearUpdateSource", () =>
        publish({ sourceFolder: null }),
      );
    });
    await page
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click({ timeout: 10000 })
      .catch(async (error) => {
        console.error(await page.locator("body").innerText(), errors);
        throw error;
      });
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(page.getByText("Recall 0.7.0 is ready.")).toBeVisible();
    await page.locator(".update-source summary").click();
    await page
      .getByRole("button", { name: "Choose repository", exact: true })
      .click();
    await expect(page.locator(".update-path")).toContainText(
      "/example/Projects/recall",
    );
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.locator(".update-path")).toHaveCount(0);
    await page.locator(".update-source summary").click();
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: null });
      await app.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme;
      }, theme);
      await expect
        .poll(() =>
          page.evaluate(
            () => matchMedia("(prefers-color-scheme: dark)").matches,
          ),
        )
        .toBe(theme === "dark");
      await page
        .locator(".recall-updates")
        .screenshot({ path: path.join(output, `updates-${theme}.png`) });
    }
    await page
      .getByRole("button", { name: "Update & restart", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "42");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .screenshot({ path: path.join(output, "downloading-dark.png") });
    await page
      .getByRole("button", { name: "Cancel update", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      page
        .locator(".recall-updates")
        .getByText("Update cancelled. Your installed app is unchanged."),
    ).toBeVisible();
    await expect(page.locator(".update-notice")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss update notice" }).click();
    await expect(page.locator(".update-notice")).toHaveCount(0);
    await page.setViewportSize({ width: 580, height: 850 });
    await page
      .locator(".recall-updates")
      .screenshot({ path: path.join(output, "updates-narrow.png") });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
  }
  const after = new Store(profile);
  assert.deepEqual(
    after.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before.cards,
  );
  assert.deepEqual(
    after.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
    before.reviews,
  );
  assert.deepEqual(after.get("session"), before.session);
  after.close();
  console.log(
    "PASS hidden update UI: check, source selection, progress, cancellation, light/dark, narrow layout; cards, reviews and session preserved.",
  );
  fs.rmSync(profile, { recursive: true, force: true });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
