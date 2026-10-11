// Real window/IPC checks against a disposable profile. No live tutor, clipboard,
// Accessibility change, network receiver or provider request is used.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { PaperStore } = require("../electron/paper-store.cjs");
const { digest } = require("../shared/handwriting-contract.cjs");
const repo = path.resolve(__dirname, ".."),
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-tutor-workspace-"));
const cards = require("../examples/demo.json").cards;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
  "base64",
);
const fixture = new Store(folder);
fixture.import(cards);
const paper = new PaperStore(fixture);
const study = paper.import(cards.find((c) => c.kind === "math").id, [
  { name: "Synthetic study.png", mime: "image/png", bytes: png },
]);
const manifest = {
  version: 1,
  id: crypto.randomUUID(),
  documentId: crypto.randomUUID(),
  revision: 1,
  mode: "tutor",
  target: "clipboard",
  questionId: null,
  handoffId: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  pages: [
    {
      index: 0,
      hash: digest(png),
      mime: "image/png",
      name: "Synthetic tutor.png",
      width: 1,
      height: 1,
    },
  ],
  drawing: null,
  evaluate: false,
};
paper.prepare("synthetic-ipad", manifest);
paper.stage("synthetic-ipad", manifest.id, digest(png), png);
paper.commit("synthetic-ipad", manifest.id);
// Tutor work must remain visible after many newer Study submissions, including
// in the real dedicated-window IPC path that enforces the tutor-only scope.
fixture.db
  .prepare("UPDATE paper_attempts SET received_at=? WHERE id=?")
  .run("2026-01-01T00:00:00.000Z", manifest.id);
for (let index = 0; index < 55; index++) {
  paper.import(cards.find((card) => card.kind === "math").id, [
    {
      name: `Synthetic newer study ${index + 1}.png`,
      mime: "image/png",
      bytes: png,
    },
  ]);
}
assert.equal(paper.attempts(null).length, 50);
assert.equal(
  paper.attempts(null).some((attempt) => attempt.id === manifest.id),
  false,
);
const before = {
  cards: fixture.db.prepare("SELECT * FROM cards ORDER BY id").all(),
  reviews: fixture.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
  attempts: fixture.db
    .prepare("SELECT * FROM paper_attempts ORDER BY id")
    .all(),
};
fixture.close();

(async () => {
  let app;
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [repo] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, OPENAI_API_KEY: "" },
    });
    const main = await app.firstWindow();
    await expect(main.locator(".index-brand")).toBeVisible();
    await app.evaluate(({ app }) => {
      const require = process.mainModule.require.bind(process.mainModule);
      const { PadService } = require(
        require("node:path").join(app.getAppPath(), "electron/pad-service.cjs"),
      );
      const status = PadService.prototype.tutorStatus;
      PadService.prototype.tutorStatus = function (...args) {
        globalThis.__tutorWorkspaceService = this;
        return status.apply(this, args);
      };
      globalThis.__restoreTutorWorkspaceCapture = () => {
        PadService.prototype.tutorStatus = status;
        delete globalThis.__tutorWorkspaceService;
      };
    });
    await main.evaluate(() => window.recall.tutorStatus());
    await main.evaluate(() => window.recall.tutorOpen());
    const tutor = await expect
      .poll(async () =>
        (await app.windows())
          .find((p) => p.url().endsWith("#tutor-pad"))
          ?.url(),
      )
      .toBe("recall://app/#tutor-pad")
      .then(async () =>
        (await app.windows()).find((p) => p.url().endsWith("#tutor-pad")),
      );
    await expect(
      tutor.getByRole("heading", {
        name: "Think on paper. Keep the conversation.",
      }),
    ).toBeVisible();
    await expect(tutor.locator(".index-nav")).toHaveCount(0);
    await expect(
      tutor.getByRole("button", { name: "Evaluate my work" }),
    ).toHaveCount(0);
    await expect(
      tutor.getByRole("heading", { name: "Your page tray" }),
    ).toBeVisible();
    await expect(
      tutor
        .locator(".handwriting-attempt strong")
        .filter({ hasText: "Tutor sheet" }),
    ).toHaveCount(1);
    const check = await tutor.evaluate(
      async ({ studyId, tutorId }) => {
        const outcome = async (action) => {
          try {
            await action();
            return "allowed";
          } catch (e) {
            return e.message;
          }
        };
        return {
          attempts: await window.recall.paperAttempts(null),
          page: await window.recall.paperPage(tutorId, 0),
          snapshot: await outcome(() => window.recall.snapshot()),
          evaluation: await outcome(() =>
            window.recall.paperEvaluate({ attemptId: studyId }),
          ),
          studyPage: await outcome(() => window.recall.paperPage(studyId, 0)),
          studyCopy: await outcome(() =>
            window.recall.tutorCopyPage({ attemptId: studyId, index: 0 }),
          ),
        };
      },
      { studyId: study.id, tutorId: manifest.id },
    );
    assert.deepEqual(
      check.attempts.map((a) => a.id),
      [manifest.id],
    );
    assert.ok(check.page.url.startsWith("data:image/png;"));
    assert.match(check.snapshot, /Untrusted request/);
    assert.match(check.evaluation, /Untrusted request/);
    assert.match(check.studyPage, /Choose a Tutor Pad sheet/);
    assert.match(check.studyCopy, /Choose a Tutor Pad sheet/);
    await tutor.evaluate(() => {
      window.__tutorEvents = [];
      window.recall.onPadEvent((e) => window.__tutorEvents.push(e));
    });
    await app.evaluate(() => {
      globalThis.__tutorWorkspaceService.emit({
        type: "session",
        channel: "study",
        session: {
          questions: [{ prompt: "synthetic-study-content-must-stay-out" }],
        },
      });
      globalThis.__tutorWorkspaceService.emit({
        type: "status",
        status: { privateSentinel: "synthetic-status-payload-must-stay-out" },
      });
      globalThis.__tutorWorkspaceService.emit({
        type: "tutor",
        state: "manual",
      });
    });
    await expect
      .poll(() => tutor.evaluate(() => window.__tutorEvents.length))
      .toBeGreaterThan(0);
    const events = await tutor.evaluate(() => window.__tutorEvents);
    assert.doesNotMatch(
      JSON.stringify(events),
      /synthetic-study-content-must-stay-out|synthetic-status-payload-must-stay-out/,
    );

    // Real UI/preload/IPC, with a synthetic transport and explicit copy callback.
    // Stale automatic-paste settings must not invoke any removed helper action.
    await app.evaluate(() => {
      const service = globalThis.__tutorWorkspaceService,
        bridge = service.bridge,
        saved = {
          helper: service.helper,
          server: bridge.server,
          startTutor: bridge.startTutor,
          tutorSession: bridge.tutorSession,
          copyImage: service.copyImage,
          pasteEnabled: service.store.get("pad:pasteEnabled", false),
        };
      const fixture = { forbiddenCalls: 0, copyCalls: 0 };
      globalThis.__tutorReceiverFixture = fixture;
      const forbidden = async () => {
        fixture.forbiddenCalls++;
        throw Error("External app control is forbidden");
      };
      service.helper = {
        status: async () => ({ available: true, advertising: false }),
        arm: forbidden,
        paste: forbidden,
        requestAccessibility: forbidden,
      };
      service.copyImage = () => {
        fixture.copyCalls++;
      };
      bridge.server = {};
      bridge.startTutor = async () => {
        bridge.tutorSession = {
          mode: "tutor",
          target: "clipboard",
          handoffId: process.mainModule.require("node:crypto").randomUUID(),
          questions: [],
        };
        return bridge.tutorSession;
      };
      service.store.set("pad:pasteEnabled", true);
      service.emit({ type: "tutor" });
      globalThis.__restoreTutorReceiverFixture = () => {
        service.helper = saved.helper;
        service.copyImage = saved.copyImage;
        bridge.server = saved.server;
        bridge.startTutor = saved.startTutor;
        bridge.tutorSession = saved.tutorSession;
        service.store.set("pad:pasteEnabled", saved.pasteEnabled);
        delete globalThis.__tutorReceiverFixture;
      };
    });
    await expect(
      tutor.getByRole("button", { name: "Codex", exact: true }),
    ).toHaveCount(0);
    await expect(
      tutor.getByRole("button", { name: "ChatGPT", exact: true }),
    ).toHaveCount(0);
    await expect(tutor.getByLabel("Enable draft pasting")).toHaveCount(0);
    await expect(
      tutor.getByRole("button", { name: /Arm tutor|Resume handoff/ }),
    ).toHaveCount(0);
    assert.deepEqual(
      await tutor.evaluate(() =>
        ["tutorArm", "tutorConfigure", "tutorResume"].map(
          (name) => typeof window.recall[name],
        ),
      ),
      ["undefined", "undefined", "undefined"],
    );
    await tutor
      .getByRole("button", { name: "Start receiving pages", exact: true })
      .click();
    await expect(tutor.locator(".handwriting-tutor-status strong")).toHaveText(
      "Page receiver ready",
    );
    await expect(
      tutor.getByRole("button", { name: "Receiving pages", exact: true }),
    ).toBeDisabled();
    assert.equal(
      await app.evaluate(() => globalThis.__tutorReceiverFixture.copyCalls),
      0,
    );
    await tutor.getByRole("button", { name: "Copy page", exact: true }).click();
    await expect(tutor.locator(".handwriting-notice")).toContainText(
      "Paste it into any chat or app.",
    );
    assert.equal(
      await app.evaluate(() => globalThis.__tutorReceiverFixture.copyCalls),
      1,
    );
    assert.equal(
      await app.evaluate(
        () => globalThis.__tutorReceiverFixture.forbiddenCalls,
      ),
      0,
    );
    await app.evaluate(() => globalThis.__restoreTutorReceiverFixture());
    await tutor.close();
    await main.evaluate(() => window.recall.tutorOpen());
    await expect
      .poll(
        async () =>
          (await app.windows()).filter((p) => p.url().endsWith("#tutor-pad"))
            .length,
      )
      .toBe(1);
    await app.evaluate(() => globalThis.__restoreTutorWorkspaceCapture());
    await app.close();
    app = null;
    const after = new Store(folder);
    try {
      assert.deepEqual(
        after.db.prepare("SELECT * FROM cards ORDER BY id").all(),
        before.cards,
      );
      assert.deepEqual(
        after.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
        before.reviews,
      );
      assert.deepEqual(
        after.db.prepare("SELECT * FROM paper_attempts ORDER BY id").all(),
        before.attempts,
      );
    } finally {
      after.close();
    }
    console.log(
      "Tutor workspace passed: isolated window, tutor-only pages retained after 55 newer Study submissions, generic receiving readiness, removed client selectors and app-control IPC, explicit-only copy, study/evaluation denied, reopen and stored-data preservation.",
    );
  } finally {
    if (app) {
      await app
        .evaluate(() => {
          globalThis.__restoreTutorReceiverFixture?.();
          globalThis.__restoreTutorWorkspaceCapture?.();
        })
        .catch(() => {});
      await app.close();
    }
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
