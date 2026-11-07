// All documents and learning records in this journey are synthetic.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { saveConfig } = require("../electron/config.cjs");
const { createProfile } = require("../electron/verification-mode.cjs");
const { KnowledgeIndex } = require("../electron/knowledge-index.cjs");
const sample = `---
recall:
  id: demo:weighted-mean
title: When some observations matter more
aliases: [Weighted mean, Weighted average]
tags: [Mathematics]
---
# When some observations matter more

A weighted mean lets each observation contribute in proportion to its importance. Think of it as finding the balance point of a collection of values.

> The question isn't only “what did we observe?” It is also “how much should each observation count?”

## One idea, a useful equation

For observations $x_i$ with nonnegative weights $w_i$, the weighted mean is

$$\\bar{x}_w = \\frac{\\sum_i w_i x_i}{\\sum_i w_i}$$

The denominator normalizes the weights. Multiplying every weight by the same positive constant leaves the answer unchanged.

## A small, concrete example

| Observation | Value | Weight |
|---|---|---|
| First assessment | 70 | 1 |
| Second assessment | 90 | 3 |

The result is **85**, closer to 90 because the second assessment has three times the influence.

## Connect the idea

Weighted means also appear in [[Portfolio returns]] and [[Expected value]]. The formula stays the same. What the weights represent changes.
`;
async function run() {
  const executable = process.env.RECALL_TEST_EXECUTABLE;
  await require("./require-invisible-runtime.cjs")(executable);
  const folder = createProfile(),
    notes = path.join(folder, "fixtures", "notes"),
    output = path.resolve(__dirname, "../evidence/knowledge-space");
  fs.mkdirSync(notes, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  const noteFile = path.join(notes, "Weighted mean.md");
  fs.writeFileSync(noteFile, sample);
  fs.writeFileSync(
    path.join(notes, "Portfolio returns.md"),
    "---\ntags: [Finance]\n---\n# Portfolio returns\n\nA collection of investments, one result. The allocation determines the weight of each return.\n\nSee [[When some observations matter more]].",
  );
  fs.writeFileSync(
    path.join(notes, "Expected value.md"),
    "---\ntags: [Probability]\n---\n# Expected value\n\nThe probability-weighted average of possible outcomes.",
  );
  fs.writeFileSync(
    path.join(notes, "Building a wheel.md"),
    "---\naliases: [Python wheel, Wheelhouse]\ntags: [Engineering]\n---\n# Building a Python wheel\n\nA distribution archive makes your package installable.\n\n```python\ndef normalize(values):\n    total = sum(values)\n    return [v / total for v in values]\n```\n\n```mermaid\nflowchart LR\n A[Source] --> B[Build wheel]\n B --> C[Install]\n```",
  );
  fs.writeFileSync(
    path.join(notes, "Reference.html"),
    '<html><head><title>The geometry of projections</title><style>body{display:none}</style></head><body><h1>The geometry of projections</h1><p>Projection isolates the component of a vector along a chosen direction.</p><script>window.KNOWLEDGE_ATTACK=true</script><img src="https://example.invalid/private" onerror="window.KNOWLEDGE_ATTACK=true"><iframe src="recall://app/"></iframe><a href="javascript:alert(1)">Bad link</a></body></html>',
  );
  // Ensure the main note sorts first without relying on directory order.
  const now = new Date();
  fs.utimesSync(noteFile, now, new Date(now.getTime() + 1000));
  saveConfig(folder, {
    sources: [
      {
        id: "notes",
        name: "The commonplace book",
        root: notes,
        type: "markdown",
        write: true,
      },
    ],
    captureEnabled: false,
  });
  const store = new Store(folder);
  store.import(require("../examples/demo.json").cards);
  const beforeCards = store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    beforeReviews = store.db.prepare("SELECT * FROM reviews ORDER BY id").all();
  store.close();
  const index = new KnowledgeIndex(folder);
  await index.refresh();
  index.close();
  let app;
  const launch = () =>
    electron.launch({
      ...(executable
        ? { executablePath: executable, args: [] }
        : { args: [path.resolve(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    await page
      .getByRole("group", { name: "Knowledge view" })
      .getByRole("button", { name: "Notes", exact: true })
      .click();
    await expect(page.locator(".knowledge-prose h1")).toHaveText(
      "When some observations matter more",
    );
    await expect(page.locator(".knowledge-prose .katex-display")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Practice this note", exact: true }),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await app.evaluate(({ nativeTheme }, v) => {
        nativeTheme.themeSource = v;
      }, theme);
      await page.emulateMedia({ colorScheme: null });
      for (const width of [1512, 900, 720]) {
        await page.setViewportSize({ width, height: 1080 });
        assert(
          (await page
            .locator(".knowledge-space")
            .evaluate((e) => e.scrollWidth - e.clientWidth)) <= 1,
        );
        await page.screenshot({
          path: path.join(output, `knowledge-${theme}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    await page.setViewportSize({ width: 1512, height: 1080 });
    await page.getByLabel("Search knowledge").fill("Wheelhouse");
    await expect(page.locator(".knowledge-entry")).toHaveCount(1);
    await page.locator(".knowledge-entry").click();
    await expect(page.locator(".knowledge-prose .diagram img")).toBeVisible();
    await page.getByLabel("Search knowledge").fill("geometry of projections");
    await page
      .locator(".knowledge-entry")
      .filter({ hasText: "The geometry of projections" })
      .click();
    await expect(page.locator(".knowledge-prose h1")).toHaveText(
      "The geometry of projections",
    );
    assert.equal(await page.evaluate(() => window.KNOWLEDGE_ATTACK), undefined);
    assert.equal(
      await page
        .locator(
          '.knowledge-prose script,.knowledge-prose iframe,.knowledge-prose style,.knowledge-prose img[src^="http"]',
        )
        .count(),
      0,
    );
    await page.getByLabel("Search knowledge").fill("Weighted average");
    await page
      .locator(".knowledge-entry")
      .filter({ hasText: "When some observations" })
      .click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const body = await page.getByLabel("Write in Markdown").inputValue();
    await page
      .getByLabel("Write in Markdown")
      .fill(body + "\n\nA draft that survives a restart.");
    await expect(
      page.getByText("Draft saved on this Mac", { exact: true }),
    ).toBeVisible();
    await app.close();
    app = null;
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    await page
      .getByRole("group", { name: "Knowledge view" })
      .getByRole("button", { name: "Notes", exact: true })
      .click();
    await expect(page.getByLabel("Write in Markdown")).toHaveValue(
      /A draft that survives a restart/,
    );
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByText("Saved to your folder", { exact: true }),
    ).toBeVisible();
    assert.match(
      fs.readFileSync(noteFile, "utf8"),
      /A draft that survives a restart/,
    );
    await page.getByRole("button", { name: "Read", exact: true }).click();
    // Another editor changes the file while this reader is open.
    fs.appendFileSync(noteFile, "\n\nA change from another editor.");
    await expect(
      page.getByText("This file changed outside Recall. Your draft is kept."),
    ).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "Load file version" }).click();
    await expect(page.locator(".knowledge-prose")).toContainText(
      "A change from another editor.",
    );
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const conflictDraft = await page
      .getByLabel("Write in Markdown")
      .inputValue();
    await page
      .getByLabel("Write in Markdown")
      .fill(conflictDraft + "\nA conflicting draft.");
    await expect(
      page.getByText("Draft saved on this Mac", { exact: true }),
    ).toBeVisible();
    fs.appendFileSync(noteFile, "\nA second external edit.");
    await expect(
      page.getByRole("button", { name: "Save note", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    await page
      .getByRole("group", { name: "Knowledge view" })
      .getByRole("button", { name: "Notes", exact: true })
      .click();
    await expect(page.getByLabel("Write in Markdown")).toHaveValue(
      /A conflicting draft/,
    );
    await page
      .getByLabel("Write in Markdown")
      .fill(conflictDraft + "\nStill my conflicting draft.");
    await expect(
      page.getByText("Draft saved on this Mac", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    await page
      .getByRole("group", { name: "Knowledge view" })
      .getByRole("button", { name: "Notes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save note", exact: true }),
    ).toBeDisabled();
    assert(!fs.readFileSync(noteFile, "utf8").includes("conflicting draft"));
    await page.getByRole("button", { name: "Load file version" }).click();
    await page
      .getByRole("button", { name: "Discard draft and reload", exact: true })
      .click();
    await page.getByRole("button", { name: "Read", exact: true }).click();
    for (const [label, kind] of [
      ["Concepts", "concept"],
      ["Math", "math"],
      ["Coding", "code"],
      ["Mixed", "all"],
    ]) {
      await page
        .getByRole("group", { name: "Knowledge practice format" })
        .getByRole("button", { name: label, exact: true })
        .click();
      await page
        .getByRole("button", { name: "Practice this note", exact: true })
        .click();
      const current = await page.evaluate(
        async () => (await window.recall.snapshot()).session,
      );
      assert.equal(current.selection.format, kind);
      assert.equal(current.revealed, false);
      const snapshot = await page.evaluate(() => window.recall.snapshot());
      assert(
        current.ids.every((id) =>
          snapshot.cards.some(
            (c) => c.id === id && (kind === "all" || c.kind === kind),
          ),
        ),
      );
      await page
        .getByRole("button", { name: "Knowledge", exact: true })
        .click();
      await page
        .getByRole("group", { name: "Knowledge view" })
        .getByRole("button", { name: "Notes", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Practice this note", exact: true })
        .click();
      assert.deepEqual(
        await page.evaluate(
          async () => (await window.recall.snapshot()).session,
        ),
        current,
      );
      await page.evaluate(() => window.recall.setting("session", null));
      await page.reload();
      await page
        .getByRole("button", { name: "Knowledge", exact: true })
        .click();
      await page
        .getByRole("group", { name: "Knowledge view" })
        .getByRole("button", { name: "Notes", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByLabel("Note title", { exact: true }).fill("My first idea");
    await page
      .getByLabel("Write in Markdown")
      .fill("# My first idea\n\nOne small useful note.");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByText("Saved to your folder", { exact: true }),
    ).toBeVisible();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    const after = new Store(folder);
    assert.deepEqual(
      after.db.prepare("SELECT * FROM cards ORDER BY id").all(),
      beforeCards,
    );
    assert.deepEqual(
      after.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
      beforeReviews,
    );
    after.close();
    console.log(
      "Knowledge journey passed invisibly: both appearances, responsive layout, math/Mermaid, safe HTML, persistent draft recovery, external edits, all four practice formats, unfinished sessions, new notes and unchanged cards/reviews.",
    );
  } catch (e) {
    if (app) {
      const page = await app.firstWindow();
      await page.screenshot({
        path: path.join(output, "failure.png"),
        fullPage: true,
      });
      console.log(
        await page
          .locator(
            ".knowledge-message,.knowledge-external,.knowledge-document-footer",
          )
          .allTextContents(),
      );
    }
    throw e;
  } finally {
    await app?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
