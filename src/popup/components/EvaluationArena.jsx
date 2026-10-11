import React, { useState, useEffect, useRef } from 'react';
import { EVALUATION_TASKS } from '../../shared/evaluationTasks.js';
import { MSG } from '../../shared/messages.js';

export default function EvaluationArena({
  mode = 'handsfree',
  stageNumber = 1,
  totalStages = 2,
  comparisonId = null,
  onFinish,
  onCancel,
}) {
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [taskState, setTaskState] = useState('running'); // 'running' | 'completed' | 'timed_out'
  const [timeLeft, setTimeLeft] = useState(30);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastActionResult, setLastActionResult] = useState(null);
  const [errorCount, setErrorCount] = useState(0);
  const [accidentalCount, setAccidentalCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // 'connecting' | 'connected' | 'error'

  const currentTask = EVALUATION_TASKS[currentTaskIndex] || EVALUATION_TASKS[0];
  const isHandsfree = mode === 'handsfree';

  // Send message helper
  const sendToActiveTab = (type, payload = {}) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type, ...payload }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn('[Handsfree Eval] Message error:', chrome.runtime.lastError);
          }
        });
      }
    } catch (e) {
      console.warn('[Handsfree Eval] Send failed:', e);
    }
  };

  // Start evaluation on active webpage when mounted
  useEffect(() => {
    // 1. Ensure tracking is started if in handsfree mode
    if (isHandsfree) {
      sendToActiveTab(MSG.START_TRACKING);
    }

    // 2. Start evaluation injection on webpage
    sendToActiveTab(MSG.START_EVALUATION, {
      mode,
      comparisonId,
      stageNumber,
      totalStages,
    });

    setConnectionStatus('connected');

    // 3. Listen to messages from webpage evaluation injector
    const handleMessage = (msg) => {
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'EVALUATION_TASK_START') {
        setCurrentTaskIndex(msg.taskIndex || 0);
        setTimeLeft(msg.timeLeft || 30);
        setTaskState('running');
        setLastActionResult(null);
      } else if (msg.type === 'EVALUATION_TASK_TICK') {
        if (typeof msg.timeLeft === 'number') setTimeLeft(msg.timeLeft);
        if (typeof msg.elapsedMs === 'number') setElapsedMs(msg.elapsedMs);
      } else if (msg.type === 'EVALUATION_TASK_COMPLETE') {
        setTaskState('completed');
        setLastActionResult({
          ok: true,
          message: '✓ Target activated successfully! Advancing...',
        });
      } else if (msg.type === 'EVALUATION_TASK_TIMEOUT') {
        setTaskState('timed_out');
        setLastActionResult({
          ok: false,
          message: '⏱ Task timed out. Advancing to next task...',
        });
      } else if (msg.type === 'EVALUATION_TASK_ERROR') {
        setErrorCount((prev) => prev + 1);
        setLastActionResult({
          ok: false,
          message: msg.reason || 'Incorrect target selected',
        });
      } else if (msg.type === 'EVALUATION_ACCIDENTAL_FLAGGED') {
        setAccidentalCount((prev) => prev + 1);
        setLastActionResult({
          ok: false,
          message: 'Marked last click as accidental activation',
        });
      } else if (msg.type === 'EVALUATION_SESSION_COMPLETE') {
        if (msg.session && typeof onFinish === 'function') {
          onFinish(msg.session);
        }
      } else if (msg.type === 'EVALUATION_CANCELLED') {
        if (typeof onCancel === 'function') {
          onCancel();
        }
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
    }

    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(handleMessage);
      }
    };
  }, [mode, comparisonId]);

  // Cancel evaluation
  const handleCancel = () => {
    sendToActiveTab(MSG.STOP_EVALUATION);
    if (typeof onCancel === 'function') {
      onCancel();
    }
  };

  // Flag accidental activation
  const handleFlagAccidental = () => {
    sendToActiveTab('FLAG_ACCIDENTAL');
    setAccidentalCount((prev) => prev + 1);
    setLastActionResult({
      ok: false,
      message: 'Marked last click as accidental activation.',
    });
  };

  return (
    <div className="space-y-3 relative select-none">
      {/* ── ZONE 1: TOP STATUS & GUIDANCE BAR ── */}
      <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wider uppercase border ${
              isHandsfree
                ? 'bg-teal-50 border-teal-300 text-teal-800'
                : 'bg-indigo-50 border-indigo-300 text-indigo-800'
            }`}
          >
            Stage {stageNumber}/{totalStages}: {isHandsfree ? 'Handsfree' : 'Mouse & Keys'}
          </span>
          <span className="text-xs font-semibold text-slate-700">
            Task {currentTaskIndex + 1} of {EVALUATION_TASKS.length}
          </span>
        </div>

        {/* Live Elapsed & Countdown Timers */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-slate-100 border border-slate-200 text-slate-700">
            <span>⏱️ {(elapsedMs / 1000).toFixed(1)}s</span>
            <span className="text-slate-400">|</span>
            <span className={timeLeft <= 5 ? 'text-red-600 animate-pulse' : 'text-slate-600'}>
              {timeLeft}s left
            </span>
          </div>

          <button
            onClick={handleCancel}
            title="Cancel evaluation and return to dashboard"
            className="px-2 py-0.5 rounded text-[11px] font-medium text-slate-500 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* ── ZONE 2: INSTRUCTIONS & LIVE FEEDBACK BAR ── */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-teal-50/80 via-cyan-50/40 to-white border border-teal-200/80 shadow-xs space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono font-bold text-teal-700 uppercase tracking-wider">
                {currentTask.shortName}
              </span>
              <span className="text-[9px] text-slate-400 font-mono">[{currentTask.id}]</span>
            </div>
            <h3 className="text-xs font-bold text-slate-900 mt-0.5 leading-snug">
              {currentTask.instruction}
            </h3>
            <p className="text-[11px] text-slate-600 mt-0.5">{currentTask.hint}</p>
          </div>

          {/* Task Status Pill */}
          <div className="shrink-0">
            {taskState === 'completed' && (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-bold flex items-center gap-1">
                ✓ Success
              </span>
            )}
            {taskState === 'timed_out' && (
              <span className="px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-800 text-xs font-bold flex items-center gap-1">
                ⏱ Timed Out
              </span>
            )}
            {taskState === 'running' && (
              <span className="px-2 py-0.5 rounded-full bg-teal-100/70 text-teal-800 text-[10px] font-mono font-semibold animate-pulse">
                Active on Webpage
              </span>
            )}
          </div>
        </div>

        {/* Live Feedback Message Banner */}
        {lastActionResult && (
          <div
            className={`mt-2 p-1.5 rounded-lg text-center text-xs font-semibold transition-all ${
              lastActionResult.ok
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}
          >
            {lastActionResult.message}
          </div>
        )}
      </div>

      {/* ── ZONE 3: INFORMATIONAL DOM INJECTION STATUS & CONTROL CARD ── */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-500"></span>
            </span>
            <h4 className="text-xs font-bold text-slate-900">
              Interactive Targets Active on Webpage DOM
            </h4>
          </div>
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
            {isHandsfree ? 'HEAD TRACKING' : 'PHYSICAL MOUSE'}
          </span>
        </div>

        {/* Guidance Box for Current Task */}
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">
              🎯 Target: <span className="text-teal-700 font-bold">{currentTask.shortName}</span>
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              Timeout: {Math.round(currentTask.timeoutMs / 1000)}s
            </span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {isHandsfree ? (
              <>
                Look directly at your webpage. Move the <strong>virtual cursor</strong> over the target element on the webpage and <strong>dwell</strong> (or say <em>"Click"</em>) to activate it.
              </>
            ) : (
              <>
                Use your <strong>conventional mouse or keyboard</strong> to select the target on the webpage.
              </>
            )}
          </p>
        </div>

        {/* Live Counters */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
            <span className="text-[10px] text-slate-500 font-medium">Selection Errors</span>
            <span className="font-mono font-bold text-slate-800 text-sm">{errorCount}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
            <span className="text-[10px] text-slate-500 font-medium">Accidental Clicks</span>
            <span className="font-mono font-bold text-amber-700 text-sm">{accidentalCount}</span>
          </div>
        </div>

        {/* Helper Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleFlagAccidental}
            className="flex-1 py-2 px-3 rounded-xl border border-amber-300 bg-amber-50/70 hover:bg-amber-100/70 text-amber-900 text-xs font-semibold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>🚩 Flag Accidental Activation</span>
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold transition-all cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
