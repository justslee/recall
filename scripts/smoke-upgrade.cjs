const { _electron: electron, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
(async () => {
  const folder = process.argv[2];
  assert(folder, "Supply an isolated existing profile");
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      args: [path.join(__dirname, "..")],
      env: { ...process.env, RECALL_DATA_DIR: folder },
    });
    const page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "Study desk", exact: true })
      .waitFor();
    const snapshot = await page.evaluate(() => window.recall.snapshot());
    assert(snapshot.cards.length > 3);
    await expect(
      page.getByRole("button", { name: "Try the demo", exact: true }),
    ).toHaveCount(0);
    const catalogCards = snapshot.cards.filter((c) => c.catalog),
      deck = catalogCards[0].decks[0];
    await page
      .locator(".sidebar")
      .getByRole("button")
      .filter({ hasText: deck })
      .click();
    await expect(
      page.getByRole("heading", { name: deck, exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /All challenges/ }).click();
    await expect(page.locator(".challenge-catalog")).toBeVisible();
    const visibleTitles = await page.locator(".challenge-catalog").innerText();
    assert(visibleTitles.includes(catalogCards[0].title));
    const target = page
      .locator(".challenge-catalog")
      .getByRole("button")
      .filter({ hasText: catalogCards[0].title })
      .first();
    // The catalog's title is a button; opening it must retain its original curriculum and workspace.
    await target.click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    const after = await page.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.cards, snapshot.cards);
    assert.deepEqual(after.history, snapshot.history);
    assert.deepEqual(errors, []);
    console.log(
      "PASS existing profile: no onboarding, catalog navigation, coding workspace, card/history preservation",
    );
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
