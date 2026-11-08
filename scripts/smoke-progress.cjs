const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs");
const { saveConfig } = require("../electron/config.cjs");
(async () => {
  await require("./require-invisible-runtime.cjs")(
    process.env.RECALL_TEST_EXECUTABLE,
  );
  const folder = require("../electron/verification-mode.cjs").createProfile();
  const emptyFolder =
    require("../electron/verification-mode.cjs").createProfile();
  const s = new Store(folder);
  saveConfig(folder, { timeZone: "UTC" });
  const today = new Date().toISOString().slice(0, 10);
  const midnight = new Date(today + "T00:00:00Z").getTime();
  const cards = structuredClone(require("../examples/demo.json").cards);
  s.import(cards);
  const insert = s.db.prepare(
    "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,0,'{}','{}',0)",
  );
  for (let i = 0; i < 140; i++)
    insert.run(
      cards[i % 3].id,
      new Date(midnight - (i % 12) * 86400000).toISOString(),
      ["Again", "Hard", "Good", "Easy"][i % 4],
    );
  const scheduled = s.db.prepare("UPDATE cards SET schedule=? WHERE id=?");
  for (const [index, offset] of [
    [0, -1],
    [1, 0],
    [2, 1],
  ]) {
    const current = JSON.parse(s.card(cards[index].id).schedule);
    scheduled.run(
      JSON.stringify({
        ...current,
        state: 2,
        due: new Date(midnight + offset * 86400000).toISOString(),
      }),
      cards[index].id,
    );
  }
  const before = JSON.parse(JSON.stringify(s.snapshot()));
  s.close();
  let app;
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [path.join(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
    });
    const p = await app.firstWindow(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await app.evaluate(({ ipcMain }) => {
      globalThis.progressAtlasCalls = 0;
      ipcMain.removeHandler("recall:learningMap");
      ipcMain.handle("recall:learningMap", () => {
        globalThis.progressAtlasCalls++;
        throw Error("Progress must not request the retired Atlas projection");
      });
    });
    await p.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(
      p.getByRole("heading", {
        name: "Review journal",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      p.getByRole("button", { name: "Atlas", exact: true }),
    ).toHaveCount(0);
    await expect(
      p.getByRole("figure", { name: "Seven-day recall trend", exact: true }),
    ).toBeVisible();
    await expect(
      p.getByRole("figure", {
        name: "Scheduled reviews for the next seven days",
        exact: true,
      }),
    ).toBeVisible();
    await expect(p.locator(".forecast-day")).toHaveCount(7);
    await expect(p.locator(".forecast-day > strong")).toHaveText([
      "1",
      "1",
      "0",
      "0",
      "0",
      "0",
      "0",
    ]);
    await expect(p.locator(".forecast-overdue")).toContainText("1");
    await expect(p.locator(".progress-stat > strong")).toHaveText([
      "140",
      "75%",
      "12",
      "2",
    ]);
    await expect(p.locator(".progress-outcome > strong")).toHaveText([
      "35",
      "35",
      "35",
      "35",
    ]);
    await expect(p.locator(".progress-formats small")).toHaveText([
      "47 reviews · 74% recalled",
      "47 reviews · 74% recalled",
      "46 reviews · 76% recalled",
    ]);
    await expect(
      p
        .getByRole("group", { name: "Daily review activity" })
        .getByRole("button"),
    ).toHaveCount(28);
    const breakdown = p.getByRole("group", { name: "Activity breakdown" });
    await breakdown
      .getByRole("button", { name: "First & repeat", exact: true })
      .click();
    await expect(
      breakdown.getByRole("button", { name: "First & repeat", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(p.locator(".progress-day").first()).toHaveAttribute(
      "aria-label",
      /first|repeat/i,
    );
    await breakdown
      .getByRole("button", { name: "Ratings", exact: true })
      .click();
    const trend = p.getByRole("slider", {
      name: "Inspect recall trend",
      exact: true,
    });
    await trend.focus();
    await p.keyboard.press("Home");
    await expect(p.locator(".trend-detail > strong")).toHaveText("No reviews");
    await p.keyboard.press("End");
    await expect(p.locator(".trend-detail > strong")).toHaveText(
      "71% recalled",
    );
    await expect(trend).toHaveAttribute("aria-valuetext", /84 reviews/);
    const activityDays = p.locator(".progress-day");
    await expect(p.locator('.progress-day[tabindex="0"]')).toHaveCount(1);
    await activityDays.last().focus();
    await p.keyboard.press("ArrowLeft");
    await expect(activityDays.nth(26)).toBeFocused();
    await expect(activityDays.nth(26)).toHaveAttribute("aria-pressed", "true");
    await expect(activityDays.nth(26)).toHaveAttribute("tabindex", "0");
    await expect(activityDays.last()).toHaveAttribute("tabindex", "-1");
    await p.keyboard.press("Home");
    await expect(activityDays.first()).toBeFocused();
    await expect(activityDays.first()).toHaveAttribute("aria-pressed", "true");
    await p.keyboard.press("End");
    await expect(activityDays.last()).toBeFocused();
    await expect(p.locator('.progress-day[tabindex="0"]')).toHaveCount(1);
    await p.keyboard.press("Enter");
    await expect(p.locator(".progress-day-detail")).toContainText(
      "12 reviews · 0 recalled",
    );
    await expect(p.locator(".trend-detail")).toContainText("84");
    await p.getByRole("button", { name: "Open this day’s history" }).click();
    await expect(p.locator(".day-filter")).toHaveText(today);
    await expect(p.locator(".ledger-entry")).toHaveCount(12);
    await expect(p.locator(".ledger-entry .rating-chip")).toHaveText(
      Array(12).fill("Again"),
    );
    await p.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(p.locator(".progress-stat > strong").first()).toHaveText(
      "140",
    );
    const output = path.join(__dirname, "../evidence/progress");
    fs.mkdirSync(output, { recursive: true });
    await p.emulateMedia({ colorScheme: null });
    for (const theme of ["dark", "light"]) {
      await app.evaluate(({ nativeTheme }, value) => {
        nativeTheme.themeSource = value;
      }, theme);
      await expect
        .poll(() =>
          p.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches),
        )
        .toBe(theme === "dark");
      for (const width of [1320, 780]) {
        await p.setViewportSize({ width, height: 1000 });
        await p.screenshot({
          path: path.join(output, `journal-${theme}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        if (width === 1320) {
          await p.screenshot({
            path: path.join(output, `journal-${theme}-overview.png`),
            fullPage: false,
            animations: "disabled",
          });
        }
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `Document overflow: ${theme} ${width}`,
        );
        assert(
          await p
            .locator(".progress-page")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          `Journal overflow: ${theme} ${width}`,
        );
      }
    }
    await p.getByLabel("Progress period").selectOption("7");
    await expect(p.locator(".progress-day")).toHaveCount(7);
    await expect(p.locator(".progress-stat > strong")).toHaveText([
      "84",
      "71%",
      "7",
      "2",
    ]);
    await p.getByLabel("Progress period").selectOption("90");
    await expect(p.locator(".progress-day")).toHaveCount(90);
    assert(
      await p
        .locator(".progress-page")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "90-day narrow overflow",
    );
    await expect(p.locator(".progress-stat > strong")).toHaveText([
      "140",
      "75%",
      "12",
      "2",
    ]);
    await expect(p.locator(".progress-revisit button")).toHaveCount(2);
    await p.locator(".progress-revisit button").first().click();
    await expect(
      p.getByRole("heading", { name: cards[0].title, exact: true }),
    ).toBeVisible();
    await expect(
      p.getByRole("button", { name: "Reveal answer", exact: true }),
    ).toBeVisible();
    await expect(p.locator(".answer")).toHaveCount(0);
    await expect(p.locator(".ratings")).toHaveCount(0);
    const after = await p.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.cards, before.cards);
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.session, before.session);
    assert.deepEqual(errors, []);
    assert.equal(await app.evaluate(() => globalThis.progressAtlasCalls), 0);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    await app.close();
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [path.join(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: emptyFolder, RECALL_VERIFY: "1" },
    });
    const empty = await app.firstWindow();
    await empty.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(
      empty.locator(".progress-stat").first().locator("strong"),
    ).toHaveText("0");
    await expect(
      empty.locator(".progress-stat").nth(1).locator("strong"),
    ).toHaveText("—");
    await expect(
      empty.getByText(
        "No scored reviews in this period. A short self-test is a good place to begin.",
      ),
    ).toBeVisible();
    await expect(
      empty.getByRole("button", { name: "Atlas", exact: true }),
    ).toHaveCount(0);
    await expect(empty.locator(".forecast-day")).toHaveCount(7);
    await expect(empty.locator(".forecast-day > strong")).toHaveText(
      Array(7).fill("0"),
    );
    await expect(empty.locator(".trend-detail > strong")).toHaveText(
      "No reviews",
    );
    await expect(empty.locator(".journal-trend-line")).toHaveCount(0);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    console.log(
      "PASS exact progress metrics for 7/28/90 days, day history, full history, both themes, narrow layout, hidden card navigation, unchanged cards/reviews/session",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(emptyFolder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
