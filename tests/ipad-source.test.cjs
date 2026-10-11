'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const native = name => fs.readFileSync(path.join(root, 'apps/ipad/RecallPad', name), 'utf8');

test('native iPad project keeps local-only transport and disclosure boundaries', () => {
  const bridge = native('BridgeClient.swift');
  const question = native('QuestionView.swift');
  const info = native('Info.plist');
  assert.match(bridge, /SecTrustEvaluateWithError/);
  assert.match(bridge, /PublicKeyPin\.fingerprint/);
  assert.match(bridge, /SecPolicyCreateSSL\(true/);
  assert.match(bridge, /_recall-pad\._tcp\./);
  assert.doesNotMatch(bridge, /api\.openai\.com/);
  assert.match(question, /connect-src 'none'/);
  assert.match(question, /DOMPurify\.sanitize/);
  assert.match(question, /left:'\$',right:'\$',display:false/);
  assert.ok(question.indexOf("left:'$$'") < question.indexOf("left:'$'"));
  assert.doesNotMatch(question, /addScriptMessageHandler/);
  assert.match(info, /NSLocalNetworkUsageDescription/);
  assert.doesNotMatch(info, /NSAllowsArbitraryLoads/);
});

test('native app icon uses the existing public brand with an opaque iOS canvas', () => {
  const iconPath = path.join(root, 'apps/ipad/RecallPad/Resources/Assets.xcassets/AppIcon.appiconset');
  const icon = fs.readFileSync(path.join(iconPath, 'AppIcon.png'));
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.equal(icon[25], 2, 'App Store icon must have no alpha channel');
  const generator = fs.readFileSync(path.join(root, 'apps/ipad/generate-icon.cjs'), 'utf8');
  assert.match(generator, /packaging\/icon\.svg/);
  assert.match(generator, /alpha:false/);
  assert.match(generator, /#f7f2e7/);
  const project = fs.readFileSync(path.join(root, 'apps/ipad/RecallPad.xcodeproj/project.pbxproj'), 'utf8');
  assert.match(project, /ASSETCATALOG_COMPILER_APPICON_NAME = "AppIcon"/);
  assert.match(project, /Assets\.xcassets/);
});

test('native handoff uses durable staged protocol and never dispatches tutor messages', () => {
  const bridge = native('BridgeClient.swift');
  const store = native('DocumentStore.swift');
  assert.match(bridge, /\/manifest/);
  assert.match(bridge, /\/assets\//);
  assert.match(bridge, /\/commit/);
  assert.match(bridge, /\/ack/);
  assert.match(store, /\.atomic/);
  assert.match(store, /drawing\.data/);
  assert.match(store, /data\.sha256/);
  assert.doesNotMatch(bridge, /\/review|\/rate|\/evaluate|\/feedback/);
});

test('native Xcode project and locked web-resource preparation are distributable', () => {
  assert.ok(fs.existsSync(path.join(root, 'apps/ipad/RecallPad.xcodeproj/project.pbxproj')));
  assert.ok(fs.existsSync(path.join(root, 'apps/ipad/RecallPadTests/RecallPadTests.swift')));
  const script = fs.readFileSync(path.join(root, 'scripts/build-ipad.cjs'), 'utf8');
  assert.match(script, /node_modules/);
  assert.match(script, /CODE_SIGNING_ALLOWED=NO/);
  assert.doesNotMatch(script, /curl|npm install|npx/);
});
