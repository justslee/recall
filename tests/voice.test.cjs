const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  VoiceService,
  referenceText,
  allowsMicrophone,
} = require("../electron/voice.cjs");
const { Store } = require("../electron/store.cjs");
const card = require("../examples/demo.json").cards[0];
const feedback = {
  verdict: "partial",
  summary: "Weights change the contribution.",
  strengths: ["Explains relative importance"],
  gaps: ["Explain normalization"],
  followUp: "What if every weight is doubled?",
};
class Socket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.bufferedAmount = 0;
  }
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  terminate() {
    this.terminated = true;
    this.emit("close");
  }
  receive(value) {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }
}
function setup(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-voice-test-"));
  let socket;
  const events = [];
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from("test-encrypted:" + s),
    decryptString: (b) => b.toString().replace("test-encrypted:", ""),
  };
  const service = new VoiceService({
    folder,
    safeStorage,
    card: () => card,
    emit: (e) => events.push(e),
    env: { OPENAI_API_KEY: "sk-test-key-not-real" },
    socketFactory: (url, opts) => {
      assert.equal(
        url,
        "wss://api.openai.com/v1/realtime?intent=transcription",
      );
      assert.equal(opts.followRedirects, false);
      return (socket = new Socket());
    },
    ...options,
  });
  t.after(() => {
    service.cancel();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { service, folder, events, socket: () => socket };
}
async function connected(f) {
  f.service.prepare(card.id);
  const pending = f.service.start(card.id, "test-token");
  f.socket().emit("open");
  assert.equal(
    f.socket().sent[0].session.audio.input.transcription.model,
    "gpt-live-transcribe",
  );
  assert.equal(f.socket().sent[0].session.audio.input.turn_detection, null);
  f.socket().receive({ type: "session.updated" });
  await pending;
}
test("dictation waits for configuration, streams PCM, replaces partial text and closes after commit", async (t) => {
  const f = setup(t);
  await connected(f);
  f.service.append("test-token", new Uint8Array(4800));
  f.socket().receive({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "one",
    delta: "A weighted",
  });
  f.socket().receive({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "other",
    delta: "wrong turn",
  });
  const done = f.service.finish("test-token");
  assert.equal(f.socket().sent.at(-1).type, "input_audio_buffer.commit");
  f.socket().receive({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "one",
    transcript: "A weighted mean.",
  });
  assert.deepEqual(await done, { text: "A weighted mean." });
  assert.deepEqual(
    f.events.map((e) => e.text),
    ["A weighted", "A weighted mean."],
  );
  assert.equal(f.service.active, null);
  assert.equal(f.socket().terminated, true);
});
test("cancellation during connection and disconnect during finalization reject without losing partial events", async (t) => {
  const f = setup(t);
  const pending = f.service.start(card.id, "early");
  f.service.cancel("early");
  await assert.rejects(pending, /cancelled/);
  await connected(f);
  f.service.append("test-token", new Uint8Array(4800));
  const done = f.service.finish("test-token");
  f.socket().emit("close");
  await assert.rejects(done, /partial transcript/);
  assert.equal(f.service.active, null);
});
test("invalid audio, stale tokens, and congestion cannot continue a stream", async (t) => {
  const f = setup(t);
  await connected(f);
  assert.throws(
    () => f.service.append("old-token", new Uint8Array(100)),
    /not recording/,
  );
  assert.throws(
    () => f.service.append("test-token", new Uint8Array(17000)),
    /Invalid audio/,
  );
  f.socket().bufferedAmount = 600000;
  assert.throws(
    () => f.service.append("test-token", new Uint8Array(4800)),
    /stopped/,
  );
  assert.equal(f.service.active, null);
});
test("provider failures never echo a key or server body", async (t) => {
  const f = setup(t);
  const pending = f.service.start(card.id, "failure");
  f.socket().receive({
    type: "error",
    error: { code: "invalid_api_key", message: "secret sk-private" },
  });
  await assert.rejects(pending, /rejected the API key/);
  assert.doesNotMatch(JSON.stringify(f.events), /sk-private/);
});
test("microphone permissions require an armed trusted main frame and audio only", () => {
  const good = {
    trustedWindow: true,
    armed: true,
    permission: "media",
    details: {
      isMainFrame: true,
      requestingUrl: "recall://app/",
      mediaTypes: ["audio"],
    },
  };
  assert.equal(allowsMicrophone(good), true);
  for (const overrides of [
    { armed: false },
    { trustedWindow: false },
    { permission: "display-capture" },
    { details: { ...good.details, isMainFrame: false } },
    { details: { ...good.details, requestingUrl: "recall://widget/x" } },
    { details: { ...good.details, mediaTypes: ["audio", "video"] } },
  ])
    assert.equal(allowsMicrophone({ ...good, ...overrides }), false);
});
test("key settings expose no secret and fail closed without encryption", (t) => {
  const f = setup(t, { env: {} });
  f.service.configure("sk-fixture-test-only");
  assert.equal(f.service.status().source, "saved");
  assert.doesNotMatch(JSON.stringify(f.service.status()), /valid-looking/);
  assert.equal(fs.statSync(f.service.keyFile).mode & 0o777, 0o600);
  assert.equal(f.service.key(), "sk-fixture-test-only");
  f.service.configure("");
  assert.equal(f.service.status().configured, false);
  f.service.safeStorage.isEncryptionAvailable = () => false;
  assert.throws(
    () => f.service.configure("sk-fixture-test-only"),
    /Secure key storage/,
  );
});
test("assessment sends only this card's text and validated history, preserving library and schedules", async (t) => {
  let body;
  const f = setup(t, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      body = JSON.parse(options.body);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  { type: "output_text", text: JSON.stringify(feedback) },
                ],
              },
            ],
          }),
      };
    },
  });
  const store = new Store(f.folder);
  store.import([card]);
  t.after(() => store.close());
  f.service.card = (id) => JSON.parse(store.card(id).content);
  const before = store.db.prepare("SELECT * FROM cards").all();
  const result = await f.service.evaluate(
    card.id,
    "It gives different contributions",
    [],
    "assessment",
  );
  assert.equal(result.verdict, "partial");
  assert.equal(body.store, false);
  assert.equal(body.model, "gpt-6-luna");
  assert.doesNotMatch(body.input, /<script>|widget|source|sk-test/);
  assert.deepEqual(store.db.prepare("SELECT * FROM cards").all(), before);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM reviews").get().n,
    0,
  );
  await f.service.evaluate(
    card.id,
    "The average stays the same",
    [{ answer: "Different importance", feedback }],
    "follow-up",
  );
  assert.equal(JSON.parse(body.input).priorAttempts.length, 1);
  await assert.rejects(
    f.service.evaluate(card.id, "x", [{ answer: "x", feedback: {} }]),
    /history/,
  );
});
test("refusals, incomplete and invalid assessments are errors, not passing grades", async (t) => {
  let output = { status: "incomplete" };
  const f = setup(t, {
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify(output),
    }),
  });
  await assert.rejects(
    f.service.evaluate(card.id, "my answer"),
    /complete assessment/,
  );
  output = {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: '{"verdict":"solid"}' }],
      },
    ],
  };
  await assert.rejects(
    f.service.evaluate(card.id, "my answer"),
    /complete assessment/,
  );
  assert.equal(f.service.assessment, null);
});
test("reference extraction excludes executable visual sources without dropping prose or math", () => {
  const result = referenceText(
    "<p>Average \\(x\\)</p><script>secret()</script>\n```widget Demo\nsource code\n```<svg>image</svg>",
  );
  assert.equal(result, "Average \\(x\\)");
});

test("cancelling during microphone permission stops a late-arriving stream", async () => {
  const { VoiceRecorder } = await import("../src/voice-recorder.js");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let deliverStream,
    stopped = 0,
    starts = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((resolve) => {
            deliverStream = resolve;
          }),
      },
    },
  });
  try {
    const recorder = new VoiceRecorder(
      {
        onVoiceEvent: () => () => {},
        voicePrepare: async () => {},
        voiceCancel: async () => {},
        voiceStart: async () => {
          starts++;
        },
      },
      card.id,
      { onText() {}, onError() {} },
    );
    const pending = recorder.start();
    await Promise.resolve();
    recorder.cancel();
    deliverStream({
      getTracks: () => [
        {
          stop: () => {
            stopped++;
          },
        },
      ],
    });
    await assert.rejects(pending, /cancelled/);
    assert.ok(stopped >= 1);
    assert.equal(starts, 0);
  } finally {
    if (oldNavigator)
      Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  }
});

test("cancelling an assessment aborts its request and cannot produce feedback", async (t) => {
  let aborted = false;
  const f = setup(t, {
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Error("aborted"));
          },
          { once: true },
        );
      }),
  });
  const pending = f.service.evaluate(
    card.id,
    "An average with weights",
    [],
    "grading",
  );
  f.service.cancel("grading");
  await assert.rejects(pending, /stopped or timed out/);
  assert.equal(aborted, true);
  assert.equal(f.service.assessment, null);
});

async function segmented(f, hooks = {}) {
  const pending = f.service.startSession("speak", "long", {
    maxSeconds: 900,
    maxText: 40000,
    segmentSeconds: 2,
    softSegmentSeconds: 1,
    shouldCommit: () => false,
    ...hooks,
  });
  f.socket().emit("open");
  f.socket().receive({ type: "session.updated" });
  await pending;
}
function appendSeconds(f, seconds) {
  const total = Math.round(seconds * 48000);
  for (let n = 0; n < total; n += 4800)
    f.service.append("long", new Uint8Array(Math.min(4800, total - n)));
}
const commits = (f) =>
  f.socket().sent.filter((event) => event.type === "input_audio_buffer.commit")
    .length;
const acknowledge = (f, id, previous = null) =>
  f.socket().receive({
    type: "input_audio_buffer.committed",
    item_id: id,
    previous_item_id: previous,
  });
const completed = (f, id, transcript) =>
  f.socket().receive({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: id,
    transcript,
  });
test("Speak segments finish in commit order despite duplicate/out-of-order finals and no final audio tail", async (t) => {
  const f = setup(t);
  let saved = 0;
  await segmented(f, {
    complete: () => {
      saved++;
      return { saved: true };
    },
  });
  appendSeconds(f, 2);
  acknowledge(f, "one");
  appendSeconds(f, 2);
  acknowledge(f, "two", "one");
  assert.equal(commits(f), 2);
  const finished = f.service.finish("long");
  let resolved = false;
  finished.then(() => {
    resolved = true;
  });
  assert.equal(
    commits(f),
    2,
    "exact segment boundary does not commit an empty buffer",
  );
  completed(f, "two", "The second part.");
  completed(f, "two", "The second part.");
  await Promise.resolve();
  assert.equal(resolved, false);
  completed(f, "one", "The first part.");
  assert.deepEqual(await finished, {
    text: "The first part. The second part.",
    saved: true,
  });
  assert.equal(saved, 1);
  assert.equal(f.service.active, null);
});
test("Speak soft commits wait for a pause and tiny final tails are padded rather than lost", async (t) => {
  const f = setup(t);
  let quiet = false;
  let analysedBytes = 0;
  await segmented(f, {
    shouldCommit: () => quiet,
    audio: (bytes) => {
      analysedBytes += bytes.length;
    },
  });
  appendSeconds(f, 1);
  assert.equal(commits(f), 0);
  quiet = true;
  appendSeconds(f, 0.1);
  assert.equal(commits(f), 1);
  acknowledge(f, "one");
  completed(f, "one", "Beginning.");
  appendSeconds(f, 0.05);
  const done = f.service.finish("long");
  assert.equal(commits(f), 2);
  const lastAppend = f
    .socket()
    .sent.filter((event) => event.type === "input_audio_buffer.append")
    .at(-1);
  assert.equal(Buffer.from(lastAppend.audio, "base64").length, 2400);
  assert.equal(analysedBytes, 55200);
  acknowledge(f, "two", "one");
  completed(f, "two", "Final syllable.");
  assert.equal((await done).text, "Beginning. Final syllable.");
});
test("Speak cannot complete missing or unacknowledged segments and retains partial text on failure", async (t) => {
  const f = setup(t);
  let saved = 0;
  await segmented(f, {
    complete: () => {
      saved++;
    },
  });
  appendSeconds(f, 2);
  acknowledge(f, "one");
  completed(f, "one", "The completed beginning.");
  appendSeconds(f, 2);
  const done = f.service.finish("long");
  completed(f, "two", "No acknowledgment yet.");
  assert.ok(
    f.service.active,
    "a final transcript cannot stand in for a commit acknowledgment",
  );
  f.socket().receive({
    type: "conversation.item.input_audio_transcription.failed",
    item_id: "two",
    error: { code: "provider_failure" },
  });
  await assert.rejects(done, /could not complete/);
  assert.equal(saved, 0);
  assert.ok(
    f.events.some((event) => event.text === "The completed beginning."),
  );
});
test("Speak long limits are bounded while card dictation retains its three-minute and text limits", async (t) => {
  const f = setup(t);
  await connected(f);
  assert.equal(f.service.active.maxSeconds, 180);
  assert.equal(f.service.active.maxText, 12000);
  f.service.cancel("test-token");
  assert.throws(
    () => f.service.startSession("speak", "invalid", { maxSeconds: 901 }),
    /Invalid recording limits/,
  );
  await segmented(f);
  assert.equal(f.service.active.maxSeconds, 900);
  assert.equal(f.service.active.maxText, 40000);
  f.service.active.bytes = 900 * 48000;
  assert.throws(
    () => f.service.append("long", new Uint8Array(4800)),
    /stopped/,
  );
  await segmented(f);
  appendSeconds(f, 2);
  acknowledge(f, "one");
  completed(f, "one", "x".repeat(20000));
  assert.ok(
    f.service.active,
    "Speak permits explanations longer than card dictation",
  );
  appendSeconds(f, 2);
  acknowledge(f, "two", "one");
  completed(f, "two", "x".repeat(20001));
  assert.equal(f.service.active, null);
  assert.ok(f.events.some((event) => event.message?.includes("too long")));
});

test("Speak exposes live provisional words before ACKs but finalizes only in acknowledged order", async (t) => {
  const f = setup(t);
  await segmented(f);
  appendSeconds(f, 0.5);
  f.socket().receive({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "one",
    delta: "A live opening",
  });
  assert.equal(f.events.at(-1).text, "A live opening");
  assert.equal(commits(f), 0);
  appendSeconds(f, 1.5);
  appendSeconds(f, 2);
  completed(f, "two", "A later conclusion.");
  const done = f.service.finish("long");
  let finalized = false;
  done.then(() => {
    finalized = true;
  });
  completed(f, "one", "A complete opening.");
  await Promise.resolve();
  assert.equal(finalized, false);
  acknowledge(f, "one");
  acknowledge(f, "two", "one");
  assert.equal((await done).text, "A complete opening. A later conclusion.");
});
