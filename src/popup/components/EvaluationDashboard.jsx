import React, { useState, useEffect } from 'react';
import {
  getEvaluationSessions,
  saveEvaluationSession,
  clearEvaluationHistory,
  deleteEvaluationSession,
  getLatestComparison,
} from '../../shared/evaluationStorage.js';
import {
  compareSessions,
  formatDuration,
  formatPercentage,
} from '../../shared/evaluationMetrics.js';
import EvaluationArena from './EvaluationArena.jsx';

export default function EvaluationDashboard({ onOpenTab }) {
  // View states: 'dashboard' | 'arena' | 'stage_transition'
  const [viewState, setViewState] = useState('dashboard');
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Guided comparison run state
  const [activeSessionRun, setActiveSessionRun] = useState({
    comparisonId: null,
    currentStage: 1, // 1: Handsfree, 2: Conventional
    handsfreeSession: null,
    conventionalSession: null,
  });

  // Transition countdown timer
  const [transitionCountdown, setTransitionCountdown] = useState(3);

  // Load history from local storage
  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const all = await getEvaluationSessions();
      setSessions(all);
      if (all.length > 0 && !selectedSessionId) {
        setSelectedSessionId(all[0].sessionId);
      }
    } catch (e) {
      console.warn('[Handsfree Eval] Storage load error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  // ── Unified Action: Start Performance Evaluation (Guided 2-Stage Comparison) ──
  const handleStartEvaluation = () => {
    const comparisonId = `comp_${Date.now()}`;
    setActiveSessionRun({
      comparisonId,
      currentStage: 1,
      handsfreeSession: null,
      conventionalSession: null,
    });
    setViewState('arena');
  };

  // Called when Arena finishes a stage
  const handleArenaFinish = async (completedSession) => {
    try {
      // Save completed stage session to storage
      await saveEvaluationSession(completedSession);

      if (activeSessionRun.currentStage === 1) {
        // Stage 1 (Handsfree) finished! Advance to Stage 2 (Conventional)
        setActiveSessionRun((prev) => ({
          ...prev,
          currentStage: 2,
          handsfreeSession: completedSession,
        }));
        setTransitionCountdown(3);
        setViewState('stage_transition');
      } else {
        // Stage 2 (Conventional) finished! Comparison is complete
        setActiveSessionRun((prev) => ({
          ...prev,
          conventionalSession: completedSession,
        }));
        await loadHistory();
        setSelectedSessionId(completedSession.sessionId);
        setViewState('dashboard');
      }
    } catch (err) {
      console.error('[Handsfree Eval] Error persisting session:', err);
      setViewState('dashboard');
    }
  };

  // Transition timer for resetting environment between stages
  useEffect(() => {
    if (viewState === 'stage_transition') {
      const timer = setInterval(() => {
        setTransitionCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setViewState('arena');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [viewState]);

  // Handle Cancel Evaluation
  const handleCancelEvaluation = () => {
    setViewState('dashboard');
  };

  // Confirm Clear History
  const handleConfirmClear = async () => {
    await clearEvaluationHistory();
    setSessions([]);
    setSelectedSessionId(null);
    setShowClearConfirm(false);
  };

  // Delete Individual Session
  const handleDeleteSession = async (id) => {
    await deleteEvaluationSession(id);
    const updated = sessions.filter((s) => s.sessionId !== id);
    setSessions(updated);
    if (selectedSessionId === id) {
      setSelectedSessionId(updated[0]?.sessionId || null);
    }
  };

  // Export Results as JSON
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(sessions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `handsfree_evaluation_results_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Find latest comparison pair
  const latestHandsfree = sessions.find((s) => s.mode === 'handsfree') || null;
  const latestConventional = sessions.find((s) => s.mode === 'conventional') || null;
  const comparisonReport = compareSessions(latestHandsfree?.summary, latestConventional?.summary);

  // Selected session for individual details
  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId) || sessions[0] || null;

  // ════════════════════ VIEW: ARENA RUNNING ════════════════════
  if (viewState === 'arena') {
    const isStage1 = activeSessionRun.currentStage === 1;
    return (
      <EvaluationArena
        mode={isStage1 ? 'handsfree' : 'conventional'}
        stageNumber={activeSessionRun.currentStage}
        totalStages={2}
        comparisonId={activeSessionRun.comparisonId}
        onFinish={handleArenaFinish}
        onCancel={handleCancelEvaluation}
      />
    );
  }

  // ════════════════════ VIEW: STAGE TRANSITION & RESET ════════════════════
  if (viewState === 'stage_transition') {
    return (
      <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center mx-auto text-xl shadow-xs">
          🔄
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase">
            Stage 1 (Handsfree) Complete
          </span>
          <h3 className="text-sm font-bold text-slate-900 mt-1">
            Resetting Test Environment for Stage 2
          </h3>
          <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
            All target elements, inputs, and timers are being restored to their exact initial state.
            In <strong>Stage 2</strong>, perform the identical tasks using your <strong>conventional mouse and keyboard</strong>.
          </p>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 font-medium max-w-xs mx-auto">
          <span>Starting Stage 2 in </span>
          <span className="font-mono font-bold text-teal-700 text-sm">{transitionCountdown}s</span>
          <span className="text-slate-400"> (or click below)</span>
        </div>

        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={handleCancelEvaluation}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            type="button"
          >
            Cancel Evaluation
          </button>
          <button
            onClick={() => setViewState('arena')}
            className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20"
            type="button"
          >
            Start Stage 2 (Mouse &amp; Keyboard) &rarr;
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════ VIEW: MAIN DASHBOARD ════════════════════
  return (
    <div className="space-y-3">
      {/* ── 1. Header & Single Action Card ── */}
      <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900">Performance Evaluation</span>
              <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold bg-teal-100 text-teal-800">
                BENCHMARK
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
              Compare task completion time, accuracy, and error rates of Handsfree vs conventional mouse &amp; keyboard.
            </p>
          </div>

          {sessions.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleExportJSON}
                title="Export evaluation history as JSON"
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                type="button"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => setShowClearConfirm(true)}
                title="Clear evaluation history"
                className="p-1 rounded text-red-400 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                type="button"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Clear Confirmation Prompt */}
        {showClearConfirm && (
          <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-center justify-between gap-2">
            <span>Clear all stored evaluation records?</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleConfirmClear}
                className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold cursor-pointer"
                type="button"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-2 py-0.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded text-[10px] cursor-pointer"
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Unified "Start Evaluation" Primary Action Button */}
        <button
          onClick={handleStartEvaluation}
          className="w-full p-3 rounded-xl bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 text-white hover:from-slate-800 hover:to-slate-800 transition-all text-left flex items-center justify-between shadow-md group cursor-pointer"
          type="button"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white group-hover:text-teal-200 transition-colors">
                Start Performance Evaluation
              </span>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-teal-500/20 text-teal-300 border border-teal-400/30 font-mono">
                2-STAGE TRIAL
              </span>
            </div>
            <p className="text-[10px] text-slate-300 leading-snug">
              Stage 1: Handsfree &rarr; Reset &rarr; Stage 2: Conventional Mouse &amp; Keyboard
            </p>
          </div>
          <span className="text-xs font-bold text-teal-400 group-hover:translate-x-1 transition-transform pl-2">
            Start &rarr;
          </span>
        </button>
      </div>

      {/* ── 2. Side-by-Side Comparison Table (Section 9 Specification) ── */}
      {comparisonReport.isCompleteComparison ? (
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-900">Side-by-Side Evaluation Comparison</span>
              <p className="text-[10px] text-slate-500">
                Direct measurement results across equivalent standardized tasks
              </p>
            </div>
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
              MEASURED
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] font-mono text-slate-500 uppercase">
                  <th className="py-2 font-semibold">Metric</th>
                  <th className="py-2 font-semibold text-right text-teal-800">Handsfree</th>
                  <th className="py-2 font-semibold text-right text-indigo-800">Mouse &amp; Keyboard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {comparisonReport.rows.map((row) => {
                  const formatVal = (v, count, total) => {
                    if (v === null || v === undefined) return 'N/A';
                    if (row.unit === 'ms') return formatDuration(v);
                    if (row.key === 'selectionErrorRate' || row.key === 'accidentalActivationRate') {
                      return `${count} (${formatPercentage(v)})`;
                    }
                    return formatPercentage(v);
                  };

                  return (
                    <tr key={row.key} className="hover:bg-slate-50/50">
                      <td className="py-2 text-slate-700 font-medium text-[11px]">{row.label}</td>
                      <td className="py-2 text-right font-mono font-bold text-teal-800 text-[11px]">
                        {formatVal(row.handsfreeVal, row.handsfreeCount, row.handsfreeTotal)}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-indigo-800 text-[11px]">
                        {formatVal(row.conventionalVal, row.conventionalCount, row.conventionalTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-start gap-1.5 text-[9px] text-slate-400">
            <span>ℹ️</span>
            <span>
              Values derived directly from real evaluation trials. Small trial sizes are descriptive and do not assert broad statistical significance.
            </span>
          </div>
        </div>
      ) : (
        sessions.length > 0 && (
          <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
            <div>
              <p className="font-semibold text-[11px]">Partial Trial Recorded</p>
              <p className="text-[10px] text-amber-700 mt-0.5">
                Complete both stages to unlock the full side-by-side comparison report.
              </p>
            </div>
            <button
              onClick={handleStartEvaluation}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold cursor-pointer"
              type="button"
            >
              Run Full Trial &rarr;
            </button>
          </div>
        )
      )}

      {/* ── 3. Summary Cards for Selected Session ── */}
      {selectedSession && selectedSession.summary && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900">
                {selectedSession.mode === 'handsfree' ? 'Handsfree Stage Summary' : 'Mouse & Keyboard Stage Summary'}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                ({new Date(selectedSession.startedAt).toLocaleTimeString()})
              </span>
            </div>

            {/* Session Switcher Pills */}
            {sessions.length > 1 && (
              <select
                value={selectedSession.sessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="text-[10px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 cursor-pointer"
              >
                {sessions.map((s, idx) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    #{idx + 1} {s.mode.toUpperCase()} ({new Date(s.startedAt).toLocaleTimeString()})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-xs">
              <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">AVERAGE DURATION</div>
              <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                <span>{formatDuration(selectedSession.summary.averageDurationMs)}</span>
                <span className="text-[9px] font-semibold text-teal-700">
                  Median: {formatDuration(selectedSession.summary.medianDurationMs)}
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-xs">
              <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">SUCCESS RATE</div>
              <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                <span>{formatPercentage(selectedSession.summary.successRate)}</span>
                <span className="text-[9px] font-semibold text-emerald-600">
                  {selectedSession.summary.completedTasks}/{selectedSession.summary.totalTasks} Done
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-xs">
              <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">COMMAND ACCURACY</div>
              <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                <span>{formatPercentage(selectedSession.summary.commandAccuracy)}</span>
                <span className="text-[9px] font-semibold text-teal-700">
                  {selectedSession.summary.correctlyExecutedCommands}/{selectedSession.summary.totalIntendedCommands} Valid
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-xs">
              <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">SELECTION ERRORS</div>
              <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                <span>{selectedSession.summary.totalSelectionErrors} Errors</span>
                <span className="text-[9px] font-semibold text-amber-700">
                  Rate: {formatPercentage(selectedSession.summary.selectionErrorRate)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. Detailed Per-Task Breakdown ── */}
      {selectedSession && Array.isArray(selectedSession.taskResults) && (
        <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-xs space-y-2">
          <span className="text-xs font-bold text-slate-900">Per-Task Breakdown</span>
          <div className="space-y-1.5 divide-y divide-slate-100">
            {selectedSession.taskResults.map((t, idx) => (
              <div key={t.taskId || idx} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-800">{t.title}</span>
                    {t.completed ? (
                      <span className="text-[9px] font-mono text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                        PASS
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono text-red-700 bg-red-50 px-1 py-0.2 rounded border border-red-200">
                        TIMED OUT
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                    <span>Errors: {t.selectionErrors || 0}</span>
                    <span>Accidental: {t.accidentalActivations || 0}</span>
                    <span>Attempts: {t.attempts || 0}</span>
                  </div>
                </div>
                <div className="text-right font-mono font-bold text-slate-900 text-xs">
                  {t.completed ? formatDuration(t.durationMs) : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 5. Empty State ── */}
      {sessions.length === 0 && !isLoading && (
        <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
          <span className="text-2xl">📊</span>
          <h4 className="text-xs font-bold text-slate-900">No Evaluations Recorded</h4>
          <p className="text-[10px] text-slate-500 max-w-xs mx-auto">
            Click <strong>Start Performance Evaluation</strong> above to begin the standardized comparison test.
          </p>
        </div>
      )}
    </div>
  );
}
