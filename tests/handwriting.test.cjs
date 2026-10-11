const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Store } = require("../electron/store.cjs");
const { PaperStore } = require("../electron/paper-store.cjs");
const { HandwritingService, MODEL } = require("../electron/handwriting.cjs");
const cards = require("../examples/demo.json").cards;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOMsAAAAASUVORK5CYII=",
  "base64",
);
const feedback = () => ({
  verdict: "partial",
  summary: "The weighted sum uses the correct method.",
  strengths: ["Weights match their values."],
  findings: [
    {
      page: 1,
      category: "arithmetic",
      expression: "12 + 7 = 20",
      explanation: "Recheck this addition.",
    },
  ],
  firstMistake: {
    page: 1,
    expression: "12 + 7 = 20",
    explanation: "This visible addition is the first step to revisit.",
  },
  followUp: "What total weight should you divide by?",
});
function response(value, status = "completed") {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        status,
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(value) }],
          },
        ],
      }),
  };
}
function setup(t, options = {}) {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-handwriting-test-"),
  );
  const store = new Store(folder);
  store.import(cards);
  const paper = new PaperStore(store);
  const attempt = paper.import(cards[0].id, [
    { name: "Reasoning.png", mime: "image/png", bytes: PNG },
  ]);
  const events = [],
    calls = [];
  const service = new HandwritingService({
    paper,
    key: () => "synthetic-device-api-credential",
    consent: () => true,
    emit: (event) => events.push(event),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(feedback());
    },
    ...options,
  });
  t.after(() => {
    service.cancel();
    store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { folder, store, paper, attempt, service, calls, events };
}
function history(store) {
  return {
    cards: store.db.prepare("SELECT * FROM cards ORDER BY id").all(),
    reviews: store.db.prepare("SELECT * FROM reviews ORDER BY id").all(),
    session: store.get("session"),
  };
}

test("handwriting sends selected pages and original reference with strict feedback, keeps API credentials out of body and preserves FSRS", async (t) => {
  const f = setup(t);
  f.store.set("session", { id: "retained-session", revealed: false, rated: 0 });
  const before = history(f.store);
  const original = f.paper.reference(f.attempt.manifest.questionId);
  f.store.saveCard({
    ...cards[0],
    prompt: "An edited question",
    answer: "An edited answer",
    status: "ready",
  });
  const edited = history(f.store);
  const result = await f.service.evaluate({ attemptId: f.attempt.id });
  assert.equal(result.status, "feedback_ready");
  assert.equal(result.feedback.referenceHash, original.reference_hash);
  assert.equal(result.feedback.model, MODEL);
  assert.equal(f.calls.length, 1);
  const { url, options } = f.calls[0];
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(options.redirect, "error");
  assert.equal(
    options.headers.Authorization,
    "Bearer " + "synthetic-device-api-credential",
  );
  const body = JSON.parse(options.body);
  assert.equal(body.store, false);
  assert.equal(body.model, "gpt-6-astra");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.type, "json_schema");
  assert(!options.body.includes("synthetic-device-api-credential"));
  const content = body.input[0].content;
  const context = JSON.parse(content[0].text);
  assert.equal(context.question, original.value.prompt);
  assert.equal(context.reference, original.value.answer);
  assert(!options.body.includes("An edited answer"));
  assert.equal(
    content.filter((entry) => entry.type === "input_image").length,
    1,
  );
  assert.equal(
    content[2].image_url,
    "data:image/png;base64," + PNG.toString("base64"),
  );
  assert.equal(content[2].detail, "original");
  assert.match(body.instructions, /alternative methods/);
  assert.match(body.instructions, /unreadable\/ambiguous/);
  assert.match(body.instructions, /Do not reveal/);
  assert.equal(before.session.revealed, false);
  assert.deepEqual(history(f.store), edited);
  assert.equal(f.service.active, null);
  assert.equal(f.events.filter((event) => event.type === "attempt").length, 2);
});

test("evaluation needs explicit consent, a valid model and a complete reference before contacting provider", async (t) => {
  const denied = setup(t, { consent: () => false });
  await assert.rejects(
    denied.service.evaluate({ attemptId: denied.attempt.id }),
    /Enable handwriting feedback/,
  );
  assert.equal(denied.calls.length, 0);
  assert.equal(denied.paper.attempt(denied.attempt.id).status, "received");
  const invalid = setup(t, { model: () => "invalid model with spaces" });
  await assert.rejects(
    invalid.service.evaluate({ attemptId: invalid.attempt.id }),
    /valid handwriting assessment model/,
  );
  assert.equal(invalid.calls.length, 0);
  const incomplete = setup(t);
  const question = incomplete.paper.reference(
    incomplete.attempt.manifest.questionId,
  );
  incomplete.store.db
    .prepare("UPDATE paper_questions SET reference=? WHERE id=?")
    .run(
      JSON.stringify({ ...question.value, answer: "" }),
      incomplete.attempt.manifest.questionId,
    );
  await assert.rejects(
    incomplete.service.evaluate({ attemptId: incomplete.attempt.id }),
    /complete question and reference/,
  );
  assert.equal(incomplete.calls.length, 0);
});

test("tutor sheets cannot be graded against card references", async (t) => {
  const f = setup(t);
  const originalAttempt = f.paper.attempt.bind(f.paper);
  f.paper.attempt = (id) => ({ ...originalAttempt(id), mode: "tutor" });
  await assert.rejects(
    f.service.evaluate({ attemptId: f.attempt.id }),
    /Tutor feedback stays/,
  );
  assert.equal(f.calls.length, 0);
});

test("invalid, out-of-page, refused and incomplete feedback is rejected without leaking raw output", async (t) => {
  const invalidCases = [
    { ...feedback(), findings: [{ ...feedback().findings[0], page: 2 }] },
    { ...feedback(), firstMistake: { ...feedback().firstMistake, page: 0 } },
    { ...feedback(), summary: " " },
    { ...feedback(), followUp: "" },
    { ...feedback(), unknownSecret: "raw-provider-secret" },
    {
      ...feedback(),
      findings: [{ ...feedback().findings[0], explanation: " " }],
    },
  ];
  for (const value of invalidCases) {
    const f = setup(t, { fetchImpl: async () => response(value) });
    await assert.rejects(
      f.service.evaluate({ attemptId: f.attempt.id }),
      /complete, page-linked handwriting feedback/,
    );
    assert.equal(f.paper.attempt(f.attempt.id).status, "failed");
    assert.equal(f.paper.attempt(f.attempt.id).feedback, null);
    assert(
      !JSON.stringify(f.paper.attempt(f.attempt.id)).includes(
        "raw-provider-secret",
      ),
    );
  }
  for (const body of [
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [
        { content: [{ type: "refusal", refusal: "raw-provider-secret" }] },
      ],
    },
  ]) {
    const f = setup(t, {
      fetchImpl: async () => ({
        ok: true,
        text: async () => JSON.stringify(body),
      }),
    });
    await assert.rejects(
      f.service.evaluate({ attemptId: f.attempt.id }),
      /complete, page-linked handwriting feedback/,
    );
  }
});

test("clear alternate-method and unreadable-work feedback remain different outcomes", async (t) => {
  const alternate = setup(t, {
    fetchImpl: async () =>
      response({
        verdict: "solid",
        summary:
          "Your alternative method correctly normalizes the weights first.",
        strengths: ["Valid equivalent method"],
        findings: [],
        firstMistake: null,
        followUp: "Would scaling every weight change the result?",
      }),
  });
  assert.equal(
    (await alternate.service.evaluate({ attemptId: alternate.attempt.id }))
      .feedback.verdict,
    "solid",
  );
  const unclear = setup(t, {
    fetchImpl: async () =>
      response({
        verdict: "unclear",
        summary: "The denominator cannot be read reliably.",
        strengths: [],
        findings: [
          {
            page: 1,
            category: "unclear",
            expression: "[ambiguous denominator]",
            explanation: "Rewrite or clarify this symbol before judging it.",
          },
        ],
        firstMistake: null,
        followUp: "Is your denominator three or eight?",
      }),
  });
  const result = await unclear.service.evaluate({
    attemptId: unclear.attempt.id,
  });
  assert.equal(result.feedback.verdict, "unclear");
  assert.equal(result.feedback.firstMistake, null);
  assert.equal(result.feedback.findings[0].category, "unclear");
});

test("provider authentication, rate limit and model errors are bounded and never silently retried or downgraded", async (t) => {
  for (const [status, pattern] of [
    [401, /rejected your API key/],
    [429, /usage or rate limit/],
    [403, /configured handwriting model is unavailable/],
    [404, /configured handwriting model is unavailable/],
    [500, /could not complete/],
  ]) {
    let calls = 0;
    const f = setup(t, {
      model: () => "explicit-model",
      fetchImpl: async (_url, options) => {
        calls++;
        assert.equal(JSON.parse(options.body).model, "explicit-model");
        return {
          ok: false,
          status,
          text: async () => {
            throw new Error("Raw provider content must not be read");
          },
        };
      },
    });
    await assert.rejects(
      f.service.evaluate({ attemptId: f.attempt.id }),
      pattern,
    );
    assert.equal(calls, 1);
    assert.equal(f.paper.attempt(f.attempt.id).status, "failed");
    assert.equal(f.paper.pages(f.attempt.id).length, 1);
  }
});

test("serialization and cancellation preserve pages and require manual retry after uncertain completion", async (t) => {
  let requests = 0,
    started;
  const didStart = new Promise((resolve) => {
    started = resolve;
  });
  const f = setup(t, {
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        requests++;
        started();
        signal.addEventListener(
          "abort",
          () => reject(new Error("synthetic provider interruption")),
          { once: true },
        );
      }),
  });
  const before = history(f.store);
  const pending = f.service.evaluate({ attemptId: f.attempt.id });
  await didStart;
  assert.equal(f.paper.attempt(f.attempt.id).status, "evaluating");
  await assert.rejects(
    f.service.evaluate({ attemptId: f.attempt.id }),
    /Another handwriting evaluation/,
  );
  f.service.cancel();
  await assert.rejects(pending, /provider may already have processed/);
  assert.equal(requests, 1);
  assert.equal(f.paper.attempt(f.attempt.id).status, "interrupted");
  assert.equal(f.service.active, null);
  assert.deepEqual(f.paper.pages(f.attempt.id)[0].bytes, PNG);
  assert.deepEqual(history(f.store), before);
});

test("timeout and late response cannot convert an interrupted assessment to success", async (t) => {
  const f = setup(t, {
    timeoutMs: 5,
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return response(feedback());
    },
  });
  await assert.rejects(
    f.service.evaluate({ attemptId: f.attempt.id }),
    /interrupted/,
  );
  assert.equal(f.paper.attempt(f.attempt.id).feedback, null);
  assert.equal(f.paper.attempt(f.attempt.id).status, "interrupted");
});

test("explicit retries preserve earlier feedback and the original reference, including a later failure", async (t) => {
  const f = setup(t);
  const before = history(f.store);
  const original = f.paper.reference(f.attempt.manifest.questionId);
  const first = await f.service.evaluate({ attemptId: f.attempt.id });
  const secondFeedback = {
    ...feedback(),
    verdict: "solid",
    summary: "The equivalent method is valid.",
    findings: [],
    firstMistake: null,
  };
  f.service.fetchImpl = async () => response(secondFeedback);
  const second = await f.service.evaluate({ attemptId: f.attempt.id });
  assert.equal(second.assessments.length, 2);
  assert.notEqual(second.assessments[0].id, first.assessments[0].id);
  assert.equal(second.assessments[0].feedback.verdict, "solid");
  assert.deepEqual(second.assessments[1].feedback, first.feedback);
  assert.equal(second.feedback.referenceHash, original.reference_hash);
  f.service.fetchImpl = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    f.service.evaluate({ attemptId: f.attempt.id }),
    /OpenAI usage or rate limit/,
  );
  const failed = f.paper.attempt(f.attempt.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.assessments.length, 3);
  assert.equal(failed.assessments[0].status, "failed");
  assert.equal(failed.assessments[0].feedback, null);
  assert.deepEqual(failed.assessments[1].feedback, second.feedback);
  assert.deepEqual(failed.assessments[2].feedback, first.feedback);
  assert.deepEqual(f.paper.pages(failed.id)[0].bytes, PNG);
  assert.deepEqual(history(f.store), before);
});
