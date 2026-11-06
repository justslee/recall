// Real Electron renderer, hidden disposable profile, no live-library writes.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { normalizePack } = require("../electron/bundles.cjs");
const { widgetsOf } = require("../electron/widgets.cjs");
const { cardLink } = require("../electron/card-links.cjs");
const { createProfile } = require("../electron/verification-mode.cjs");
const args = process.argv.slice(2);
const option = (key) => args[args.indexOf(key) + 1];
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function runtimeKey() {
  const h = crypto.createHash("sha256");
  for (const dir of ["dist", "electron", "shared"]) {
    function visit(folder) {
      for (const entry of fs
        .readdirSync(folder, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile()) {
          h.update(path.relative(path.join(__dirname, ".."), file));
          h.update(fs.readFileSync(file));
        }
      }
    }
    visit(path.join(__dirname, "..", dir));
  }
  h.update(fs.readFileSync(__filename));
  h.update(fs.readFileSync(path.join(__dirname, "../package-lock.json")));
  return h.digest("hex");
}
async function run() {
  if (!args.includes("--pack") || !args.includes("--output"))
    throw Error(
      "Usage: node scripts/verify-cards.cjs --pack FILE --output PRIVATE_FOLDER [--scenes FILE] [--force]",
    );
  const pack = normalizePack(
    JSON.parse(fs.readFileSync(option("--pack"), "utf8")),
  );
  const scenes = args.includes("--scenes")
    ? JSON.parse(fs.readFileSync(option("--scenes"), "utf8"))
    : {};
  const output = path.resolve(option("--output"));
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const runtime = runtimeKey(),
    results = [],
    pending = [];
  for (const card of pack.cards) {
    const checks = scenes[card.id] || [];
    const key = hash(JSON.stringify([card, checks, runtime, "render-v1"]));
    const file = path.join(output, key + ".json");
    let cached;
    try {
      cached = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    if (
      !args.includes("--force") &&
      cached?.key === key &&
      cached.passed &&
      cached.screenshots?.length === 4 &&
      cached.screenshots.every(
        (p) =>
          path.basename(p) === p &&
          fs.existsSync(path.join(output, p)) &&
          cached.artifacts?.[p] === hash(fs.readFileSync(path.join(output, p))),
      )
    ) {
      results.push({ ...cached, cached: true });
    } else pending.push({ card, checks, key, file });
  }
  let app, folder;
  try {
    if (pending.length) {
      folder = createProfile();
      const store = new Store(folder);
      // Permission is local to the disposable QA copy; never exported/imported.
      store.import(
        pending.map(({ card }) => ({ ...card, widgetsAllowed: true })),
      );
      store.close();
      app = await electron.launch({
        args: [path.join(__dirname, "..")],
        env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
      });
      const page = await app.firstWindow(),
        errors = [];
      await page.emulateMedia({ colorScheme: null });
      page.on("pageerror", (error) => errors.push(error.message));
      for (const { card, checks, key, file } of pending) {
        const beforeErrors = errors.length,
          screenshots = [];
        await app.evaluate(
          ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
          cardLink(card.id),
        );
        await expect(page.locator(".answer")).toHaveCount(0);
        await page
          .getByRole("button", {
            name: /^(Reveal answer|Reveal worked solution|Reveal reference & explanation)$/,
          })
          .click();
        const widgets = widgetsOf(card.answer);
        for (let i = 0; i < widgets.length; i++) {
          const widget = page.locator(".visual-widget").nth(i);
          await widget
            .getByRole("button", { name: "Load interactive", exact: true })
            .click();
          await expect(widget).toHaveAttribute("data-widget-status", "ready");
          const frame = widget.frameLocator("iframe");
          expect(
            await frame.locator("body").evaluate(() => typeof window.recall),
          ).toBe("undefined");
          const relevant = checks.filter((s) => (s.widget || 0) === i);
          if (!relevant.length)
            throw Error(
              `${card.id}: add explicit interaction and visible-result checks for widget ${i}`,
            );
          for (const scene of relevant) {
            if (!scene.steps?.length || !scene.text?.length)
              throw Error(
                "Each visual scenario needs actions and visible text assertions",
              );
            for (const step of scene.steps) {
              if (step.click) await frame.locator(step.click).click();
              else if (step.input)
                await frame.locator(step.input).fill(String(step.value));
              else if (step.select)
                await frame
                  .locator(step.select)
                  .selectOption(String(step.value));
              else throw Error("Unsupported visual interaction");
            }
            for (const check of scene.text) {
              if (check.equals !== undefined)
                await expect(frame.locator(check.selector)).toHaveText(
                  String(check.equals),
                );
              else if (check.includes !== undefined)
                await expect(frame.locator(check.selector)).toContainText(
                  String(check.includes),
                );
              else throw Error("A visible expected result is required");
            }
          }
        }
        for (const theme of ["light", "dark"]) {
          await app.evaluate(({ nativeTheme }, value) => {
            nativeTheme.themeSource = value;
          }, theme);
          await expect
            .poll(() =>
              page.evaluate(
                () => matchMedia("(prefers-color-scheme: dark)").matches,
              ),
            )
            .toBe(theme === "dark");
          for (const width of [800, 1320]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator(".answer").evaluate(async () => {
              await document.fonts.ready;
            });
            await expect(page.locator(".katex-error")).toHaveCount(0);
            for (let i = 0; i < widgets.length; i++) {
              const widget = page.locator(".visual-widget").nth(i);
              await expect(widget).toHaveAttribute(
                "data-widget-status",
                "ready",
              );
              expect(
                await widget
                  .frameLocator("iframe")
                  .locator("body")
                  .evaluate(
                    () =>
                      document.documentElement.scrollWidth <=
                      document.documentElement.clientWidth + 1,
                  ),
              ).toBe(true);
            }
            const name = `${key}-${theme}-${width}.png`;
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({
              path: path.join(output, name),
              fullPage: true,
              animations: "disabled",
            });
            screenshots.push(name);
          }
        }
        expect(errors.slice(beforeErrors)).toEqual([]);
        expect(
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some(
              (w) => w.isVisible() || w.isFocused(),
            ),
          ),
        ).toBe(false);
        const report = {
          id: card.id,
          key,
          runtime,
          passed: true,
          checkedAt: new Date().toISOString(),
          screenshots,
          artifacts: Object.fromEntries(
            screenshots.map((name) => [
              name,
              hash(fs.readFileSync(path.join(output, name))),
            ]),
          ),
          scope:
            "Hidden render and supplied visual interactions only. Editorial, math and native code checks are separate.",
        };
        fs.writeFileSync(file, JSON.stringify(report, null, 2), {
          mode: 0o600,
        });
        results.push(report);
      }
      expect(fs.existsSync(path.join(folder, "backups"))).toBe(false);
    }
    const report = {
      cards: results.length,
      cached: results.filter((r) => r.cached).length,
      results,
    };
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        cards: report.cards,
        cached: report.cached,
        report: path.join(output, "report.json"),
      }),
    );
  } finally {
    await app?.close();
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
  }
}
run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
