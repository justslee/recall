// This is a layout/status and local-dismissal channel, never a general bridge
// to host capabilities.
export const WIDGET_PROTOCOL_VERSION = 2;
export const WIDGET_LOAD_TIMEOUT_MS = 8000;
export const WIDGET_MIN_HEIGHT = 96;
export const WIDGET_MAX_HEIGHT = 1400;
export const WIDGET_INITIAL_HEIGHT = 260;

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, allowed) =>
  Object.keys(value).every((key) => allowed.includes(key));
const measuredHeight = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= 100000;

export function widgetHeight(value) {
  return Math.min(WIDGET_MAX_HEIGHT, Math.max(WIDGET_MIN_HEIGHT, value));
}

/** Validate only messages already attributed to the current iframe window. */
export function widgetMessage(data, instance) {
  if (
    !record(data) ||
    !exactKeys(data, ["recallWidget"]) ||
    !record(data.recallWidget)
  ) {
    return null;
  }

  const message = data.recallWidget;
  if (
    message.version !== WIDGET_PROTOCOL_VERSION ||
    typeof message.instance !== "string" ||
    message.instance !== instance ||
    !/^[A-Za-z0-9_-]{1,96}$/.test(message.instance)
  ) {
    return null;
  }

  if (message.type === "dismiss") {
    return exactKeys(message, ["version", "instance", "type"])
      ? { type: "dismiss" }
      : null;
  }

  if (message.type === "error") {
    if (
      !exactKeys(message, ["version", "instance", "type", "message"]) ||
      (message.message !== undefined &&
        (typeof message.message !== "string" || message.message.length > 400))
    ) {
      return null;
    }

    // The frame's own error text is deliberately not placed into host UI.
    return { type: "error" };
  }

  if (message.type !== "ready" && message.type !== "height") return null;
  if (!exactKeys(message, ["version", "instance", "type", "height"]))
    return null;
  if (message.height === undefined && message.type === "ready") {
    return { type: "ready" };
  }
  if (!measuredHeight(message.height)) return null;

  return { type: message.type, height: widgetHeight(message.height) };
}
