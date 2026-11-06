// Build self-contained widget fragments and a synthetic pack. No live-library access.
const fs = require("node:fs"),
  path = require("node:path");
const models = require("./models.cjs");
const root = __dirname;
const css = fs.readFileSync(path.join(root, "shared.css"), "utf8");
const helpers = fs.readFileSync(path.join(root, "browser-helpers.js"), "utf8");
const modelSource = Object.values(models)
  .map((model) => model.toString())
  .join("\n\n");
const manifest = require("./manifest.json");
const cards = manifest.benchmarks.map((entry) => {
  const source = fs
    .readFileSync(path.join(root, entry.template), "utf8")
    .replace("/* BENCHMARK_STYLES */", css)
    .replace("/* BENCHMARK_MODELS */", modelSource)
    .replace("/* BENCHMARK_HELPERS */", helpers);
  if (/BENCHMARK_(?:STYLES|MODELS|HELPERS)/.test(source))
    throw Error("Unresolved source marker");
  fs.writeFileSync(path.join(root, entry.file), source);
  return {
    id: entry.previewCardId,
    conceptId: entry.previewCardId,
    kind: "concept",
    title: entry.title,
    prompt: entry.prompt,
    answer: `<p>${entry.summary}</p>\n\`\`\`widget ${entry.title}\n${source}\n\`\`\``,
    topic: entry.topic,
    decks: ["Visual Benchmarks"],
    tags: ["synthetic", "visual-benchmark"],
    difficulty: "Application",
    status: "ready",
    source: "Original synthetic teaching benchmark",
    widgetsAllowed: true,
  };
});
fs.writeFileSync(
  path.join(root, "preview-pack.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      id: "recall-visual-benchmarks-v1",
      title: "Visual Benchmarks",
      cards,
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(
  `Built ${cards.length} self-contained visual benchmarks and synthetic preview-pack.json\n`,
);
