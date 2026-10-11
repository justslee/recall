// Capture the real UI with original demo content and disposable local profiles.
// Never opens the user's library, installs into their assistant home, pairs a
// device, requests microphone access, runs card code or contacts an AI provider.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { saveConfig } = require("../electron/config.cjs");
const selfTest = require("../electron/self-test.cjs");

const repo = path.resolve(__dirname, ".."),
  output = path.join(repo, "docs/images"),
  root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-guide-")),
  folder = path.join(root, "profile"),
  home = path.join(root, "assistant-home"),
  cards = require("../examples/demo.json").cards,
  errors = [];
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(output, { recursive: true });
saveConfig(folder, { captureEnabled: false, timeZone: "UTC" });
const env = {
  ...process.env,
  HOME: home,
  CODEX_HOME: path.join(home, ".codex"),
  RECALL_DATA_DIR: folder,
  OPENAI_API_KEY: "",
};
let app, page;

async function launch() {
  app = await electron.launch({ args: [repo], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".index-brand").waitFor();
}
async function shot(name, target = page) {
  await page.evaluate(() => document.fonts.ready);
  await target.screenshot({
    path: path.join(output, name + ".png"),
    animations: "disabled",
    // Transient toast messages add no setup guidance.
    style: ".toast{visibility:hidden!important}",
  });
  console.log("Captured " + name);
}
async function nav(name) {
  await page.getByRole("button", { name, exact: true }).click();
}
async function settings(name) {
  await nav("Settings & backups");
  await nav(name);
}
async function study(format) {
  await nav("Study desk");
  await page.locator(".formats button").filter({ hasText: format }).click();
  await nav("Start review");
}

(async () => {
  try {
    await launch();
    await expect(
      page.getByRole("button", { name: "Try demo", exact: true }),
    ).toBeVisible();
    await shot("setup-welcome");
    await nav("Try demo");
    await shot("setup-study-desk");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot("study-desk-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await shot("study-desk-light");
    const samplePage = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = 1180;
        const pen = canvas.getContext("2d");
        pen.fillStyle = "#fff";
        pen.fillRect(0, 0, canvas.width, canvas.height);
        pen.fillStyle = "#667469";
        pen.font = "20px sans-serif";
        pen.fillText("DOCUMENTATION EXAMPLE · SAMPLE PAGE", 60, 70);
        pen.fillStyle = "#355242";
        pen.font = "34px Georgia";
        pen.fillText("Weighted mean — my working", 60, 135);
        pen.strokeStyle = "#e2e7df";
        for (let y = 200; y < canvas.height; y += 65) {
          pen.beginPath();
          pen.moveTo(50, y);
          pen.lineTo(910, y);
          pen.stroke();
        }
        pen.fillStyle = "#315b8b";
        pen.font = "30px Georgia";
        [
          "Scores: 50 and 90",
          "Weights: 3 and 1",
          "Weighted sum = 50 × 3 + 90 × 1",
          "                         = 240",
          "Total weight = 3 + 1 = 4",
          "Weighted mean = 240 ÷ 4 = 60",
        ].forEach((line, index) => pen.fillText(line, 70, 255 + index * 90));
        return canvas.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    );
    await app.close();
    app = null;

    // Illustrative learning/review history belongs only to this demo profile.
    const store = new Store(folder);
    const date = new Date();
    for (let index = 0; index < 15; index++) {
      store.db
        .prepare(
          "INSERT INTO reviews(card_id,at,rating,practice,before_schedule,after_schedule,undone) VALUES(?,?,?,0,'{}','{}',0)",
        )
        .run(
          cards[index % cards.length].id,
          new Date(
            date.getTime() - Math.floor(index / 3) * 86400000,
          ).toISOString(),
          ["Good", "Hard", "Easy"][index % 3],
        );
    }
    selfTest.capture(folder, {
      id: "guide/weighted-mean/1",
      sessionId: "guide-demo",
      title: "Weighted means",
      objective: "Explain, calculate and implement a weighted mean",
      context: "Illustrative learning session using the original demo cards",
      at: date.toISOString(),
      evidence: "discussed",
      source: "Documentation demo",
      cardIds: cards.map((card) => card.id),
    });
    const paper = new (require("../electron/paper-store.cjs").PaperStore)(
      store,
    );
    const hash = require("../shared/handwriting-contract.cjs").digest(
      samplePage,
    );
    const manifest = {
      version: 1,
      id: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      revision: 1,
      mode: "tutor",
      target: "clipboard",
      questionId: null,
      handoffId: crypto.randomUUID(),
      createdAt: date.toISOString(),
      pages: [
        {
          index: 0,
          hash,
          mime: "image/png",
          name: "Demo working.png",
          width: 960,
          height: 1180,
        },
      ],
      drawing: null,
      evaluate: false,
    };
    paper.prepare("documentation-demo", manifest);
    paper.stage("documentation-demo", manifest.id, hash, samplePage);
    paper.commit("documentation-demo", manifest.id);
    store.close();
    require("../electron/connections.cjs").connect(folder, "codex", {
      apply: true,
      home,
    });
    await launch();

    await study("Concepts");
    await expect(
      page.getByRole("button", { name: "Reveal answer", exact: true }),
    ).toBeVisible();
    await shot("demo-concept-front");
    await nav("Reveal answer");
    await nav("Load interactive");
    await expect(page.frameLocator("iframe").locator("#mean")).toHaveText(
      "60.0",
    );
    await shot("demo-concept-back", page.locator(".review-card"));
    await page.getByRole("button", { name: /^Good/ }).click();

    await study("Math");
    await expect(
      page.getByRole("button", { name: "Reveal worked solution", exact: true }),
    ).toBeVisible();
    await shot("demo-math");
    await nav("Reveal worked solution");
    await shot("demo-math-solution", page.locator(".review-card"));
    await page.getByRole("button", { name: /^Good/ }).click();

    await study("Coding");
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    await shot("demo-coding");
    await nav("Pause session");
    await nav("Self test");
    await expect(page.getByLabel("Learning day")).toBeVisible();
    await shot("demo-self-test");
    await nav("Progress");
    await expect(page.locator(".progress-stat").first()).toBeVisible();
    await shot("demo-progress");
    await nav("Review history");
    await expect(page.locator(".ledger-entry").first()).toBeVisible();
    await shot("demo-review-history");
    await nav("Library");
    await shot("demo-library");

    await settings("Learning connections");
    await expect(
      page.getByRole("button", {
        name: "Create my first knowledge base",
        exact: true,
      }),
    ).toBeVisible();
    await shot("setup-learning-connections");
    await shot("setup-assistant-readiness", page.locator(".connection-hosts"));
    await nav("Create my first knowledge base");
    const wizard = page.locator(".knowledge-bootstrap");
    await wizard.getByRole("button", { name: /^Obsidian/ }).click();
    await wizard.getByRole("button", { name: /^Notion/ }).click();
    await shot("setup-knowledge-base", wizard);
    await page
      .getByRole("button", {
        name: "Close knowledge base creation",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Add knowledge source", exact: true })
      .click();
    const source = page.locator(".knowledge-wizard");
    await source.getByRole("button", { name: /^Markdown/ }).click();
    await source.getByRole("button", { name: /Continue/ }).click();
    const notes = path.join(root, "demo-notes");
    fs.mkdirSync(notes);
    fs.writeFileSync(
      path.join(notes, "weighted-mean.md"),
      "# Weighted mean\nDivide the weighted sum by the total weight.\n",
    );
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, notes);
    await source
      .getByRole("button", { name: "Choose folder", exact: true })
      .click();
    await source.getByRole("button", { name: /Continue/ }).click();
    await source
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      source.getByText("Local connection checked", { exact: true }),
    ).toBeVisible();
    await shot("setup-knowledge-scope", source);
    await page
      .getByRole("button", { name: "Cancel knowledge setup", exact: true })
      .click();
    await nav("Voice & feedback");
    await shot("setup-voice-settings");
    await nav("iPad & handwriting");
    await expect(
      page.getByRole("checkbox", { name: "Enable companion", exact: true }),
    ).not.toBeChecked();
    await shot("setup-ipad-settings");
    await shot(
      "setup-paper-connection",
      page
        .locator(".handwriting-setting-row")
        .filter({ hasText: "Learn on paper with your tutor" }),
    );

    await nav("Speak");
    await nav("Your own topic");
    await page
      .getByLabel("Topic or presentation title")
      .fill("Why weighted means matter");
    await page
      .getByLabel("What should your listener understand?")
      .fill(
        "Explain why a final exam can have more influence than a quiz, using a simple example.",
      );
    await shot("demo-speak");
    await page.evaluate(() => window.recall.tutorOpen());
    let tutor;
    await expect
      .poll(async () => {
        tutor = (await app.windows()).find((window) =>
          window.url().endsWith("#tutor-pad"),
        );
        return !!tutor;
      })
      .toBe(true);
    await tutor.setViewportSize({ width: 1120, height: 820 });
    await tutor.emulateMedia({ colorScheme: "light" });
    await expect(
      tutor.getByRole("heading", {
        name: "Think on paper. Keep the conversation.",
      }),
    ).toBeVisible();
    await expect(
      tutor.getByRole("button", { name: "Copy page", exact: true }),
    ).toBeVisible();
    await shot("setup-tutor-pad", tutor.locator(".tutor-pad-settings"));
    assert.deepEqual(errors, []);
    console.log(
      "Documentation screenshots use only disposable demo data. No provider calls, device pairing or personal assistant installation.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
