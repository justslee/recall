// Synthetic profile only. No live library, learning captures or review ratings.
const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs"),
  { cardLink } = require("../electron/card-links.cjs");
const manifest = require("../examples/visual-benchmarks/manifest.json"),
  pack = require("../examples/visual-benchmarks/preview-pack.json");
const output = path.join(__dirname, "../evidence/visual-benchmarks");
async function run() {
  await require("./require-invisible-runtime.cjs")(
    process.env.RECALL_TEST_EXECUTABLE,
  );
  const folder = require("../electron/verification-mode.cjs").createProfile();
  const s = new Store(folder),
    errors = [],
    results = [];
  s.import(pack.cards);
  const broken = {
    ...pack.cards[0],
    id: "benchmark:runtime-error",
    title: "Broken visual fixture",
    answer:
      '```widget Broken fixture\n<script>throw Error("fixture failure")</script>\n```',
  };
  const silent = {
    ...pack.cards[0],
    id: "benchmark:runtime-timeout",
    title: "Silent readiness fixture",
    answer:
      '```widget Silent fixture\n<script>addEventListener("DOMContentLoaded",e=>e.stopImmediatePropagation(),true)</script>\n```',
  };
  s.import([broken, silent]);
  s.close();
  fs.mkdirSync(output, { recursive: true });
  let app;
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? {
            executablePath: process.env.RECALL_TEST_EXECUTABLE,
            args: [cardLink(pack.cards[0].id)],
          }
        : { args: [path.join(__dirname, ".."), cardLink(pack.cards[0].id)] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
    });
    const page = await app.firstWindow();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluate(() => {
      window.__visualDiagnostics = [];
      addEventListener("message", (e) => {
        if (e.data?.recallWidget?.type === "error")
          window.__visualDiagnostics.push(e.data.recallWidget.message);
      });
    });
    await page.setViewportSize({ width: 1320, height: 1040 });
    await page.emulateMedia({ colorScheme: null });
    const open = async (id) => {
      await app.evaluate(
        ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
        cardLink(id),
      );
      await expect(page.locator(".answer")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Reveal answer", exact: true })
        .click();
      await expect(page.locator("iframe")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Load interactive", exact: true })
        .click();
    };
    const clickSettled = async (frame, selector) => {
      const control = frame.locator(selector);
      // Widget height messages are applied after an 80ms host debounce. Two
      // animation frames of actionability can finish before that resize, moving
      // the intended control under a pointer. Wait for the real geometry,
      // without forcing a click, bypassing disabled state or retrying an action.
      let last = null,
        since = 0;
      await expect
        .poll(
          async () => {
            const box = await control.boundingBox();
            const signature = box && JSON.stringify(box);
            if (!signature || signature !== last) {
              last = signature;
              since = Date.now();
              return false;
            }
            return Date.now() - since >= 200;
          },
          { intervals: [50] },
        )
        .toBe(true);
      await control.click();
    };
    for (const entry of manifest.benchmarks) {
      await open(entry.previewCardId);
      await expect(page.locator(".visual-widget")).toHaveAttribute(
        "data-widget-status",
        "ready",
      );
      const frame = page.frameLocator(".visual-widget iframe");
      assert.equal(
        await frame.locator("body").evaluate(() => typeof window.recall),
        "undefined",
      );
      assert.equal(
        await frame.locator("body").evaluate(() => typeof window.require),
        "undefined",
      );
      for (const scene of entry.interactions) {
        await clickSettled(frame, entry.reset);
        if (entry.id === "weak-reference") {
          const initial = JSON.parse(
            await frame.locator(entry.root).getAttribute("data-result"),
          );
          assert.deepEqual(
            initial,
            entry.interactions[0].expected,
            `${scene.name}: reset acknowledged`,
          );
        }
        for (const step of scene.steps) {
          if (step.click) await clickSettled(frame, step.click);
          else await frame.locator(step.input).fill(String(step.value));
        }
        const actual = JSON.parse(
          await frame.locator(entry.root).getAttribute("data-result"),
        );
        for (const [key, value] of Object.entries(scene.expected)) {
          if (typeof value === "number")
            assert(
              Math.abs(actual[key] - value) < 1e-7,
              `${entry.id}/${scene.name}: ${key} ${actual[key]} != ${value}`,
            );
          else
            assert.equal(
              actual[key],
              value,
              `${entry.id}/${scene.name}: ${key}`,
            );
        }
        // Assert visible marks and copy too: a correct data attribute beside a
        // stale chart is not a successful teaching interaction.
        if (entry.id === "yield-curve") {
          await expect(frame.locator("#curve-spread")).toHaveText(
            actual.spreadBp.toFixed(0) + " bp",
          );
          await expect(frame.locator("#curve-slope")).toHaveText(actual.slope);
          const marks = await frame
            .locator("#curve-chart svg")
            .evaluate((svg) =>
              [...svg.querySelectorAll("circle")].map((c) =>
                Number(c.getAttribute("cy")),
              ),
            );
          assert.equal(marks.length, 5);
          const shortBp = Number(
            await frame.locator("#curve-short").inputValue(),
          );
          const longBp = Number(
            await frame.locator("#curve-long").inputValue(),
          );
          const sign = 0.6 + shortBp / 100 - (2 + longBp / 100);
          assert.equal(Math.sign(marks.at(-1) - marks[0]), Math.sign(sign));
        } else if (entry.id === "duration-gap") {
          await expect(frame.locator("#duration-surplus")).toHaveText(
            "¥" + actual.surplusAfter.toFixed(1) + "bn",
          );
          const bars = await frame
            .locator("#duration-assets-after")
            .evaluate((el) => parseFloat(el.style.width));
          const duration = Number(
            await frame.locator("#duration-asset-input").inputValue(),
          );
          const shock =
            Number(await frame.locator("#duration-shock").inputValue()) / 100;
          assert(
            Math.abs(bars - ((110 * (1 - duration * shock)) / 180) * 100) <
              1e-4,
          );
        } else {
          await expect(frame.locator("#reference-gc-count")).toHaveText(
            "GC runs: " + actual.gcRuns,
          );
          await expect(frame.locator('[aria-current="step"]')).toHaveAttribute(
            "data-phase",
            String(actual.phase),
          );
          if (actual.collected)
            await expect(frame.locator("#reference-explanation")).toContainText(
              "collects the unreachable wrapper",
            );
        }
        results.push({ benchmark: entry.id, scene: scene.name, passed: true });
      }
      await frame.locator(entry.reset).click();
      // Keep a nondefault value through expansion and live appearance changes.
      if (entry.id === "yield-curve")
        await frame.locator("#curve-short").fill("30");
      const preserved = await frame
        .locator(entry.root)
        .getAttribute("data-result");
      const src = await page.locator("iframe").getAttribute("src");
      await page.getByRole("button", { name: "Expand", exact: true }).click();
      await expect(page.locator(".visual-widget")).toHaveAttribute(
        "aria-modal",
        "true",
      );
      assert.equal(await page.locator("iframe").getAttribute("src"), src);
      assert.equal(
        await frame.locator(entry.root).getAttribute("data-result"),
        preserved,
      );
      await frame.locator(entry.reset).focus();
      await frame.locator(entry.reset).press("Escape");
      await expect(
        page.getByRole("button", { name: "Expand", exact: true }),
      ).toBeVisible();
      for (const theme of manifest.appearances) {
        const beforeTheme = await frame
          .locator(entry.root)
          .getAttribute("data-result");
        await app.evaluate(
          ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
          theme,
        );
        await expect
          .poll(() =>
            frame
              .locator("body")
              .evaluate(
                () => matchMedia("(prefers-color-scheme: dark)").matches,
              ),
          )
          .toBe(theme === "dark");
        assert.equal(
          await frame.locator(entry.root).getAttribute("data-result"),
          beforeTheme,
        );
        await frame.locator(entry.reset).click();
        for (const width of manifest.viewports) {
          await page.locator(".visual-widget").evaluate((el, w) => {
            el.style.width = w + "px";
            el.style.maxWidth = "100%";
          }, width);
          await expect(
            page.locator(".visual-widget"),
            JSON.stringify(
              await page.evaluate(() => window.__visualDiagnostics),
            ),
          ).toHaveAttribute("data-widget-status", "ready");
          await expect
            .poll(() =>
              frame
                .locator("body")
                .evaluate(
                  () =>
                    document.documentElement.scrollWidth <=
                    document.documentElement.clientWidth + 1,
                ),
            )
            .toBe(true);
          await expect
            .poll(async () =>
              Number(
                await page
                  .locator("iframe")
                  .evaluate((e) => e.getBoundingClientRect().height),
              ),
            )
            .toBeGreaterThan(200);
          let stableSince = null,
            stableHeight = null;
          await expect
            .poll(
              async () => {
                const expected = await frame
                  .locator("body")
                  .evaluate((el) =>
                    Math.max(
                      96,
                      Math.min(
                        1400,
                        Math.ceil(el.getBoundingClientRect().height),
                      ),
                    ),
                  );
                const actual = await page
                  .locator("iframe")
                  .evaluate((el) => el.getBoundingClientRect().height);
                if (
                  Math.abs(expected - actual) >= 3 ||
                  stableHeight !== expected
                ) {
                  stableSince = null;
                  stableHeight = expected;
                  return false;
                }
                stableSince ??= Date.now();
                return Date.now() - stableSince >= 200;
              },
              { intervals: [50] },
            )
            .toBe(true);
          const innerGeometry = await frame.locator("body").evaluate((el) => ({
            body: el.getBoundingClientRect().height,
            scene: el.querySelector("[data-benchmark]").getBoundingClientRect()
              .height,
            bottom: el.querySelector("[data-benchmark]").getBoundingClientRect()
              .bottom,
            padding: getComputedStyle(el).paddingBottom,
          }));
          const outerGeometry = await page
            .locator(".visual-widget")
            .evaluate((el) => ({
              shell: el.getBoundingClientRect().height,
              viewport: el
                .querySelector(".visual-widget-viewport")
                .getBoundingClientRect().height,
              iframe: el.querySelector("iframe").getBoundingClientRect().height,
            }));
          assert(
            Math.abs(
              Math.min(1400, Math.ceil(innerGeometry.body)) -
                outerGeometry.iframe,
            ) < 3,
            "Frame must fit settled content",
          );
          await page.locator(".visual-widget").screenshot({
            path: path.join(output, `${entry.id}-${theme}-${width}.png`),
            animations: "disabled",
            style: ".titlebar, .index-header {visibility:hidden!important}",
          });
        }
        await page.locator(".visual-widget").evaluate((el) => {
          el.style.width = "";
        });
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await frame.locator(entry.reset).click();
      const range = frame.locator('input[type="range"]').first();
      if (await range.count()) {
        await range.focus();
        const before = await range.inputValue();
        await range.press("ArrowRight");
        assert.notEqual(await range.inputValue(), before);
      } else {
        await frame.locator("#reference-next").focus();
        await frame.locator("#reference-next").press("Enter");
        assert.equal(
          JSON.parse(
            await frame.locator(entry.root).getAttribute("data-result"),
          ).phase,
          1,
        );
      }
      // Host Reset creates a fresh instance; expansion did not.
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(page.locator(".visual-widget")).toHaveAttribute(
        "data-widget-status",
        "ready",
      );
      assert.notEqual(await page.locator("iframe").getAttribute("src"), src);
      // Reopening a card hides the answer and destroys its old widget.
      await app.evaluate(
        ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
        cardLink(entry.previewCardId),
      );
      await expect(page.locator("iframe")).toHaveCount(0);
    }
    assert.deepEqual(errors, []);
    await open(broken.id);
    await expect(page.locator(".visual-widget")).toHaveAttribute(
      "data-widget-status",
      "error",
    );
    await expect(
      page.getByRole("button", { name: "Retry visual" }),
    ).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry visual" }).click();
    await expect(page.locator(".visual-widget")).toHaveAttribute(
      "data-widget-status",
      "error",
    );
    assert.deepEqual(errors, ["fixture failure", "fixture failure"]);
    await open(silent.id);
    await expect(page.locator(".visual-widget")).toHaveAttribute(
      "data-widget-status",
      "error",
      { timeout: 12000 },
    );
    await expect(
      page.getByText("This visual didn’t finish opening.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    const report = {
      version: 1,
      checkedAt: new Date().toISOString(),
      scenes: results,
      appearances: manifest.appearances,
      widths: manifest.viewports,
      hostChecks: [
        "explicit-load",
        "error-retry",
        "initialization-timeout",
        "instance-reset",
        "same-frame-expand",
        "escape-from-frame",
        "theme-state",
        "keyboard",
        "reduced-motion",
        "no-preload",
        "answer-unmount",
      ],
    };
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `Visual QA passed: ${results.length} scenarios, both appearances, both widths; host lifecycle and sandbox checks passed. Evidence: ${output}`,
    );
  } finally {
    await app?.close();
    const check = new Store(folder);
    try {
      assert.equal(
        check.db.prepare("SELECT count(*) n FROM reviews").get().n,
        0,
      );
      assert.equal(check.cards().length, pack.cards.length + 2);
    } finally {
      check.close();
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
