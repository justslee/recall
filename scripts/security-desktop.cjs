const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const repo = path.resolve(__dirname, "..");
const os = require("node:os");
const evidence = path.join(repo, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const { _electron: electron, expect } = require(
  repo + "/node_modules/@playwright/test",
);
const { Store } = require(repo + "/electron/store.cjs");
const { cardLink } = require(repo + "/electron/card-links.cjs");
(async () => {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-security-desktop-"),
  );
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
  const widgetHtml = `<div id="result">pending</div><script>(async()=>{const r={recall:typeof window.recall,node:typeof require};for(const [k,fn] of Object.entries({parent:()=>parent.document.body.innerText,storage:()=>localStorage.length,topNavigation:()=>{top.location='recall://app/blocked-probe';return 'allowed'},popup:()=>window.open('recall://app/blocked-probe')?'opened':'blocked'})){try{r[k]=fn()}catch(e){r[k]=e.name}}try{await fetch('https://recall-security-probe.invalid/');r.network='allowed'}catch(e){r.network=e.name}parent.postMessage({method:'run',args:['audit:svg','python','print(1)'],recallWidget:{height:999999}},'*');document.getElementById('result').textContent=JSON.stringify(r)})();</script>`;
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
      env: { ...process.env, RECALL_DATA_DIR: folder },
      timeout: 30000,
    });
    const p = await app.firstWindow();
    p.setDefaultTimeout(12000);
    const logs = [],
      pageErrors = [];
    p.on("pageerror", (e) => pageErrors.push(e.message));
    p.on("console", (m) => {
      if (m.type() === "error") logs.push(m.text());
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
    result.frameHeight = await p
      .locator("iframe")
      .evaluate((el) => el.style.height);
    result.mainUrlAfterWidget = p.url();
    // A loaded widget may not steer its own frame to another widget document.
    const widgetFrame = p
      .frames()
      .find((f) => f.url().startsWith("recall://widget/"));
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
