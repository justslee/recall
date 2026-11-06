const { test } = require("node:test");
const assert = require("node:assert/strict");
const protocol = import("../src/widget-protocol.js");
const instance = "a9a39827-76b0-4867-b7e2-d4d5bb54b5b1";
const envelope = (fields) => ({
  recallWidget: { version: 2, instance, ...fields },
});

test("widget status/layout channel binds version and exact instance", async () => {
  const { widgetMessage } = await protocol;
  assert.deepEqual(
    widgetMessage(envelope({ type: "ready", height: 460 }), instance),
    { type: "ready", height: 460 },
  );
  assert.deepEqual(widgetMessage(envelope({ type: "ready" }), instance), {
    type: "ready",
  });
  for (const data of [
    null,
    [],
    { recallWidget: [] },
    { recallWidget: { height: 200 } },
    envelope({ type: "ready", version: 1 }),
    envelope({ type: "ready", instance: "older-run" }),
    envelope({ type: "execute", code: "anything" }),
    { ...envelope({ type: "ready" }), otherBridge: true },
    envelope({ type: "ready", url: "file:///" }),
  ])
    assert.equal(widgetMessage(data, instance), null);
});

test("widget sizes reject malformed values and cap accepted layout reports", async () => {
  const { widgetMessage } = await protocol;
  for (const height of ["320", NaN, Infinity, -1, 0, 1.5, 100001, {}, null]) {
    assert.equal(
      widgetMessage(envelope({ type: "height", height }), instance),
      null,
    );
  }
  assert.deepEqual(
    widgetMessage(envelope({ type: "height", height: 23 }), instance),
    { type: "height", height: 96 },
  );
  assert.deepEqual(
    widgetMessage(envelope({ type: "height", height: 90000 }), instance),
    { type: "height", height: 1400 },
  );
  assert.equal(widgetMessage(envelope({ type: "height" }), instance), null);
});

test("widget errors are bounded and never expose frame-supplied text to the host", async () => {
  const { widgetMessage } = await protocol;
  assert.deepEqual(
    widgetMessage(
      envelope({ type: "error", message: "<script>private details</script>" }),
      instance,
    ),
    { type: "error" },
  );
  assert.deepEqual(widgetMessage(envelope({ type: "error" }), instance), {
    type: "error",
  });
  assert.equal(
    widgetMessage(
      envelope({ type: "error", message: "x".repeat(401) }),
      instance,
    ),
    null,
  );
  assert.equal(
    widgetMessage(envelope({ type: "error", message: 42 }), instance),
    null,
  );
  assert.equal(
    widgetMessage(envelope({ type: "error", height: 200 }), instance),
    null,
  );
});

test("widget Escape can only request dismissal of its own expanded workspace", async () => {
  const { widgetMessage } = await protocol;
  assert.deepEqual(widgetMessage(envelope({ type: "dismiss" }), instance), {
    type: "dismiss",
  });
  for (const data of [
    envelope({ type: "dismiss", instance: "previous-frame" }),
    envelope({ type: "dismiss", height: 200 }),
    envelope({ type: "dismiss", message: "run a command" }),
    envelope({ type: "dismiss", command: "open" }),
  ])
    assert.equal(widgetMessage(data, instance), null);
});
