const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm");
const {
  installVisualRuntime,
  installWidgetBridge,
} = require("../shared/widget-runtime.cjs");
const {
  widgetDocument,
  widgetsOf,
  kit,
  WIDGET_CSP,
} = require("../electron/widgets.cjs");
const { theme, tokens, lightTokens } = require("../shared/widget-theme.cjs");

function events(target = {}) {
  const listeners = new Map();
  target.addEventListener = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
  };
  target.removeEventListener = (name, fn) => listeners.get(name)?.delete(fn);
  target.fire = (name, event = {}) => {
    for (const listener of [...(listeners.get(name) || [])]) listener(event);
  };
  return target;
}
class Element {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.height = 246.5;
    events(this);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  getBoundingClientRect() {
    return { height: this.height };
  }
}
function browser() {
  const frames = new Map(),
    timers = new Map(),
    messages = [],
    observers = [];
  let sequence = 0;
  const document = events({
    body: new Element("body"),
    documentElement: new Element("html"),
    readyState: "loading",
    hidden: false,
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
  });
  const media = events({ matches: false });
  const context = events({
    document,
    structuredClone,
    matchMedia: () => media,
    parent: {
      postMessage: (message) => messages.push(structuredClone(message)),
    },
    requestAnimationFrame: (fn) => {
      frames.set(++sequence, fn);
      return sequence;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn) => {
      timers.set(++sequence, fn);
      return sequence;
    },
    clearTimeout: (id) => timers.delete(id),
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.targets = [];
        observers.push(this);
      }
      observe(node) {
        this.targets.push(node);
      }
      disconnect() {
        this.targets = [];
      }
    },
  });
  context.window = context;
  vm.createContext(context);
  return {
    context,
    document,
    media,
    frames,
    timers,
    messages,
    observers,
    install: (fn, arg) =>
      vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)});`, context),
    flushFrame: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn());
    },
    runTimer: () => {
      const [id, fn] = [...timers][0] || [];
      if (fn) {
        timers.delete(id);
        fn();
      }
    },
  };
}

test("one canonical palette supplies app and widgets, with legacy and semantic aliases", () => {
  const appTokens = fs.readFileSync(
    path.join(__dirname, "../src/tokens.css"),
    "utf8",
  );
  assert.match(appTokens, /@import "\.\.\/shared\/visual-theme\.css"/);
  assert.doesNotMatch(
    appTokens,
    /--[\w-]+\s*:/,
    "No second app palette may silently drift",
  );
  assert.ok(kit.includes(theme));
  assert.equal(tokens["--card"], "#2d312d");
  assert.equal(lightTokens["--card"], "#fffefb");
  for (const name of [
    "--foreground",
    "--primary",
    "--color-text-primary",
    "--font-sans",
  ])
    assert.ok(kit.includes(name + ":"));
  for (const name of [
    "--viz-grid",
    "--viz-axis",
    "--viz-label",
    "--viz-focus",
    ...Array.from({ length: 6 }, (_, i) => `--viz-series-${i + 1}`),
  ]) {
    assert.ok(tokens[name], name + " needs dark appearance");
    assert.ok(lightTokens[name], name + " needs light appearance");
  }
});

test("packaged widget envelope works with shared resources and no src directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-widget-package-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of [
    "electron/widgets.cjs",
    "shared/widget-theme.cjs",
    "shared/visual-theme.css",
    "shared/widget-runtime.cjs",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "..", file), path.join(root, file));
  }
  const shipped = require(path.join(root, "electron/widgets.cjs"));
  assert.ok(
    shipped
      .widgetDocument({ title: "Shipped", html: "<p>Offline</p>" })
      .includes("#fffefb"),
  );
  assert.equal(fs.existsSync(path.join(root, "src")), false);
});

test("helpers precede authored code, instance is bounded, and legacy fences retain isolation", () => {
  const html = widgetDocument(
    {
      title: '<unsafe "title">',
      html: "<script>window.authored=true;</script>",
    },
    { instance: "session_123-abc" },
  );
  assert.ok(html.indexOf('version: "1.0.0"') < html.indexOf("window.authored"));
  assert.ok(
    html.indexOf('"session_123-abc"') < html.indexOf("window.authored"),
  );
  assert.match(html, /&lt;unsafe &quot;title&quot;&gt;/);
  assert.throws(
    () => widgetDocument({ title: "x", html: "" }, { instance: "</script>" }),
    /Invalid widget instance/,
  );
  assert.throws(
    () =>
      widgetDocument({ title: "x", html: "" }, { instance: "a".repeat(97) }),
    /Invalid widget instance/,
  );
  assert.equal(
    widgetsOf("```widget A\n<p>A</p>\n```\n```widget B\n<p>B</p>\n```").length,
    2,
  );
  assert.match(WIDGET_CSP, /sandbox allow-scripts(?:;|$)/);
  assert.doesNotMatch(
    WIDGET_CSP,
    /allow-same-origin|https:|connect-src|unsafe-eval/,
  );
});

test("state updates and Reset keep one coherent model without exposing mutable state", () => {
  const b = browser();
  b.install(installVisualRuntime);
  const draws = [],
    original = { input: 2, nested: { selected: "baseline" } };
  const state = b.context.RecallVisual.state(original, (value) =>
    draws.push(value),
  );
  original.nested.selected = "changed outside";
  state.set({ input: 4 });
  state.set((value) => ({ ...value, input: value.input * 3 }));
  assert.equal(state.get().input, 12);
  const escaped = state.get();
  escaped.nested.selected = "mutated outside";
  assert.equal(state.get().nested.selected, "baseline");
  state.reset();
  assert.deepEqual(state.get(), { input: 2, nested: { selected: "baseline" } });
  assert.equal(draws.length, 4);
  assert.ok(Object.isFrozen(b.context.RecallVisual));
});

test("native SVG scales, plots, bars and timelines preserve calculated geometry and names", () => {
  const b = browser();
  b.install(installVisualRuntime);
  const v = b.context.RecallVisual;
  assert.equal(v.linear([0, 10], [100, 0])(2), 80);
  assert.equal(v.linear([0, 10], [0, 100], { clamp: true })(12), 100);
  assert.throws(() => v.linear([1, 1], [0, 10]), /width/);
  assert.throws(() => v.pointsPath([[NaN, 1]]), /finite/);
  assert.throws(() => v.svg("script"), /Unsupported/);
  assert.throws(() => v.svg("rect", { onclick: "doThing()" }), /handlers/);
  const target = v.svg("svg");
  const scales = v.plot(target, {
    domain: [0, 2],
    range: [0, 10],
    series: [
      {
        label: "Doubled",
        points: [
          [0, 0],
          [1, 5],
          [2, 10],
        ],
      },
    ],
    xLabel: "Time",
    yLabel: "Value",
    label: "Growth",
  });
  assert.equal(target.attrs["aria-label"], "Growth");
  const plotted = target.children.find((node) => node.tag === "path");
  assert.equal(
    plotted.attrs.d,
    `M${scales.x(0)} ${scales.y(0)} L${scales.x(1)} ${scales.y(5)} L${scales.x(2)} ${scales.y(10)}`,
  );
  assert.equal(plotted.children[0].textContent, "Doubled");
  v.bars(target, {
    items: [
      { label: "Cost", value: -2 },
      { label: "Return", value: 4 },
    ],
    max: 4,
  });
  const rectangles = target.children.filter((node) => node.tag === "rect");
  assert.equal(
    Number(rectangles[1].attrs.width),
    Number(rectangles[0].attrs.width) * 2,
  );
  v.timeline(target, {
    steps: [{ label: "Queued" }, { label: "Saved", detail: "Durable" }],
    active: 1,
  });
  assert.equal(
    target.children.filter((node) => node.tag === "circle")[1].attrs.r,
    "8",
  );
  assert.ok(target.children.some((node) => node.textContent === "Durable"));
});

test("range controls have native labels, bounded values and coordinated numeric output", () => {
  const b = browser();
  b.install(installVisualRuntime);
  const changes = [];
  const range = b.context.RecallVisual.createRange({
    label: "Yield change",
    min: -100,
    max: 100,
    value: 20,
    unit: " bp",
    onChange: (value) => changes.push(value),
  });
  assert.equal(range.input.attrs["aria-label"], "Yield change");
  assert.equal(range.output.textContent, "20 bp");
  range.input.value = "75";
  range.input.fire("input");
  assert.deepEqual(changes, [75]);
  assert.equal(range.output.textContent, "75 bp");
  range.set(500);
  assert.equal(range.input.attrs["aria-valuetext"], "100 bp");
});

test("playback starts manually and Reset invalidates stale callbacks; reduced motion stays manual", () => {
  const b = browser();
  b.install(installVisualRuntime);
  const draws = [];
  const player = b.context.RecallVisual.playback({
    frames: ["first", "middle", "last"],
    render: (value) => draws.push(value),
    interval: 100,
  });
  assert.equal(b.timers.size, 0);
  assert.equal(player.play(), true);
  const stale = [...b.timers.values()][0];
  player.reset();
  stale();
  assert.equal(player.current(), 0);
  assert.equal(draws.at(-1), "first");
  player.play();
  b.runTimer();
  assert.equal(player.current(), 1);
  b.document.hidden = true;
  b.document.fire("visibilitychange");
  assert.equal(player.isPlaying(), false);
  b.document.hidden = false;
  b.media.matches = true;
  assert.equal(player.play(), false);
  player.next();
  assert.equal(draws.at(-1), "last");
  player.reset();
  b.media.matches = false;
  player.play();
  b.media.matches = true;
  b.media.fire("change");
  assert.equal(player.isPlaying(), false);
  player.destroy();
  assert.equal(player.play(), false);
});

test("v2 lifecycle reports ready once, coalesces height, handles shrink and disconnects", () => {
  const b = browser();
  b.install(installWidgetBridge, "instance-1");
  assert.equal(b.messages.length, 0);
  b.context.fire("DOMContentLoaded");
  assert.deepEqual(b.messages[0], {
    recallWidget: {
      version: 2,
      instance: "instance-1",
      type: "ready",
      height: 247,
    },
  });
  b.document.body.height = 800;
  b.observers[0].callback();
  b.observers[0].callback();
  b.context.fire("load");
  assert.equal(b.frames.size, 1);
  b.flushFrame();
  assert.equal(b.messages.at(-1).recallWidget.height, 800);
  b.document.body.height = 160;
  b.observers[0].callback();
  b.flushFrame();
  assert.equal(b.messages.at(-1).recallWidget.height, 160);
  b.document.body.height = 161;
  b.observers[0].callback();
  b.flushFrame();
  assert.equal(
    b.messages.at(-1).recallWidget.height,
    160,
    "One pixel drift must not create resize churn",
  );
  b.observers[0].callback();
  b.context.fire("pagehide");
  assert.equal(b.frames.size, 0);
  assert.equal(b.observers[0].targets.length, 0);
});

test("initial errors cannot be erased by ready, and diagnostics are bounded and deduplicated", () => {
  const b = browser();
  b.install(installWidgetBridge, "broken");
  b.context.fire("error", { message: "x".repeat(1000) });
  b.context.fire("DOMContentLoaded");
  b.context.fire("unhandledrejection", { reason: { message: "another" } });
  assert.equal(
    b.messages.filter((m) => m.recallWidget.type === "error").length,
    1,
  );
  assert.equal(b.messages[0].recallWidget.message.length, 400);
  assert.equal(
    b.messages.some((m) => m.recallWidget.type === "ready"),
    false,
  );
  const policy = browser();
  policy.install(installWidgetBridge, "policy");
  policy.context.fire("securitypolicyviolation", {
    blockedURI: "https://private.invalid/path",
  });
  assert.equal(
    policy.messages[0].recallWidget.message.includes("private.invalid"),
    false,
  );
});

test("browser resize-loop notices are nonfatal but genuine errors with the same text remain visible", () => {
  for (const message of [
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ]) {
    const b = browser();
    b.install(installWidgetBridge, "resizing");
    b.context.fire("error", { message, error: null });
    b.context.fire("DOMContentLoaded");
    assert.equal(b.messages[0].recallWidget.type, "ready");
    b.document.body.height = 500;
    b.observers[0].callback();
    b.flushFrame();
    assert.equal(b.messages.at(-1).recallWidget.height, 500);
    b.context.fire("error", { message, error: new Error(message) });
    assert.equal(b.messages.at(-1).recallWidget.type, "error");
    assert.equal(b.messages.at(-1).recallWidget.message, message);
  }
  const other = browser();
  other.install(installWidgetBridge, "real-failure");
  other.context.fire("error", {
    message:
      "ResizeObserver loop completed with undelivered notifications. Extra failure",
    error: null,
  });
  assert.equal(other.messages[0].recallWidget.type, "error");
});

test("Escape in the isolated frame requests only bounded dismissal of its visual", () => {
  const b = browser();
  b.install(installWidgetBridge, "expanded-visual");
  let prevented = 0,
    stopped = 0;
  const key = (value, repeat = false) => ({
    key: value,
    repeat,
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  });
  b.context.fire("keydown", key("ArrowRight"));
  assert.equal(b.messages.length, 0);
  b.context.fire("keydown", key("Escape"));
  assert.deepEqual(b.messages, [
    {
      recallWidget: {
        version: 2,
        instance: "expanded-visual",
        type: "dismiss",
      },
    },
  ]);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  b.context.fire("keydown", key("Escape", true));
  b.context.fire("pagehide");
  b.context.fire("keydown", key("Escape"));
  assert.equal(
    b.messages.length,
    1,
    "Repeats or an old frame must not emit commands",
  );
});
