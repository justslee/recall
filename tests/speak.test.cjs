const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Store } = require("../electron/store.cjs");
const { VoiceService } = require("../electron/voice.cjs");
const {
  SpeakService,
  AcousticAnalysis,
  textMetrics,
} = require("../electron/speak.cjs");
const { saveConfig } = require("../electron/config.cjs");
const backup = require("../electron/backup.cjs");
const card = require("../examples/demo.json").cards[0];
class Socket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.bufferedAmount = 0;
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  terminate() {
    this.emit("close");
  }
  receive(event) {
    this.emit("message", Buffer.from(JSON.stringify(event)));
  }
}
function feedback(referenceId, quote = "An average with weights") {
  return {
    outcome: "partial",
    summary: "A sound start; explain normalization.",
    dimensions: ["accuracy", "depth", "structure", "audience"].map((id) => ({
      id,
      label: id,
      level: "developing",
      evidence: quote,
      feedback: "Connect each weight to its relative contribution.",
    })),
    strengths: ["Identifies an average."],
    improvements: [
      {
        quote,
        advice: "Explain dividing by total weight.",
        referenceIds: [referenceId],
      },
    ],
    followUp: "What if all weights double?",
    sampleExplanation: "Each value contributes in proportion to its weight.",
    sourceCaveat: "Grounded only in the selected reference.",
    coaching: {
      focus: "mechanism",
      rationale: "The listener needs to know why total weight matters.",
      quote,
      revision: "Each value contributes in proportion to its weight.",
      referenceIds: referenceId ? [referenceId] : [],
      drill: {
        kind: "repair_gap",
        audience: "same",
        instructions: "Explain what happens when every weight doubles.",
        successChecks: [
          "Connect the numerator and denominator to the same scaling factor.",
        ],
      },
    },
  };
}
function result(value) {
  return {
    ok: true,
    text: async () =>
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(value) }],
          },
        ],
      }),
  };
}
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-speak-"));
  const store = new Store(path.join(root, "profile"));
  store.import([card]);
  let socket;
  const voice = new VoiceService({
    folder: store.folder,
    safeStorage: { isEncryptionAvailable: () => true },
    card: () => card,
    env: { OPENAI_API_KEY: "sk-synthetic-test-only" },
    emit() {},
    socketFactory: () => (socket = new Socket()),
  });
  const speak = new SpeakService({ store, voice });
  t.after(() => {
    speak.cancel();
    voice.cancel();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = speak.sources().sources[0];
  const config = speak.preview({
    sourceId: source.id,
    audience: "general",
    targetSeconds: 60,
    drill: "explain",
  });
  return { root, store, voice, speak, config, socket: () => socket };
}
function pcm(seconds, amplitude = 0) {
  const bytes = new Uint8Array(Math.round(seconds * 24000) * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < bytes.length; i += 2) view.setInt16(i, amplitude, true);
  return bytes;
}
function append(voice, token, bytes) {
  for (let i = 0; i < bytes.length; i += 4800)
    voice.append(token, bytes.slice(i, i + 4800));
}
async function recorded(
  f,
  transcript = "um An average with weights like a course grade",
) {
  f.speak.prepare(f.config);
  const pending = f.speak.start(f.config, "recorded");
  f.socket().emit("open");
  assert.equal(
    f.socket().sent[0].session.audio.input.transcription.delay,
    "medium",
  );
  assert.match(
    f.socket().sent[0].session.audio.input.transcription.prompt,
    /Preserve spoken fillers/,
  );
  f.socket().receive({ type: "session.updated" });
  await pending;
  append(f.voice, "recorded", pcm(1, 7000));
  append(f.voice, "recorded", pcm(1));
  append(f.voice, "recorded", pcm(1, 7000));
  const done = f.voice.finish("recorded");
  f.socket().receive({
    type: "input_audio_buffer.committed",
    item_id: "one",
    previous_item_id: null,
  });
  f.socket().receive({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "one",
    transcript,
  });
  return done;
}
test("local pause estimates are chunk independent, exclude boundary silence and distinguish ambiguous fillers", () => {
  const all = new Uint8Array([
    ...pcm(1),
    ...pcm(1, 7000),
    ...pcm(1),
    ...pcm(1, 7000),
    ...pcm(1),
  ]);
  const whole = new AcousticAnalysis();
  whole.append(all);
  const chunks = new AcousticAnalysis();
  for (let i = 0; i < all.length; i += 638)
    chunks.append(all.slice(i, i + 638));
  assert.deepEqual(chunks.result(), whole.result());
  assert.equal(whole.result().pauseCount, 1);
  assert.equal(whole.result().longestPauseSeconds, 1);
  const metrics = textMetrics(
    "Um I like apples. Uh, you know, an example.",
    whole.result(),
  );
  assert.equal(metrics.fillerCount, 2);
  assert.equal(metrics.candidateFillerCount, 2);
  assert.ok(metrics.fillers.find((item) => item.term === "like").ambiguous);
  assert.equal(textMetrics("A typed answer").wordsPerMinute, null);
  const brief = new AcousticAnalysis();
  brief.append(pcm(0.5, 7000));
  const shortMetrics = textMetrics(
    "An artificially long transcript for this short clip",
    brief.result(),
  );
  assert.equal(shortMetrics.wordsPerMinute, null);
  assert.match(shortMetrics.signalNote, /too short/);
  const boundary = new AcousticAnalysis();
  boundary.append(pcm(1, 7000));
  boundary.append(pcm(0.8));
  boundary.append(pcm(1, 7000));
  assert.equal(boundary.result().pauseCount, 1);
});
test("sources stay scoped, references omit code, and stale source revisions require a fresh preview", (t) => {
  const f = setup(t);
  const notes = path.join(f.root, "notes");
  fs.mkdirSync(notes);
  fs.writeFileSync(
    path.join(notes, "average.md"),
    "# Average\nA finite sum divided by the number of values.",
  );
  saveConfig(f.store.folder, {
    sources: [{ id: "kb", type: "markdown", root: notes }],
  });
  f.speak.loadSources(true);
  const sources = f.speak.sources().sources;
  assert.ok(sources.some((source) => source.kind === "knowledge"));
  assert.ok(
    sources.every((source) => !JSON.stringify(source).includes(f.root)),
  );
  assert.doesNotMatch(
    f.config.reference.text,
    /document.getElementById|<script>/,
  );
  const changed = { ...card, answer: "Different reference" };
  f.store.db
    .prepare("UPDATE cards SET content=? WHERE id=?")
    .run(JSON.stringify(changed), card.id);
  assert.throws(() => f.speak.prepare(f.config), /reference changed/);
  assert.throws(
    () => f.speak.preview({ ...f.config, sourceId: "../../credentials" }),
    /Choose a topic/,
  );
});
test("completed audio persists trusted metrics across service restart and draft cannot forge them", async (t) => {
  const f = setup(t);
  const done = await recorded(f);
  assert.equal(done.metrics.pauseCount, 1);
  assert.equal(done.metrics.fillerCount, 1);
  f.voice.cancel("recorded");
  const reloaded = new SpeakService({ store: f.store, voice: f.voice });
  const draft = reloaded.saveDraft({
    config: f.config,
    transcript: "An average with weights",
    recordingToken: "recorded",
    originalTranscript: "forged",
    metrics: { fillerCount: 0 },
    stage: "transcript",
  });
  assert.equal(draft.originalTranscript, done.text);
  assert.equal(draft.metrics.fillerCount, 1);
  assert.equal(reloaded.draft().recordingToken, "recorded");
  const typed = reloaded.saveDraft({
    config: f.config,
    transcript: "Text",
    recordingToken: "forged",
    metrics: done.metrics,
  });
  assert.equal(typed.recordingToken, null);
  assert.equal(typed.metrics, null);
  assert.equal(f.voice.active, null);
});
test("grounded feedback stores both transcripts, survives full backup, and never changes scheduling", async (t) => {
  const f = setup(t);
  await recorded(f);
  const before = f.store.db.prepare("SELECT * FROM cards").all();
  let request;
  f.speak.fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.redirect, "error");
    request = JSON.parse(options.body);
    return result(feedback(f.config.reference.id));
  };
  const attempt = await f.speak.evaluate(
    {
      config: f.config,
      transcript: "An average with weights",
      recordingToken: "recorded",
    },
    "evaluate",
  );
  assert.equal(attempt.metrics.fillerCount, 1);
  assert.match(attempt.originalTranscript, /^um/);
  assert.equal(request.store, false);
  assert.doesNotMatch(
    request.input,
    /sk-synthetic|<script>|document.getElementById/,
  );
  assert.equal(JSON.parse(request.input).reference.id, f.config.reference.id);
  assert.equal(attempt.feedback.rubricVersion, "articulation-1");
  assert.deepEqual(
    attempt.feedback.coaching,
    feedback(f.config.reference.id).coaching,
  );
  assert.equal(
    JSON.parse(request.input).learnerText,
    "An average with weights",
  );
  assert.equal(JSON.parse(request.input).delivery.fillerCount, 1);
  assert.equal(
    Object.hasOwn(JSON.parse(request.input), "originalTranscript"),
    false,
  );
  assert.match(request.instructions, /main point is identifiable early/);
  assert.match(
    request.instructions,
    /A shorter explanation is not automatically better/,
  );
  assert.match(request.instructions, /Typed input has no recorded delivery/);
  assert.match(request.instructions, /No universal ideal words-per-minute/);
  assert.match(
    request.instructions,
    /Do not make filler removal the coaching priority from counts alone/,
  );
  assert.deepEqual(f.store.db.prepare("SELECT * FROM cards").all(), before);
  assert.equal(
    f.store.db.prepare("SELECT count(*) AS n FROM reviews").get().n,
    0,
  );
  assert.equal(f.speak.history()[0].id, attempt.id);
  assert.deepEqual(f.speak.attempt(attempt.id), attempt);
  const saved = backup.backup(f.store, path.join(f.root, "backup"));
  const restored = path.join(f.root, "restored");
  backup.restore(restored, saved.backup);
  const other = new Store(restored);
  assert.deepEqual(other.get("speak:attempt:" + attempt.id), attempt);
  other.close();
  assert.equal(f.speak.delete(attempt.id), true);
  assert.equal(f.speak.history().length, 0);
});
test("provider hallucinated quotes, unsupported reference IDs and duplicate dimensions fail without losing draft", async (t) => {
  const f = setup(t);
  for (const mutate of [
    (value) => {
      value.improvements[0].quote = "I never said this";
    },
    (value) => {
      value.improvements[0].referenceIds = ["other-source"];
    },
    (value) => {
      value.dimensions[3].id = "accuracy";
    },
    (value) => {
      value.coaching.quote = "um An average with weights";
    },
    (value) => {
      value.coaching.referenceIds = ["other-source"];
    },
    (value) => {
      value.coaching.focus = "pronunciation";
    },
    (value) => {
      value.coaching.drill.kind = "eliminate_all_fillers";
    },
    (value) => {
      value.coaching.drill.kind = "audience_switch";
    },
    (value) => {
      value.coaching.drill.audience = "peer";
    },
    (value) => {
      value.coaching.drill.successChecks = [];
    },
    (value) => {
      value.coaching.drill.successChecks = [" "];
    },
    (value) => {
      value.coaching.revision = "x".repeat(1501);
    },
    (value) => {
      value.coaching.focus = "accuracy";
      value.coaching.referenceIds = [];
    },
    (value) => {
      delete value.coaching;
    },
  ]) {
    const value = feedback(f.config.reference.id);
    mutate(value);
    f.speak.fetchImpl = async () => result(value);
    await assert.rejects(
      f.speak.evaluate(
        { config: f.config, transcript: "An average with weights" },
        "evaluate",
      ),
      /source-linked feedback/,
    );
    assert.equal(f.speak.history().length, 0);
    assert.equal(f.speak.draft().transcript, "An average with weights");
  }
});
test("focused retries send only the saved practice objective and audience-switch uses the new listener", async (t) => {
  const f = setup(t);
  const value = feedback(f.config.reference.id);
  value.coaching.focus = "audience_fit";
  value.coaching.drill.kind = "audience_switch";
  value.coaching.drill.audience = "peer";
  value.coaching.drill.instructions =
    "Explain the same idea to a technical peer, making normalization explicit.";
  f.speak.fetchImpl = async () => result(value);
  const first = await f.speak.evaluate(
    { config: f.config, transcript: "An average with weights" },
    "first",
  );
  let request;
  f.speak.fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return result(feedback(f.config.reference.id));
  };
  await assert.rejects(
    f.speak.evaluate(
      {
        config: f.config,
        transcript: "An average with weights",
        practiceAttemptId: first.id,
      },
      "wrong-audience",
    ),
    /no longer matches/,
  );
  const nextConfig = f.speak.preview({ ...f.config, audience: "peer" });
  const next = await f.speak.evaluate(
    {
      config: nextConfig,
      transcript: "An average with weights",
      practiceAttemptId: first.id,
    },
    "retry",
  );
  const input = JSON.parse(request.input);
  assert.deepEqual(input.practice, {
    focus: first.feedback.coaching.focus,
    drill: first.feedback.coaching.drill,
  });
  assert.equal(Object.hasOwn(input.practice, "transcript"), false);
  assert.equal(Object.hasOwn(input.practice, "revision"), false);
  assert.equal(next.practiceAttemptId, first.id);
  assert.equal(next.config.audience, "peer");
  const changed = f.speak.preview({ ...nextConfig, targetSeconds: 30 });
  await assert.rejects(
    f.speak.evaluate(
      {
        config: changed,
        transcript: "An average with weights",
        practiceAttemptId: first.id,
      },
      "changed-retry",
    ),
    /no longer matches/,
  );
  await assert.rejects(
    f.speak.evaluate(
      {
        config: nextConfig,
        transcript: "An average with weights",
        practiceAttemptId: "missing",
      },
      "missing-retry",
    ),
    /attempt|session/i,
  );
  assert.equal(f.speak.history().length, 2);
  assert.equal(
    f.store.db.prepare("SELECT count(*) AS n FROM reviews").get().n,
    0,
  );
});
test("focused drills support omissions and wording-only advice without rewriting older attempts", async (t) => {
  const f = setup(t);
  const value = feedback(f.config.reference.id);
  value.coaching.quote = "";
  value.coaching.focus = "main_point";
  value.coaching.referenceIds = [];
  value.coaching.drill.kind = "main_point_first";
  f.speak.fetchImpl = async () => result(value);
  const attempt = await f.speak.evaluate(
    { config: f.config, transcript: "An average with weights" },
    "focused",
  );
  assert.equal(attempt.metrics.method, "typed");
  assert.equal(attempt.metrics.pauseCount, null);
  assert.equal(attempt.feedback.coaching.quote, "");
  assert.deepEqual(attempt.config, f.config);

  const historical = structuredClone(attempt);
  delete historical.feedback.coaching;
  delete historical.feedback.rubricVersion;
  f.store.set("speak:attempt:" + attempt.id, historical);
  const restarted = new SpeakService({ store: f.store, voice: f.voice });
  assert.deepEqual(restarted.attempt(attempt.id), historical);
  assert.equal(restarted.history()[0].id, attempt.id);
  const saved = backup.backup(f.store, path.join(f.root, "historical-backup"));
  const restored = path.join(f.root, "historical-restored");
  backup.restore(restored, saved.backup);
  const other = new Store(restored);
  assert.deepEqual(other.get("speak:attempt:" + attempt.id), historical);
  other.close();
});
test("cancellation, changed recording config and concurrent modes cannot produce an attempt", async (t) => {
  const f = setup(t);
  await recorded(f);
  const changed = f.speak.preview({ ...f.config, audience: "peer" });
  await assert.rejects(
    f.speak.evaluate(
      { config: changed, transcript: "Text", recordingToken: "recorded" },
      "wrong",
    ),
    /no longer matches/,
  );
  f.speak.fetchImpl = async (_url, { signal }) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(Error("aborted")), {
        once: true,
      }),
    );
  const pending = f.speak.evaluate(
    {
      config: f.config,
      transcript: "An average with weights",
      recordingToken: "recorded",
    },
    "pending",
  );
  assert.throws(
    () => f.speak.prepare(f.config),
    /current recording or evaluation/,
  );
  f.speak.cancel("pending");
  await assert.rejects(pending, /stopped or timed out/);
  assert.equal(f.speak.history().length, 0);
  assert.equal(f.speak.draft().recordingToken, "recorded");
});

test("imported entity titles and references become bounded readable plain text", (t) => {
  const f = setup(t);
  const imported = {
    ...card,
    id: "entity-title",
    title:
      "<b>&#x27;Democrats&#39;</b> &amp; P&amp;L &quot;today&quot; &apos;quoted&apos;",
    prompt: "Explain &quot;P&amp;L&quot; and &#x27;quotes&#39;.",
    answer:
      "<p>Already literal \"quotes\" and 'apostrophes'. &lt;literal&gt; remains text. Invalid &#x110000; &#xD800;.</p><script>doNotSend()</script>",
  };
  f.store.import([imported]);
  f.speak.loadSources(true);
  const found = f.speak.sources("democrats").sources[0];
  assert.equal(found.title, "'Democrats' & P&L \"today\" 'quoted'");
  const config = f.speak.preview({ ...f.config, sourceId: found.id });
  assert.match(config.reference.text, /Explain "P&L" and 'quotes'/);
  assert.match(
    config.reference.text,
    /Already literal "quotes" and 'apostrophes'/,
  );
  assert.match(config.reference.text, /<literal> remains text/);
  assert.match(config.reference.text, /Invalid &#x110000; &#xD800;/);
  assert.doesNotMatch(config.reference.text, /doNotSend|<p>/);
});

function customConfig(service, extra = {}) {
  return service.preview({
    sourceId: "custom",
    customTitle: "A data platform",
    customBrief: "Explain the whole architecture",
    customReference: "",
    audience: "peer",
    targetSeconds: 900,
    drill: "presentation",
    ...extra,
  });
}
test("custom topics use persistent canonical previews and validate long presentation bounds", (t) => {
  const f = setup(t);
  const config = customConfig(f.speak);
  assert.equal(config.maxSeconds, 900);
  assert.equal(config.maxText, 40000);
  assert.equal(config.grounding, "none");
  assert.equal(config.reference.text, "");
  assert.match(config.prompt, /data or control flow/);
  f.speak.saveDraft({
    config,
    transcript: "A".repeat(20000),
    stage: "transcript",
  });
  const restarted = new SpeakService({ store: f.store, voice: f.voice });
  assert.deepEqual(restarted.checkedConfig(config), config);
  assert.throws(
    () => restarted.prepare({ ...config, customTitle: "Forged title" }),
    /changed or expired/,
  );
  assert.throws(
    () => customConfig(f.speak, { targetSeconds: 1800 }),
    /Choose a topic/,
  );
  assert.throws(
    () => customConfig(f.speak, { customTitle: "x".repeat(301) }),
    /too long/,
  );
  assert.throws(
    () => customConfig(f.speak, { customReference: "x".repeat(24001) }),
    /too long/,
  );
  assert.throws(
    () => f.speak.saveDraft({ config, transcript: "x".repeat(40001) }),
    /too long/,
  );
  for (let i = 0; i < 25; i++)
    customConfig(f.speak, { customTitle: "Topic " + i });
  assert.equal(f.store.get("speak:custom-configs").length, 20);
  assert.throws(() => f.speak.prepare(config), /changed or expired/);
});
test("no-reference custom feedback cannot claim grounded accuracy or invent reference links", async (t) => {
  const f = setup(t);
  const config = customConfig(f.speak);
  let request;
  const answer = "An average with weights";
  const response = feedback("");
  response.outcome = "grounded";
  response.improvements[0].referenceIds = [];
  response.dimensions[0].level = "strong";
  f.speak.fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return result(response);
  };
  const attempt = await f.speak.evaluate(
    { config, transcript: answer },
    "no-reference",
  );
  assert.match(request.instructions, /NO REFERENCE WAS SUPPLIED/);
  assert.match(request.instructions, /do not introduce new factual claims/);
  assert.match(request.instructions, /coaching.focus cannot be accuracy/);
  assert.deepEqual(attempt.feedback.coaching.referenceIds, []);
  assert.equal(attempt.feedback.outcome, "insufficient_reference");
  assert.equal(
    attempt.feedback.dimensions.find((item) => item.id === "accuracy").level,
    "unassessable",
  );
  assert.match(
    attempt.feedback.sourceCaveat,
    /factual accuracy has not been verified/,
  );
  response.improvements[0].referenceIds = [""];
  await assert.rejects(
    f.speak.evaluate({ config, transcript: answer }, "bad-links"),
    /source-linked/,
  );
  response.improvements[0].referenceIds = [];
  response.coaching.focus = "accuracy";
  await assert.rejects(
    f.speak.evaluate({ config, transcript: answer }, "bad-coaching"),
    /source-linked/,
  );
  assert.equal(f.speak.history().length, 1);
  assert.equal(f.speak.draft().transcript, answer);
});
test("provided custom references are explicit and never represented as verified KB truth", async (t) => {
  const f = setup(t);
  const config = customConfig(f.speak, {
    customReference: "Weighted averages divide by total weight.",
    targetSeconds: 300,
  });
  assert.equal(config.grounding, "user_reference");
  assert.equal(config.reference.verified, false);
  let request;
  f.speak.fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return result(feedback(config.reference.id));
  };
  const attempt = await f.speak.evaluate(
    { config, transcript: "An average with weights" },
    "provided-reference",
  );
  assert.equal(
    JSON.parse(request.input).reference.text,
    "Weighted averages divide by total weight.",
  );
  assert.match(
    attempt.feedback.sourceCaveat,
    /provided reference.*not independently verified/,
  );
  assert.equal(
    f.store.db.prepare("SELECT count(*) AS n FROM reviews").get().n,
    0,
  );
});
test("old library recording receipts remain compatible with added presentation metadata", async (t) => {
  const f = setup(t);
  await recorded(f);
  const receipt = f.store.get("speak:recording:recorded");
  delete receipt.config.maxSeconds;
  delete receipt.config.maxText;
  delete receipt.config.grounding;
  f.store.set("speak:recording:recorded", receipt);
  assert.equal(f.speak.recording("recorded", f.config).token, "recorded");
});

test("custom briefs and architecture references preserve paragraphs and code as untrusted data", async (t) => {
  const f = setup(t);
  const customBrief = "Explain the request path.\n\nThen discuss a failure.";
  const customReference =
    "# Components\nThe journal stores frames.\n\n```python\nappend(frame)\nfsync()\n```\n<script>untrustedReference()</script>";
  const config = customConfig(f.speak, { customBrief, customReference });
  assert.equal(config.customBrief, customBrief);
  assert.equal(config.reference.text, customReference);
  assert.doesNotMatch(config.prompt, /Brief:|request path/);
  let body;
  f.speak.fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    return result(feedback(config.reference.id));
  };
  await f.speak.evaluate(
    { config, transcript: "An average with weights" },
    "multiline",
  );
  const input = JSON.parse(body.input);
  assert.equal(input.customBrief, customBrief);
  assert.equal(input.reference.text, customReference);
  assert.doesNotMatch(body.instructions, /untrustedReference|request path/);
});
