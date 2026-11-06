// Hidden real-renderer checks with synthetic data; never reads a personal profile.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { createProfile } = require("../electron/verification-mode.cjs");
async function run() {
  const executable = process.env.RECALL_TEST_EXECUTABLE;
  await require("./require-invisible-runtime.cjs")(executable);
  const folder = createProfile(), output = path.join(__dirname, "../evidence/atlas");
  fs.mkdirSync(output, { recursive: true });
  const store = new Store(folder), demo = require("../examples/demo.json").cards;
  store.import(demo);
  store.import(Array.from({ length: 1100 }, (_, i) => ({ ...demo[i % 3], id: `atlas-fixture:${i}`, conceptId: `atlas-fixture:${Math.floor(i / 3)}`, title: `Practice idea ${Math.floor(i / 3) + 1}`, topic: `Topic ${String(Math.floor(i / 60) + 1).padStart(2, "0")}`, decks: ["Atlas fixtures"] })));
  const at = new Date(), weekAgo = new Date(at.getTime() - 8 * 86400000);
  const insert = store.db.prepare("INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,0,'{}','{}',0)");
  insert.run(demo[0].id, weekAgo.toISOString(), "Hard");
  insert.run(demo[0].id, at.toISOString(), "Good");
  const beforeCards = store.db.prepare("SELECT * FROM cards ORDER BY id").all(), beforeReviews = store.db.prepare("SELECT * FROM reviews ORDER BY id").all();
  store.close();
  let app;
  try {
    app = await electron.launch({ ...(executable ? { executablePath: executable, args: [] } : { args: [path.join(__dirname, "..")] }), env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" } });
    const page = await app.firstWindow(), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.emulateMedia({ colorScheme: null });
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(page.locator("#atlas-title")).toBeVisible();
    await expect(page.locator(".atlas-region")).toHaveCount(6);
    assert((await page.locator(".atlas-node").count()) <= 24);
    const first = await page.locator(".atlas-region-open").first().innerText();
    await page.getByLabel("Next atlas page").click();
    assert.notEqual(await page.locator(".atlas-region-open").first().innerText(), first);
    await page.getByLabel("Atlas collection").selectOption(demo[0].decks[0]);
    const formats = page.getByRole("group", { name: "Question format" });
    for (const [label, kind] of [["Concepts", "concept"], ["Math", "math"], ["Coding", "code"], ["Mixed", "all"]]) {
      await formats.getByRole("button", { name: new RegExp(`^${label}`) }).click();
      await page.getByRole("button", { name: "Practice this idea", exact: true }).click();
      const session = await page.evaluate(async () => (await window.recall.snapshot()).session);
      assert(session.ids.length && session.ids.every((id) => demo.some((c) => c.id === id && (kind === "all" || c.kind === kind))));
      assert.equal(session.selection.format, kind);
      assert.equal(session.revealed, false);
      await expect(page.locator(".answer")).toHaveCount(0);
      await page.getByRole("button", { name: "Progress", exact: true }).click();
      await page.getByRole("button", { name: "Review a small set", exact: true }).click();
      assert.deepEqual(await page.evaluate(async () => (await window.recall.snapshot()).session), session);
      // Clear only this disposable test session; never rate a fixture.
      await page.evaluate(() => window.recall.setting("session", null));
      await page.reload();
      await page.getByRole("button", { name: "Progress", exact: true }).click();
    }
    await formats.getByRole("button", { name: /^Concepts/ }).click();
    await expect(page.locator(".atlas-node .recalled_later")).toHaveCount(1);
    await page.getByRole("button", { name: "A week ago", exact: true }).click();
    await expect(page.locator(".atlas-node .needs_practice")).toHaveCount(1);
    await page.getByRole("button", { name: "Now", exact: true }).click();
    await page.getByText("Recorded attempts (2)", { exact: true }).click();
    await page.getByRole("button", { name: "View review day", exact: true }).first().click();
    await expect(page.locator(".ledger-entry")).toHaveCount(1);
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await page.getByLabel("Atlas collection").selectOption("all");
    for (const theme of ["light", "dark"]) {
      await app.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value; }, theme);
      await expect.poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(theme === "dark");
      for (const width of [1420, 780]) {
        await page.setViewportSize({ width, height: 1000 });
        const overflow = await page.locator(".learning-atlas").evaluate((el) => el.scrollWidth - el.clientWidth);
        assert(overflow <= 1, `Atlas overflow at ${width}`);
        await page.screenshot({ path: path.join(output, `atlas-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
      }
    }
    await page.getByLabel("Find a concept in Atlas").fill("No matching fixture");
    await expect(page.locator(".atlas-empty")).toBeVisible();
    await expect(page.getByRole("button", { name: "Practice this idea", exact: true })).toHaveCount(0);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible() || w.isFocused())), false);
    assert.deepEqual(errors, []);
    await app.close(); app = null;
    const after = new Store(folder);
    assert.deepEqual(after.db.prepare("SELECT * FROM cards ORDER BY id").all(), beforeCards);
    assert.deepEqual(after.db.prepare("SELECT * FROM reviews ORDER BY id").all(), beforeReviews);
    after.close();
    console.log("Atlas passed invisibly: 1,103 cards, bounded regions, all four session formats, hidden answers, history replay, review links, unfinished session preservation, light/dark and narrow layouts. Cards and reviews unchanged.");
  } finally { await app?.close(); fs.rmSync(folder, { recursive: true, force: true }); }
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
