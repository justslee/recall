// Reproducible synthetic workload. Never reads a personal vault or profile.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { saveConfig } = require("../electron/config.cjs");
const { KnowledgeSpace } = require("../electron/knowledge-space.cjs");
const count = Math.max(100, Math.min(50000, Number(process.argv[2]) || 10000));
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ];
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-index-bench-")),
    folder = path.join(root, "profile"),
    notes = path.join(root, "notes");
  fs.mkdirSync(notes);
  for (let i = 0; i < count; i++)
    fs.writeFileSync(
      path.join(notes, `note-${i}.md`),
      `---\nrecall:\n  id: synthetic:${i}\naliases: [Alias ${i}]\n---\n# Synthetic concept ${i}\n\n${i % 2 ? "Probability" : "Engineering"} notes explain a useful concept.\n\n${"A short explanation with a concrete example and a question to test understanding. ".repeat(12)}\nUniqueTerm${i}\n`,
    );
  saveConfig(folder, {
    sources: [{ id: "bench", root: notes, type: "markdown", write: true }],
  });
  const service = new KnowledgeSpace(folder);
  try {
    const begin = performance.now();
    await service.call("refresh");
    const buildMs = performance.now() - begin;
    const results = { notes: count, initialIndexMs: buildMs, measurements: {} };
    for (const [label, query] of [
      ["alias", `Alias ${count - 1}`],
      ["selective", `UniqueTerm${count - 1}`],
      ["common", "Probability"],
      ["miss", "no_such_objective"],
    ]) {
      const times = [];
      for (let i = 0; i < 60; i++) {
        const t = performance.now();
        const result = await service.call("search", {
          query,
          sourceId: "bench",
          limit: 12,
        });
        times.push(performance.now() - t);
        if (label !== "miss" && !result.documents.length)
          throw Error("Missing benchmark result");
      }
      results.measurements[label] = {
        workerRoundTripP50Ms: percentile(times, 0.5),
        workerRoundTripP95Ms: percentile(times, 0.95),
      };
    }
    const recheck = performance.now();
    await service.call("refresh");
    results.unchangedMetadataScanMs = performance.now() - recheck;
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
