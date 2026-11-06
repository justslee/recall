// Validate an authorized widget revision against a READ-ONLY source library.
// All execution and edits occur in a disposable profile with no credentials.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite"),
  { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs"),
  revisions = require("../electron/card-revisions.cjs"),
  { cardLink } = require("../electron/card-links.cjs");
const args = process.argv.slice(2);
function option(name, required = false) {
  const i = args.indexOf("--" + name),
    value = i >= 0 ? args[i + 1] : null;
  if (i >= 0 && (!value || value.startsWith("--")))
    throw Error("Missing --" + name + " value");
  if (required && !value) throw Error("Required --" + name);
  return value;
}
const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
async function check() {
  await require("./require-invisible-runtime.cjs")(process.env.RECALL_TEST_EXECUTABLE);
  const compatibility = args.includes("--compatibility");
  const source = path.resolve(option("data", true)),
    request = readJSON(option("request", true)),
    manifest = readJSON(option("scenes", true));
  const output = path.resolve(
    option("output") || path.join(__dirname, "../evidence/visual-revisions"),
  );
  const db = new DatabaseSync(path.join(source, "recall.sqlite"), {
    readOnly: true,
  });
  let cards;
  try {
    revisions.preview({ db }, request); // identity, stale content, markup syntax
    cards = request.cards.map((edit) =>
      JSON.parse(
        db.prepare("SELECT content FROM cards WHERE id=?").get(edit.id).content,
      ),
    );
  } finally {
    db.close();
  }
  const folder = require("../electron/verification-mode.cjs").createProfile(),
    s = new Store(folder);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  // Keep the exact checked inputs beside the report; an author's next edit
  // must not silently change what an earlier acceptance record refers to.
  for (const [name, value] of [
    ["checked-request.json", request],
    ["checked-scenes.json", manifest],
  ])
    fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
  // Explicit execution permission is for these isolated QA copies only. It is
  // never sent back in the original live request, whose permission is preserved.
  const fixtures = cards.map((c) => ({ ...c, widgetsAllowed: true }));
  s.import(fixtures);
  const fixtureRequest = {
    schemaVersion: 1,
    cards: request.cards.map((edit) => ({
      ...edit,
      expectedContentHash: revisions.hash(
        fixtures.find((c) => c.id === edit.id),
      ),
    })),
  };
  const queued = revisions.enqueue(folder, fixtureRequest);
  assert.equal(revisions.applyPending(s).applied, 1);
  assert.equal(revisions.status(folder, queued.requestId).mode, "revised");
  s.close();
  let app;
  const results = [],
    errors = [];
  const near = (actual, expected, context) => {
    if (typeof expected === "number")
      assert(
        Number.isFinite(actual) && Math.abs(actual - expected) < 1e-6,
        context + ": " + actual + " != " + expected,
      );
    else assert.deepEqual(actual, expected, context);
  };
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? {
            executablePath: process.env.RECALL_TEST_EXECUTABLE,
            args: [cardLink(cards[0].id)],
          }
        : { args: [path.join(__dirname, ".."), cardLink(cards[0].id)] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 1060 });
    await page.emulateMedia({ colorScheme: null, reducedMotion: "reduce" });
    page.on("pageerror", (error) => errors.push(error.message));
    const settle = async (frame) => {
      let since = null,
        previous = null;
      await expect
        .poll(
          async () => {
            const expected = await frame
              .locator("body")
              .evaluate((el) =>
                Math.max(
                  96,
                  Math.min(1400, Math.ceil(el.getBoundingClientRect().height)),
                ),
              );
            const actual = await page
              .locator(".visual-widget iframe")
              .evaluate((el) => el.getBoundingClientRect().height);
            if (Math.abs(expected - actual) >= 3 || previous !== expected) {
              since = null;
              previous = expected;
              return false;
            }
            since ??= Date.now();
            return Date.now() - since >= 200;
          },
          { intervals: [50] },
        )
        .toBe(true);
    };
    const steps = async (frame, values = []) => {
      for (const step of values) {
        if (step.click) await frame.locator(step.click).click();
        else if (step.select)
          await frame.locator(step.select).selectOption(String(step.value));
        else if (step.input) {
          const control = frame.locator(step.input);
          if (await control.evaluate((el) => el.tagName === "SELECT"))
            await control.selectOption(String(step.value));
          else await control.fill(String(step.value));
        } else throw Error("Unsupported scenario step");
      }
    };
    for (const edit of request.cards) {
      const entry = manifest.cards.find((c) => c.id === edit.id);
      assert(
        entry?.scenes?.length,
        "Scenario coverage required for " + edit.id,
      );
      const item = {
        id: edit.id,
        editHash: revisions.hash(edit),
        passed: false,
        scenes: [],
        screenshots: [],
      };
      results.push(item);
      try {
        await app.evaluate(
          ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
          cardLink(edit.id),
        );
        await expect(page.locator(".answer")).toHaveCount(0);
        await expect(page.locator("iframe")).toHaveCount(0);
        await page
          .getByRole("button", {
            name: /^(Reveal answer|Reveal worked solution|Reveal reference & explanation)$/,
          })
          .click();
        await expect(page.locator("iframe")).toHaveCount(0);
        await page
          .getByRole("button", { name: "Load interactive", exact: true })
          .nth(edit.widgetIndex)
          .click();
        await expect(
          page.locator(".visual-widget").nth(edit.widgetIndex),
        ).toHaveAttribute("data-widget-status", "ready");
        const frame = page.frameLocator(".visual-widget iframe");
        assert.equal(
          await frame.locator("body").evaluate(() => typeof window.recall),
          "undefined",
        );
        for (const scene of entry.scenes) {
          if (!compatibility) await frame.locator(entry.reset).click();
          await steps(frame, scene.steps);
          const actual = compatibility
            ? {}
            : JSON.parse(
                await frame.locator(entry.root).getAttribute("data-result"),
              );
          if (compatibility)
            assert(
              (await frame.locator("body").innerText()).trim().length,
              "Existing visual has no readable labels",
            );
          for (const [key, value] of Object.entries(scene.expected || {}))
            near(actual[key], value, edit.id + "/" + scene.name + "/" + key);
          for (const text of scene.text || []) {
            if (text.equals !== undefined)
              await expect(frame.locator(text.selector)).toHaveText(
                text.equals,
              );
            else if (text.includes !== undefined)
              await expect(frame.locator(text.selector)).toContainText(
                text.includes,
              );
            else throw Error("Visible text assertion required");
          }
          assert(
            scene.text?.length || scene.marks?.length || compatibility,
            "A visible scene check is required",
          );
          for (const mark of scene.marks || [])
            await expect(frame.locator(mark.selector)).toHaveAttribute(
              mark.attribute,
              String(mark.equals),
            );
          item.scenes.push({
            name: scene.name,
            passed: true,
            observed: actual,
          });
        }
        const changed = entry.scenes.find((c) => c.steps?.length);
        for (const theme of ["light", "dark"]) {
          const before = await frame
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
            before,
          );
          for (const width of [360, 720]) {
            if (!compatibility) await frame.locator(entry.reset).click();
            await page.locator(".visual-widget").evaluate((el, width) => {
              el.style.width = width + "px";
              el.style.maxWidth = "100%";
            }, width);
            await settle(frame);
            assert(
              await frame
                .locator("body")
                .evaluate(
                  () =>
                    document.documentElement.scrollWidth <=
                    document.documentElement.clientWidth + 1,
                ),
              "Horizontal overflow at " + width,
            );
            const tiny = await frame.locator("svg text").evaluateAll((nodes) =>
              nodes
                .filter((el) => {
                  const box = el.getBoundingClientRect(),
                    matrix = el.getScreenCTM();
                  return (
                    el.textContent.trim() &&
                    box.width &&
                    box.height &&
                    matrix &&
                    parseFloat(getComputedStyle(el).fontSize) *
                      Math.hypot(matrix.a, matrix.b) <
                      8.9
                  );
                })
                .map((el) => el.textContent),
            );
            assert.equal(
              tiny.length,
              0,
              "Unreadable SVG labels: " + tiny.join(", "),
            );
            const screenshot = path.join(
              output,
              revisions.hash(edit.id).slice(0, 12) +
                "-" +
                theme +
                "-" +
                width +
                ".png",
            );
            await page.locator(".visual-widget").screenshot({
              path: screenshot,
              animations: "disabled",
              style: ".titlebar,.index-header{visibility:hidden!important}",
            });
            item.screenshots.push(screenshot);
          }
          if (changed) {
            await frame.locator(entry.reset).click();
            await steps(frame, changed.steps);
            await settle(frame);
            const screenshot = path.join(
              output,
              revisions.hash(edit.id).slice(0, 12) +
                "-" +
                theme +
                "-changed.png",
            );
            await page.locator(".visual-widget").screenshot({
              path: screenshot,
              animations: "disabled",
              style: ".titlebar,.index-header{visibility:hidden!important}",
            });
            item.screenshots.push(screenshot);
          }
        }
        const preserved = await frame
            .locator(entry.root)
            .getAttribute("data-result"),
          src = await page.locator("iframe").getAttribute("src");
        await page
          .locator(".visual-widget")
          .evaluate((el) => (el.style.width = ""));
        await page.getByRole("button", { name: "Expand", exact: true }).click();
        await settle(frame);
        assert.equal(
          await frame.locator(entry.root).getAttribute("data-result"),
          preserved,
        );
        assert.equal(await page.locator("iframe").getAttribute("src"), src);
        if (compatibility) {
          const control = frame
            .locator(
              'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]',
            )
            .first();
          if (await control.count()) await control.press("Escape");
          else
            await page
              .getByRole("button", { name: "Collapse", exact: true })
              .click();
        } else await frame.locator(entry.reset).press("Escape");
        await expect(
          page.getByRole("button", { name: "Expand", exact: true }),
        ).toBeVisible();
        if (!compatibility) await frame.locator(entry.reset).press("Enter");
        const input = frame
          .locator('input[type="range"]:not([disabled])')
          .first();
        if (await input.count()) {
          const value = await input.inputValue();
          await input.press("ArrowRight");
          if ((await input.inputValue()) === value)
            await input.press("ArrowLeft");
          assert.notEqual(await input.inputValue(), value);
        }
        item.passed = true;
      } catch (error) {
        item.error = error.message;
        console.error("FAIL " + edit.id + ": " + error.message);
      }
    }
    const report = {
      version: 1,
      checkedAt: new Date().toISOString(),
      requestId: revisions.hash(request),
      acceptance: compatibility
        ? "Existing visual load/layout compatibility only; no new model or editorial acceptance"
        : "Replacement scenarios and rendered layout",
      results,
      pageErrors: errors,
    };
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    assert.deepEqual(errors, []);
    assert(
      results.every((item) => item.passed),
      "Some card visuals failed; no live revisions were applied",
    );
    console.log(
      JSON.stringify({
        passed: results.length,
        scenes: results.reduce((n, item) => n + item.scenes.length, 0),
        report: path.join(output, "report.json"),
        liveApplied: false,
      }),
    );
  } finally {
    await app?.close();
    const check = new Store(folder);
    try {
      assert.equal(
        check.db.prepare("SELECT count(*)n FROM reviews").get().n,
        0,
      );
    } finally {
      check.close();
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }
}
check().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
