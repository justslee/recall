// Real renderer IPC, native image decoding, storage and application lifecycle.
// Only Bonjour advertising is replaced inside this disposable test process.
// No iPad, Accessibility, chat composer, API key or provider request is used.
const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs"),
  { cardLink } = require("../electron/card-links.cjs");
const repo = path.resolve(__dirname, ".."),
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-pad-lifecycle-")),
  shutdownFile = path.join(folder, "synthetic-shutdown.json"),
  cards = require("../examples/demo.json").cards,
  math = cards.find((card) => card.kind === "math"),
  concept = cards.find((card) => card.kind === "concept");
const fixture = new Store(folder);
fixture.import(cards);
fixture.set("session", {
  id: "pad-lifecycle",
  ids: [math.id, concept.id],
  index: 0,
  revealed: false,
  rated: 0,
  skipped: 0,
  selection: { practice: false, deck: "all", topics: [], format: "all" },
});
const before = {
  cards: fixture.db.prepare("SELECT * FROM cards ORDER BY id").all(),
  reviews: fixture.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
  session: fixture.get("session"),
};
fixture.close();

(async () => {
  let application, child;
  try {
    application = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? {
            executablePath: path.resolve(process.env.RECALL_TEST_EXECUTABLE),
            args: [cardLink(math.id)],
          }
        : { args: [repo, cardLink(math.id)] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, OPENAI_API_KEY: "" },
      timeout: 30000,
    });
    child = application.process();
    let page = await application.firstWindow();
    page.setDefaultTimeout(15000);
    await expect(
      page.getByRole("heading", { name: math.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".answer")).toHaveCount(0);
    // This changes no production API or executable. The real receiver starts,
    // while its native discovery helper is inert and listens only on loopback.
    const png = await application.evaluate(
      ({ app, nativeImage }, { folder, shutdownFile }) => {
        const require = process.mainModule.require.bind(process.mainModule),
          path = require("node:path"),
          fs = require("node:fs"),
          { PadBridge } = require(
            path.join(app.getAppPath(), "electron/pad-bridge.cjs"),
          ),
          { Store } = require(
            path.join(app.getAppPath(), "electron/store.cjs"),
          );
        const state = {
          quitEvents: 0,
          closes: 0,
          bridgeStopped: false,
          earlyClose: false,
        };
        const quietHelper = {
          status: async () => ({
            available: false,
            trusted: false,
            armed: null,
            lastState: "helper-unavailable",
          }),
          advertise: async () => ({ state: "stopped" }),
          disarm: async () => ({ state: "disarmed" }),
          stopAdvertising: async () => {
            // Keep shutdown pending long enough to exercise repeated Cmd+Q.
            await new Promise((resolve) => setTimeout(resolve, 400));
            return { state: "stopped" };
          },
        };
        const start = PadBridge.prototype.start,
          stop = PadBridge.prototype.stop,
          status = PadBridge.prototype.status,
          close = Store.prototype.close;
        PadBridge.prototype.start = async function (...args) {
          this.host = "127.0.0.1";
          this.helper = quietHelper;
          globalThis.__padLifecycleBridge = this;
          return start.apply(this, args);
        };
        PadBridge.prototype.status = function (...args) {
          this.helper = quietHelper;
          return status.apply(this, args);
        };
        PadBridge.prototype.stop = async function (...args) {
          await stop.apply(this, args);
          state.bridgeStopped = true;
        };
        Store.prototype.close = function (...args) {
          if (this.folder === folder) {
            state.closes++;
            state.earlyClose ||= !state.bridgeStopped;
          }
          return close.apply(this, args);
        };
        app.on("before-quit", () => state.quitEvents++);
        app.on("will-quit", () =>
          fs.writeFileSync(shutdownFile, JSON.stringify(state)),
        );
        return nativeImage
          .createFromBitmap(Buffer.from([48, 60, 46, 255]), {
            width: 1,
            height: 1,
          })
          .toPNG()
          .toString("base64");
      },
      { folder, shutdownFile },
    );
    const attempt = await page.evaluate(
      async ({ cardId, png }) => {
        const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
        return window.recall.paperImport({
          cardId,
          pages: [
            {
              name: "Synthetic page.png",
              mime: "image/png",
              bytes: bytes.buffer,
            },
          ],
        });
      },
      { cardId: math.id, png },
    );
    assert.equal(attempt.status, "received");
    assert.equal(attempt.pageCount, 1);
    const savedPage = await page.evaluate(
      (id) => window.recall.paperPage(id, 0),
      attempt.id,
    );
    assert.equal(savedPage.url, "data:image/png;base64," + png);
    assert.equal(savedPage.index, 0);
    assert.equal(savedPage.name, "Synthetic page.png");
    await expect(page.locator(".answer")).toHaveCount(0);
    const status = await page.evaluate(() =>
      window.recall.padConfigure({ enabled: true }),
    );
    assert.equal(status.enabled, true);
    assert(
      await application.evaluate(
        () => !!globalThis.__padLifecycleBridge.server?.listening,
      ),
    );
    const receiverPort = await application.evaluate(
      () => globalThis.__padLifecycleBridge.server.address().port,
    );
    assert(receiverPort > 0);

    const closeWindow = async () => {
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].close(),
      );
      await expect
        .poll(() =>
          application.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
          ),
        )
        .toBe(0);
      assert.equal(
        child.exitCode,
        null,
        "Companion receiver must remain alive after closing the window",
      );
      assert(
        await application.evaluate(
          () => globalThis.__padLifecycleBridge.server.listening,
        ),
      );
    };
    const reopened = async (trigger) => {
      const nextWindow = application.waitForEvent("window", { timeout: 15000 });
      await trigger();
      page = await nextWindow;
      page.setDefaultTimeout(15000);
      await page.waitForLoadState();
      await expect(
        page.getByRole("navigation", { name: "Main", exact: true }),
      ).toBeVisible();
      return page;
    };
    await closeWindow();
    await reopened(() =>
      application.evaluate(({ app }) => app.emit("activate")),
    );
    await closeWindow();
    await reopened(() =>
      application.evaluate(
        ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
        cardLink(math.id),
      ),
    );
    await expect(
      page.getByRole("heading", { name: math.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".answer")).toHaveCount(0);
    assert.equal(
      (await page.evaluate((id) => window.recall.paperAttempts(id), math.id))[0]
        .id,
      attempt.id,
    );
    await closeWindow();
    await reopened(() =>
      application.evaluate(
        ({ app }, url) => app.emit("second-instance", {}, [url]),
        cardLink(concept.id),
      ),
    );
    await expect(
      page.getByRole("heading", { name: concept.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".answer")).toHaveCount(0);

    const exited = application.waitForEvent("close", { timeout: 20000 });
    await application.evaluate(({ app }) => {
      setTimeout(() => {
        app.quit();
        app.quit();
      }, 25);
    });
    await exited;
    assert.equal(child.exitCode, 0);
    const shutdown = JSON.parse(fs.readFileSync(shutdownFile, "utf8"));
    assert(
      shutdown.quitEvents >= 3,
      "Both quit requests and the final quit must run",
    );
    assert.equal(
      shutdown.earlyClose,
      false,
      "The database must not close before receiver shutdown",
    );
    assert.equal(shutdown.closes, 1);
    assert.equal(shutdown.bridgeStopped, true);
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
      assert.deepEqual(after.get("session"), before.session);
      assert.equal(
        after.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
        1,
      );
      assert.equal(after.get("pad:enabled"), true);
    } finally {
      after.close();
    }
    console.log(
      "PASS real handwriting IPC/native image intake, page roundtrip, hidden answers and schedules, background receiver, activate/deep-link/second-launch reopen, repeated quit and released writer. Bonjour is inert; no real API, iPad or chat actions.",
    );
  } finally {
    if (child?.exitCode === null) await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
