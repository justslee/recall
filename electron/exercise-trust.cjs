const { createHash } = require("node:crypto");

// Only the local, validated authoring workflow can write these settings.
// Card content and the renderer's setting IPC cannot grant native-code trust.
function exerciseHash(card) {
  const languages = Object.keys(card.code || {})
    .sort()
    .map((language) => {
      const { stub, solution, harness, runtime } = card.code[language];
      return runtime
        ? [language, stub, solution, harness, runtime]
        : [language, stub, solution, harness];
    });
  return createHash("sha256")
    .update(JSON.stringify([card.id, languages]))
    .digest("hex");
}

function canRunExercise(card, getSetting) {
  if (card.kind !== "code") return false;
  const hash = exerciseHash(card);
  return getSetting("validated-code:" + card.id)?.sha256 === hash;
}

module.exports = { exerciseHash, canRunExercise };
