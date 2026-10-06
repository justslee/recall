const { _electron: electron, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs"),
  { saveConfig } = require("../electron/config.cjs"),
  connections = require("../electron/connections.cjs"),
  inbox = require("../electron/inbox.cjs");
(async () => {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-connections-ui-"),
  );
  saveConfig(folder, { captureEnabled: true, timeZone: "America/New_York" });
  const assistantHome = path.join(folder, "synthetic-assistant-home");
  connections.connect(folder, "claude", { home: assistantHome, apply: true });
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
    // Exercise native-copy IPC without replacing the person's clipboard.
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = (text) => {
        globalThis.__recallCopiedPrompt = text;
      };
    });
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
    const claude = p.getByRole("article", { name: "Claude connection" });
    await expect(
      claude.getByText("Skills installed", { exact: true }),
    ).toBeVisible();
    await expect(claude.getByText("Not tested", { exact: true })).toBeVisible();
    await expect(
      claude.getByText("Learning verified", { exact: true }),
    ).toHaveCount(0);
    await claude
      .getByRole("button", { name: "Verify learning", exact: true })
      .click();
    await p.getByLabel("A concept to learn").fill("Explain a weighted average");
    await p
      .getByRole("button", { name: "Create verification prompt", exact: true })
      .click();
    await p.getByRole("button", { name: "Copy prompt", exact: true }).click();
    const challenge = JSON.parse(
      fs.readFileSync(path.join(folder, "connections/readiness.json"), "utf8"),
    ).hosts.claude.challenge;
    assert(
      await app.evaluate(
        (_, id) => globalThis.__recallCopiedPrompt.includes(id),
        challenge.id,
      ),
    );
    assert.equal(inbox.read(folder).items.length, 1);
    await p.getByRole("button", { name: "Done", exact: true }).click();
    inbox.add(
      folder,
      {
        id: challenge.id,
        sessionId: challenge.id,
        source: "Recall connection verification: claude",
        title: "Weighted mean",
        objective: "Explain a weighted average",
        context: "The synthetic user asked and received a concrete example",
        at: new Date().toISOString(),
        evidence: "discussed",
        cardIds: [card.id],
      },
      before.cards,
    );
    await expect(
      claude.getByText("Learning verified", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      claude.getByRole("link", { name: card.title }),
    ).toHaveAttribute("href", /^recall:\/\/card\//);
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
    assert.equal(
      inbox.read(folder).items.find((item) => item.id === "ui-gap").status,
      "pending",
    );
    inbox.update(folder, "ui-gap", {
      status: "blocked",
      error: "A visual needs independent validation",
    });
    await expect(
      p.getByText("A visual needs independent validation", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await p.getByLabel("Inbox assistant").selectOption("claude");
    await expect.poll(() => connections.settings(folder).agent).toBe("claude");
    await p
      .getByRole("button", { name: "Finish with assistant", exact: true })
      .click();
    await p
      .getByText("Review the prompt and selected context", { exact: true })
      .click();
    await expect(p.getByLabel("Assistant handoff prompt")).toHaveValue(
      /ui-gap/,
    );
    await expect(p.getByLabel("Assistant handoff prompt")).toHaveValue(
      /untrusted DATA/,
    );
    await p.getByRole("button", { name: "Copy prompt", exact: true }).click();
    assert(
      await app.evaluate(() =>
        globalThis.__recallCopiedPrompt.includes(
          "inbox submit 'ui-gap' RESULT_FILE",
        ),
      ),
    );
    assert.equal(
      inbox.read(folder).items.find((item) => item.id === "ui-gap").status,
      "blocked",
    );
    await p.getByRole("button", { name: "Done", exact: true }).click();
    await p.getByRole("button", { name: "Retry", exact: true }).click();
    assert.equal(
      inbox.read(folder).items.find((item) => item.id === "ui-gap").status,
      "pending",
    );
    await p
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await expect(
      p.getByRole("button", { name: "Install connection" }),
    ).toBeVisible();
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await p.getByText("Optional catch-up", { exact: false }).click();
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
      p.getByText("2 ready · 0 checked with no new learning"),
    ).toBeVisible();
    await p.getByText("Optional catch-up", { exact: false }).click();
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
    await p.screenshot({
      path: path.join(__dirname, "../evidence/connections-narrow.png"),
      fullPage: true,
      animations: "disabled",
    });
    await claude.getByRole("link", { name: card.title }).click();
    await expect(
      p.getByRole("heading", { name: card.title, exact: true }),
    ).toBeVisible();
    await expect(p.locator(".answer")).toHaveCount(0);
    const after = await p.evaluate(() => window.recall.snapshot());
    assert.deepEqual(after.cards, before.cards);
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.session, before.session);
    assert.deepEqual(errors, []);
    console.log(
      "PASS independent installation/receipt status, fresh-session verification, exact blocked-item handoff/native-copy, retry, previews, opt-in scope, open-app import, themes, narrow layout and unchanged cards/history/session",
    );
  } finally {
    await app?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
