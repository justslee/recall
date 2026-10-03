// Executes only explicitly supplied, locally authored exercise code.
// Review the bundle and mutants before invoking. Runner requires the macOS sandbox.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Runner } = require("../electron/runner.cjs");
const { exerciseHash } = require("../electron/exercise-trust.cjs");
const args = process.argv.slice(2);
const dataIndex = args.indexOf("--data");
let selectedProfile;
if (dataIndex >= 0) {
  selectedProfile = args[dataIndex + 1];
  assert(
    selectedProfile && !selectedProfile.startsWith("--"),
    "Missing --data profile",
  );
  args.splice(dataIndex, 2);
}
const [bundleFile, mutantsFile, reportFile] = args;
assert(
  args.length === 3 && bundleFile && mutantsFile && reportFile,
  "Usage: node validate-card-exercises.cjs [--data PROFILE] cards.json mutants.json report.json",
);
const cards = JSON.parse(fs.readFileSync(bundleFile, "utf8"));
const mutants = JSON.parse(fs.readFileSync(mutantsFile, "utf8"));
const report = {
  version: 1,
  validatedAt: new Date().toISOString(),
  exercises: [],
};
const runner = new Runner({
  scientificPython: path.join(
    require("../electron/config.cjs").dataDir(selectedProfile),
    "python/bin/python3",
  ),
});
(async () => {
  for (const card of cards.filter((c) => c.kind === "code")) {
    const languages = {};
    for (const [language, config] of Object.entries(card.code)) {
      assert(["python", "cpp"].includes(language));
      for (const key of ["stub", "solution", "harness"])
        assert(typeof config[key] === "string" && config[key].trim());
      const reference = await runner.run(card, language, config.solution);
      assert.equal(
        reference.status,
        "passed",
        `${card.id}/${language} reference: ${reference.output}`,
      );
      const stub = await runner.run(card, language, config.stub);
      assert.equal(
        stub.status,
        "failed",
        `${card.id}/${language} stub must fail tests`,
      );
      const variants = mutants[card.id]?.[language];
      assert(
        variants?.length,
        "Provide at least one realistic incorrect implementation",
      );
      const rejected = [];
      for (const variant of variants) {
        assert(
          variant.name &&
            variant.code !== config.solution &&
            variant.code !== config.stub,
        );
        const result = await runner.run(card, language, variant.code);
        assert.equal(
          result.status,
          "failed",
          `${card.id}/${language} accepted mutant ${variant.name}: ${result.output}`,
        );
        assert.notEqual(
          result.phase,
          "compile",
          "Mutants must compile and fail behavior checks",
        );
        assert(
          !/SyntaxError:|IndentationError:|TabError:/.test(result.output),
          "Python mutants must parse and fail behavior checks",
        );
        rejected.push(variant.name);
      }
      languages[language] = {
        reference: "passed",
        stub: "failed",
        rejectedMutants: rejected,
        output: reference.output,
      };
    }
    report.exercises.push({
      id: card.id,
      sha256: exerciseHash(card),
      languages,
    });
    console.log("PASS " + card.id);
  }
  fs.writeFileSync(
    path.resolve(reportFile),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(`Validated ${report.exercises.length} coding exercises.`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
