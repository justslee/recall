const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs");
const st = require("../electron/self-test.cjs");
(async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-repeat-day-"));
  const past = new Date(Date.now() - 86400000),
    day = st.dayOf(past);
  const s = new Store(folder);
  s.import(
    ["a", "b"].map((id) => ({
      id,
      conceptId: id,
      title: "Recall example " + id,
      kind: "concept",
      prompt: "Explain the example.",
      answer: "<p>A focused explanation.</p>",
      topic: "Example",
      decks: ["Example"],
      status: "ready",
      tags: [],
      difficulty: "Foundation",
    })),
  );
  require("../electron/config.cjs").saveConfig(folder, {
    timeZone: "America/New_York",
    captureEnabled: true,
  });
  st.capture(folder, {
    id: "prior-day",
    sessionId: "example",
    title: "Prior learning",
    objective: "Explain both examples",
    context: "Original test fixture",
    at: past.toISOString(),
    evidence: "discussed",
    cardIds: ["a", "b"],
  });
  const initial = st.start(s, { day }, past);
  for (const id of initial.ids) {
    s.set("session", { ...s.get("session"), revealed: true });
    s.rate(
      { id, rating: id === "a" ? "Again" : "Good", sessionId: initial.id },
      past,
    );
  }
  const before = s.cards();
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
    await p.getByRole("button", { name: "Self test", exact: true }).click();
    await expect(p.getByLabel("Learning day")).toHaveValue(day);
    await p.getByLabel("Learning day").selectOption(st.dayOf(new Date()));
    await expect(
      p.getByRole("button", { name: /Review all cards/ }),
    ).toHaveCount(0);
    await p.getByLabel("Learning day").selectOption(day);
    await expect(
      p.getByRole("heading", { name: "Attempted. Still worth practicing." }),
    ).toBeVisible();
    await expect(
      p.getByRole("button", { name: "Review needs practice (1)", exact: true }),
    ).toBeVisible();
    for (const theme of ["dark", "light"]) {
      await p.emulateMedia({ colorScheme: theme });
      await p.setViewportSize({
        width: theme === "dark" ? 1200 : 800,
        height: 1000,
      });
      fs.mkdirSync(path.join(__dirname, "../evidence"), { recursive: true });
      await p
        .locator(".self-test-hero")
        .screenshot({
          path: path.join(__dirname, "../evidence/revisit-" + theme + ".png"),
        });
    }
    await p
      .getByRole("button", { name: "Review needs practice (1)", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Reveal answer", exact: true }),
    ).toBeVisible();
    const started = await p.evaluate(() => window.recall.snapshot());
    assert.deepEqual(started.session.ids, ["a"]);
    assert.deepEqual(
      started.cards.map((c) => c.schedule),
      before.map((c) => c.schedule),
    );
    await p.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await p.getByRole("button", { name: /^Again/ }).click();
    await expect(
      p.getByRole("heading", { name: "This pass is finished." }),
    ).toBeVisible();
    await expect(p.getByText(/1 card still needs practice/)).toBeVisible();
    await p
      .getByRole("button", { name: "Back to this learning day", exact: true })
      .click();
    await expect(p.getByLabel("Learning day")).toHaveValue(day);
    await p
      .getByRole("button", { name: "Review all cards (2)", exact: true })
      .click();
    assert.deepEqual(
      new Set((await p.evaluate(() => window.recall.snapshot())).session.ids),
      new Set(["a", "b"]),
    );
    await p.getByRole("button", { name: "Pause session", exact: true }).click();
    await p.getByRole("button", { name: "Self test", exact: true }).click();
    await p
      .getByRole("button", { name: "Review needs practice (1)", exact: true })
      .click();
    await expect(p.getByRole("alert")).toContainText(
      "Your completed reviews stay saved.",
    );
    await p
      .getByRole("button", { name: "Keep current session", exact: true })
      .click();
    assert.equal(
      (await p.evaluate(() => window.recall.snapshot())).session.ids.length,
      2,
    );
    await p
      .getByRole("button", { name: "Review needs practice (1)", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Replace queue and start", exact: true })
      .click();
    assert.deepEqual(
      (await p.evaluate(() => window.recall.snapshot())).session.ids,
      ["a"],
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS previous-day selection, repeat weak/all cards, hidden answers, completion return, queue guard, both themes",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
