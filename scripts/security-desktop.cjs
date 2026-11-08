const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const repo = path.resolve(__dirname, "..");
const evidence = path.join(repo, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const { _electron: electron, expect } = require(
  repo + "/node_modules/@playwright/test",
);
const { Store } = require(repo + "/electron/store.cjs");
const { cardLink } = require(repo + "/electron/card-links.cjs");
(async () => {
  const folder = require("../electron/verification-mode.cjs").createProfile();
  const s = new Store(folder);
  const base = require(repo + "/examples/demo.json").cards[0];
  const cssCard = {
    ...base,
    id: "audit:svg",
    title: "Synthetic SVG audit",
    widgetsAllowed: false,
    answer:
      '<p>Safe test fixture</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 80" onload="window.__recallXss=true"><style>body{--recall-security-probe:escaped!important}button{--recall-button-probe:affected!important}</style><text x="10" y="40">Synthetic security probe</text></svg><img src="x" onerror="window.__recallXss=true">',
  };
  const widgetHtml = `<div id="result">pending</div><script>(async()=>{const r={recall:typeof window.recall,node:typeof require};for(const [k,fn] of Object.entries({parent:()=>parent.document.body.innerText,storage:()=>localStorage.length,topNavigation:()=>{top.location='recall://app/blocked-probe';return 'allowed'},popup:()=>window.open('recall://app/blocked-probe')?'opened':'blocked'})){try{r[k]=fn()}catch(e){r[k]=e.name}}parent.postMessage({method:'run',args:['audit:svg','python','print(1)'],recallWidget:{height:999999}},'*');document.getElementById('result').textContent=JSON.stringify(r)})();</script>`;
  const widgetCard = {
    ...base,
    id: "audit:widget",
    title: "Synthetic widget audit",
    answer: "```widget Boundary check\n" + widgetHtml + "\n```",
    widgetsAllowed: true,
  };
  const disabledCard = {
    ...widgetCard,
    id: "audit:disabled",
    widgetsAllowed: false,
  };
  // Authored figures usually omit xmlns and may use HTML entities.
  const authoredSvgCard = {
    ...base,
    id: "audit:svg-authored",
    title: "Synthetic authored SVG audit",
    widgetsAllowed: false,
    answer:
      '<p>Figure without an xmlns declaration</p><svg viewBox="0 0 400 80" role="img" aria-label="Authored figure"><style>body{--recall-security-probe:escaped!important}.lbl{fill:var(--text)}</style><rect width="400" height="80" rx="10" fill="var(--accent-soft)"/><text class="lbl" x="10" y="45">1&nbsp;000 authored figure</text></svg>',
  };
  const mermaidCard = {
    ...base,
    id: "audit:mermaid",
    title: "Synthetic Mermaid audit",
    widgetsAllowed: false,
    answer:
      '```mermaid\n%%{init: {"themeCSS":"body{--recall-security-probe:escaped!important}"}}%%\nflowchart LR\n  A[Recall a concept] --> B[Test an example]\n```',
  };
  const diagramCases = [
    [
      "sequence",
      "sequenceDiagram\n participant Learner\n participant Tutor\n Learner->>Tutor: Explain the method\n Tutor-->>Learner: Check the example",
      "Explain the method",
    ],
    [
      "state",
      "stateDiagram-v2\n [*] --> Draft\n Draft --> Ready: Validate\n Ready --> [*]",
      "Validate",
    ],
    [
      "class",
      "classDiagram\n class Notebook {\n +String title\n }\n class Page\n Notebook --> Page: contains",
      "Notebook",
    ],
    [
      "entity",
      "erDiagram\n NOTEBOOK ||--o{ PAGE : contains\n NOTEBOOK {\n string title\n }",
      "NOTEBOOK",
    ],
  ].map(([name, source, label]) => ({
    ...base,
    id: `audit:mermaid-${name}`,
    title: `Synthetic ${name} diagram`,
    widgetsAllowed: false,
    answer: `\`\`\`mermaid\n${source}\n\`\`\``,
    label,
  }));
  const untrustedCode = {
    ...require(repo + "/examples/demo.json").cards.find(
      (c) => c.kind === "code",
    ),
    id: "audit:untrusted-code",
  };
  s.import([
    cssCard,
    widgetCard,
    disabledCard,
    authoredSvgCard,
    mermaidCard,
    ...diagramCases,
    untrustedCode,
  ]);
  s.close();
  let app;
  const result = { folder };
  try {
    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? {
            executablePath: path.resolve(process.env.RECALL_TEST_EXECUTABLE),
            args: [cardLink(cssCard.id)],
          }
        : { args: [repo, cardLink(cssCard.id)] }),
      env: { ...process.env, RECALL_DATA_DIR: folder, RECALL_VERIFY: "1" },
      timeout: 30000,
    });
    const p = await app.firstWindow();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() || w.isFocused(),
        ),
      ),
      false,
    );
    p.setDefaultTimeout(12000);
    const logs = [],
      pageErrors = [];
    let networkResult = null;
    p.on("pageerror", (e) => pageErrors.push(e.message));
    p.on("console", (m) => {
      if (m.type() === "error") logs.push(m.text());
      if (m.text().startsWith("RECALL_WIDGET_NETWORK:"))
        networkResult = m.text().slice("RECALL_WIDGET_NETWORK:".length);
    });
    await p.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await expect(p.locator(".answer")).toBeVisible();
    await p.waitForFunction(
      () => document.querySelector(".answer .diagram img")?.naturalWidth > 0,
    );
    result.inlineSvg = await p.evaluate(() => ({
      bodyMarker: getComputedStyle(document.body)
        .getPropertyValue("--recall-security-probe")
        .trim(),
      outerButtonMarker: getComputedStyle(document.querySelector("button"))
        .getPropertyValue("--recall-button-probe")
        .trim(),
      scriptExecuted: window.__recallXss === true,
    }));
    assert.equal(result.inlineSvg.bodyMarker, "");
    assert.equal(result.inlineSvg.outerButtonMarker, "");
    assert.equal(result.inlineSvg.scriptExecuted, false);
    await p.emulateMedia({ colorScheme: "dark" });
    await p.screenshot({ path: path.join(evidence, "security-svg-dark.png") });
    await p
      .getByRole("button", { name: "Zoom in diagram", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Reset diagram zoom" }),
    ).toHaveText("125%");
    await p.emulateMedia({ colorScheme: "light" });
    await p.screenshot({ path: path.join(evidence, "security-svg-light.png") });
    await app.evaluate(
      ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
      cardLink(mermaidCard.id),
    );
    await p.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await p.waitForFunction(
      () => document.querySelector(".answer .diagram img")?.naturalWidth > 0,
    );
    assert.equal(
      await p.evaluate(() =>
        getComputedStyle(document.body)
          .getPropertyValue("--recall-security-probe")
          .trim(),
      ),
      "",
    );
    for (const theme of ["dark", "light"]) {
      await p.emulateMedia({ colorScheme: theme });
      await p.screenshot({
        path: path.join(evidence, `security-mermaid-${theme}.png`),
      });
    }
    result.mermaid =
      "Rendered isolated image; injected global CSS did not escape";
    for (const diagram of diagramCases) {
      await app.evaluate(
        ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
        cardLink(diagram.id),
      );
      await p
        .getByRole("button", { name: "Reveal answer", exact: true })
        .click();
      for (const theme of ["dark", "light"]) {
        await p.emulateMedia({ colorScheme: theme });
        await p.waitForFunction(
          () =>
            document.querySelector(".answer .diagram img")?.naturalWidth > 0,
        );
        const src = await p.locator(".answer .diagram img").getAttribute("src");
        assert.ok(src.startsWith("data:image/svg+xml;charset=utf-8,"));
        const svg = decodeURIComponent(src.slice(src.indexOf(",") + 1));
        assert.ok(
          svg.includes(diagram.label),
          `${diagram.id}: missing label in ${theme}`,
        );
        assert.ok(
          !/<(?:script|foreignObject)\b/i.test(svg),
          "Diagrams remain inert SVG images",
        );
      }
    }
    result.diagramCompatibility =
      "Sequence, state, class and entity diagrams render with labels in both appearances";
    await app.evaluate(
      ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
      cardLink(authoredSvgCard.id),
    );
    await p.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await p.waitForFunction(
      () =>
        document.querySelector('.answer .diagram img[alt="Figure"]')
          ?.naturalWidth > 0,
    );
    await expect(p.getByRole("navigation", { name: "Main" })).toBeVisible();
    assert.equal(
      await p.evaluate(() =>
        getComputedStyle(document.body)
          .getPropertyValue("--recall-security-probe")
          .trim(),
      ),
      "",
    );
    assert.deepEqual(pageErrors, []);
    result.authoredSvg =
      "Rendered without xmlns and with &nbsp;; styles did not escape";
    await app.evaluate(
      ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
      cardLink(untrustedCode.id),
    );
    await expect(
      p.getByRole("button", { name: "Run tests", exact: true }),
    ).toBeDisabled();
    const denied = await p.evaluate(async (id) => {
      try {
        await window.recall.run(id, "python", "print(1)");
        return false;
      } catch {
        return true;
      }
    }, untrustedCode.id);
    assert(
      denied,
      "Backend must reject imported code even if Run is invoked directly",
    );
    result.untrustedCode = "UI disabled and backend rejected execution";
    await app.evaluate(
      ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
      cardLink(widgetCard.id),
    );
    await p.getByRole("button", { name: "Reveal answer", exact: true }).click();
    result.widgetBeforeClick = await p.locator("iframe").count();
    await p
      .getByRole("button", { name: "Load interactive", exact: true })
      .click();
    const frame = p.frameLocator("iframe");
    await expect(frame.locator("#result")).not.toHaveText("pending");
    result.widget = JSON.parse(await frame.locator("#result").textContent());
    await expect(p.locator(".widget")).toHaveAttribute(
      "data-widget-status",
      "ready",
    );
    // Let the initial measured height settle before probing rejected messages.
    await p.waitForTimeout(180);
    const widgetFrame = p
      .frames()
      .find((f) => f.url().startsWith("recall://widget/"));
    const instance = new URL(widgetFrame.url()).searchParams.get("instance");
    const initialHeight = await p
      .locator("iframe")
      .evaluate((el) => el.style.height);
    await widgetFrame.evaluate((instance) => {
      parent.postMessage({ recallWidget: { height: 999999 } }, "*");
      parent.postMessage(
        {
          recallWidget: {
            version: 2,
            instance: "stale-instance",
            type: "height",
            height: 100000,
          },
        },
        "*",
      );
      parent.postMessage(
        {
          method: "run",
          args: ["audit:svg", "python", "print(1)"],
          recallWidget: {
            version: 2,
            instance,
            type: "height",
            height: 100000,
          },
        },
        "*",
      );
      parent.postMessage(
        {
          recallWidget: {
            version: 2,
            instance,
            type: "height",
            height: 100001,
          },
        },
        "*",
      );
    }, instance);
    // Correct envelope from the host is still the wrong WindowProxy/source.
    await p.evaluate((instance) => {
      window.postMessage(
        {
          recallWidget: {
            version: 2,
            instance,
            type: "height",
            height: 100000,
          },
        },
        "*",
      );
    }, instance);
    await p.waitForTimeout(180);
    assert.equal(
      await p.locator("iframe").evaluate((el) => el.style.height),
      initialHeight,
    );
    result.rejectedWidgetMessages = [
      "legacy",
      "stale instance",
      "extra command keys",
      "oversized measurement",
      "wrong sender",
    ];
    await widgetFrame.evaluate((instance) => {
      parent.postMessage(
        {
          recallWidget: {
            version: 2,
            instance,
            type: "height",
            height: 100000,
          },
        },
        "*",
      );
    }, instance);
    await expect(p.locator("iframe")).toHaveCSS("height", "1400px");
    result.frameHeight = await p
      .locator("iframe")
      .evaluate((el) => el.style.height);
    result.mainUrlAfterWidget = p.url();
    // A loaded widget may not steer its own frame to another widget document.
    const frameUrlBefore = widgetFrame.url();
    await widgetFrame.evaluate(() => {
      location.href = "recall://widget/audit%3Awidget/0?rev=99&n=99";
    });
    await p.waitForTimeout(500);
    result.widgetSelfNavigation = {
      before: frameUrlBefore,
      after: p
        .frames()
        .filter((f) => f.url().startsWith("recall://widget/"))
        .map((f) => f.url()),
    };
    result.disabledWidgetStatus = await app.evaluate(
      async ({ net }) =>
        (await net.fetch("recall://widget/audit%3Adisabled/0")).status,
    );
    result.traversalStatuses = await app.evaluate(async ({ net }) => {
      const r = {};
      for (const tail of [
        "..%2f..%2fpackage.json",
        "%2f..%2fpackage.json",
        "%2e%2e%2felectron%2fmain.cjs",
      ])
        r[tail] = (await net.fetch("recall://app/" + tail)).status;
      return r;
    });
    // Provoke the blocked network only after the healthy-frame checks. The
    // bridge reports this CSP violation and removes the failed iframe; capture
    // the synthetic result without relying on DOM that must be torn down.
    await widgetFrame.evaluate(() => {
      void fetch("https://recall-security-probe.invalid/").then(
        () => console.info("RECALL_WIDGET_NETWORK:allowed"),
        (error) => console.info("RECALL_WIDGET_NETWORK:" + error.name),
      );
    });
    await expect.poll(() => networkResult).toBe("TypeError");
    await expect(p.locator(".widget")).toHaveAttribute(
      "data-widget-status",
      "error",
    );
    await expect(p.locator("iframe")).toHaveCount(0);
    result.widget.network = networkResult;
    result.blockedResourceFeedback =
      "Visible failure and Retry; failed iframe removed";
    result.cspErrors = logs.filter((m) =>
      /security|refused|blocked|sandbox/i.test(m),
    );
    result.windows = (await app.windows()).length;
    assert.equal(result.widgetBeforeClick, 0);
    assert.equal(result.widget.recall, "undefined");
    assert.equal(result.widget.node, "undefined");
    assert.equal(result.widget.parent, "SecurityError");
    assert.equal(result.widget.storage, "SecurityError");
    assert.equal(result.widget.network, "TypeError");
    assert.equal(result.disabledWidgetStatus, 403);
    assert.deepEqual(result.widgetSelfNavigation.after, [
      result.widgetSelfNavigation.before,
    ]);
    assert.equal(result.windows, 1);
    fs.writeFileSync(
      path.join(evidence, "security-desktop.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      "PASS SVG/Mermaid image isolation, zoom/themes, untrusted coding lock, widget boundaries, pinned widget frames and protocol traversal",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
