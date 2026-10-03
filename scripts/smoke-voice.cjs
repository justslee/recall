// Synthetic microphone + stubbed OpenAI transport. No real speech, key or
// learner data is sent. This is desktop integration QA, not a live API test.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { cardLink } = require("../electron/card-links.cjs");
const repo = path.resolve(__dirname, "..");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-voice-desktop-"));
const cards = require("../examples/demo.json").cards;
const s = new Store(folder);
s.import(cards);
const beforeCards = s.db.prepare("SELECT * FROM cards ORDER BY id").all();
const fixtureSession = {
  id: "voice-settings-roundtrip",
  ids: [cards[0].id],
  index: 0,
  selection: { practice: false, deck: "all", topics: [], format: "all" },
  revealed: false,
  rated: 0,
  skipped: 0,
  startedAt: new Date().toISOString(),
};
s.set("session", fixtureSession);
s.close();
// An old saved key must never be decrypted merely by opening the app/settings.
const legacyKeyFile = path.join(folder, "credentials", "openai.enc");
require("../electron/private-files.cjs").atomicText(
  legacyKeyFile,
  "synthetic-legacy-ciphertext",
);
const evidence = path.join(repo, "evidence");
fs.mkdirSync(evidence, { recursive: true });
(async () => {
  const launchOptions = {
    ...(process.env.RECALL_TEST_EXECUTABLE
      ? {
          executablePath: process.env.RECALL_TEST_EXECUTABLE,
          args: ["--use-fake-device-for-media-stream"],
        }
      : { args: [repo, "--use-fake-device-for-media-stream"] }),
    env: {
      ...process.env,
      RECALL_DATA_DIR: folder,
      OPENAI_API_KEY: "",
    },
  };
  const app = await electron.launch(launchOptions);
  try {
    const p = await app.firstWindow();
    p.setDefaultTimeout(12000);
    await app.evaluate(async ({ app, safeStorage }, repo) => {
      for (const method of [
        "isEncryptionAvailable",
        "encryptString",
        "decryptString",
      ])
        safeStorage[method] = () => {
          throw Error("Unexpected Keychain access");
        };
      // Fake microphone via Chromium still exercises getUserMedia, permissions,
      // AudioContext, AudioWorklet, PCM IPC and start/stop resource ownership.
      app.commandLine.appendSwitch("use-fake-device-for-media-stream");
      const req = process
        .getBuiltinModule("node:module")
        .createRequire(app.getAppPath() + "/package.json");
      const { VoiceService } = req("./electron/voice.cjs");
      const { EventEmitter } = req("node:events");
      const originalPrepare = VoiceService.prototype.prepare;
      const originalEvaluate = VoiceService.prototype.evaluate;
      globalThis.__voiceTest = { bytes: 0, closes: 0, requests: 0 };
      VoiceService.prototype.prepare = function (...args) {
        this.socketFactory = () => {
          const ws = new EventEmitter();
          ws.bufferedAmount = 0;
          const deliver = (event) =>
            ws.emit("message", Buffer.from(JSON.stringify(event)));
          ws.send = (value) => {
            const event = JSON.parse(value);
            if (event.type === "session.update")
              setTimeout(() => deliver({ type: "session.updated" }), 5);
            if (event.type === "input_audio_buffer.append") {
              globalThis.__voiceTest.bytes += Buffer.from(
                event.audio,
                "base64",
              ).length;
              if (!ws.onceText) {
                ws.onceText = true;
                deliver({
                  type: "conversation.item.input_audio_transcription.delta",
                  item_id: "one",
                  delta: "Weights give values different importance.",
                });
              }
            }
            if (event.type === "input_audio_buffer.commit")
              setTimeout(
                () =>
                  deliver({
                    type: "conversation.item.input_audio_transcription.completed",
                    item_id: "one",
                    transcript:
                      "Weights give values different importance. Divide the weighted sum by total weight.",
                  }),
                10,
              );
          };
          ws.terminate = () => {
            globalThis.__voiceTest.closes++;
            ws.emit("close");
          };
          setTimeout(() => ws.emit("open"), 5);
          return ws;
        };
        return originalPrepare.apply(this, args);
      };
      VoiceService.prototype.evaluate = function (...args) {
        this.fetchImpl = async (_url, options) => {
          globalThis.__voiceTest.requests++;
          const input = JSON.parse(JSON.parse(options.body).input);
          const feedback = {
            verdict: "solid",
            summary: input.priorAttempts.length
              ? "Your follow-up correctly explains that scaling all weights preserves their proportions."
              : "You explained both relative influence and normalization.",
            strengths: ["Relative importance", "Dividing by the total weight"],
            gaps: [],
            followUp: "What happens if every weight is doubled?",
          };
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                status: "completed",
                output: [
                  {
                    type: "message",
                    content: [
                      { type: "output_text", text: JSON.stringify(feedback) },
                    ],
                  },
                ],
              }),
          };
        };
        return originalEvaluate.apply(this, args);
      };
    }, repo);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    // Setup belongs only in Settings, and a detour cannot consume a review.
    await p
      .getByRole("button", { name: "Resume session", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Set up voice", exact: true }),
    ).toBeVisible();
    await expect(p.getByLabel("OpenAI API key", { exact: true })).toHaveCount(
      0,
    );
    await expect(p.locator(".answer")).toHaveCount(0);
    assert.ok(
      (await p.locator(".answer-strip-row").boundingBox()).height <= 60,
    );
    await expect(p.locator(".answer-strip-editor")).toHaveCount(0);
    // Typing and local drafts remain available without an API key.
    await p.getByRole("button", { name: "Type answer", exact: true }).click();
    await p
      .getByRole("textbox", { name: "Your spoken answer" })
      .fill("My local draft");
    await p
      .getByRole("button", { name: "Collapse response", exact: true })
      .click();
    await p.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await expect(p.locator(".card-front")).toBeHidden();
    await p.getByRole("button", { name: "Hide answer", exact: true }).click();
    await p.getByRole("button", { name: /Your answer.*draft/ }).click();
    await expect(
      p.getByRole("textbox", { name: "Your spoken answer" }),
    ).toHaveValue("My local draft");
    await p.getByRole("button", { name: "New attempt", exact: true }).click();
    await p
      .getByRole("button", { name: "Collapse response", exact: true })
      .click();
    await p.getByRole("button", { name: "Set up voice", exact: true }).click();
    await expect(
      p.getByRole("region", { name: "Voice & feedback", exact: true }),
    ).toBeFocused();
    await expect(
      p.getByText("Re-enter key once · local storage update", { exact: true }),
    ).toBeVisible();
    assert.equal(
      fs.readFileSync(legacyKeyFile, "utf8"),
      "synthetic-legacy-ciphertext",
    );
    await p
      .getByLabel("OpenAI API key", { exact: true })
      .fill("sk-synthetic-test-only");
    await p.getByRole("button", { name: "Save key", exact: true }).click();
    await expect(
      p.getByText("Key saved on this Mac", { exact: true }),
    ).toBeVisible();
    await expect(p.getByLabel("OpenAI API key", { exact: true })).toHaveCount(
      0,
    );
    const keyFile = path.join(folder, "credentials", "openai.key");
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(keyFile)).mode & 0o777, 0o700);
    assert.equal(fs.existsSync(legacyKeyFile), false);
    const savedStatus = await p.evaluate(() => window.recall.voiceStatus());
    assert.equal(savedStatus.source, "saved");
    assert.doesNotMatch(JSON.stringify(savedStatus), /synthetic/);
    for (const theme of ["light", "dark"]) {
      await p.emulateMedia({ colorScheme: theme });
      await p.locator(".voice-settings").screenshot({
        path: path.join(evidence, `voice-settings-${theme}.png`),
        animations: "disabled",
      });
    }
    await p.setViewportSize({ width: 700, height: 900 });
    await p
      .locator(".voice-settings")
      .screenshot({ path: path.join(evidence, "voice-settings-narrow.png") });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await p.setViewportSize({ width: 1280, height: 900 });
    await p
      .getByRole("button", { name: "Back to your answer", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Speak answer", exact: true }),
    ).toBeVisible();
    assert.deepEqual(
      (await p.evaluate(() => window.recall.snapshot())).session,
      fixtureSession,
    );
    await expect(p.locator(".answer")).toHaveCount(0);
    // Also exercise the browsing-card return path before recording.
    await app.evaluate(
      ({ app }, link) => app.emit("open-url", { preventDefault() {} }, link),
      cardLink(cards[0].id),
    );
    await expect(
      p.getByRole("button", { name: "Speak answer", exact: true }),
    ).toBeVisible();
    await expect(p.locator(".answer")).toHaveCount(0);
    // Draft and card position survive a Settings detour, including key replacement.
    await p.getByRole("button", { name: "Speak answer", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Stop recording", exact: true }),
    ).toBeVisible();
    await expect(
      p.getByRole("textbox", { name: "Your spoken answer" }),
    ).toHaveValue(/Weights give/);
    await expect(
      p.getByRole("button", { name: "Reveal answer", exact: true }),
    ).toBeDisabled();
    await p.locator(".card-side-label").click();
    await p.keyboard.press("Space");
    await expect(p.locator(".answer")).toHaveCount(0);
    await p
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Evaluate answer", exact: true }),
    ).toBeEnabled();
    await expect(
      p.getByRole("textbox", { name: "Your spoken answer" }),
    ).toHaveValue(/total weight/);
    await p
      .getByRole("button", { name: "Evaluate answer", exact: true })
      .click();
    await expect(p.locator(".answer")).toBeVisible();
    await expect(p.locator(".card-front")).toBeHidden();
    await expect(p.locator(".answer-strip-editor")).toHaveCount(0);
    await expect(p.locator(".voice-feedback-summary")).toContainText(
      "Well explained",
    );
    await expect(p.locator(".voice-feedback-body")).toHaveCount(0);
    await p.locator(".voice-feedback-summary").click();
    for (const theme of ["light", "dark"]) {
      await p.emulateMedia({ colorScheme: theme });
      await p.waitForFunction(
        (theme) =>
          matchMedia("(prefers-color-scheme: dark)").matches ===
          (theme === "dark"),
        theme,
      );
      await p
        .locator(".voice-answer")
        .screenshot({ path: path.join(evidence, `voice-${theme}.png`) });
    }
    await p
      .getByRole("button", { name: "Try a follow-up", exact: true })
      .click();
    await expect(p.locator(".voice-followup")).toContainText(
      "every weight is doubled",
    );
    await p
      .getByRole("textbox", { name: "Your spoken answer" })
      .fill(
        "The mean is unchanged because numerator and denominator both double.",
      );
    await p
      .getByRole("button", { name: "Evaluate answer", exact: true })
      .click();
    await expect(p.locator(".answer-strip-editor")).toHaveCount(0);
    await p.locator(".voice-feedback-summary").click();
    await expect(p.locator(".voice-feedback")).toContainText(
      "scaling all weights",
    );
    await p
      .getByRole("button", { name: "About voice and feedback", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Voice settings", exact: true })
      .click();
    await p.getByRole("button", { name: "Replace key", exact: true }).click();
    await expect(p.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
      "",
    );
    await p
      .getByLabel("OpenAI API key", { exact: true })
      .fill("sk-replacement-test");
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(p.getByLabel("OpenAI API key", { exact: true })).toHaveCount(
      0,
    );
    await p
      .getByRole("button", { name: "Back to your answer", exact: true })
      .click();
    await expect(p.locator(".answer-strip-editor")).toHaveCount(0);
    await p
      .getByRole("button", { name: /Your answer.*feedback saved/ })
      .click();
    await expect(
      p.getByRole("textbox", { name: "Your spoken answer" }),
    ).toHaveValue(/numerator/);
    await p.locator(".voice-feedback-summary").click();
    await expect(p.locator(".voice-feedback")).toContainText(
      "scaling all weights",
    );
    await expect(p.locator(".answer")).toBeVisible();
    assert.deepEqual(
      (await p.evaluate(() => window.recall.snapshot())).session,
      fixtureSession,
    );
    // A reload must keep the typed answer and feedback; code cards have no mic.
    await p.reload();
    await app.evaluate(
      ({ app }, link) => app.emit("open-url", { preventDefault() {} }, link),
      cardLink(cards[0].id),
    );
    await expect(p.locator(".answer")).toHaveCount(0);
    await expect(p.locator(".answer-strip-editor")).toHaveCount(0);
    await p
      .getByRole("button", { name: /Your answer.*feedback saved/ })
      .click();
    await expect(
      p.getByRole("textbox", { name: "Your spoken answer" }),
    ).toHaveValue(/numerator/);
    await p
      .getByRole("button", { name: "Continue dictating", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Stop recording", exact: true }),
    ).toBeVisible();
    await app.evaluate(
      ({ app }, link) => app.emit("open-url", { preventDefault() {} }, link),
      cardLink(cards.find((c) => c.kind === "math").id),
    );
    await expect(p.locator(".voice-answer")).not.toHaveClass(/is-open/);
    await expect(p.locator(".answer")).toHaveCount(0);
    await p
      .getByRole("textbox", { name: "Numerical answer", exact: true })
      .fill("42");
    await p
      .getByRole("button", { name: "Reveal worked solution", exact: true })
      .click();
    await expect(p.locator(".card-front")).toBeHidden();
    await expect(p.locator(".answer")).toBeVisible();
    await p
      .getByRole("button", { name: "Hide worked solution", exact: true })
      .click();
    await expect(
      p.getByRole("textbox", { name: "Numerical answer", exact: true }),
    ).toHaveValue("42");
    await expect(p.locator(".answer")).toHaveCount(0);
    await app.evaluate(
      ({ app }, link) => app.emit("open-url", { preventDefault() {} }, link),
      cardLink(cards.find((c) => c.kind === "code").id),
    );
    await expect(p.locator(".voice-answer")).toHaveCount(0);
    const metrics = await app.evaluate(() => globalThis.__voiceTest);
    assert.ok(metrics.bytes > 0);
    assert.ok(metrics.closes >= 2);
    assert.equal(metrics.requests, 2);
    assert.deepEqual(errors, []);
    // Settings is also directly available without visiting a card.
    await p
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Voice & feedback", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Back to your answer", exact: true }),
    ).toHaveCount(0);
    await p.getByRole("button", { name: "Remove key", exact: true }).click();
    await expect(
      p.getByText("Not set up · optional", { exact: true }),
    ).toBeVisible();
    assert.equal(fs.existsSync(keyFile), false);
    await p
      .getByLabel("OpenAI API key", { exact: true })
      .fill("sk-synthetic-test-only");
    await p.getByRole("button", { name: "Save key", exact: true }).click();
    await expect(
      p.getByText("Key saved on this Mac", { exact: true }),
    ).toBeVisible();
    console.log(
      JSON.stringify({
        ok: true,
        synthetic: true,
        metrics,
        profile: folder,
        screenshots: ["voice-light.png", "voice-dark.png"],
      }),
    );
  } finally {
    await app.close();
  }
  // Real process restart with an isolated, synthetic saved key; no API request.
  const restarted = await electron.launch(launchOptions);
  try {
    const p = await restarted.firstWindow();
    await p
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Voice & feedback", exact: true })
      .click();
    await expect(
      p.getByText("Key saved on this Mac", { exact: true }),
    ).toBeVisible();
    await expect(p.getByLabel("OpenAI API key", { exact: true })).toHaveCount(
      0,
    );
    // Read only the synthetic fixture in the main process to prove restart usability.
    const fixtureUnlocks = await restarted.evaluate(({ app, safeStorage }) => {
      for (const method of [
        "isEncryptionAvailable",
        "encryptString",
        "decryptString",
      ])
        safeStorage[method] = () => {
          throw Error("Unexpected Keychain access");
        };
      const req = process
        .getBuiltinModule("node:module")
        .createRequire(app.getAppPath() + "/package.json");
      const { VoiceService } = req("./electron/voice.cjs");
      const service = new VoiceService({
        folder: app.getPath("userData"),
        env: {},
      });
      return service.key() === "sk-synthetic-test-only";
    });
    assert.equal(fixtureUnlocks, true);
  } finally {
    await restarted.close();
  }
  const after = new Store(folder);
  assert.deepEqual(
    after.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    beforeCards,
  );
  assert.deepEqual(after.get("session"), fixtureSession);
  assert.equal(
    after.db.prepare("SELECT COUNT(*) AS n FROM reviews").get().n,
    0,
  );
  after.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
