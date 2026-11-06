/** Serialized into the isolated widget; never exposes an app or Node API. */
function installVisualRuntime() {
  const NS = "http://www.w3.org/2000/svg";
  const copy = (value) => structuredClone(value);
  const finite = (value) => {
    if (!Number.isFinite(value)) throw Error("A visual value must be finite.");
    return value;
  };
  const svg = (tag, attrs = {}, text) => {
    if (
      !/^(svg|g|path|rect|circle|ellipse|line|polyline|polygon|text|tspan|title|desc|defs|marker|clipPath)$/.test(
        tag,
      )
    )
      throw Error("Unsupported SVG primitive.");

    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (/^on/i.test(name) || /href/i.test(name))
        throw Error(
          "SVG primitive attributes cannot load resources or handlers.",
        );
      if (typeof value === "number") finite(value);
      node.setAttribute(name, String(value));
    }
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const linear = (domain, range, { clamp = false } = {}) => {
    if (domain.length !== 2 || range.length !== 2)
      throw Error("A scale needs two domain and range values.");
    [...domain, ...range].forEach(finite);
    if (domain[0] === domain[1]) throw Error("A scale domain must have width.");

    return (value) => {
      let t = (finite(value) - domain[0]) / (domain[1] - domain[0]);
      if (clamp) t = Math.max(0, Math.min(1, t));
      return range[0] + t * (range[1] - range[0]);
    };
  };
  const pointsPath = (points, x = (v) => v, y = (v) => v) =>
    points
      .map(([a, b], i) => `${i ? "L" : "M"}${finite(x(a))} ${finite(y(b))}`)
      .join(" ");
  const state = (initial, render) => {
    const baseline = copy(initial);
    let value = copy(baseline);
    const draw = () => render(copy(value));
    const api = {
      get: () => copy(value),
      set: (change) => {
        const next =
          typeof change === "function"
            ? change(copy(value))
            : { ...value, ...change };
        value = copy(next);
        draw();
        return api.get();
      },
      reset: () => {
        value = copy(baseline);
        draw();
        return api.get();
      },
    };
    draw();
    return api;
  };
  const scene = (target, width, height, label) => {
    finite(width);
    finite(height);
    if (width <= 0 || height <= 0)
      throw Error("A scene needs a positive size.");
    target.replaceChildren();
    target.setAttribute("viewBox", `0 0 ${width} ${height}`);
    target.setAttribute("role", "img");
    target.setAttribute("aria-label", label);
    target.append(svg("title", {}, label));
  };
  const text = (target, x, y, value, extra = {}) =>
    target.append(
      svg(
        "text",
        { x, y, fill: "var(--viz-label)", "font-size": 12, ...extra },
        value,
      ),
    );
  const plot = (
    target,
    {
      width = 640,
      height = 300,
      domain,
      range,
      series,
      xLabel = "",
      yLabel = "",
      label = "Interactive plot",
    },
  ) => {
    scene(target, width, height, label);
    const x = linear(domain, [60, width - 24]);
    const y = linear(range, [height - 48, 24]);
    for (let i = 0; i <= 4; i++) {
      const value = range[0] + (i * (range[1] - range[0])) / 4;
      target.append(
        svg("line", {
          x1: 60,
          x2: width - 24,
          y1: y(value),
          y2: y(value),
          stroke: "var(--viz-grid)",
        }),
      );
      text(target, 52, y(value) + 4, Number(value.toFixed(2)), {
        "text-anchor": "end",
        fill: "var(--viz-axis)",
      });
    }
    target.append(
      svg("line", {
        x1: 60,
        x2: width - 24,
        y1: height - 48,
        y2: height - 48,
        stroke: "var(--viz-axis)",
      }),
    );
    for (let i = 0; i <= 4; i++) {
      const value = domain[0] + (i * (domain[1] - domain[0])) / 4;
      text(target, x(value), height - 28, Number(value.toFixed(2)), {
        "text-anchor": "middle",
        fill: "var(--viz-axis)",
      });
    }
    series.forEach((item, i) => {
      if (item.points.length > 2000)
        throw Error("Split plots larger than 2000 points.");
      const path = svg("path", {
        d: pointsPath(item.points, x, y),
        fill: "none",
        stroke: item.color || `var(--viz-series-${(i % 6) + 1})`,
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
      });
      path.append(svg("title", {}, item.label || `Series ${i + 1}`));
      target.append(path);
    });
    text(target, (width + 36) / 2, height - 6, xLabel, {
      "text-anchor": "middle",
    });
    text(target, 8, 14, yLabel);
    return { x, y };
  };
  const bars = (
    target,
    {
      items,
      width = 640,
      height = Math.max(100, items.length * 40 + 24),
      max,
      label = "Comparison",
    },
  ) => {
    if (!items.length || items.length > 60)
      throw Error("A bar scene needs 1–60 items.");
    items.forEach((item) => finite(item.value));
    const limit =
      max ?? Math.max(1, ...items.map((item) => Math.abs(item.value)));
    if (!(limit > 0)) throw Error("The bar maximum must be positive.");
    const hasNegative = items.some((item) => item.value < 0);
    scene(target, width, height, label);
    const scale = linear(hasNegative ? [-limit, limit] : [0, limit], [
      145,
      width - 70,
    ]);
    const row = (height - 24) / items.length;
    items.forEach((item, i) => {
      const y = i * row + 12;
      const start = scale(0),
        end = scale(item.value);
      text(target, 8, y + row / 2 + 4, item.label);
      target.append(
        svg("rect", {
          x: Math.min(start, end),
          y: y + 5,
          width: Math.abs(end - start),
          height: Math.max(8, row - 10),
          rx: 4,
          fill: item.color || `var(--viz-series-${(i % 6) + 1})`,
        }),
      );
      text(target, width - 8, y + row / 2 + 4, item.value, {
        "text-anchor": "end",
      });
    });
  };
  const timeline = (
    target,
    {
      steps,
      active = 0,
      width = 640,
      height = Math.max(120, steps.length * 62),
      label = "Process stages",
    },
  ) => {
    if (
      !steps.length ||
      steps.length > 60 ||
      !Number.isInteger(active) ||
      active < 0 ||
      active >= steps.length
    )
      throw Error("A timeline needs 1–60 stages and a valid active stage.");
    scene(target, width, height, label);
    const row = height / steps.length;
    target.append(
      svg("line", {
        x1: 20,
        x2: 20,
        y1: row / 2,
        y2: height - row / 2,
        stroke: "var(--viz-grid)",
        "stroke-width": 2,
      }),
    );
    steps.forEach((item, i) => {
      const y = i * row + row / 2;
      target.append(
        svg("circle", {
          cx: 20,
          cy: y,
          r: i === active ? 8 : 5,
          fill: i <= active ? "var(--viz-series-2)" : "var(--sunken)",
          stroke: "var(--viz-axis)",
        }),
      );
      text(target, 42, y - 2, item.label, {
        "font-weight": i === active ? 600 : 400,
      });
      if (item.detail)
        text(target, 42, y + 17, item.detail, {
          fill: "var(--muted)",
          "font-size": 11,
        });
    });
  };
  const createRange = ({
    label,
    min,
    max,
    step = 1,
    value,
    unit = "",
    onChange,
  }) => {
    [min, max, step, value].forEach(finite);
    if (!(max > min) || !(step > 0)) throw Error("Invalid range bounds.");
    const element = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = label;
    const output = document.createElement("output");
    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.setAttribute("aria-label", label);
    const set = (next) => {
      input.value = Math.max(min, Math.min(max, finite(Number(next))));
      output.textContent = `${input.value}${unit}`;
      input.setAttribute("aria-valuetext", output.textContent);
    };
    input.addEventListener("input", () => {
      set(input.value);
      onChange?.(Number(input.value));
    });
    set(value);
    element.append(caption, output, input);
    return { element, input, output, set };
  };
  const playback = ({ frames, render, interval = 800 }) => {
    if (
      !Array.isArray(frames) ||
      !frames.length ||
      frames.length > 10000 ||
      !Number.isFinite(interval) ||
      interval < 50
    )
      throw Error(
        "Playback needs finite frames and an interval of at least 50 ms.",
      );
    const values = copy(frames);
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let index = 0,
      timer = null,
      generation = 0,
      destroyed = false;
    const pause = () => {
      generation++;
      clearTimeout(timer);
      timer = null;
    };
    const draw = () => render(copy(values[index]), index);
    const next = () => {
      pause();
      if (destroyed) return;
      index = Math.min(index + 1, values.length - 1);
      draw();
    };
    const play = () => {
      pause();
      if (
        destroyed ||
        preference.matches ||
        document.hidden ||
        index >= values.length - 1
      )
        return false;
      const ticket = generation;
      const tick = () => {
        if (
          destroyed ||
          ticket !== generation ||
          document.hidden ||
          preference.matches
        )
          return;
        index++;
        draw();
        timer = index < values.length - 1 ? setTimeout(tick, interval) : null;
      };
      timer = setTimeout(tick, interval);
      return true;
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    const motion = () => {
      if (preference.matches) pause();
    };
    const destroy = () => {
      pause();
      destroyed = true;
      document.removeEventListener("visibilitychange", visibility);
      preference.removeEventListener("change", motion);
      removeEventListener("pagehide", destroy);
    };
    document.addEventListener("visibilitychange", visibility);
    preference.addEventListener("change", motion);
    addEventListener("pagehide", destroy);
    draw();
    return {
      play,
      pause,
      next,
      destroy,
      reset: () => {
        pause();
        if (!destroyed) {
          index = 0;
          draw();
        }
      },
      isPlaying: () => timer !== null,
      current: () => index,
    };
  };
  Object.defineProperty(window, "RecallVisual", {
    value: Object.freeze({
      version: "1.0.0",
      state,
      svg,
      linear,
      pointsPath,
      plot,
      bars,
      timeline,
      createRange,
      playback,
    }),
    writable: false,
    configurable: false,
  });
}

/** Lifecycle/diagnostics only. This never accepts commands from the host. */
function installWidgetBridge(instance) {
  let scheduled = null,
    lastHeight = 0,
    ready = false,
    failed = false,
    stopped = false;
  const emit = (type, data = {}) =>
    parent.postMessage(
      { recallWidget: { version: 2, instance, type, ...data } },
      "*",
    );
  const measure = () => {
    const body = document.body;
    if (!body) return 200;
    const height = body.getBoundingClientRect().height;
    if (!Number.isFinite(height)) return 200;
    return Math.min(100000, Math.max(96, Math.ceil(height)));
  };
  const resize = () => {
    scheduled = null;
    if (stopped || !ready) return;
    const height = measure();
    if (Math.abs(height - lastHeight) >= 2) {
      lastHeight = height;
      emit("height", { height });
    }
  };
  const schedule = () => {
    if (!stopped && scheduled === null)
      scheduled = requestAnimationFrame(resize);
  };
  const failure = (message) => {
    if (failed || stopped) return;

    failed = true;
    emit("error", {
      message: String(
        message || "The interactive could not finish loading.",
      ).slice(0, 400),
    });
  };
  addEventListener(
    "error",
    (event) => {
      // Chromium reports deferred ResizeObserver notifications as an ErrorEvent
      // without an Error object. Layout catches up on the next animation frame;
      // a real thrown Error, even with this text, remains a visible failure.
      if (
        event.error == null &&
        (event.message ===
          "ResizeObserver loop completed with undelivered notifications." ||
          event.message === "ResizeObserver loop limit exceeded")
      )
        return;

      failure(event.message || "A visual resource could not load.");
    },
    true,
  );
  addEventListener("unhandledrejection", (event) =>
    failure(
      event.reason?.message || "The interactive could not finish an operation.",
    ),
  );
  addEventListener("securitypolicyviolation", () =>
    failure("A resource was blocked by Recall's offline safety policy."),
  );
  // Escape pressed while focus is inside the opaque frame cannot reach the
  // host dialog's key handler. This requests only that visual's expanded view
  // close; it grants no navigation or other host capability.
  addEventListener(
    "keydown",
    (event) => {
      if (stopped || event.key !== "Escape" || event.repeat) return;

      event.preventDefault();
      event.stopPropagation();
      emit("dismiss");
    },
    true,
  );
  const observer = new ResizeObserver(schedule);
  const start = () => {
    if (ready || stopped) return;
    ready = true;
    lastHeight = measure();
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    if (!failed) emit("ready", { height: lastHeight });
    else emit("height", { height: lastHeight });
    document.fonts?.ready.then(schedule, schedule);
  };
  if (document.readyState === "loading")
    addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  addEventListener("load", schedule, true);
  addEventListener(
    "pagehide",
    () => {
      stopped = true;
      observer.disconnect();
      if (scheduled !== null) cancelAnimationFrame(scheduled);
    },
    { once: true },
  );
}

module.exports = { installVisualRuntime, installWidgetBridge };
