const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { packageOptions } = require("../scripts/package-mac.cjs");
const root = path.resolve(__dirname, "..");

test("the actual packager filter excludes local profiles and unknown files", async () => {
  // Use Packager's filter, not a second implementation of the policy. Git
  // ignores alone do not prevent these files from entering a distributable app.
  const { userPathFilter, populateIgnoredPaths } = await import(
    pathToFileURL(
      path.join(root, "node_modules/@electron/packager/dist/copy-filter.js"),
    )
  );
  const options = { ...packageOptions(root), prune: false };
  options.ignore = populateIgnoredPaths(options).ignore;
  const accepts = userPathFilter(options);
  for (const file of [
    "config.local.json",
    ".env.local",
    "credentials/provider.json",
    "private/review-contacts.json",
    "tasks/work.md",
    "notes.md",
    "local-library/cards.json",
    "recall.sqlite",
    "signing.p8",
    "account.p12",
    "release/submission/private/readiness.json",
    "apps/ipad/Local.xcconfig",
    "electron/.env",
    "shared/auth.json",
    "skills/credentials/token.json",
    "examples/my-private-cards.json",
    "dist-native/.swift-module-cache/cache",
    "node_modules/.credentials.json",
    "node_modules/.git/config",
    "node_modules/.bin/private-tool",
    "electron/debug.symbols",
    "shared/check.xcresult/result.json",
  ])
    assert.equal(await accepts(path.join(root, file)), false, file);

  for (const file of [
    "package.json",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "electron/main.cjs",
    "electron/local-credentials.cjs",
    "cli/paper-mcp.cjs",
    "shared/privacy-audit.cjs",
    "skills/recall-cards/SKILL.md",
    "adapters/knowledge.cjs",
    "schemas/Card.json",
    "dist/index.html",
    "dist/assets/renderer.js",
    "dist-native/RecallPadHandoff",
    "examples/demo.json",
    "node_modules/react/index.js",
  ])
    assert.equal(await accepts(path.join(root, file)), true, file);
});

test("ordinary packaging never signs or uploads and automatically audits its archive", () => {
  const options = packageOptions(root);
  assert.equal(options.osxSign, undefined);
  assert.equal(options.osxNotarize, undefined);
  assert.equal(options.extraResource, undefined);
  assert.deepEqual(options.asar, { unpackDir: "dist-native" });
  const scripts = require("../package.json").scripts;
  assert.match(scripts.package, /scripts\/package-mac\.cjs/);
  assert.match(scripts.postpackage, /scripts\/audit-package\.cjs/);
});

test("the pinned Packager API exposes the callable export used by the build script", async () => {
  const { packager } = await import("@electron/packager");
  assert.equal(typeof packager, "function");
});
