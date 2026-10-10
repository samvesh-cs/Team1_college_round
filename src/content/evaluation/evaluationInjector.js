/**
 * EvaluationInjector — Injects performance evaluation task targets 
 * directly into the webpage DOM so the head-controlled virtual cursor 
 * and dwell activation can interact with them.
 *
 * The extension popup displays instructions, progress, and results.
 * All interactive targets live in the webpage DOM where document.elementFromPoint()
 * and dwell activation can interact with them cleanly.
 */

import { EVALUATION_TASKS } from "../../shared/evaluationTasks.js";
import { computeSessionSummary } from "../../shared/evaluationMetrics.js";

const CONTAINER_ID = "eval-overlay-container";
const STATUS_ID = "eval-overlay-status";
const CANVAS_ID = "eval-task-canvas";

let currentTaskIndex = 0;
let taskState = "idle"; // "idle" | "running" | "completed" | "timed_out"
let taskStartTime = 0;
let taskResults = [];
let activeMode = "handsfree"; // "handsfree" | "conventional"
let activeComparisonId = null;
let countdownTimer = null;
let timeLeft = 30;
let taskFinished = false;
let onSessionFinish = null;

/**
 * Builds and injects the evaluation container into the webpage body.
 */
function injectContainer() {
  removeContainer();

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 2147483600;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
  `;

  // Status bar at top
  const statusBar = document.createElement("div");
  statusBar.id = STATUS_ID;
  statusBar.style.cssText = `
    pointer-events: none;
    background: linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,41,59,0.96));
    backdrop-filter: blur(12px);
    color: white;
    padding: 12px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    border-bottom: 2px solid rgba(20,184,166,0.6);
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  `;
  container.appendChild(statusBar);

  // Task canvas area (interactive targets live here)
  const canvas = document.createElement("div");
  canvas.id = CANVAS_ID;
  canvas.style.cssText = `
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    padding: 40px 20px;
  `;
  container.appendChild(canvas);

  document.body.appendChild(container);

  // Add global keyboard shortcuts: Esc to cancel
  window.addEventListener("keydown", handleGlobalKeyDown);

  return container;
}

function handleGlobalKeyDown(e) {
  if (taskState !== "idle" && e.key === "Escape") {
    e.preventDefault();
    stopEvaluation();
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "EVALUATION_CANCELLED" }).catch(() => {});
    }
  }
}

function removeContainer() {
  window.removeEventListener("keydown", handleGlobalKeyDown);
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) existing.remove();
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function updateStatus() {
  const statusBar = document.getElementById(STATUS_ID);
  if (!statusBar) return;

  const task = EVALUATION_TASKS[currentTaskIndex];
  if (!task) return;
  const isHandsfree = activeMode === "handsfree";
  const modeLabel = isHandsfree ? "HANDSFREE (HEAD TRACKING)" : "CONVENTIONAL (MOUSE & KEYS)";
  const modeColor = isHandsfree ? "#0d9488" : "#6366f1";
  const stateLabel = taskState === "completed" ? "✓ SUCCESS" : taskState === "timed_out" ? "⏱ TIMED OUT" : "ACTIVE";
  const stateColor = taskState === "completed" ? "#10b981" : taskState === "timed_out" ? "#f59e0b" : "#06b6d4";

  statusBar.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;pointer-events:none;">
      <span style="background:${modeColor};color:white;padding:4px 12px;border-radius:12px;font-size:10px;font-weight:800;letter-spacing:0.5px;">${modeLabel}</span>
      <span style="font-weight:700;font-size:13px;color:#f8fafc;">Task ${currentTaskIndex + 1}/${EVALUATION_TASKS.length}: ${task.shortName}</span>
      <span style="background:${stateColor}25;border:1px solid ${stateColor}66;color:${stateColor};padding:2px 10px;border-radius:8px;font-size:11px;font-weight:700;">${stateLabel}</span>
    </div>
    <div style="display:flex;align-items:center;gap:16px;pointer-events:auto;">
      <span style="font-family:monospace;font-weight:700;font-size:15px;color:${timeLeft <= 5 ? '#ef4444' : '#38bdf8'};">⏱ ${timeLeft}s left</span>
      <button id="eval-flag-accidental-btn" type="button" class="eval-target" data-eval-target="true" style="pointer-events:auto;cursor:pointer;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#fca5a5;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:600;">
        Flag Accidental
      </button>
      <button id="eval-cancel-btn" type="button" class="eval-target" data-eval-target="true" style="pointer-events:auto;cursor:pointer;background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.3);color:#cbd5e1;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:600;">
        Exit (Esc)
      </button>
    </div>
  `;

  const flagBtn = document.getElementById("eval-flag-accidental-btn");
  if (flagBtn) flagBtn.addEventListener("click", flagAccidental);
  const cancelBtn = document.getElementById("eval-cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      stopEvaluation();
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "EVALUATION_CANCELLED" }).catch(() => {});
      }
    });
  }
}

/**
 * Creates a styled interactive button target in the webpage DOM.
 */
function createTargetButton(id, label, isTarget, onClick) {
  const btn = document.createElement("button");
  btn.id = id;
  btn.type = "button";
  btn.textContent = label;
  btn.className = "eval-target";
  btn.setAttribute("data-eval-target", "true");
  btn.style.cssText = `
    pointer-events: auto;
    cursor: pointer;
    padding: 14px 26px;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 700;
    border: 2px solid ${isTarget ? "#14b8a6" : "#cbd5e1"};
    background: ${isTarget ? "linear-gradient(135deg, #0d9488, #06b6d4)" : "#f8fafc"};
    color: ${isTarget ? "white" : "#334155"};
    box-shadow: ${isTarget ? "0 4px 18px rgba(20,184,166,0.35)" : "0 2px 6px rgba(0,0,0,0.06)"};
    transition: all 0.15s ease;
    font-family: inherit;
    min-width: 130px;
    user-select: none;
  `;
  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.04)";
    btn.style.boxShadow = isTarget ? "0 6px 24px rgba(20,184,166,0.45)" : "0 4px 10px rgba(0,0,0,0.12)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "scale(1)";
    btn.style.boxShadow = isTarget ? "0 4px 18px rgba(20,184,166,0.35)" : "0 2px 6px rgba(0,0,0,0.06)";
  });
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * Renders interactive targets for the current task inside the webpage canvas.
 */
function renderTask() {
  const canvas = document.getElementById(CANVAS_ID);
  if (!canvas) return;
  canvas.innerHTML = "";

  const task = EVALUATION_TASKS[currentTaskIndex];
  if (!task) return;

  // Instruction box (non-interactive)
  const instructionEl = document.createElement("div");
  instructionEl.style.cssText = `
    pointer-events: none;
    text-align: center;
    margin-bottom: 20px;
    color: #1e293b;
  `;
  instructionEl.innerHTML = `
    <div style="font-size:11px;font-family:monospace;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">
      TASK ${task.order} OF ${EVALUATION_TASKS.length} — ${task.shortName}
    </div>
    <h3 style="font-size:17px;font-weight:800;margin:0 0 8px 0;color:#0f172a;line-height:1.3;">
      ${task.instruction}
    </h3>
    <p style="font-size:12px;color:#64748b;margin:0;line-height:1.4;">
      ${task.hint}
    </p>
  `;

  // Wrapper card for targets (interactive)
  const taskCard = document.createElement("div");
  taskCard.id = "eval-task-card";
  taskCard.className = "eval-target";
  taskCard.setAttribute("data-eval-target", "true");
  taskCard.style.cssText = `
    pointer-events: auto;
    background: white;
    border-radius: 24px;
    padding: 32px 36px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
    border: 1px solid #e2e8f0;
    max-width: 620px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    box-sizing: border-box;
  `;
  taskCard.appendChild(instructionEl);

  const disabled = taskState !== "running";

  // ── TASK 1: Designated Button Click ──
  if (task.id === "task-1-button") {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;justify-content:center;pointer-events:auto;width:100%;";
    row.setAttribute("data-eval-target", "true");

    task.distractors.forEach((dist) => {
      const btn = createTargetButton(dist.id, dist.label, false, () => {
        if (taskState !== "running") return;
        recordSelectionError(dist.id, `Clicked distractor: ${dist.label}`);
      });
      if (disabled) btn.disabled = true;
      row.appendChild(btn);
    });

    const targetBtn = createTargetButton(task.targetElement.id, task.targetElement.label, true, () => {
      if (taskState !== "running") return;
      completeCurrentTask();
    });
    if (disabled) targetBtn.disabled = true;
    row.appendChild(targetBtn);
    taskCard.appendChild(row);
  }

  // ── TASK 2: Numbered Target Badges ──
  else if (task.id === "task-2-target") {
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:420px;width:100%;pointer-events:auto;";
    grid.setAttribute("data-eval-target", "true");

    task.badges.forEach((badge) => {
      const isTarget = badge.number === task.targetNumber;
      const item = document.createElement("button");
      item.id = badge.id;
      item.type = "button";
      item.className = "eval-target";
      item.setAttribute("data-eval-target", "true");
      item.style.cssText = `
        pointer-events: auto;
        cursor: pointer;
        padding: 16px 20px;
        border-radius: 14px;
        border: 2px solid ${isTarget ? "#14b8a6" : "#e2e8f0"};
        background: ${isTarget ? "rgba(20,184,166,0.08)" : "#f8fafc"};
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: all 0.15s ease;
        font-family: inherit;
        user-select: none;
      `;
      item.innerHTML = `
        <span style="font-size:13px;font-weight:700;color:${isTarget ? '#0f766e' : '#334155'};">${badge.label}</span>
        <span style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;font-family:monospace;background:${isTarget ? '#0d9488' : '#e2e8f0'};color:${isTarget ? 'white' : '#475569'};box-shadow:${isTarget ? '0 2px 8px rgba(13,148,136,0.3)' : 'none'};">${badge.number}</span>
      `;
      item.addEventListener("click", () => {
        if (taskState !== "running") return;
        if (isTarget) completeCurrentTask();
        else recordSelectionError(badge.id, `Selected Badge #${badge.number}`);
      });
      if (disabled) item.disabled = true;
      grid.appendChild(item);
    });
    taskCard.appendChild(grid);
  }

  // ── TASK 3: Nav Link (Accessibility Specs) ──
  else if (task.id === "task-3-link") {
    const nav = document.createElement("div");
    nav.setAttribute("data-eval-target", "true");
    nav.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;justify-content:center;background:#f1f5f9;border-radius:14px;padding:10px;pointer-events:auto;width:100%;max-width:520px;";

    task.navLinks.forEach((link) => {
      const isTarget = link.id === task.targetId;
      const a = document.createElement("a");
      a.id = link.id;
      a.href = "#";
      a.textContent = link.label;
      a.className = "eval-target";
      a.setAttribute("data-eval-target", "true");
      a.style.cssText = `
        pointer-events: auto;
        cursor: pointer;
        padding: 10px 18px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: ${isTarget ? "700" : "600"};
        color: ${isTarget ? "#0d9488" : "#64748b"};
        background: ${isTarget ? "white" : "transparent"};
        box-shadow: ${isTarget ? "0 3px 12px rgba(13,148,136,0.2)" : "none"};
        border: ${isTarget ? "2px solid #14b8a6" : "1px solid transparent"};
        text-decoration: none;
        transition: all 0.15s ease;
        user-select: none;
      `;
      a.addEventListener("mouseenter", () => {
        if (!isTarget) {
          a.style.background = "#e2e8f0";
          a.style.color = "#1e293b";
        }
      });
      a.addEventListener("mouseleave", () => {
        if (!isTarget) {
          a.style.background = "transparent";
          a.style.color = "#64748b";
        }
      });
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (taskState !== "running") return;
        if (isTarget) completeCurrentTask();
        else recordSelectionError(link.id, `Navigated to ${link.label}`);
      });
      nav.appendChild(a);
    });
    taskCard.appendChild(nav);
  }

  // ── TASK 4: Scrollable Section ──
  else if (task.id === "task-4-scroll") {
    const scrollBox = document.createElement("div");
    scrollBox.id = "eval-scroll-viewport";
    scrollBox.className = "eval-target";
    scrollBox.setAttribute("data-eval-target", "true");
    scrollBox.style.cssText = `
      pointer-events: auto;
      height: 220px;
      overflow-y: auto;
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      background: #f8fafc;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-sizing: border-box;
    `;

    task.sections.forEach((sec) => {
      const row = document.createElement("div");
      row.id = sec.id;
      row.className = "eval-target";
      row.setAttribute("data-eval-target", "true");
      row.style.cssText = `
        padding: 14px;
        border-radius: 10px;
        border: 1px solid ${sec.isTarget ? "#14b8a6" : "#e2e8f0"};
        background: ${sec.isTarget ? "rgba(20,184,166,0.06)" : "white"};
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 52px;
        box-sizing: border-box;
      `;
      const label = document.createElement("span");
      label.textContent = sec.title;
      label.style.cssText = `font-size:12px;font-weight:${sec.isTarget ? '700' : '600'};color:${sec.isTarget ? '#0f766e' : '#1e293b'};`;
      row.appendChild(label);

      const btn = createTargetButton(sec.buttonId, sec.buttonLabel, sec.isTarget, () => {
        if (taskState !== "running") return;
        if (sec.isTarget) completeCurrentTask();
        else recordSelectionError(sec.buttonId, `Activated ${sec.title}`);
      });
      btn.style.padding = "8px 16px";
      btn.style.fontSize = "11px";
      btn.style.minWidth = "auto";
      if (disabled) btn.disabled = true;
      row.appendChild(btn);
      scrollBox.appendChild(row);
    });
    taskCard.appendChild(scrollBox);
  }

  // ── TASK 5: Text Input Field ──
  else if (task.id === "task-5-input") {
    const form = document.createElement("form");
    form.className = "eval-target";
    form.setAttribute("data-eval-target", "true");
    form.style.cssText = "width:100%;max-width:360px;display:flex;flex-direction:column;gap:12px;pointer-events:auto;";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (taskState !== "running") return;
      const val = input.value.trim().toLowerCase();
      if (val === task.expectedText) completeCurrentTask();
      else recordSelectionError(task.targetId, `Submitted '${val}' instead of '${task.expectedText}'`);
    });

    const input = document.createElement("input");
    input.id = task.targetId;
    input.type = "text";
    input.placeholder = "Type 'handsfree' here...";
    input.className = "eval-target";
    input.setAttribute("data-eval-target", "true");
    input.disabled = disabled;
    input.style.cssText = `
      pointer-events: auto;
      width: 100%;
      padding: 12px 16px;
      border-radius: 12px;
      border: 2px solid #cbd5e1;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s ease;
    `;
    input.addEventListener("focus", () => { input.style.borderColor = "#14b8a6"; });
    input.addEventListener("blur", () => { input.style.borderColor = "#cbd5e1"; });

    const submitBtn = createTargetButton(task.submitButtonId, "Submit Text", true, () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    submitBtn.style.width = "100%";
    if (disabled) { submitBtn.disabled = true; input.disabled = true; }

    form.appendChild(input);
    form.appendChild(submitBtn);
    taskCard.appendChild(form);
  }

  // ── TASK 6: Multi-Step Form Sequence ──
  else if (task.id === "task-6-sequence") {
    const wrapper = document.createElement("div");
    wrapper.className = "eval-target";
    wrapper.setAttribute("data-eval-target", "true");
    wrapper.style.cssText = "width:100%;max-width:380px;display:flex;flex-direction:column;gap:14px;pointer-events:auto;background:#f8fafc;border-radius:14px;padding:20px;border:1px solid #e2e8f0;box-sizing:border-box;";

    const checkLabel = document.createElement("label");
    checkLabel.className = "eval-target";
    checkLabel.setAttribute("data-eval-target", "true");
    checkLabel.style.cssText = "display:flex;align-items:center;gap:12px;cursor:pointer;font-size:13px;font-weight:600;color:#1e293b;user-select:none;";

    const checkbox = document.createElement("input");
    checkbox.id = task.checkboxId;
    checkbox.type = "checkbox";
    checkbox.className = "eval-target";
    checkbox.setAttribute("data-eval-target", "true");
    checkbox.disabled = disabled;
    checkbox.style.cssText = "pointer-events:auto;width:20px;height:20px;accent-color:#0d9488;cursor:pointer;";
    checkLabel.appendChild(checkbox);
    checkLabel.appendChild(document.createTextNode("Agree to Telemetry & Terms (Step 1)"));

    const submitBtn = createTargetButton(task.submitButtonId, "Submit Form (Step 2)", true, () => {
      if (taskState !== "running") return;
      if (checkbox.checked) completeCurrentTask();
      else recordSelectionError(task.submitButtonId, "Submitted without checking checkbox");
    });
    submitBtn.style.width = "100%";
    if (disabled) submitBtn.disabled = true;

    wrapper.appendChild(checkLabel);
    wrapper.appendChild(submitBtn);
    taskCard.appendChild(wrapper);
  }

  canvas.appendChild(taskCard);
  updateStatus();
}

function completeCurrentTask() {
  if (taskFinished) return;
  taskFinished = true;
  stopCountdown();

  const duration = Math.round(performance.now() - taskStartTime);

  taskResults[currentTaskIndex] = {
    ...taskResults[currentTaskIndex],
    startedAt: new Date(Date.now() - duration).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: duration,
    completed: true,
    timedOut: false,
    correctlyExecutedCommands: (taskResults[currentTaskIndex]?.correctlyExecutedCommands || 0) + 1,
    totalActivations: (taskResults[currentTaskIndex]?.totalActivations || 0) + 1,
    totalSelectionAttempts: (taskResults[currentTaskIndex]?.totalSelectionAttempts || 0) + 1,
    attempts: (taskResults[currentTaskIndex]?.attempts || 0) + 1,
  };

  taskState = "completed";
  updateStatus();
  renderTask();

  // Notify extension popup
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      type: "EVALUATION_TASK_COMPLETE",
      taskIndex: currentTaskIndex,
      result: taskResults[currentTaskIndex],
    }).catch(() => {});
  }

  // Auto-advance to next task after 1.2s
  setTimeout(() => advanceTask(), 1200);
}

function handleTaskTimeout() {
  if (taskFinished) return;
  taskFinished = true;
  stopCountdown();

  const duration = Math.round(performance.now() - taskStartTime);
  taskResults[currentTaskIndex] = {
    ...taskResults[currentTaskIndex],
    startedAt: new Date(Date.now() - duration).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: duration,
    completed: false,
    timedOut: true,
  };

  taskState = "timed_out";
  updateStatus();
  renderTask();

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      type: "EVALUATION_TASK_TIMEOUT",
      taskIndex: currentTaskIndex,
      result: taskResults[currentTaskIndex],
    }).catch(() => {});
  }

  setTimeout(() => advanceTask(), 1200);
}

function recordSelectionError(elementId, reason) {
  if (taskFinished) return;
  const r = taskResults[currentTaskIndex];
  r.selectionErrors = (r.selectionErrors || 0) + 1;
  r.totalSelectionAttempts = (r.totalSelectionAttempts || 0) + 1;
  r.attempts = (r.attempts || 0) + 1;
  r.totalActivations = (r.totalActivations || 0) + 1;
  r.errorLog = r.errorLog || [];
  r.errorLog.push(`[${new Date().toLocaleTimeString()}] ${reason} (${elementId})`);

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      type: "EVALUATION_TASK_ERROR",
      taskIndex: currentTaskIndex,
      reason,
      elementId,
    }).catch(() => {});
  }
}

function startCountdown() {
  const task = EVALUATION_TASKS[currentTaskIndex];
  timeLeft = Math.round((task?.timeoutMs || 30000) / 1000);
  stopCountdown();

  countdownTimer = setInterval(() => {
    timeLeft -= 1;
    updateStatus();

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "EVALUATION_TASK_TICK",
        taskIndex: currentTaskIndex,
        timeLeft,
        elapsedMs: Math.round(performance.now() - taskStartTime),
      }).catch(() => {});
    }

    if (timeLeft <= 0) {
      handleTaskTimeout();
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function startTask(index) {
  currentTaskIndex = index;
  taskState = "running";
  taskFinished = false;
  taskStartTime = performance.now();

  const task = EVALUATION_TASKS[index];
  if (!taskResults[index]) {
    taskResults[index] = {
      taskId: task.id,
      order: task.order,
      title: task.title,
      shortName: task.shortName,
      mode: activeMode,
      startedAt: null,
      completedAt: null,
      durationMs: 0,
      completed: false,
      timedOut: false,
      intendedCommands: task.intendedCommands || 1,
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

  renderTask();
  startCountdown();

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      type: "EVALUATION_TASK_START",
      taskIndex: index,
      task,
      mode: activeMode,
      timeLeft,
    }).catch(() => {});
  }
}

function advanceTask() {
  if (currentTaskIndex + 1 < EVALUATION_TASKS.length) {
    startTask(currentTaskIndex + 1);
  } else {
    // All tasks completed — compute summary metrics and send results back to popup
    const summary = computeSessionSummary(taskResults);
    const finalSession = {
      sessionId: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      comparisonId: activeComparisonId,
      mode: activeMode,
      startedAt: taskResults[0]?.startedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "completed",
      taskResults: [...taskResults],
      summary,
    };

    removeContainer();
    taskState = "idle";

    // Report back to the popup via chrome.runtime
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "EVALUATION_SESSION_COMPLETE",
        session: finalSession,
      }).catch(() => {});
    }

    if (typeof onSessionFinish === "function") {
      onSessionFinish(finalSession);
    }
  }
}

/**
 * Start an evaluation session. Called from the content script message handler.
 */
export function startEvaluation(mode = "handsfree", comparisonId = null, finishCallback = null) {
  activeMode = mode;
  activeComparisonId = comparisonId;
  onSessionFinish = finishCallback;
  currentTaskIndex = 0;
  taskResults = [];
  taskState = "idle";

  injectContainer();
  startTask(0);
}

/**
 * Stop/cancel evaluation.
 */
export function stopEvaluation() {
  removeContainer();
  taskState = "idle";
  currentTaskIndex = 0;
  taskResults = [];
}

/**
 * Flag the most recent action as an accidental activation.
 */
export function flagAccidental() {
  if (currentTaskIndex >= 0 && taskResults[currentTaskIndex]) {
    const r = taskResults[currentTaskIndex];
    r.accidentalActivations = (r.accidentalActivations || 0) + 1;
    r.userFlaggedAccidental = (r.userFlaggedAccidental || 0) + 1;
    r.errorLog = r.errorLog || [];
    r.errorLog.push(`[${new Date().toLocaleTimeString()}] User flagged accidental activation`);

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "EVALUATION_ACCIDENTAL_FLAGGED",
        taskIndex: currentTaskIndex,
        accidentalActivations: r.accidentalActivations,
      }).catch(() => {});
    }
  }
}

/**
 * Status query helper for popup sync.
 */
export function getEvaluationStatus() {
  return {
    active: taskState === "running",
    taskState,
    currentTaskIndex,
    activeMode,
    activeComparisonId,
    timeLeft,
    currentTask: EVALUATION_TASKS[currentTaskIndex] || null,
    taskResults,
  };
}
