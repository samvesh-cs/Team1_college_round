/**
 * Standardized Benchmark Browser Tasks for Handsfree Performance Evaluation
 * Provides identical task definitions, target IDs, instructions, and success conditions
 * for fair, repeatable comparison across Handsfree and Conventional input modes.
 */

export const EVALUATION_TASKS = [
  {
    id: "task-1-button",
    order: 1,
    title: "1. Click Designated Button",
    shortName: "Button Click",
    instruction: "Activate the primary 'Confirm Order' button among the options.",
    hint: "Locate and activate 'Confirm Order'. Do not activate Cancel or Reset.",
    targetType: "button",
    targetId: "eval-btn-confirm",
    timeoutMs: 30000,
    intendedCommands: 1,
    distractors: [
      { id: "eval-btn-cancel", label: "Cancel", variant: "neutral" },
      { id: "eval-btn-reset", label: "Reset Values", variant: "neutral" },
      { id: "eval-btn-draft", label: "Save Draft", variant: "neutral" },
    ],
    targetElement: { id: "eval-btn-confirm", label: "Confirm Order", variant: "primary" },
  },
  {
    id: "task-2-target",
    order: 2,
    title: "2. Select Numbered Target",
    shortName: "Target Badge",
    instruction: "Select target badge #3 among the numbered items.",
    hint: "Activate target number 3 using voice ('click 3') or dwell / direct mouse click.",
    targetType: "numbered-badge",
    targetId: "eval-badge-3",
    targetNumber: 3,
    timeoutMs: 30000,
    intendedCommands: 1,
    badges: [
      { id: "eval-badge-1", number: 1, label: "Option 1" },
      { id: "eval-badge-2", number: 2, label: "Option 2" },
      { id: "eval-badge-3", number: 3, label: "Option 3 (Target)" },
      { id: "eval-badge-4", number: 4, label: "Option 4" },
    ],
  },
  {
    id: "task-3-link",
    order: 3,
    title: "3. Navigate Designated Link",
    shortName: "Navigation Link",
    instruction: "Navigate to the 'Accessibility Specs' link.",
    hint: "Activate the link labelled 'Accessibility Specs'.",
    targetType: "link",
    targetId: "eval-link-specs",
    timeoutMs: 30000,
    intendedCommands: 1,
    navLinks: [
      { id: "eval-link-overview", label: "Overview", href: "#overview" },
      { id: "eval-link-specs", label: "Accessibility Specs", href: "#specs" },
      { id: "eval-link-shortcuts", label: "Keyboard Shortcuts", href: "#shortcuts" },
      { id: "eval-link-support", label: "Help & Support", href: "#support" },
    ],
  },
  {
    id: "task-4-scroll",
    order: 4,
    title: "4. Scroll to Specified Section",
    shortName: "Scroll & Select",
    instruction: "Scroll down to Section 3: Feature Verification and activate its button.",
    hint: "Scroll down the container until Section 3 is visible, then activate 'Verify Feature'.",
    targetType: "scroll-target",
    targetId: "eval-scroll-btn-3",
    timeoutMs: 35000,
    intendedCommands: 2, // Scroll command + Activation command
    sections: [
      { id: "sec-1", title: "Section 1: Hardware Diagnostics", buttonId: "eval-scroll-btn-1", buttonLabel: "Run Diagnostics" },
      { id: "sec-2", title: "Section 2: Calibration Profiles", buttonId: "eval-scroll-btn-2", buttonLabel: "Load Profile" },
      { id: "sec-3", title: "Section 3: Feature Verification", buttonId: "eval-scroll-btn-3", buttonLabel: "Verify Feature (Target)", isTarget: true },
      { id: "sec-4", title: "Section 4: Diagnostic Logs", buttonId: "eval-scroll-btn-4", buttonLabel: "Export Logs" },
      { id: "sec-5", title: "Section 5: System Telemetry", buttonId: "eval-scroll-btn-5", buttonLabel: "View Telemetry" },
    ],
  },
  {
    id: "task-5-input",
    order: 5,
    title: "5. Enter Short Text in Field",
    shortName: "Text Input",
    instruction: "Click the text box and enter the keyword 'handsfree'.",
    hint: "Focus the field and type 'handsfree'. Press Enter or click 'Submit Text'.",
    targetType: "input",
    targetId: "eval-input-field",
    submitButtonId: "eval-input-submit",
    expectedText: "handsfree",
    timeoutMs: 35000,
    intendedCommands: 2, // Focus + Dictate/Type
  },
  {
    id: "task-6-sequence",
    order: 6,
    title: "6. Multi-Step Form Sequence",
    shortName: "Multi-Step Sequence",
    instruction: "Step 1: Check the 'Agree to Terms' checkbox. Step 2: Click 'Submit Form'.",
    hint: "Complete both steps in order to fulfill the sequence.",
    targetType: "sequence",
    checkboxId: "eval-seq-checkbox",
    submitButtonId: "eval-seq-submit",
    timeoutMs: 40000,
    intendedCommands: 2, // Checkbox toggle + submit button
  },
];

/**
 * Creates a blank task result template.
 * @param {Object} taskDef - Task definition from EVALUATION_TASKS
 * @returns {Object} Initial task result record
 */
export function createInitialTaskResult(taskDef) {
  return {
    taskId: taskDef.id,
    order: taskDef.order,
    title: taskDef.title,
    shortName: taskDef.shortName,
    startedAt: null,
    completedAt: null,
    durationMs: 0,
    completed: false,
    timedOut: false,
    intendedCommands: taskDef.intendedCommands || 1,
    correctlyExecutedCommands: 0,
    selectionErrors: 0,
    totalSelectionAttempts: 0,
    accidentalActivations: 0,
    totalActivations: 0,
    attempts: 0,
    userFlaggedAccidental: 0,
    errorLog: [],
  };
}

/**
 * Creates a blank evaluation session object.
 * @param {string} mode - "handsfree" | "conventional"
 * @param {string} [comparisonId] - Optional linking ID for paired comparison trials
 * @returns {Object} Initial evaluation session
 */
export function createEvaluationSession(mode = "handsfree", comparisonId = null) {
  const sessionId = `eval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    sessionId,
    comparisonId,
    mode,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "in_progress", // "in_progress" | "completed" | "cancelled"
    taskResults: EVALUATION_TASKS.map((t) => createInitialTaskResult(t)),
    summary: null,
  };
}
