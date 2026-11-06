const $ = (id) => document.getElementById(id);
const number = (value, digits = 1) =>
  Math.abs(value) < 1e-9 ? (0).toFixed(digits) : value.toFixed(digits);
const signed = (value, digits = 0) =>
  (value > 1e-9 ? "+" : value < -1e-9 ? "−" : "") +
  number(Math.abs(value), digits);
const svgNode = (tag, attrs = {}, content) => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs))
    element.setAttribute(name, String(value));
  if (content !== undefined) element.textContent = content;
  return element;
};
const svgText = (parent, x, y, content, attrs = {}) => {
  const element = svgNode(
    "text",
    {
      x,
      y,
      fill: "var(--vb-muted)",
      "font-size": 11,
      "font-family": "var(--sans, sans-serif)",
      ...attrs,
    },
    content,
  );
  parent.append(element);
  return element;
};
const setText = (id, value) => {
  $(id).textContent = value;
};

// A redraw may change the SVG's height. Observe width only and draw in a later
// frame, outside ResizeObserver delivery, so the two cannot form a resize loop.
const observeWidth = (element, draw) => {
  let lastWidth = Math.round(element.getBoundingClientRect().width);
  let pending = 0;
  let disposed = false;
  const observer = new ResizeObserver((entries) => {
    const width = Math.round(entries[0]?.contentRect.width ?? lastWidth);
    if (disposed || width === lastWidth) return;

    lastWidth = width;
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (!disposed) draw();
    });
  });
  observer.observe(element);
  const cleanup = () => {
    disposed = true;
    observer.disconnect();
    if (pending) cancelAnimationFrame(pending);
    pending = 0;
  };
  addEventListener("pagehide", cleanup, { once: true });
  return cleanup;
};
