// Synthetic fixtures only; never opens or modifies the reader's profile.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs"),
  { createProfile } = require("../electron/verification-mode.cjs"),
  { saveConfig } = require("../electron/config.cjs"),
  { KnowledgeIndex } = require("../electron/knowledge-index.cjs");
async function main() {
  const folder = createProfile(),
    notes = path.join(folder, "notes");
  fs.mkdirSync(notes);
  const card = {
    ...require("../examples/demo.json").cards[0],
    id: "demo:note-visual",
    widgetsAllowed: false,
    answer:
      'Definition.\n```widget Explore grouping\n<label>Group size<input id="size" type="range" min="1" max="8" value="8"></label><output id="calls"></output><script>const size=document.querySelector("#size");function draw(){document.querySelector("#calls").textContent=Math.ceil(8/Number(size.value))+" calls"}size.addEventListener("input",draw);draw()</script>\n```',
  };
  fs.writeFileSync(
    path.join(notes, "Grouping.md"),
    "# Grouping\n\nAn explanation remains readable.\n\n```recall-visual\n" +
      JSON.stringify({ cardId: card.id, widgetIndex: 0 }) +
      "\n```",
  );
  fs.writeFileSync(
    path.join(notes, "Missing.md"),
    '# Missing\n\n```recall-visual\n{"cardId":"missing","widgetIndex":0}\n```',
  );
  fs.writeFileSync(
    path.join(notes, "Hostile.md"),
    '# Hostile\n<script>window.ATTACK=true</script><iframe src="recall://widget/demo/0"></iframe>\n\n```widget Inert code\n<script>window.ATTACK=true</script>\n```',
  );
  saveConfig(folder, {
    sources: [
      {
        id: "notes",
        name: "Fixtures",
        type: "markdown",
        root: notes,
        write: true,
      },
    ],
    captureEnabled: false,
  });
  const store = new Store(folder);
  store.import([card]);
  const before = store.card(card.id);
  store.close();
  const index = new KnowledgeIndex(folder);
  await index.refresh();
  index.close();
  let app;
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [path.resolve(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
    });
    const page = await app.firstWindow();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    await page
      .getByRole("group", { name: "Knowledge view" })
      .getByRole("button", { name: "Notes", exact: true })
      .click();
    const open = async (title) => {
      await page.getByLabel("Search knowledge").fill(title);
      await page
        .locator(".knowledge-entry")
        .filter({ has: page.getByText(title, { exact: true }) })
        .click();
      await expect(page.locator(".knowledge-prose h1")).toHaveText(title);
    };
    await open("Grouping");
    await expect(page.locator("iframe")).toHaveCount(0);
    assert.equal(
      await app.evaluate(
        async ({ net }, id) =>
          (await net.fetch("recall://widget/" + encodeURIComponent(id) + "/0"))
            .status,
        card.id,
      ),
      403,
    );
    await page
      .getByRole("button", {
        name: "Enable interactive visuals for this card",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Load interactive", exact: true }),
    ).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    for (const theme of ["light", "dark"])
      for (const width of [1400, 900]) {
        await app.evaluate(({ nativeTheme }, v) => {
          nativeTheme.themeSource = v;
        }, theme);
        await page.setViewportSize({ width, height: 1000 });
        await page
          .getByRole("button", { name: "Load interactive", exact: true })
          .click();
        await expect(page.locator(".visual-widget")).toHaveAttribute(
          "data-widget-status",
          "ready",
        );
        const frame = page.frameLocator(".visual-widget iframe");
        await expect(frame.locator("#calls")).toHaveText("1 calls");
        await frame.locator("#size").fill("3");
        await expect(frame.locator("#calls")).toHaveText("3 calls");
        assert.equal(
          await frame.locator("body").evaluate(() => typeof window.recall),
          "undefined",
        );
        assert.equal(
          await page.locator("iframe").getAttribute("sandbox"),
          "allow-scripts",
        );
        await page.getByRole("button", { name: "Expand", exact: true }).click();
        await expect(frame.locator("#size")).toHaveValue("3");
        await page
          .getByRole("button", { name: "Collapse", exact: true })
          .click();
        await expect(frame.locator("#size")).toHaveValue("3");
        await app.evaluate(
          ({ nativeTheme }, v) => {
            nativeTheme.themeSource = v;
          },
          theme === "light" ? "dark" : "light",
        );
        await expect(frame.locator("#size")).toHaveValue("3");
        await page
          .getByRole("button", { name: "Progress", exact: true })
          .click();
        await expect(page.locator("iframe")).toHaveCount(0);
        await page
          .getByRole("button", { name: "Knowledge", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Load interactive", exact: true }),
        ).toBeVisible();
      }
    await open("Missing");
    await expect(
      page.getByText(/linked card or visual may have been removed/),
    ).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await open("Hostile");
    await expect(page.locator("iframe")).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.ATTACK), undefined);
    await app.close();
    app = null;
    const check = new Store(folder);
    const after = check.card(card.id);
    assert.deepEqual(JSON.parse(after.content), {
      ...JSON.parse(before.content),
      widgetsAllowed: true,
    });
    assert.equal(after.schedule, before.schedule);
    assert.equal(
      check.db.prepare("SELECT count(*) AS n FROM reviews").get().n,
      0,
    );
    check.close();
    console.log(
      "PASS hidden Knowledge visual journey: explicit enable/load, 403, sandbox, controls, appearance, expansion, unload, missing references, hostile notes and preservation.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
