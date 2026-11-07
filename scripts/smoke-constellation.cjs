// A real, invisible Electron journey. Every note, card and review is synthetic.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const { Store } = require("../electron/store.cjs");
const { saveConfig } = require("../electron/config.cjs");
const { KnowledgeIndex } = require("../electron/knowledge-index.cjs");
const { createProfile } = require("../electron/verification-mode.cjs");
const taxonomy = require("../electron/taxonomy.cjs");
const expertise = require("../electron/expertise.cjs");
const graph = require("../electron/constellation.cjs");
const DAY = 86400000;

async function fixture(folder) {
  const notes = path.join(folder, "Knowledge");
  fs.mkdirSync(notes, { recursive: true });
  const noteFile = path.join(notes, "Japanese yen.md");
  const noteText =
    "---\nrecall:\n  id: fixture:yen\ntitle: Japanese yen funding\ntags: [Macroeconomics]\n---\n# Japanese yen funding\n\nA synthetic note about funding a carry trade in yen.\n\nSee [[Liquidity]].\n";
  fs.writeFileSync(noteFile, noteText);
  fs.writeFileSync(
    path.join(notes, "Liquidity.md"),
    "---\nrecall:\n  id: fixture:liquidity\ntitle: Liquidity\ntags: [Macroeconomics]\n---\n# Liquidity\n\nAn unassessed synthetic learning objective.\n",
  );
  saveConfig(folder, {
    sources: [
      {
        id: "localKnowledge",
        name: "Recall Knowledge Base",
        root: notes,
        type: "markdown",
        write: true,
      },
    ],
    captureEnabled: false,
  });
  const index = new KnowledgeIndex(folder);
  await index.refresh();
  index.close();
  const store = new Store(folder);
  const templates = require("../examples/demo.json").cards;
  const card = (id, title, kind = "concept", conceptId = id) => ({
    ...structuredClone(templates.find((c) => c.kind === kind)),
    id,
    conceptId,
    title,
    topic: "Constellation fixtures",
    decks: ["Constellation fixtures"],
  });
  const cards = [
    card(
      "fixture:yen:concept",
      "Explain yen funding",
      "concept",
      "fixture:yen",
    ),
    card("fixture:yen:math", "Calculate a carry return", "math", "fixture:yen"),
    card("fixture:yen:code", "Calculate funding costs", "code", "fixture:yen"),
    card("fixture:liquidity", "Liquidity risk"),
    card("fixture:columnar", "Columnar scans"),
    card("fixture:arrow", "Arrow memory layout"),
  ];
  cards.push(
    ...Array.from({ length: 1000 }, (_, i) =>
      card(
        `fixture:scale-${i}`,
        `Scalability idea ${String(i).padStart(4, "0")}`,
      ),
    ),
  );
  store.import(cards);
  const now = Date.now() - 60000;
  let reviewNumber = 0;
  const rate = (id, rating, at) => {
    const sessionId = `constellation-fixture-${++reviewNumber}`;
    store.set("session", {
      id: sessionId,
      ids: [id],
      index: 0,
      revealed: true,
      rated: 0,
      skipped: 0,
      selection: { practice: false },
    });
    store.rate({ id, rating, sessionId }, new Date(at));
  };
  for (let i = 5; i >= 0; i--)
    rate("fixture:yen:concept", "Good", now - i * 3 * DAY);
  rate("fixture:yen:math", "Again", now);
  rate("fixture:columnar", "Good", now - 3 * DAY);
  rate("fixture:columnar", "Good", now);
  rate("fixture:arrow", "Hard", now);
  const nodes = [
    ["economics-finance", "Economics & Finance", null],
    ["fx", "Foreign Exchange", "economics-finance"],
    ["carry", "Carry Trades", "fx"],
    ["yen", "Japanese Yen", "carry"],
    ["liquidity", "Liquidity", "fx"],
    ["interest", "Interest Rates", "economics-finance"],
    ["computing", "Computing", null],
    ["storage", "Storage", "computing"],
    ["columnar", "Columnar Storage", "storage"],
    ["arrow", "Arrow", "storage"],
    ["mathematics-statistics", "Mathematics & Statistics", null],
    ["large", "Large concept collection", "mathematics-statistics"],
    ...Array.from({ length: 23 }, (_, i) => [
      `branch-${i}`,
      `Topic ${i + 1}`,
      "mathematics-statistics",
    ]),
  ].map(([id, label, parentId]) => ({ id, label, parentId, type: "topic" }));
  taxonomy.apply(store, {
    expectedRevision: 0,
    nodes,
    mappings: [
      ...Array.from({ length: 1000 }, (_, i) => ({
        kind: "concept",
        id: `fixture:scale-${i}`,
        nodeId: "large",
      })),
      ...[
        ["fixture:yen", "yen"],
        ["fixture:liquidity", "liquidity"],
        ["fixture:columnar", "columnar"],
        ["fixture:arrow", "arrow"],
      ].map(([id, nodeId]) => ({ kind: "concept", id, nodeId })),
      {
        kind: "note",
        sourceId: "localKnowledge",
        id: "fixture:yen",
        nodeId: "yen",
      },
      {
        kind: "note",
        sourceId: "localKnowledge",
        id: "fixture:liquidity",
        nodeId: "liquidity",
      },
    ],
    relations: [
      {
        from: "economics-finance",
        to: "computing",
        type: "related",
        status: "suggested",
      },
      {
        from: "carry",
        to: "interest",
        type: "uses",
        status: "explicit",
        source: "Synthetic carry-trade reference",
      },
      { from: "yen", to: "liquidity", type: "related", status: "suggested" },
      {
        from: "columnar",
        to: "arrow",
        type: "uses",
        status: "explicit",
        source: "Synthetic storage reference",
      },
    ],
  });
  expertise.refresh(store, { budget: 10000 });
  const expected = graph.snapshot(store, {
    nodeId: expertise.conceptNodeId("fixture:yen"),
  });
  assert(
    expected.focus.summary.score > 0 && expected.focus.summary.score < 100,
  );
  assert.equal(expected.focus.summary.needsPractice, 1);
  assert.equal(expected.focus.summary.assessed, 2);
  assert.equal(expected.focus.summary.total, 3);
  assert.equal(expected.focus.noteRefs.length, 1);
  const session = {
    id: "unfinished-constellation-fixture",
    ids: ["fixture:arrow"],
    index: 0,
    revealed: false,
    rated: 0,
    skipped: 0,
    selection: {
      deck: "all",
      topics: [],
      difficulty: "all",
      limit: 10,
      practice: true,
      format: "concept",
    },
  };
  store.set("session", session);
  const raw = {
    cards: store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    reviews: store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
  };
  store.close();
  return { raw, session, noteFile, noteText, expected };
}

async function run() {
  const { expertiseValue } = await import("../src/constellation-model.js");
  const executable = process.env.RECALL_TEST_EXECUTABLE;
  await require("./require-invisible-runtime.cjs")(executable);
  const folder = createProfile();
  const output = path.join(__dirname, "../evidence/domain-constellation");
  fs.mkdirSync(output, { recursive: true });
  let app, page;
  try {
    const seeded = await fixture(folder);
    app = await electron.launch({
      ...(executable
        ? { executablePath: executable, args: [] }
        : { args: [path.join(__dirname, "..")] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
    });
    page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.error("Renderer error:", e.message);
    });
    await page.reload();
    await page.setViewportSize({ width: 1420, height: 1100 });
    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    const constellation = page.getByRole("region", {
      name: "Constellation knowledge graph",
    });
    await expect(constellation).toBeVisible();
    await expect(page.locator(".constellation-knowledge-status")).toContainText(
      "2 indexed knowledge notes",
    );
    const switcher = page.getByRole("group", { name: "Knowledge view" });
    await expect(
      switcher.getByRole("button", { name: "Constellation", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const focus = page.locator(".constellation-evidence h2");
    const node = (id) =>
      page.locator(`.constellation-node[data-node-id="${id}"]`);
    const explore = async (id, title) => {
      const target = node(id);
      if (await target.isVisible()) await target.click();
      else {
        await page
          .getByLabel("Find on this canvas", { exact: true })
          .fill(title);
        await page.getByRole("option", { name: title, exact: true }).click();
      }
      await expect(focus).toHaveText(title);
    };
    const root = async () => {
      const collapseAll = page.getByRole("button", {
        name: "Collapse all",
        exact: true,
      });
      if (await collapseAll.isVisible()) await collapseAll.click();
      else
        await page
          .getByRole("navigation", { name: "Constellation hierarchy" })
          .getByRole("button", { name: "All knowledge", exact: true })
          .click();
      await expect(focus).toHaveText("Evidence behind the constellation");
      await expect(page.locator(".constellation-stage")).toHaveAttribute(
        "data-node-count",
        "3",
      );
    };
    const snapshot = (options) =>
      page.evaluate((options) => window.recall.constellation(options), options);
    const stage = page.locator(".constellation-stage");
    await expect(stage).toHaveAttribute("data-node-count", "3");
    const domainIds = [
      "computing",
      "mathematics-statistics",
      "economics-finance",
    ];
    const domainColors = async () =>
      Promise.all(
        domainIds.map(async (id) => {
          const chip = page.locator(
            `.constellation-domain-chip[data-domain-id="${id}"]`,
          );
          return chip.evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--domain-color").trim(),
          );
        }),
      );
    await expect(
      page.getByRole("group", { name: "Knowledge domains", exact: true }),
    ).toBeVisible();
    for (const id of domainIds)
      await expect(node(id)).toHaveAttribute("data-domain-id", id);
    const initialColors = await domainColors();
    assert(initialColors.every(Boolean), "Each domain needs an actual color");
    assert.equal(
      new Set(initialColors).size,
      3,
      "Domain colors must be distinct",
    );
    await expect(node("mathematics-statistics")).toHaveAttribute(
      "data-expertise",
      "unassessed",
    );
    await expect(node("computing")).not.toHaveAttribute(
      "data-expertise",
      "unassessed",
    );
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Previous", exact: true }),
    ).toHaveCount(0);
    await expect(stage).toHaveAttribute("data-related-count", /^[1-9]/);
    await page.screenshot({
      path: path.join(output, "three-roots.png"),
      fullPage: true,
      animations: "disabled",
    });
    await explore("mathematics-statistics", "Mathematics & Statistics");
    await expect(stage).toHaveAttribute("data-node-count", "27");
    await explore("large", "Large concept collection");
    await expect(stage).toHaveAttribute("data-node-count", "1027");
    await expect(stage).toHaveAttribute("data-in-view-count", "1027");
    assert(
      (await page.locator(".constellation-node").count()) < 100,
      "Overview must window expensive labels, not drop canvas nodes",
    );
    await page
      .getByRole("button", { name: "Collapse branch", exact: true })
      .click();
    await expect(stage).toHaveAttribute("data-node-count", "27");
    await explore("large", "Large concept collection");
    await expect(stage).toHaveAttribute("data-node-count", "1027");
    await page
      .getByLabel("Find on this canvas", { exact: true })
      .fill("Scalability idea 0999");
    await page
      .getByRole("option", { name: "Scalability idea 0999", exact: true })
      .click();
    await expect(focus).toHaveText("Scalability idea 0999");
    await expect(
      node(expertise.conceptNodeId("fixture:scale-999")),
    ).toBeVisible();
    await page.getByRole("button", { name: "Fit all", exact: true }).click();
    await page.screenshot({
      path: path.join(output, "thousand-concepts.png"),
      fullPage: true,
      animations: "disabled",
    });
    await root();
    await explore("economics-finance", "Economics & Finance");
    await expect(stage).toHaveAttribute("data-node-count", "5");
    // Domain siblings remain on the same canvas while a branch unfolds.
    await expect(node("computing")).toBeVisible();
    await expect(node("mathematics-statistics")).toBeVisible();
    await expect(node("economics-finance")).toHaveAttribute(
      "data-context",
      "active",
    );
    for (const id of ["computing", "mathematics-statistics"]) {
      await expect(node(id)).toHaveAttribute("data-context", "other");
      await expect(node(id)).toContainText("Other domain");
    }
    await expect(node("fx")).toHaveAttribute(
      "data-domain-id",
      "economics-finance",
    );
    assert.equal(
      await node("fx").evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--domain-color").trim(),
      ),
      initialColors[2],
    );
    await page.setViewportSize({ width: 1420, height: 1900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(output, "finance-context.png"),
      fullPage: true,
      animations: "disabled",
    });
    const navBounds = await page
      .locator(".constellation-navigation")
      .boundingBox();
    const graphBounds = await stage.boundingBox();
    await page.screenshot({
      path: path.join(output, "finance-context-detail.png"),
      clip: {
        x: navBounds.x,
        y: navBounds.y,
        width: navBounds.width,
        height: graphBounds.y + graphBounds.height - navBounds.y,
      },
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1420, height: 1100 });
    await explore("fx", "Foreign Exchange");
    await explore("carry", "Carry Trades");
    await expect(page.locator(".constellation-connections")).toContainText(
      "Interest Rates",
    );
    await expect(page.locator(".constellation-connections")).toContainText(
      "Explicit link",
    );
    await explore("yen", "Japanese Yen");
    await expect(page.locator(".constellation-connections")).toContainText(
      "Suggested",
    );
    const yenId = expertise.conceptNodeId("fixture:yen");
    await explore(yenId, "Explain yen funding");
    await expect(node(yenId)).toHaveAttribute(
      "data-domain-id",
      "economics-finance",
    );
    await expect(node(yenId)).toHaveAttribute("data-context", "active");
    await expect(page.locator(".constellation-evidence")).toContainText(
      "2 of 3 mapped objectives assessed · 1 need practice",
    );
    assert.equal(
      await page.locator(".constellation-score-line strong").innerText(),
      expertiseValue(seeded.expected.focus.summary.score),
    );
    await expect(page.locator(".constellation-connections")).toContainText(
      "Liquidity",
    );
    await expect(stage).toHaveAttribute("data-related-count", /^[1-9]/);
    await expect(page.locator(".constellation-evidence-values")).toContainText(
      "67%",
    );
    const format = page.getByLabel("Practice evidence", { exact: true });
    for (const [value, assessed, total] of [
      ["concept", 1, 1],
      ["math", 1, 1],
      ["code", 0, 1],
      ["all", 2, 3],
    ]) {
      await format.selectOption(value);
      await expect(page.locator(".constellation-evidence")).toContainText(
        `${assessed} of ${total} mapped objectives assessed`,
      );
      const actual = (await snapshot({ nodeId: yenId, format: value })).focus
        .summary;
      await expect(page.locator(".constellation-score-line strong")).toHaveText(
        expertiseValue(actual.score),
      );
      assert(actual.score == null || actual.score < 100);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(output, "yen-evidence.png"),
      fullPage: true,
      animations: "disabled",
    });
    await explore("liquidity", "Liquidity");
    await explore(
      expertise.conceptNodeId("fixture:liquidity"),
      "Liquidity risk",
    );
    await expect(page.locator(".constellation-score-line strong")).toHaveText(
      "Unassessed",
    );
    await expect(
      node(expertise.conceptNodeId("fixture:liquidity")),
    ).toHaveAttribute("data-expertise", "unassessed");

    await root();
    await explore("computing", "Computing");
    await explore("storage", "Storage");
    await explore("columnar", "Columnar Storage");
    await expect(page.locator(".constellation-connections")).toContainText(
      "Arrow",
    );
    await expect(stage).toHaveAttribute("data-related-count", /^[1-9]/);
    const zoomValue = async () =>
      parseInt(
        await page.getByLabel("Zoom level", { exact: true }).innerText(),
        10,
      );
    const fitZoom = await zoomValue();
    await page.getByLabel("Zoom in", { exact: true }).click();
    await expect.poll(zoomValue).toBeGreaterThan(fitZoom);
    await page.getByRole("button", { name: "Fit all", exact: true }).click();
    await expect.poll(zoomValue).toBe(fitZoom);
    await stage.focus();
    await page.keyboard.press("+");
    await expect.poll(zoomValue).toBeGreaterThan(fitZoom);
    const beforePan = await node("columnar").boundingBox();
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await node("columnar").boundingBox()).x)
      .toBeGreaterThan(beforePan.x + 30);
    await page.keyboard.press("f");
    await expect.poll(zoomValue).toBe(fitZoom);
    await page.locator(".constellation-stage").evaluate((el) => {
      const b = el.getBoundingClientRect();
      el.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -35,
          clientX: b.x + b.width / 2,
          clientY: b.y + b.height / 2,
        }),
      );
    });
    await expect
      .poll(() => page.getByLabel("Zoom level", { exact: true }).innerText())
      .not.toBe(`${fitZoom}%`);
    await constellation
      .getByRole("button", { name: "Fit all", exact: true })
      .click();
    await page.locator(".constellation-stage").scrollIntoViewIfNeeded();
    const bounds = await page.locator(".constellation-stage").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 2,
    });
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    const touches = (distance) => [
      { x: x - distance, y, id: 1 },
      { x: x + distance, y, id: 2 },
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touches(60),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touches(105),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () =>
        parseInt(
          await page.getByLabel("Zoom level", { exact: true }).innerText(),
          10,
        ),
      )
      .toBeGreaterThan(fitZoom * 1.5);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
    await constellation
      .getByRole("button", { name: "Fit all", exact: true })
      .click();
    await page.getByLabel("Pause graph motion").click();
    await expect(page.getByLabel("Resume graph motion")).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: null });
    await expect(
      page.getByLabel("System reduced motion enabled"),
    ).toBeDisabled();
    for (const theme of ["light", "dark"]) {
      await app.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme;
      }, theme);
      await expect
        .poll(() =>
          page.evaluate(
            () => matchMedia("(prefers-color-scheme: dark)").matches,
          ),
        )
        .toBe(theme === "dark");
      const themedColors = await domainColors();
      assert.equal(new Set(themedColors).size, 3);
      for (const width of [1420, 780, 375]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert(
          (await constellation.evaluate(
            (el) => el.scrollWidth - el.clientWidth,
          )) <= 1,
          `Graph overflow at ${width}`,
        );
        await page.screenshot({
          path: path.join(output, `constellation-${theme}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    await page.setViewportSize({ width: 1420, height: 1100 });
    await root();
    await explore("economics-finance", "Economics & Finance");
    await explore("fx", "Foreign Exchange");
    await explore("carry", "Carry Trades");
    await explore("yen", "Japanese Yen");
    await explore(yenId, "Explain yen funding");
    await constellation
      .getByRole("button", { name: "Japanese yen funding", exact: true })
      .click();
    await expect(page.locator(".knowledge-prose h1")).toHaveText(
      "Japanese yen funding",
    );
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const draft =
      (await page.getByLabel("Write in Markdown").inputValue()) +
      "\nA draft preserved while exploring.";
    await page.getByLabel("Write in Markdown").fill(draft);
    await switcher
      .getByRole("button", { name: "Constellation", exact: true })
      .click();
    await expect(constellation).toBeVisible();
    await page.keyboard.press("Meta+s");
    assert.equal(
      fs.readFileSync(seeded.noteFile, "utf8"),
      seeded.noteText,
      "Graph shortcut must not save a hidden note draft",
    );
    await switcher.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.getByLabel("Write in Markdown")).toHaveValue(draft);
    await switcher
      .getByRole("button", { name: "Constellation", exact: true })
      .click();
    await constellation
      .getByRole("button", {
        name: "Explain yen funding Concepts",
        exact: true,
      })
      .click();
    await expect(page.locator(".review-shell")).toBeVisible();
    await expect(page.locator(".answer")).toHaveCount(0);
    assert.deepEqual(
      (await page.evaluate(() => window.recall.snapshot())).session,
      seeded.session,
    );
    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    await expect(constellation).toBeVisible();
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
    try {
      assert.deepEqual(
        after.db.prepare("SELECT * FROM cards ORDER BY id").all(),
        seeded.raw.cards,
      );
      assert.deepEqual(
        after.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
        seeded.raw.reviews,
      );
      assert.deepEqual(after.get("session"), seeded.session);
    } finally {
      after.close();
    }
    assert.equal(fs.readFileSync(seeded.noteFile, "utf8"), seeded.noteText);
    console.log(
      "Constellation passed invisibly: real taxonomy, continuous canvas with all 1,000 leaves and no pagination, hierarchy and cross-links, scored/unknown/needs-practice evidence, all formats, wheel/touch pinch, fit, light/dark/narrow, real note/card navigation, preserved draft and unfinished session. Cards, schedules, reviews and notes unchanged.",
    );
  } catch (error) {
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
        .catch(() => {});
      console.error(
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 6000),
      );
    }
    throw error;
  } finally {
    await app?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
