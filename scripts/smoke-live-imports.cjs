// Real desktop import and refresh; only synthetic cards in a disposable profile.
const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const { Store } = require("../electron/store.cjs"),
  { cardLink } = require("../electron/card-links.cjs");
const repo = path.resolve(__dirname, "..");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-live-desktop-"));
const cards = structuredClone(require("../examples/demo.json").cards);
const collectionNames = [
  "Algorithms",
  "Economics",
  "Statistics",
  "Systems",
  "Languages",
  "Packaging",
];
const shelfCards = collectionNames.map((name, index) => ({
  ...cards[0],
  id: "shelf-" + index,
  conceptId: "shelf-" + index,
  decks: [name],
}));
for (const card of cards) card.decks = [collectionNames[0]];
const store = new Store(folder);
store.import([...cards, ...shelfCards]);
const session = {
  id: "paused",
  ids: cards.map((c) => c.id),
  index: 0,
  revealed: false,
  rated: 0,
  skipped: 0,
  selection: {
    practice: false,
    topics: [],
    deck: "all",
    format: "all",
    difficulty: "all",
    limit: 10,
  },
};
store.set("session", session);
const before = store.db.prepare("SELECT * FROM cards ORDER BY id").all();
store.close();
const cli = (...args) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(repo, "cli/recall.cjs"), "--data", folder, "cards", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ),
  );
(async () => {
  let app;
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [repo] }),
      env: { ...process.env, RECALL_DATA_DIR: folder },
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    await expect(page.locator(".shelf-book")).toHaveCount(4);
    await page.getByRole("button", { name: /^View all collections/ }).click();
    await expect(page.locator(".shelf-book")).toHaveCount(6);
    await expect(
      page.getByRole("button", {
        name: "Open collection Packaging",
        exact: true,
      }),
    ).toBeVisible();
    for (const [theme, width] of [
      ["light", 1320],
      ["dark", 760],
    ]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 950 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Shelf overflows viewport",
      );
      fs.mkdirSync(path.join(repo, "evidence"), { recursive: true });
      await page.screenshot({
        path: path.join(repo, `evidence/collections-${theme}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: /^Show fewer collections/ }).click();
    await expect(page.locator(".shelf-book")).toHaveCount(4);
    await page.getByRole("button", { name: /^Resume session/ }).click();
    await page
      .getByRole("button", { name: "Type answer", exact: true })
      .click();
    const prose = "Keep this unfinished explanation while importing.";
    await page.getByRole("textbox", { name: "Your spoken answer" }).fill(prose);
    await page.evaluate(() => {
      window.__liveImportCanary = "same page";
      window.__libraryChanges = 0;
      window.recall.onLibraryChanged(() => window.__libraryChanges++);
    });
    const importCard = async (id, deck, checkAttempt) => {
      const file = path.join(folder, id + ".json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          schemaVersion: 1,
          id,
          title: deck,
          cards: [
            {
              ...cards[0],
              id,
              conceptId: id,
              title: deck + " concept",
              decks: [deck],
            },
          ],
        }),
      );
      const queued = cli("import", file, "--apply");
      assert.equal(queued.mode, "queued");
      await expect
        .poll(() => cli("import-status", queued.requestId).mode, {
          timeout: 15000,
        })
        .toBe("imported");
      await expect
        .poll(() => page.evaluate(() => window.__libraryChanges))
        .toBe(Number(id.slice(-1)));
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.recall.snapshot().then((s) => s.cards.length),
          ),
        )
        .toBe(before.length + Number(id.slice(-1)));
      assert.equal(
        await page.evaluate(() => window.__liveImportCanary),
        "same page",
      );
      await checkAttempt();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      // The rendered collection selector proves the renderer took the notification.
      await expect(
        page
          .getByRole("combobox", { name: "Collection", exact: true })
          .locator("option")
          .filter({ hasText: deck }),
      ).toHaveCount(1);
    };
    // Start with an import during an active concept review.
    const file = path.join(folder, "live-1.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        id: "live-1",
        title: "New collection",
        cards: [
          {
            ...cards[0],
            id: "live-1",
            conceptId: "live-1",
            title: "Newly imported concept",
            decks: ["New collection"],
          },
        ],
      }),
    );
    const queued = cli("import", file, "--apply");
    assert.equal(queued.mode, "queued");
    await expect
      .poll(() => cli("import-status", queued.requestId).mode, {
        timeout: 15000,
      })
      .toBe("imported");
    await expect
      .poll(() => page.evaluate(() => window.__libraryChanges))
      .toBe(1);
    await expect(
      page.getByRole("textbox", { name: "Your spoken answer" }),
    ).toHaveValue(prose);
    await expect(page.locator(".answer")).toHaveCount(0);
    assert.equal(
      await page.evaluate(() => window.__liveImportCanary),
      "same page",
    );
    await page.getByRole("button", { name: "Study desk", exact: true }).click();
    await page.getByRole("button", { name: /^View all collections/ }).click();
    await expect(
      page.getByRole("button", {
        name: "Open collection New collection",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Open collection New collection",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "New collection", exact: true }),
    ).toBeVisible();
    // Math input and Monaco drafts also survive refresh without revealing answers.
    const open = (url) =>
      app.evaluate(
        ({ app }, value) =>
          app.emit("open-url", { preventDefault() {} }, value),
        url,
      );
    const math = cards.find((c) => c.kind === "math"),
      code = cards.find((c) => c.kind === "code");
    await open(cardLink(math.id));
    await page.getByRole("textbox", { name: "Numerical answer" }).fill("123.4");
    await page.evaluate(() => {
      window.__attemptElement = document.querySelector(".math-work input");
    });
    await importCard("live-2", "Fresh math collection", async () => {
      await expect(
        page.getByRole("textbox", { name: "Numerical answer" }),
      ).toHaveValue("123.4");
      assert(
        await page.evaluate(
          () =>
            window.__attemptElement ===
            document.querySelector(".math-work input"),
        ),
      );
      await expect(page.locator(".answer")).toHaveCount(0);
    });
    await open(cardLink(math.id));
    await expect(
      page.getByRole("textbox", { name: "Numerical answer" }),
    ).toHaveValue("123.4");
    await expect(page.locator(".answer")).toHaveCount(0);
    await open(cardLink(code.id));
    const editor = page.locator(".monaco-editor textarea");
    await editor.focus();
    await page.keyboard.press("Meta+A");
    await page.keyboard.insertText("# Preserve this coding draft\n");
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.recall.draft("draft:" + id + ":python"),
          code.id,
        ),
      )
      .toContain("Preserve this coding draft");
    await page.evaluate(() => {
      window.__attemptElement = document.querySelector(
        ".monaco-editor textarea",
      );
    });
    await importCard("live-3", "Fresh coding collection", async () => {
      await expect(page.locator(".monaco-editor")).toContainText(
        "Preserve this coding draft",
      );
      assert(
        await page.evaluate(
          () =>
            window.__attemptElement ===
            document.querySelector(".monaco-editor textarea"),
        ),
      );
    });
    await open(cardLink(code.id));
    await expect(page.locator(".monaco-editor")).toContainText(
      "Preserve this coding draft",
    );
    const after = await page.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.session, session);
    assert.deepEqual(after.history, []);
    assert.equal(
      await page.evaluate(() => window.__liveImportCanary),
      "same page",
    );
    await app.close();
    app = null;
    const check = new Store(folder);
    try {
      for (const old of before) assert.deepEqual(check.card(old.id), old);
      assert.equal(
        require("../electron/self-test.cjs").read(folder).entries.length,
        0,
      );
    } finally {
      check.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS expand/collapse collections in both themes, live imports without reload, visible new collections, concept/math/code drafts, hidden answers and paused session/history preserved",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
