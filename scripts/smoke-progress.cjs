const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs");
(async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-progress-ui-"));
  const s = new Store(folder);
  const cards = structuredClone(require("../examples/demo.json").cards);
  s.import(cards);
  const insert = s.db.prepare(
    "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,0,'{}','{}',0)",
  );
  for (let i = 0; i < 140; i++)
    insert.run(
      cards[i % 3].id,
      new Date(Date.now() - (i % 12) * 86400000 - 60000).toISOString(),
      ["Again", "Hard", "Good", "Easy"][i % 4],
    );
  const before = JSON.parse(JSON.stringify(s.snapshot()));
  s.close();
  let app;
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [path.join(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: folder },
    });
    const p = await app.firstWindow(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Small sessions. Lasting progress." }),
    ).toBeVisible();
    await expect(p.locator(".progress-stat").first()).toContainText("140");
    await expect(p.locator(".progress-stat").nth(1)).toContainText("75%");
    await expect(
      p
        .getByRole("group", { name: "Daily review activity" })
        .getByRole("button"),
    ).toHaveCount(28);
    await p.locator(".progress-day").last().click();
    await expect(p.locator(".progress-day-detail")).toContainText("recalled");
    for (const theme of ["dark", "light"]) {
      await p.emulateMedia({ colorScheme: theme });
      await p.setViewportSize({ width: 1320, height: 1000 });
      fs.mkdirSync(path.join(__dirname, "../evidence"), { recursive: true });
      await p.screenshot({
        path: path.join(__dirname, `../evidence/progress-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await p.setViewportSize({ width: 780, height: 900 });
    await p.screenshot({
      path: path.join(__dirname, "../evidence/progress-narrow.png"),
      fullPage: true,
      animations: "disabled",
    });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.getByLabel("Progress period").selectOption("7");
    await expect(p.locator(".progress-day")).toHaveCount(7);
    await p.getByLabel("Progress period").selectOption("90");
    await expect(p.locator(".progress-day")).toHaveCount(90);
    await p.locator(".progress-revisit button").first().click();
    await expect(p.locator(".answer")).toHaveCount(0);
    const after = await p.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.cards, before.cards);
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.session, before.session);
    assert.deepEqual(errors, []);
    await app.close();
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [path.join(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: path.join(folder, "empty") },
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
    console.log(
      "PASS progress metrics, full history, date selection, both themes, narrow layout, hidden card navigation, unchanged cards/reviews/session",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
