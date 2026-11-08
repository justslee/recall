// Real renderer/preload/main-writer journey using only synthetic notebooks in a
// disposable profile. No live library, assistant chat, clipboard or API is used.
const { _electron: electron, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs"),
  { PaperStore } = require("../electron/paper-store.cjs"),
  { saveConfig } = require("../electron/config.cjs"),
  connections = require("../electron/connections.cjs"),
  notebooks = require("../electron/notebook-intake.cjs"),
  inbox = require("../electron/inbox.cjs"),
  contract = require("../shared/handwriting-contract.cjs");
const repo = path.resolve(__dirname, ".."),
  cards = require("../examples/demo.json").cards,
  png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
    "base64",
  ),
  ink = Buffer.from("Synthetic notebook editable PencilKit strokes");
const normalize = (value) => JSON.parse(JSON.stringify(value));
const cardRows = (store) =>
  normalize(store.db.prepare("SELECT * FROM cards ORDER BY id").all());
const reviewRows = (store) =>
  normalize(store.db.prepare("SELECT * FROM reviews ORDER BY id").all());

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-notebooks-ui-")),
    folder = path.join(root, "profile"),
    knowledgeRoot = path.join(root, "synthetic-read-only-knowledge"),
    assistantHome = path.join(root, "synthetic-assistant-home"),
    sourceId = "synthetic-read-only-notes",
    noteId = crypto.randomUUID(),
    pageId = crypto.randomUUID(),
    submissionId = crypto.randomUUID(),
    notebookId = crypto.randomUUID();
  let app;
  try {
    fs.mkdirSync(knowledgeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(knowledgeRoot, "weighted-mean.md"),
      "---\ntitle: Weighted mean\n---\n\nA weighted mean divides the weighted sum by the sum of the weights.\n",
    );
    const fixture = new Store(folder);
    fixture.import(cards);
    saveConfig(folder, {
      captureEnabled: true,
      timeZone: "America/New_York",
      sources: [
        {
          id: sourceId,
          type: "markdown",
          root: knowledgeRoot,
          write: false,
        },
      ],
    });
    connections.connect(folder, "codex", { home: assistantHome, apply: true });
    const paper = new PaperStore(fixture),
      createdAt = new Date().toISOString(),
      drawingHash = contract.digest(ink),
      manifest = {
        version: 3,
        id: submissionId,
        documentId: noteId,
        revision: 1,
        mode: "notebook",
        questionId: null,
        handoffId: null,
        createdAt,
        evaluate: false,
        drawing: null,
        drawings: [
          { sourcePageId: pageId, hash: drawingHash, bytes: ink.length },
        ],
        pages: [0, 1].map((index) => ({
          index,
          hash: contract.digest(png),
          mime: "image/png",
          name: `Synthetic selected page ${index + 1}.png`,
          width: 1,
          height: 1,
          sourcePageId: pageId,
          sourceRevision: 1,
          sourceHash: drawingHash,
        })),
        notebook: {
          id: notebookId,
          title: "Synthetic mathematics notebook",
          noteId,
          noteTitle: "Weighted mean working",
          revision: 1,
          selectedPageIds: [pageId],
          sourcePages: [{ id: pageId, revision: 1, hash: drawingHash }],
          contentHash: contract.digest(noteId + pageId + drawingHash),
        },
      };
    paper.prepare("synthetic-ipad", manifest);
    paper.stage("synthetic-ipad", submissionId, contract.digest(png), png);
    paper.stage("synthetic-ipad", submissionId, drawingHash, ink);
    paper.commit("synthetic-ipad", submissionId);
    notebooks.receive(fixture, paper, paper.attempt(submissionId));
    const before = {
      cards: cardRows(fixture),
      reviews: reviewRows(fixture),
      session: normalize(fixture.get("session", null)),
      snapshot: normalize(fixture.snapshot()),
      knowledge: fs.readFileSync(
        path.join(knowledgeRoot, "weighted-mean.md"),
        "utf8",
      ),
    };
    fixture.close();
    const itemId = notebooks.sourceId(submissionId);
    assert.equal(inbox.read(folder).items.length, 1);
    assert.equal(
      notebooks.inspect(folder, submissionId).receipt.notebook.status,
      "awaiting_assistant",
    );

    app = await electron.launch({
      ...(process.env.RECALL_TEST_EXECUTABLE
        ? { executablePath: process.env.RECALL_TEST_EXECUTABLE, args: [] }
        : { args: [repo] }),
      env: {
        ...process.env,
        RECALL_DATA_DIR: folder,
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
      },
    });
    // Electron's inspector can attach before main has finished loading. Wait
    // for the real renderer before requiring more app modules from the inspector;
    // re-entering startup can capture partially initialized CommonJS exports.
    const main = await app.firstWindow({ timeout: 30000 }),
      errors = [];
    main.on("pageerror", (error) => errors.push(error.message));
    await expect(main.locator(".index-brand")).toBeVisible();
    await app.evaluate(({ app, clipboard, session, shell }) => {
      const require = process.mainModule.require.bind(process.mainModule),
        worker = require(
          require("node:path").join(
            app.getAppPath(),
            "electron/learning-worker.cjs",
          ),
        );
      globalThis.__notebookUIProof = {
        copied: [],
        externalRequests: [],
        shellCalls: [],
        prepareCalls: 0,
        providerCalls: [],
      };
      // A real copy button/IPC is exercised, without replacing the user's
      // system clipboard or opening/dispatching to any assistant conversation.
      clipboard.writeText = (text) =>
        globalThis.__notebookUIProof.copied.push(text);
      clipboard.writeImage = () => {
        throw Error("Clipboard images are outside this notebook journey");
      };
      shell.openExternal = async (url) => {
        globalThis.__notebookUIProof.shellCalls.push(url);
        throw Error("External app dispatch is outside this notebook journey");
      };
      worker.prepare = async () => {
        globalThis.__notebookUIProof.prepareCalls++;
        throw Error("Notebook snapshots require the full assistant workflow");
      };
      globalThis.fetch = async (input) => {
        globalThis.__notebookUIProof.providerCalls.push(String(input));
        throw Error(
          "No provider requests are permitted in this isolated UI journey",
        );
      };
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
        (details, callback) => {
          globalThis.__notebookUIProof.externalRequests.push(details.url);
          callback({ cancel: true });
        },
      );
    });
    await main
      .getByRole("button", { name: "Settings & backups", exact: true })
      .click();
    await main
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await main
      .getByRole("button", { name: "Open preparation queue", exact: true })
      .click();
    await expect(
      main.getByRole("heading", { name: "From your notebooks", exact: true }),
    ).toBeVisible();
    const row = main
      .locator(".notebook-intake-row")
      .filter({ hasText: manifest.notebook.noteTitle });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("status")).toHaveText(
      "Received · awaiting assistant",
    );
    await expect(row.getByText(/2 exported pages/)).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Finish with assistant", exact: true }),
    ).toBeEnabled();
    assert.equal(inbox.read(folder).items[0].status, "pending");

    // The preview reads the exact durable images, supports ordered navigation,
    // traps keyboard focus and restores focus on Escape without changing data.
    await row.getByRole("button", { name: "View pages", exact: true }).click();
    const preview = main.getByRole("dialog", {
      name: "Notebook page preview",
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole("img", { name: "Selected handwritten page 1" }),
    ).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(
      preview.getByText("Page 1 of 2", { exact: true }),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      preview.getByText("Page 2 of 2", { exact: true }),
    ).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();
    await preview
      .getByRole("button", { name: "Previous", exact: true })
      .click();
    await expect(
      preview.getByText("Page 1 of 2", { exact: true }),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Close page preview" }).focus();
    await main.keyboard.press("Shift+Tab");
    await expect(
      preview.getByRole("button", { name: "Next", exact: true }),
    ).toBeFocused();
    await main.keyboard.press("Tab");
    await expect(
      preview.getByRole("button", { name: "Close page preview" }),
    ).toBeFocused();
    await main.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "View pages", exact: true }),
    ).toBeFocused();

    await row
      .getByRole("button", { name: "Finish with assistant", exact: true })
      .click();
    const handoff = main.locator(".assistant-handoff");
    await handoff
      .getByText("Review the prompt and selected context", { exact: true })
      .click();
    const prompt = await handoff
      .getByLabel("Assistant handoff prompt")
      .inputValue();
    assert.ok(prompt.includes(itemId));
    assert.ok(prompt.includes(submissionId));
    assert.ok(prompt.includes(manifest.notebook.contentHash));
    assert.ok(prompt.includes("references/notebooks.md"));
    assert.ok(prompt.includes("untrusted source DATA"));
    assert.ok(prompt.includes("inbox submit"));
    assert.ok(
      prompt.includes("read every selected page") ||
        prompt.includes("Read every selected page"),
    );
    assert.ok(
      fs.existsSync(
        path.join(
          folder,
          "connections/skills/recall-source/references/notebooks.md",
        ),
      ),
    );
    await handoff
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    assert.equal(
      await app.evaluate(() => globalThis.__notebookUIProof.copied.at(-1)),
      prompt,
    );
    assert.equal(
      inbox.read(folder).items[0].status,
      "pending",
      "Copying instructions does not process a notebook or dispatch a message",
    );
    await handoff.getByRole("button", { name: "Done", exact: true }).click();

    // Submit the ordinary public inbox result; the running main process remains
    // the sole SQLite writer. A reused card cannot falsely certify a blocked KB.
    const inspected = notebooks.inspect(folder, submissionId);
    inbox.submit(folder, itemId, {
      reviewedSource: {
        ...inspected.reviewedSource,
        evidence:
          "Synthetic fixture reviewed both selected image pages and checked the existing weighted-mean objective.",
      },
      captures: [
        {
          title: cards[0].title,
          objective: cards[0].authoring.objective,
          context:
            "The explicitly selected notebook snapshot discusses how weights alter an average.",
          at: createdAt,
          sourcePageIndices: [0, 1],
          cardIds: [cards[0].id],
        },
      ],
      knowledge: [
        {
          sourceId,
          status: "read_only",
          reason:
            "This notebook adds a written example, but the chosen KB scope is read-only. Its existing note was preserved; authoring needs explicit user access.",
        },
      ],
    });
    await expect
      .poll(() => inbox.read(folder).items[0].status, { timeout: 20000 })
      .toBe("ready");
    await expect(row.getByRole("status")).toContainText("Needs attention", {
      timeout: 20000,
    });
    await expect(row.getByRole("status")).not.toContainText("Added to Recall");
    await expect(
      row.getByText(/synthetic-read-only-notes: Read-only access/),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Finish with assistant", exact: true }),
    ).toBeEnabled();
    await expect(
      row.getByRole("button", { name: "Open a card · 1 ready", exact: true }),
    ).toBeVisible();
    const partial = notebooks.inspect(folder, submissionId).receipt;
    assert.equal(partial.state, "notebook_needs_attention");
    assert.equal(partial.notebook.status, "needs_attention");
    assert.deepEqual(partial.notebook.cardIds, [cards[0].id]);
    assert.deepEqual(partial.notebook.selectedPageIds, [pageId]);
    await row
      .getByRole("button", { name: "Finish with assistant", exact: true })
      .click();
    await handoff
      .getByText("Review the prompt and selected context", { exact: true })
      .click();
    await expect(handoff.getByLabel("Assistant handoff prompt")).toHaveValue(
      /finish only the remaining KB gaps/,
    );
    await handoff.getByRole("button", { name: "Done", exact: true }).click();

    // Theme and narrow rendering checks remain synthetic evidence, never docs
    // screenshots from the person's actual cards or handwritten notebooks.
    const evidence = path.join(repo, "evidence");
    fs.mkdirSync(evidence, { recursive: true });
    for (const colorScheme of ["light", "dark"]) {
      await main.emulateMedia({ colorScheme });
      await main.setViewportSize({ width: 1320, height: 1000 });
      await main.screenshot({
        path: path.join(evidence, `notebook-intake-${colorScheme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await main.setViewportSize({ width: 780, height: 900 });
    assert.ok(
      await main.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await main.screenshot({
      path: path.join(evidence, "notebook-intake-narrow.png"),
      fullPage: true,
      animations: "disabled",
    });

    // The dedicated Tutor Pad renderer has no notebook-read authority, even
    // when it can access its own tutor pages through the same preload bridge.
    await main.evaluate(() => window.recall.tutorOpen());
    await expect
      .poll(async () =>
        (await app.windows()).some((page) => page.url().endsWith("#tutor-pad")),
      )
      .toBe(true);
    const tutor = (await app.windows()).find((page) =>
      page.url().endsWith("#tutor-pad"),
    );
    const denial = await tutor.evaluate(async (id) => {
      const outcome = async (action) => {
        try {
          await action();
          return "allowed";
        } catch (error) {
          return error.message;
        }
      };
      return {
        notebookPage: await outcome(() => window.recall.notebookPage(id, 0)),
        notebookInspect: await outcome(() => window.recall.notebookInspect(id)),
        paperPage: await outcome(() => window.recall.paperPage(id, 0)),
        attempts: await window.recall.paperAttempts(null),
      };
    }, submissionId);
    assert.match(denial.notebookPage, /Untrusted request/);
    assert.match(denial.notebookInspect, /Untrusted request/);
    assert.match(denial.paperPage, /Choose a Tutor Pad sheet/);
    assert.equal(denial.attempts.length, 0);
    await tutor.close();

    const afterSnapshot = await main.evaluate(() => window.recall.snapshot()),
      proof = await app.evaluate(() => globalThis.__notebookUIProof);
    assert.deepEqual(afterSnapshot.cards, before.snapshot.cards);
    assert.deepEqual(afterSnapshot.history, before.snapshot.history);
    assert.deepEqual(afterSnapshot.session, before.snapshot.session);
    assert.equal(proof.prepareCalls, 0);
    assert.deepEqual(proof.providerCalls, []);
    assert.deepEqual(proof.externalRequests, []);
    assert.deepEqual(proof.shellCalls, []);
    assert.equal(proof.copied.length, 1);
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    const reopened = new Store(folder);
    try {
      assert.deepEqual(
        cardRows(reopened),
        before.cards,
        "All card content and FSRS schedules must remain byte-for-byte unchanged",
      );
      assert.deepEqual(reviewRows(reopened), before.reviews);
      assert.deepEqual(
        normalize(reopened.get("session", null)),
        before.session,
      );
      assert.equal(
        reopened.db.prepare("SELECT count(*) n FROM paper_attempts").get().n,
        1,
      );
      assert.equal(
        reopened.db
          .prepare("SELECT count(*) n FROM paper_tutor_attempt_bindings")
          .get().n,
        0,
      );
      assert.equal(
        reopened.db.prepare("SELECT count(*) n FROM paper_questions").get().n,
        0,
      );
      assert.equal(
        reopened.db.prepare("SELECT count(*) n FROM paper_assets").get().n,
        2,
      );
    } finally {
      reopened.close();
    }
    assert.equal(
      fs.readFileSync(path.join(knowledgeRoot, "weighted-mean.md"), "utf8"),
      before.knowledge,
    );
    console.log(
      "PASS notebook UI: exact immutable received snapshot, ordered page preview/keyboard/focus, full assistant prompt/native-copy without dispatch, real main-writer partial KB receipt, remaining-gap handoff, tutor IPC isolation, themes/narrow layout, no provider calls and unchanged card schedules/reviews/live sessions/read-only KB.",
    );
  } finally {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
