// Isolated-profile desktop QA with synthetic pages and mocked transport/feedback.
// No real iPad, chat composer, credentials, learner data or provider requests.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { cardLink } = require("../electron/card-links.cjs");
const repo = path.resolve(__dirname, "..");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-handwriting-ui-"));
const evidence = path.join(repo, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const cards = require("../examples/demo.json").cards;
const math = cards.find((card) => card.kind === "math");
const concept = cards.find((card) => card.kind === "concept");
const store = new Store(folder);
store.import(cards);
const session = {
  id: "handwriting-ui-session",
  ids: [math.id, concept.id],
  index: 0,
  selection: { practice: false, deck: "all", topics: [], format: "all" },
  revealed: false,
  rated: 0,
  skipped: 0,
  startedAt: new Date().toISOString(),
};
store.set("session", session);
const before = {
  cards: store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
  reviews: store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
};
store.close();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
  "base64",
);
(async () => {
  const app = await electron.launch({
    ...(process.env.RECALL_TEST_EXECUTABLE
      ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
      : { args: [repo] }),
    env: { ...process.env, RECALL_DATA_DIR: folder, OPENAI_API_KEY: "" },
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain, BrowserWindow }, png) => {
      const image = "data:image/png;base64," + png;
      const state = {
        status: {
          version: 1,
          enabled: false,
          endpoint: null,
          installationId: "synthetic-installation",
          model: "gpt-6-astra",
          assessmentConsent: false,
          loginAtStartup: false,
          devices: [],
          pendingPairings: [],
          assessmentBusy: false,
        },
        tutor: {
          enabled: false,
          manualReady: false,
          target: "clipboard",
          lastState: "idle",
        },
        attempts: [],
        calls: {
          assessments: 0,
          importedBytes: 0,
          follow: [],
          start: [],
          receiver: [],
        },
      };
      globalThis.__handwritingQA = state;
      const emit = (event) =>
        BrowserWindow.getAllWindows()[0].webContents.send(
          "recall:pad-event",
          event,
        );
      globalThis.__handwritingQAEmit = emit;
      const handles = {
        padStatus: () => state.status,
        padConfigure: (patch) => Object.assign(state.status, patch),
        padPairing: () => ({
          payload: { version: 1 },
          qrDataUrl: image,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
        padConfirmPairing: ({ id, allow }) => {
          const request = state.status.pendingPairings.find(
            (item) => item.id === id,
          );
          state.status.pendingPairings = [];
          if (allow)
            state.status.devices.push({
              id,
              name: request.name,
              connected: true,
              lastSeen: new Date().toISOString(),
            });
          emit({ type: "status", status: state.status });
        },
        padRevokeDevice: (id) => {
          state.status.devices = state.status.devices.filter(
            (item) => item.id !== id,
          );
        },
        padStartStudy: (value) => {
          state.calls.start.push(value);
          state.status.study = value;
        },
        padFollowStudy: (value) => {
          if (state.status.study) {
            state.calls.follow.push(value);
            state.status.study = value;
          }
        },
        paperAttempts: (id) =>
          state.attempts.filter((item) => id === null || item.cardId === id),
        paperPage: (_id, index) => ({
          url: image,
          name: "Synthetic reasoning " + (index + 1),
          index,
        }),
        paperImport: ({ cardId, pages }) => {
          state.calls.importedBytes += pages.reduce(
            (sum, item) => sum + item.bytes.byteLength,
            0,
          );
          const item = {
            id: "synthetic-attempt-" + state.attempts.length,
            documentId: "synthetic-document",
            cardId,
            mode: "study",
            status: "received",
            createdAt: new Date().toISOString(),
            pageCount: pages.length,
          };
          state.attempts.push(item);
          emit({ type: "attempt", attempt: item });
          return item;
        },
        paperAttach: () => null,
        paperEvaluate: ({ attemptId }) => {
          assertConsent();
          state.calls.assessments++;
          const item = state.attempts.find(
            (attempt) => attempt.id === attemptId,
          );
          item.status = "assessed";
          item.feedback = {
            verdict: "partial",
            summary: "Your method uses the correct weighted sum.",
            strengths: ["Weights were applied to the matching values."],
            findings: [
              {
                page: 1,
                category: "arithmetic",
                expression: "12 + 7 = 20",
                explanation: "Recheck this sum.",
              },
            ],
            firstMistake: {
              page: 1,
              expression: "12 + 7 = 20",
              explanation: "This addition is the first step to revisit.",
            },
            followUp: "What denominator belongs with these weights?",
          };
          emit({ type: "attempt", attempt: item });
          return item;
        },
        paperCancelAssessment: () => {},
        tutorStatus: () => state.tutor,
        tutorStart: () => {
          state.calls.receiver.push(true);
          state.tutor.manualReady = true;
          return state.tutor;
        },
        tutorCopyPage: () => {},
      };
      function assertConsent() {
        if (!state.status.assessmentConsent)
          throw new Error("Explicit consent required");
      }
      for (const [name, handler] of Object.entries(handles)) {
        ipcMain.removeHandler("recall:" + name);
        ipcMain.handle("recall:" + name, (_event, ...args) => handler(...args));
      }
    }, png.toString("base64"));
    await page.reload();
    assert(
      await page.evaluate(
        () => typeof window.recall.paperAttempts === "function",
      ),
      "Handwriting preload bridge must be included",
    );
    await page
      .getByRole("button", { name: "Resume session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Write on iPad", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".answer-strip-row")).toHaveCount(1);
    assert(
      await page
        .locator(".answer-strip")
        .evaluate((element) => element.getBoundingClientRect().height < 100),
      "Closed handwriting and voice tools must fit in one compact strip",
    );
    await page
      .getByRole("textbox", { name: "Numerical answer", exact: true })
      .fill("42");
    await page
      .getByRole("button", { name: "Type answer", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Your spoken answer", exact: true })
      .fill("Keep my unfinished explanation.");
    await page.evaluate(() => {
      window.__handwritingNumeric = document.querySelector(".math-work input");
      window.__handwritingProse = document.querySelector(
        ".voice-transcript-label textarea",
      );
    });
    await page
      .getByRole("button", { name: "Paper workspace", exact: true })
      .click();
    await page.locator(".handwriting-upload input").setInputFiles({
      name: "Synthetic attempt.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(
      page.getByRole("button", { name: "Evaluate my work", exact: true }),
    ).toBeVisible();
    assert.equal(
      await app.evaluate(() => globalThis.__handwritingQA.calls.assessments),
      0,
    );
    await page
      .getByRole("button", { name: "Evaluate my work", exact: true })
      .click();
    await expect(
      page.getByRole("region", {
        name: "Allow handwriting feedback",
        exact: true,
      }),
    ).toBeVisible();
    assert.equal(
      await app.evaluate(() => globalThis.__handwritingQA.calls.assessments),
      0,
    );
    await page.getByRole("button", { name: "Keep local", exact: true }).click();
    await page
      .getByRole("button", { name: "Evaluate my work", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Allow & evaluate", exact: true })
      .click();
    await expect(
      page.getByText("Your method uses the correct weighted sum.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".answer")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Numerical answer", exact: true }),
    ).toHaveValue("42");
    await expect(
      page.getByRole("textbox", { name: "Your spoken answer", exact: true }),
    ).toHaveValue("Keep my unfinished explanation.");
    assert(
      await page.evaluate(
        () =>
          window.__handwritingNumeric ===
            document.querySelector(".math-work input") &&
          window.__handwritingProse ===
            document.querySelector(".voice-transcript-label textarea"),
      ),
      "Incoming work must not remount Mac drafts",
    );
    await page
      .getByRole("button", { name: "Page 1", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("dialog", {
        name: "Handwritten page preview",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", {
        name: "Handwritten page preview",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator(".answer")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Write on iPad", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "iPad & handwriting", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Enable companion", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Pair an iPad", exact: true })
      .click();
    await expect(
      page.getByAltText("Recall Pad pairing QR code", { exact: true }),
    ).toBeVisible();
    await app.evaluate(() => {
      const state = globalThis.__handwritingQA;
      state.status.pendingPairings.push({
        id: "synthetic-ipad",
        name: "Test iPad",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });
      globalThis.__handwritingQAEmit({ type: "status", status: state.status });
    });
    await page
      .getByRole("button", { name: "Pair this iPad", exact: true })
      .click();
    await expect(
      page.getByText("iPad paired. This device will reconnect automatically.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("textbox", {
        name: "Handwriting assessment model",
        exact: true,
      })
      .fill("synthetic-handwriting-model");
    await page.getByRole("button", { name: "Save model", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Tutor Pad", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Codex", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Enable draft pasting")).toHaveCount(0);
    await app.evaluate(() => {
      globalThis.__handwritingQA.tutor.enabled = true;
      globalThis.__handwritingQAEmit({ type: "tutor" });
    });
    await page
      .getByRole("button", { name: "Start receiving pages", exact: true })
      .click();
    await expect(page.locator(".handwriting-tutor-status strong")).toHaveText(
      "Page receiver ready",
    );
    await expect(
      page.getByRole("button", { name: "Receiving pages", exact: true }),
    ).toBeDisabled();
    assert.equal(
      await app.evaluate(
        () => globalThis.__handwritingQA.calls.receiver.length,
      ),
      1,
    );
    await page.getByRole("button", { name: "Study desk", exact: true }).click();
    await page
      .getByRole("button", { name: "Resume session", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Write on iPad", exact: true })
      .click();
    assert.equal(
      await app.evaluate(
        () => globalThis.__handwritingQA.calls.start[0].cardId,
      ),
      math.id,
    );
    await app.evaluate(
      ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
      cardLink(concept.id),
    );
    await expect(
      page.getByRole("heading", { name: concept.title, exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        app.evaluate(
          () => globalThis.__handwritingQA.calls.follow.at(-1)?.cardId,
        ),
      )
      .toBe(concept.id);
    await expect(page.locator(".answer")).toHaveCount(0);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.waitForFunction(
      () => !matchMedia("(prefers-color-scheme: dark)").matches,
    );
    await page.screenshot({
      path: path.join(evidence, "handwriting-answer-light.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.waitForFunction(
      () => matchMedia("(prefers-color-scheme: dark)").matches,
    );
    await page.screenshot({
      path: path.join(evidence, "handwriting-answer-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await page
      .getByRole("button", { name: "iPad & handwriting", exact: true })
      .first()
      .click();
    await page.setViewportSize({ width: 820, height: 950 });
    await page.screenshot({
      path: path.join(evidence, "handwriting-settings-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page
      .getByRole("button", { name: "Remove device", exact: true })
      .click();
    assert.equal(
      await app.evaluate(
        () => globalThis.__handwritingQA.status.devices.length,
      ),
      0,
    );
    assert.deepEqual(errors, []);
    assert.equal(
      await app.evaluate(() => globalThis.__handwritingQA.calls.assessments),
      1,
    );
    assert.equal(
      await app.evaluate(() => globalThis.__handwritingQA.calls.importedBytes),
      png.length,
    );
  } finally {
    await app.close();
  }
  const after = new Store(folder);
  assert.deepEqual(
    after.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    before.cards,
  );
  assert.deepEqual(
    after.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
    before.reviews,
  );
  assert.deepEqual(after.get("session"), session);
  after.close();
  console.log(
    "Handwriting UI passed: compact shared strip, explicit consent, preserved drafts/hidden answers, pairing, device removal, study following and both appearances. Synthetic transport only; real-device and live-client verification remain separate.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
