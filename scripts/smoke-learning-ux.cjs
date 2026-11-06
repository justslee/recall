const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { createProfile } = require("../electron/verification-mode.cjs");
async function run() {
  const executable = process.env.RECALL_TEST_EXECUTABLE;
  await require("./require-invisible-runtime.cjs")(executable);
  const folder = createProfile(),
    output = path.join(__dirname, "../evidence/learning-ux");
  const launch = () =>
    electron.launch({
      ...(executable
        ? { executablePath: executable, args: [] }
        : { args: [path.join(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
    });
  fs.mkdirSync(output, { recursive: true });
  // Document the first-run entry points using an empty, invisible profile.
  const welcome = await launch();
  try {
    const page = await welcome.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    await welcome.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "light";
    });
    await expect(
      page.getByRole("button", { name: "Try a short session", exact: true }),
    ).toBeVisible();
    assert.equal(
      await welcome.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    await page.screenshot({
      path: path.join(output, "welcome.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await welcome.close();
  }
  const store = new Store(folder),
    demo = require("../examples/demo.json").cards;
  store.import(demo);
  store.import(
    Array.from({ length: 35 }, (_, i) => ({
      ...demo[0],
      id: `synthetic:${i}`,
      conceptId: `synthetic:${i}`,
      title: `Notebook concept ${i + 1}`,
      topic: i % 2 ? "Systems" : "Mathematics",
      decks: ["Practice notebook"],
    })),
  );
  store.db
    .prepare(
      "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,0,'{}','{}',0)",
    )
    .run(demo[0].id, new Date().toISOString(), "Hard");
  const beforeCards = store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    beforeReviews = store.db.prepare("SELECT * FROM reviews ORDER BY id").all();
  store.close();
  let app;
  try {
    app = await launch();
    const page = await app.firstWindow(),
      errors = [];
    await page.emulateMedia({ colorScheme: null });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "See the ground you’ve gained." }),
    ).toBeVisible();
    assert((await page.locator(".atlas-node").count()) <= 24);
    await page.getByLabel("Find a concept in Atlas").fill("Weighted");
    await page.locator(".atlas-node").first().click();
    await expect(page.getByLabel("Selected concept evidence")).toContainText(
      "Needs practice",
    );
    await page.getByRole("button", { name: "A week ago", exact: true }).click();
    await expect(page.getByLabel("Selected concept evidence")).toContainText(
      "No recorded attempt",
    );
    await page.getByRole("button", { name: "Now", exact: true }).click();
    await page.getByLabel("Find a concept in Atlas").fill("");
    for (const theme of ["light", "dark"]) {
      await app.evaluate(({ nativeTheme }, v) => {
        nativeTheme.themeSource = v;
      }, theme);
      await expect
        .poll(() =>
          page.evaluate(
            () => matchMedia("(prefers-color-scheme: dark)").matches,
          ),
        )
        .toBe(theme === "dark");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(output, `map-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page
      .getByRole("button", { name: "Review journal", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your study rhythm" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Atlas", exact: true }).click();
    await page.getByLabel("Atlas topic").selectOption("Systems");
    await expect(page.locator(".atlas-node")).toHaveCount(4);
    await page.getByRole("button", { name: /Explore all .*Systems/ }).click();
    await expect(page.locator(".atlas-node")).toHaveCount(12);
    await page
      .getByRole("button", { name: "Next atlas page", exact: true })
      .click();
    await expect(page.locator(".atlas-node")).toHaveCount(5);
    await page
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your learning, connected." }),
    ).toBeVisible();
    await expect(page.locator(".connection-hub-card")).toHaveCount(5);
    await expect(page.locator(".connection-codex small")).not.toHaveText(
      "Checking…",
    );
    for (const theme of ["light", "dark"]) {
      await app.evaluate(({ nativeTheme }, v) => {
        nativeTheme.themeSource = v;
      }, theme);
      await expect
        .poll(() =>
          page.evaluate(
            () => matchMedia("(prefers-color-scheme: dark)").matches,
          ),
        )
        .toBe(theme === "dark");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(output, `connections-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    for (const [title, expected] of [
      ["Codex", "Connect Codex"],
      ["Claude", "Connect Claude"],
    ]) {
      await page.locator(`.connection-${title.toLowerCase()}`).click();
      await expect(
        page.getByRole("button", { name: expected, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Readiness & connection details"),
      ).toBeVisible();
      await expect(page.locator(".assistant-readiness")).not.toBeVisible();
      await expect(page.locator(".learning-inbox")).toHaveCount(0);
      await page
        .getByRole("button", { name: "All connections", exact: true })
        .click();
    }
    await page.locator(".connection-knowledge").click();
    await expect(
      page.getByRole("button", { name: /Create my first knowledge base/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "All connections", exact: true })
      .click();
    await page.locator(".connection-voice").click();
    await expect(
      page.getByRole("heading", { name: "Speak, reflect, remember." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "All connections", exact: true })
      .click();
    await page.locator(".connection-paper").click();
    await expect(
      page.getByText("Connect Recall Pad", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await page.getByLabel("Atlas topic").selectOption("all");
    await page
      .getByRole("group", { name: "Question format" })
      .getByRole("button", { name: /^Math/ })
      .click();
    await page
      .getByRole("button", { name: "Review a small set", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Reveal worked solution", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".answer")).toHaveCount(0);
    const session = await page.evaluate(
      async () => (await window.recall.snapshot()).session,
    );
    assert.deepEqual(session.ids, [demo.find((c) => c.kind === "math").id]);
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await page
      .getByRole("group", { name: "Question format" })
      .getByRole("button", { name: /^Concepts/ })
      .click();
    await page
      .getByRole("button", { name: "Review a small set", exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(async () => (await window.recall.snapshot()).session),
      session,
    );
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    const after = new Store(folder);
    assert.deepEqual(
      after.db.prepare("SELECT * FROM cards ORDER BY id").all(),
      beforeCards,
    );
    assert.deepEqual(
      after.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
      beforeReviews,
    );
    after.close();
    console.log(
      "Hidden UI checks passed: map, evidence, format-scoped sessions, unfinished session preservation, journal, connections, paper and speech; cards and reviews unchanged.",
    );
  } finally {
    await app?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
