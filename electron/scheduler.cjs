const { fsrs, calculateLearningSteps, Rating } = require("ts-fsrs");

function createScheduler() {
  // ts-fsrs 6's legacy facade retains the FSRS-6 model and elapsed-day policy.
  // Its modern DefaultScheduler uses FSRS-7; that requires a separate migration.
  return fsrs({
    request_retention: 0.9,
    enable_fuzz: false,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"],
  }).useStrategy("LearningSteps", (config, state, step) => {
    const result = calculateLearningSteps(config, state, step);
    // Preserve v5's whole-minute Hard/Good intervals (e.g. 6m, not 5m30s).
    for (const grade of [Rating.Hard, Rating.Good]) {
      if (result[grade])
        result[grade].scheduledMinutes = Math.round(
          result[grade].scheduledMinutes,
        );
    }
    return result;
  });
}

module.exports = { createScheduler };
