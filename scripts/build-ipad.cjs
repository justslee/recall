#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const resources = path.join(root, 'apps/ipad/RecallPad/Resources/Web');
const files = [
  ['katex/dist/katex.min.js', 'katex.min.js'],
  ['katex/dist/katex.min.css', 'katex.min.css'],
  ['katex/dist/contrib/auto-render.min.js', 'auto-render.min.js'],
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
  ['katex/LICENSE', 'KATEX-LICENSE.txt'],
  ['dompurify/LICENSE', 'DOMPURIFY-LICENSE.txt'],
];

function prepareResources() {
  for (const [source] of files) {
    if (!fs.existsSync(path.join(root, 'node_modules', source))) {
      throw new Error('Install the locked Recall dependencies before building Recall Pad: npm ci');
    }
  }
  fs.mkdirSync(resources, { recursive: true });
  for (const [source, destination] of files) {
    fs.copyFileSync(path.join(root, 'node_modules', source), path.join(resources, destination));
  }
  fs.cpSync(path.join(root, 'node_modules/katex/dist/fonts'), path.join(resources, 'fonts'), { recursive: true });
}

function main(args) {
  const allowed = new Set(['--resources-only', '--test', '--device', '--simulator']);
  for (const argument of args) {
    if (!allowed.has(argument)) throw new Error(`Unknown option: ${argument}`);
  }
  prepareResources();
  if (args.includes('--resources-only')) return;
  if (process.platform !== 'darwin') throw new Error('A Mac with full Xcode is required to compile Recall Pad. Web resources are ready.');
  const project = path.join(root, 'apps/ipad/RecallPad.xcodeproj');
  const buildRoot = path.join(root, 'apps/ipad/.build');
  let command;
  if (args.includes('--test')) {
    command = ['-project', project, '-scheme', 'RecallPad', '-derivedDataPath', buildRoot, '-destination', process.env.RECALL_IPAD_TEST_DESTINATION || 'platform=iOS Simulator,name=iPad (A16)', 'CODE_SIGNING_ALLOWED=NO', 'test'];
  } else {
    // Debug uses a bundled PNG icon; Release archives compile the full catalog.
    // A target+SDK compilation needs no simulator runtime for this Debug build.
    command = ['-project', project, '-target', 'RecallPad', '-sdk', args.includes('--simulator') ? 'iphonesimulator' : 'iphoneos', '-configuration', 'Debug', 'CODE_SIGNING_ALLOWED=NO', `SYMROOT=${path.join(buildRoot, 'Build/Products')}`, `OBJROOT=${path.join(buildRoot, 'Build/Intermediates.noindex')}`, 'build'];
  }
  const result = spawnSync('xcodebuild', command, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { prepareResources, main };
