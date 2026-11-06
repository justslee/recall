const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const {
  yieldCurve,
  durationGap,
  referenceInitial,
  referenceView,
  referenceTransition,
} = require("./models.cjs");
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} ≈ ${expected}`,
  );

test("yield curve: exact endpoint and spread arithmetic, not a price/return model", () => {
  const bear = yieldCurve({ shortBp: 20, longBp: 80 });
  near(bear.points[0].scenario, 0.8);
  near(bear.points.at(-1).scenario, 2.8);
  near(bear.spreadBp, (2.8 - 0.8) * 100);
  near(bear.spreadChangeBp, 60);
  assert.equal(bear.slope, "Steepening");
  assert.equal(bear.direction, "Bear");
  const bull = yieldCurve({ shortBp: -75, longBp: -20 });
  near(bull.points[0].scenario, -0.15);
  near(bull.points.at(-1).scenario, 1.8);
  near(bull.spreadBp, 195);
  assert.equal(bull.direction, "Bull");
  assert.equal(bull.slope, "Steepening");
});

test("yield curve: parallel shifts preserve every maturity spread, boundaries allow inversion", () => {
  const parallel = yieldCurve({ shortBp: 50, longBp: 50 });
  for (const point of parallel.points)
    near(point.scenario - point.baseline, 0.5);
  near(parallel.spreadBp, 140);
  assert.equal(parallel.slope, "Parallel shift");
  near(yieldCurve({ shortBp: 100, longBp: -100 }).spreadBp, -60);
  near(yieldCurve({ shortBp: -100, longBp: 100 }).spreadBp, 340);
  assert.throws(() => yieldCurve({ shortBp: NaN }), /finite/);
});

test("duration gap: independently calculated balance sheets and sign reversal", () => {
  const rise = durationGap({ assetDuration: 12, shockPct: 1 });
  // A'=110*(1-12*.01); L'=100*(1-18*.01), independently.
  near(rise.assetsAfter, 96.8);
  near(rise.liabilitiesAfter, 82);
  near(rise.surplusAfter, 96.8 - 82);
  near(rise.surplusChange, 4.8);
  near(rise.exposure, -480);
  const fall = durationGap({ assetDuration: 12, shockPct: -1 });
  near(fall.assetsAfter, 123.2);
  near(fall.liabilitiesAfter, 118);
  near(fall.surplusAfter, 5.2);
});

test("duration gap: equal years are not equal weighted exposure; first-order match is", () => {
  const sameYears = durationGap({ assetDuration: 18, shockPct: 1 });
  near(sameYears.exposure, 180);
  near(sameYears.surplusChange, -1.8);
  const target = 1800 / 110;
  for (const shockPct of [-2, -1, 0, 1, 2]) {
    const matched = durationGap({ assetDuration: target, shockPct });
    near(matched.exposure, 0);
    near(matched.surplusAfter, 10);
    near(matched.gapYears, 0);
  }
  near(durationGap({ shockPct: 0 }).surplusAfter, 10);
  near(
    durationGap({ assets: 100, liabilities: 100, assetDuration: 18 }).exposure,
    0,
  );
  assert.throws(() => durationGap({ assets: 0 }), /positive assets/);
});

test("duration model stays positive and inside fixed 180bn chart domain at every UI boundary", () => {
  for (const assetDuration of [5, 12, 18, 25])
    for (const shockPct of [-2, 0, 2]) {
      const model = durationGap({ assetDuration, shockPct });
      assert.ok(model.assetsAfter > 0 && model.assetsAfter < 180);
      assert.ok(model.liabilitiesAfter > 0 && model.liabilitiesAfter < 180);
      near(model.assetsAfter - model.liabilitiesAfter, model.surplusAfter);
    }
});

test("weak reference: close does not collect, releasing owner only makes it eligible", () => {
  const initial = referenceInitial();
  const closed = referenceTransition(initial, "close");
  assert.equal(referenceView(closed).reachable, true);
  assert.equal(closed.collected, false);
  const released = referenceTransition(closed, "release-owner");
  assert.equal(referenceView(released).reachable, false);
  assert.equal(released.collected, false);
  const collected = referenceTransition(released, "collect");
  assert.equal(collected.collected, true);
  assert.equal(referenceView(collected).referenceRead, "None");
  assert.equal(
    referenceTransition(collected, "read").temporary,
    false,
    "a dead weak reference cannot resurrect its object",
  );
  assert.deepEqual(
    initial,
    referenceInitial(),
    "transitions do not mutate earlier snapshots",
  );
});

test("weak reference: GC never frees a strongly reachable object", () => {
  assert.equal(
    referenceTransition(referenceInitial(), "collect").collected,
    false,
  );
  let strong = referenceInitial(true);
  for (const action of ["close", "release-owner", "collect", "collect"])
    strong = referenceTransition(strong, action);
  assert.equal(strong.owner, false);
  assert.equal(strong.gcRuns, 2);
  assert.equal(strong.collected, false);
  assert.equal(referenceView(strong).reachable, true);
});

test("weak reference read creates temporary owner; releasing it does not retroactively run GC", () => {
  let state = referenceInitial();
  for (const action of ["read", "close", "release-owner", "collect"])
    state = referenceTransition(state, action);
  assert.equal(state.temporary, true);
  assert.equal(state.collected, false);
  assert.equal(state.gcRuns, 1);
  state = referenceTransition(state, "release-caller");
  assert.equal(state.collected, false);
  assert.equal(referenceView(state).reachable, false);
  assert.equal(state.gcRuns, 1);
  state = referenceTransition(state, "collect");
  assert.equal(state.collected, true);
  assert.equal(state.gcRuns, 2);
  assert.deepEqual(referenceTransition(state, "reset"), referenceInitial());
});

test("manifest outcomes agree with independent pure-model transitions", () => {
  for (const entry of require("./manifest.json").benchmarks)
    for (const scene of entry.interactions) {
      let state =
        entry.id === "yield-curve"
          ? { shortBp: 20, longBp: 80 }
          : entry.id === "duration-gap"
            ? { assetDuration: 12, shockPct: 1 }
            : referenceInitial();
      const history = [];
      for (const step of scene.steps) {
        if (entry.id === "yield-curve") {
          if (step.input)
            state[step.input === "#curve-short" ? "shortBp" : "longBp"] =
              step.value;
          else if (step.click === "#curve-reset")
            state = { shortBp: 20, longBp: 80 };
          else {
            const name = step.click.match(/data-scenario='(.*?)'/)?.[1];
            const pair = {
              bear: [20, 80],
              bull: [-75, -20],
              parallel: [50, 50],
              flatten: [80, 20],
            }[name];
            assert.ok(pair);
            state = { shortBp: pair[0], longBp: pair[1] };
          }
        } else if (entry.id === "duration-gap") {
          if (step.input)
            state[
              step.input === "#duration-shock" ? "shockPct" : "assetDuration"
            ] = step.value;
          else if (step.click === "#duration-match")
            state.assetDuration = 1800 / 110;
          else if (step.click === "#duration-reset")
            state = { assetDuration: 12, shockPct: 1 };
          else assert.fail(step.click);
        } else if (
          ["#reference-weak", "#reference-strong", "#reference-reset"].includes(
            step.click,
          )
        ) {
          state = referenceInitial(step.click === "#reference-strong");
          history.length = 0;
        } else if (step.click === "#reference-back") state = history.pop();
        else {
          history.push({ ...state });
          const action =
            step.click === "#reference-next"
              ? state.phase === 0
                ? "close"
                : state.phase === 1
                  ? "release-owner"
                  : "collect"
              : step.click === "#reference-read"
                ? "read"
                : "release-caller";
          state = referenceTransition(state, action);
        }
      }
      const result =
        entry.id === "yield-curve"
          ? yieldCurve(state)
          : entry.id === "duration-gap"
            ? durationGap(state)
            : referenceView(state);
      for (const [key, expected] of Object.entries(scene.expected)) {
        if (typeof expected === "number") near(result[key], expected);
        else
          assert.equal(
            result[key],
            expected,
            `${entry.id}/${scene.name}/${key}`,
          );
      }
    }
});

test("width observer coalesces layout frames, ignores height-only delivery and cleans up", () => {
  let notify,
    pagehide,
    disconnected = 0,
    draws = 0,
    nextId = 1;
  const frames = new Map();
  const context = vm.createContext({
    ResizeObserver: class {
      constructor(callback) {
        notify = callback;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
    requestAnimationFrame: (callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: (event, callback) => {
      assert.equal(event, "pagehide");
      pagehide = callback;
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "browser-helpers.js"), "utf8") +
      "\nglobalThis.testObserve = observeWidth;",
    context,
  );
  context.testObserve(
    { getBoundingClientRect: () => ({ width: 320 }) },
    () => draws++,
  );
  notify([{ contentRect: { width: 320, height: 100 } }]);
  assert.equal(
    frames.size,
    0,
    "initial and height-only delivery do not redraw",
  );
  notify([{ contentRect: { width: 360, height: 100 } }]);
  notify([{ contentRect: { width: 720, height: 200 } }]);
  assert.equal(frames.size, 1, "rapid widths share one pending redraw");
  assert.equal(draws, 0, "drawing never occurs inside observer delivery");
  const draw = [...frames.values()][0];
  frames.clear();
  draw();
  assert.equal(draws, 1);
  notify([{ contentRect: { width: 720, height: 300 } }]);
  assert.equal(frames.size, 0);
  notify([{ contentRect: { width: 500, height: 300 } }]);
  const stale = [...frames.values()][0];
  pagehide();
  stale();
  assert.equal(disconnected, 1);
  assert.equal(frames.size, 0);
  assert.equal(draws, 1);
});

test("generated artifacts are reproducible, self-contained classic scripts with no private metadata", () => {
  const before = new Map();
  for (const entry of require("./manifest.json").benchmarks)
    before.set(
      entry.file,
      fs.readFileSync(path.join(__dirname, entry.file), "utf8"),
    );
  require("./build.cjs");
  for (const [file, html] of before) {
    assert.equal(
      fs.readFileSync(path.join(__dirname, file), "utf8"),
      html,
      file,
    );
    const sourceWithoutSvgNamespace = html.replaceAll(
      "http://www.w3.org/2000/svg",
      "",
    );
    assert.doesNotMatch(
      sourceWithoutSvgNamespace,
      /<script\b[^>]*\bsrc=|https?:\/\/|file:\/\/|\/Users\/|localStorage|fetch\(|\bimport\s*\(/i,
    );
    for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))
      new vm.Script(script[1], { filename: file });
  }
});
