/**
 * Evaluation Metrics Utility Functions
 * Pure mathematical functions for Handsfree Performance Evaluation.
 * Handles zero denominators, missing data, and invalid inputs gracefully.
 */

/**
 * Calculates duration between two performance/timestamp markers in milliseconds.
 * @param {number} startMs - Start time from performance.now() or Date.now()
 * @param {number} endMs - End time
 * @returns {number} Duration in milliseconds (non-negative)
 */
export function calculateTaskDuration(startMs, endMs) {
  if (typeof startMs !== "number" || typeof endMs !== "number" || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 0;
  }
  return Math.max(0, Math.round(endMs - startMs));
}

/**
 * Calculates average task duration for completed tasks.
 * @param {number[]} durations - Array of duration values in milliseconds
 * @returns {number} Average duration in milliseconds, or 0 if empty
 */
export function calculateAverageDuration(durations) {
  if (!Array.isArray(durations) || durations.length === 0) {
    return 0;
  }
  const valid = durations.filter((d) => typeof d === "number" && Number.isFinite(d) && d >= 0);
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, d) => acc + d, 0);
  return Math.round(sum / valid.length);
}

/**
 * Calculates median task duration.
 * @param {number[]} durations - Array of durations in milliseconds
 * @returns {number} Median duration in milliseconds, or 0 if empty
 */
export function calculateMedianDuration(durations) {
  if (!Array.isArray(durations) || durations.length === 0) {
    return 0;
  }
  const valid = durations.filter((d) => typeof d === "number" && Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const mid = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) {
    return Math.round(valid[mid]);
  }
  return Math.round((valid[mid - 1] + valid[mid]) / 2);
}

/**
 * Calculates command accuracy percentage.
 * Formula: (Correctly executed commands / Total intended commands) * 100
 * @param {number} correctlyExecuted
 * @param {number} totalIntended
 * @returns {number|null} Accuracy percentage (0-100), or null if no intended commands
 */
export function calculateCommandAccuracy(correctlyExecuted, totalIntended) {
  if (typeof totalIntended !== "number" || totalIntended <= 0 || !Number.isFinite(totalIntended)) {
    return null; // Represented as "N/A"
  }
  const validCorrect = typeof correctlyExecuted === "number" && Number.isFinite(correctlyExecuted) ? Math.max(0, correctlyExecuted) : 0;
  const ratio = Math.min(1, validCorrect / totalIntended);
  return +(ratio * 100).toFixed(1);
}

/**
 * Calculates selection error rate percentage.
 * Formula: (Incorrect selections / Total selection attempts) * 100
 * @param {number} incorrectSelections
 * @param {number} totalAttempts
 * @returns {number} Selection error rate percentage (0-100)
 */
export function calculateSelectionErrorRate(incorrectSelections, totalAttempts) {
  if (typeof totalAttempts !== "number" || totalAttempts <= 0 || !Number.isFinite(totalAttempts)) {
    return 0;
  }
  const validErrors = typeof incorrectSelections === "number" && Number.isFinite(incorrectSelections) ? Math.max(0, incorrectSelections) : 0;
  const ratio = Math.min(1, validErrors / totalAttempts);
  return +(ratio * 100).toFixed(1);
}

/**
 * Calculates accidental activation rate percentage.
 * Formula: (Accidental activations / Total activations) * 100
 * @param {number} accidentalActivations
 * @param {number} totalActivations
 * @returns {number} Accidental activation rate percentage (0-100)
 */
export function calculateAccidentalActivationRate(accidentalActivations, totalActivations) {
  if (typeof totalActivations !== "number" || totalActivations <= 0 || !Number.isFinite(totalActivations)) {
    return 0;
  }
  const validAccidental = typeof accidentalActivations === "number" && Number.isFinite(accidentalActivations) ? Math.max(0, accidentalActivations) : 0;
  const ratio = Math.min(1, validAccidental / totalActivations);
  return +(ratio * 100).toFixed(1);
}

/**
 * Calculates task success rate percentage.
 * @param {number} completedTasks
 * @param {number} totalTasks
 * @returns {number} Success rate percentage (0-100)
 */
export function calculateSuccessRate(completedTasks, totalTasks) {
  if (typeof totalTasks !== "number" || totalTasks <= 0 || !Number.isFinite(totalTasks)) {
    return 0;
  }
  const validCompleted = typeof completedTasks === "number" && Number.isFinite(completedTasks) ? Math.max(0, completedTasks) : 0;
  const ratio = Math.min(1, validCompleted / totalTasks);
  return +(ratio * 100).toFixed(1);
}

/**
 * Computes comprehensive summary metrics for an entire evaluation session.
 * @param {Array<Object>} taskResults - Array of individual task result records
 * @returns {Object} Summarized metrics object
 */
export function computeSessionSummary(taskResults = []) {
  if (!Array.isArray(taskResults) || taskResults.length === 0) {
    return {
      totalTasks: 0,
      completedTasks: 0,
      timedOutTasks: 0,
      successRate: 0,
      averageDurationMs: 0,
      medianDurationMs: 0,
      totalIntendedCommands: 0,
      correctlyExecutedCommands: 0,
      commandAccuracy: null,
      totalSelectionErrors: 0,
      totalSelectionAttempts: 0,
      selectionErrorRate: 0,
      totalAccidentalActivations: 0,
      totalActivations: 0,
      accidentalActivationRate: 0,
    };
  }

  const totalTasks = taskResults.length;
  const completedTasks = taskResults.filter((t) => Boolean(t.completed)).length;
  const timedOutTasks = taskResults.filter((t) => Boolean(t.timedOut)).length;
  const successRate = calculateSuccessRate(completedTasks, totalTasks);

  const completedDurations = taskResults
    .filter((t) => Boolean(t.completed) && typeof t.durationMs === "number" && t.durationMs >= 0)
    .map((t) => t.durationMs);

  const averageDurationMs = calculateAverageDuration(completedDurations);
  const medianDurationMs = calculateMedianDuration(completedDurations);

  let totalIntendedCommands = 0;
  let correctlyExecutedCommands = 0;
  let totalSelectionErrors = 0;
  let totalSelectionAttempts = 0;
  let totalAccidentalActivations = 0;
  let totalActivations = 0;

  for (const t of taskResults) {
    if (typeof t.intendedCommands === "number") totalIntendedCommands += Math.max(0, t.intendedCommands);
    if (typeof t.correctlyExecutedCommands === "number") correctlyExecutedCommands += Math.max(0, t.correctlyExecutedCommands);
    if (typeof t.selectionErrors === "number") totalSelectionErrors += Math.max(0, t.selectionErrors);
    if (typeof t.totalSelectionAttempts === "number") totalSelectionAttempts += Math.max(0, t.totalSelectionAttempts);
    if (typeof t.accidentalActivations === "number") totalAccidentalActivations += Math.max(0, t.accidentalActivations);
    if (typeof t.totalActivations === "number") totalActivations += Math.max(0, t.totalActivations);
  }

  const commandAccuracy = calculateCommandAccuracy(correctlyExecutedCommands, totalIntendedCommands);
  const selectionErrorRate = calculateSelectionErrorRate(totalSelectionErrors, totalSelectionAttempts);
  const accidentalActivationRate = calculateAccidentalActivationRate(totalAccidentalActivations, totalActivations);

  return {
    totalTasks,
    completedTasks,
    timedOutTasks,
    successRate,
    averageDurationMs,
    medianDurationMs,
    totalIntendedCommands,
    correctlyExecutedCommands,
    commandAccuracy,
    totalSelectionErrors,
    totalSelectionAttempts,
    selectionErrorRate,
    totalAccidentalActivations,
    totalActivations,
    accidentalActivationRate,
  };
}

/**
 * Compares two evaluated modes (Handsfree vs Conventional) across all standard metrics.
 * @param {Object} handsfreeSummary - Summary metrics for Handsfree
 * @param {Object} conventionalSummary - Summary metrics for Conventional Mouse & Keyboard
 * @returns {Object} Comparison report with deltas, percentage differences, and performance leaders
 */
export function compareSessions(handsfreeSummary, conventionalSummary) {
  if (!handsfreeSummary || !conventionalSummary) {
    return { isCompleteComparison: false };
  }

  const metrics = [
    {
      key: "averageDurationMs",
      label: "Average task completion time",
      unit: "ms",
      lowerIsBetter: true,
      handsfreeVal: handsfreeSummary.averageDurationMs ?? 0,
      conventionalVal: conventionalSummary.averageDurationMs ?? 0,
    },
    {
      key: "medianDurationMs",
      label: "Median completion time",
      unit: "ms",
      lowerIsBetter: true,
      handsfreeVal: handsfreeSummary.medianDurationMs ?? 0,
      conventionalVal: conventionalSummary.medianDurationMs ?? 0,
    },
    {
      key: "successRate",
      label: "Task success rate",
      unit: "%",
      lowerIsBetter: false,
      handsfreeVal: handsfreeSummary.successRate ?? 0,
      conventionalVal: conventionalSummary.successRate ?? 0,
    },
    {
      key: "commandAccuracy",
      label: "Command/action accuracy",
      unit: "%",
      lowerIsBetter: false,
      handsfreeVal: handsfreeSummary.commandAccuracy,
      conventionalVal: conventionalSummary.commandAccuracy,
    },
    {
      key: "selectionErrorRate",
      label: "Selection errors",
      unit: "%",
      lowerIsBetter: true,
      handsfreeVal: handsfreeSummary.selectionErrorRate ?? 0,
      conventionalVal: conventionalSummary.selectionErrorRate ?? 0,
      handsfreeCount: handsfreeSummary.totalSelectionErrors ?? 0,
      conventionalCount: conventionalSummary.totalSelectionErrors ?? 0,
      handsfreeTotal: handsfreeSummary.totalSelectionAttempts ?? 0,
      conventionalTotal: conventionalSummary.totalSelectionAttempts ?? 0,
    },
    {
      key: "accidentalActivationRate",
      label: "Accidental activations",
      unit: "%",
      lowerIsBetter: true,
      handsfreeVal: handsfreeSummary.accidentalActivationRate ?? 0,
      conventionalVal: conventionalSummary.accidentalActivationRate ?? 0,
      handsfreeCount: handsfreeSummary.totalAccidentalActivations ?? 0,
      conventionalCount: conventionalSummary.totalAccidentalActivations ?? 0,
      handsfreeTotal: handsfreeSummary.totalActivations ?? 0,
      conventionalTotal: conventionalSummary.totalActivations ?? 0,
    },
  ];

  const rows = metrics.map((m) => {
    const h = m.handsfreeVal;
    const c = m.conventionalVal;

    let delta = null;
    let pctDiff = null;
    let winner = "tie";

    if (h !== null && c !== null) {
      delta = +(h - c).toFixed(1);
      if (c !== 0) {
        pctDiff = +(((h - c) / c) * 100).toFixed(1);
      }

      if (h === c) {
        winner = "tie";
      } else if (m.lowerIsBetter) {
        winner = h < c ? "handsfree" : "conventional";
      } else {
        winner = h > c ? "handsfree" : "conventional";
      }
    } else {
      winner = "inconclusive";
    }

    return {
      ...m,
      delta,
      pctDiff,
      winner,
    };
  });

  return {
    isCompleteComparison: true,
    rows,
    handsfreeSummary,
    conventionalSummary,
  };
}

/**
 * Human-readable duration formatter (e.g. 1420ms -> "1.42s", 250ms -> "250ms").
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (typeof ms !== "number" || isNaN(ms) || ms < 0) return "0ms";
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${Math.round(ms)}ms`;
}

/**
 * Human-readable percentage formatter.
 * @param {number|null} val
 * @returns {string}
 */
export function formatPercentage(val) {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return `${val.toFixed(1)}%`;
}
