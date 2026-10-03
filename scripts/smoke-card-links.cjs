const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs");
const { cardLink } = require("../electron/card-links.cjs");
const st = require("../electron/self-test.cjs");
(async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-link-smoke-"));
  const s = new Store(folder);
  const cards = structuredClone(require("../examples/demo.json").cards);
  cards[0].id = "kb/reading (example)/concept";
  s.import(cards);
  s.set("session", {
    id: "paused",
    ids: [cards[0].id],
    index: 0,
    revealed: true,
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
  });
  s.set("draft:" + cards[1].id + ":numeric", "123");
  st.capture(folder, {
    id: "reading/1",
    sessionId: "reading",
    title: "Reading example",
    objective: "Explain weighted means",
    context: "Test fixture",
    at: new Date().toISOString(),
    evidence: "discussed",
    cardIds: cards.map((c) => c.id),
  });
  const before = {
    cards: s.cards(),
    reviews: s.db.prepare("SELECT * FROM reviews").all(),
    session: s.get("session"),
    draft: s.get("draft:" + cards[1].id + ":numeric"),
  };
  s.close();
  let app;
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? {
            executablePath: process.env.RECALL_TEST_EXECUTABLE,
            args: [cardLink(cards[0].id)],
          }
        : { args: [path.join(__dirname, ".."), cardLink(cards[0].id)] }),
      env: { ...process.env, RECALL_DATA_DIR: folder },
    });
    const p = await app.firstWindow(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await expect(
      p.getByRole("heading", { name: cards[0].title, exact: true }),
    ).toBeVisible();
    await expect(p.locator(".answer")).toHaveCount(0);
    await p.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await expect(p.locator(".answer")).toBeVisible();
    const open = async (url) =>
      app.evaluate(
        ({ app }, value) =>
          app.emit("open-url", { preventDefault() {} }, value),
        url,
      );
    await open(cardLink(cards[0].id));
    await expect(p.locator(".answer")).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      await p.emulateMedia({ colorScheme: theme });
      await p.setViewportSize({
        width: theme === "light" ? 800 : 1320,
        height: 950,
      });
      fs.mkdirSync(path.join(__dirname, "../evidence"), { recursive: true });
      await p.screenshot({
        path: path.join(__dirname, `../evidence/card-link-${theme}.png`),
      });
    }
    for (const card of cards.slice(1)) {
      await open(cardLink(card.id));
      await expect(
        p.getByRole("heading", { name: card.title, exact: true }),
      ).toBeVisible();
      await expect(p.locator(".answer")).toHaveCount(0);
      await expect(p.locator(".ratings")).toHaveCount(0);
    }
    await open("recall://card/missing");
    await expect(p.getByRole("alert")).toContainText(
      "isn't in this Recall library",
    );
    await open("recall://card/valid?run=true");
    await expect(p.getByRole("alert")).toContainText("link is invalid");
    await open(cardLink(cards[0].id));
    await expect(
      p.getByRole("heading", { name: cards[0].title, exact: true }),
    ).toBeVisible();
    await p.getByRole("button", { name: "Self test", exact: true }).click();
    await p
      .getByRole("button", {
        name: `Open card: ${cards[0].title}`,
        exact: true,
      })
      .click();
    await expect(p.locator(".answer")).toHaveCount(0);
    await p
      .getByRole("button", { name: "Copy card link", exact: true })
      .click();
    assert.equal(
      await app.evaluate(({ clipboard }) => clipboard.readText()),
      cardLink(cards[0].id),
    );
    const after = await p.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.cards, before.cards);
    assert.deepEqual(after.session, before.session);
    assert.deepEqual(after.history, before.reviews);
    assert.equal(
      await p.evaluate(
        (id) => window.recall.draft("draft:" + id + ":numeric"),
        cards[1].id,
      ),
      before.draft,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS cold/warm links, encoded IDs, hidden concept/math/code, missing/invalid links, log navigation, copy link, paused session and schedules unchanged",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
