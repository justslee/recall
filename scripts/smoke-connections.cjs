const { _electron: electron, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs"),
  { saveConfig } = require("../electron/config.cjs"),
  inbox = require("../electron/inbox.cjs");
(async () => {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-connections-ui-"),
  );
  saveConfig(folder, { captureEnabled: true, timeZone: "America/New_York" });
  const s = new Store(folder);
  s.import(require("../examples/demo.json").cards);
  const before = JSON.parse(JSON.stringify(s.snapshot())),
    card = s.cards()[0];
  s.close();
  inbox.add(
    folder,
    {
      id: "ui-gap",
      sessionId: "ui",
      title: "A missing objective",
      objective: "A question",
      context: "User asked",
      at: new Date().toISOString(),
      evidence: "discussed",
      cardIds: [],
    },
    [],
  );
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
    await p
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Learning connections", exact: true })
      .click();
    await expect(
      p.getByText("Keep the learning. Keep your flow."),
    ).toBeVisible();
    await expect(p.getByText("A missing objective")).toBeVisible();
    await expect(
      p.getByRole("button", { name: "Prepare next", exact: true }),
    ).toBeEnabled();
    await p.getByRole("button", { name: "Prepare next", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Prepare this context", exact: true }),
    ).toBeVisible();
    await p
      .getByText("See the exact learning context", { exact: true })
      .click();
    await expect(p.locator(".connection-preview pre")).toContainText(
      '"objective": "A question"',
    );
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(inbox.read(folder).items[0].status, "pending");
    await p
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await expect(
      p.getByRole("button", { name: "Install connection" }),
    ).toBeVisible();
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await p.getByLabel("Catch up from local session records").check();
    await p.getByLabel("All local projects").check();
    await p.getByLabel("Catch-up start").fill("2026-09-27T04:00:00Z");
    await p.getByRole("button", { name: "Save connection settings" }).click();
    await expect(p.getByRole("button", { name: "Check now" })).toBeEnabled();
    inbox.submit(folder, "ui-gap", { captures: [{ cardIds: [card.id] }] });
    await expect(p.getByText("No pending learning.")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      p.getByText("1 ready · 0 checked with no new learning"),
    ).toBeVisible();
    for (const theme of ["dark", "light"]) {
      await p.emulateMedia({ colorScheme: theme });
      await p.setViewportSize({ width: 1320, height: 1000 });
      await p.screenshot({
        path: path.join(__dirname, `../evidence/connections-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await p.setViewportSize({ width: 780, height: 900 });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const after = await p.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.cards, before.cards);
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.session, before.session);
    assert.deepEqual(errors, []);
    console.log(
      "PASS connection preview, opt-in scope, open-app import, ready status, system themes, narrow layout, unchanged cards/history/session",
    );
  } finally {
    await app?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
