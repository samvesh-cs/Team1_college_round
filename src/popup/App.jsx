import React, { useState, useEffect, useRef } from 'react';
import { MSG } from '../shared/messages.js';
import { loadSettings, saveSettings, getDefaults, validateSettingsPatch } from '../shared/settings.js';

function send(type, payload = {}) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) {
          // Ignore connection errors if background script is idle
        }
      });
    }
  } catch (e) {
    // Graceful fallback in non-extension environments
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('controls'); // 'controls' | 'calibration' | 'commands'
  const [isRunning, setIsRunning] = useState(false);
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [typingEnabled, setTypingEnabled] = useState(false);
  const [intentLockEnabled, setIntentLockEnabled] = useState(true);

  // Calibration state
  const [calibrationStep, setCalibrationStep] = useState(3);
  const [dwellTime, setDwellTime] = useState(1200);
  const [smoothingFactor, setSmoothingFactor] = useState(0.75);
  const [sensitivity, setSensitivity] = useState(4.5);
  const [deadZone, setDeadZone] = useState(0.02);
  const [statusError, setStatusError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);

  // === WS-4 Phase D: newest-wins settings core (avoids stale closures) ===
  const settingsRef = useRef(getDefaults());
  const revRef = useRef(0);
  const dirtyRef = useRef(false);
  const saveChainRef = useRef(Promise.resolve());

  function requestStatus() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
          resolve({ ok: false, error: 'NO_EXTENSION_API' });
          return;
        }
        chrome.runtime.sendMessage({ type: MSG.GET_STATUS }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res);
        });
      } catch (e) {
        resolve({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    });
  }

  const toggleEngine = () => {
    const nextState = !isRunning;
    setIsRunning(nextState);
    if (nextState) {
      send(MSG.START_TRACKING);
      if (voiceEnabled) send(MSG.START_VOICE);
    } else {
      send(MSG.STOP_TRACKING);
      send(MSG.STOP_VOICE);
    }
  };

  useEffect(() => {
    let mounted = true;
    loadSettings()
      .then((s) => {
        // Fix 1: never let the initial load overwrite settings the user already changed.
        if (!mounted || dirtyRef.current) return;
        const { clean } = validateSettingsPatch(s);
        const next = { ...getDefaults(), ...clean };
        settingsRef.current = next;
        setTrackingEnabled(next.trackingEnabled);
        setVoiceEnabled(next.voiceEnabled);
        setTypingEnabled(next.typingEnabled);
        setIntentLockEnabled(next.intentLockEnabled);
        setDwellTime(next.dwellDuration);
        setSmoothingFactor(next.smoothing);
        setSensitivity(next.sensitivity);
        setDeadZone(next.deadZone);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const syncStatesFromSettings = (next) => {
    setTrackingEnabled(next.trackingEnabled);
    setVoiceEnabled(next.voiceEnabled);
    setTypingEnabled(next.typingEnabled);
    setIntentLockEnabled(next.intentLockEnabled);
    setDwellTime(next.dwellDuration);
    setSmoothingFactor(next.smoothing);
    setSensitivity(next.sensitivity);
    setDeadZone(next.deadZone);
  };

  const applyLocalUpdate = (patch) => {
    // Fix 4: never save or broadcast an invalid patch.
    const { clean, errors } = validateSettingsPatch(patch);
    if (errors.length > 0) {
      setSaveError(errors[0]);
      return;
    }
    dirtyRef.current = true;
    // Timestamp-based revision: strictly increasing within and across popup sessions.
    revRef.current = Math.max(Date.now(), revRef.current + 1);
    const rev = revRef.current;
    const next = { ...settingsRef.current, ...clean };
    settingsRef.current = next;
    syncStatesFromSettings(next);
    // Fix 2: serialize storage writes so they finish in issue order (newest last).
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        await saveSettings(next);
        if (revRef.current === rev) setSaveError(null);
      } catch (e) {
        if (revRef.current === rev) {
          setSaveError(e && e.message ? e.message : 'SAVE_FAILED');
        }
      }
    });
    // Fix 2: content keeps an in-memory copy and does not re-save (popup is primary writer).
    send(MSG.UPDATE_SETTINGS, { settings: next, rev });
  };

  // === WS-4 Phase C: query real content status; show errors instead of fake telemetry ===
  // Bounded polling while open: the content script may still be initializing
  // on a freshly restored tab. Terminal errors stop immediately.
  const describeStatusError = (code) => {
    if (code === 'RESTRICTED_PAGE') {
      return 'Extensions cannot run on this page (e.g. chrome:// pages or the Chrome Web Store). Switch to a regular webpage.';
    }
    if (code === 'NO_ACTIVE_TAB') {
      return 'No active tab found. Click the webpage, then open the popup again.';
    }
    if (/receiving end|NO_RESPONSE_FROM_CONTENT/i.test(code || '')) {
      return "Couldn't reach this tab. Reload the page, then open the popup again.";
    }
    return `Status unavailable: ${code}. Open a regular web page and reload the extension.`;
  };

  useEffect(() => {
    let mounted = true;
    let timer = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    const POLL_INTERVAL_MS = 1500;
    // Restricted pages can never host a content script: fail fast instead
    // of polling. Anything else may be slow initialization — keep trying.
    const isTerminal = (res) =>
      !!res && res.ok === false && (res.error === 'RESTRICTED_PAGE' || res.error === 'NO_ACTIVE_TAB');
    const finish = (res) => {
      if (!mounted) return;
      if (!res || res.ok === false) {
        setStatusError(res && res.error ? res.error : 'STATUS_UNAVAILABLE');
        setVoiceListening(false);
      } else {
        setStatusError(null);
        setVoiceListening(!!res.listening);
        // Show Active only for genuinely running modalities, not for
        // merely enabled preferences.
        setIsRunning(!!(res.tracking || res.listening));
      }
      setIsConnecting(false);
    };
    const poll = () => {
      if (!mounted) return;
      attempts += 1;
      requestStatus().then((res) => {
        if (!mounted) return;
        if ((res && res.ok) || isTerminal(res) || attempts >= MAX_ATTEMPTS) {
          finish(res);
          return;
        }
        // Still initializing: show a connecting state and try again.
        // Next poll starts only after this response — never overlapping.
        setIsConnecting(true);
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      });
    };
    poll();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="w-[390px] h-[580px] bg-[#f8fafc] text-slate-800 flex flex-col font-sans overflow-hidden select-none relative">
      {/* Ambient glowing radial spotlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 ambient-spotlight-light z-0 opacity-75"
      ></div>

      {/* Decorative subtle background accents */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        <div className="absolute -top-16 -left-12 w-48 h-48 bg-cyan-200/40 rounded-full blur-2xl animate-float-slow"></div>
        <div className="absolute top-1/2 -right-16 w-56 h-56 bg-teal-100/50 rounded-full blur-3xl animate-pulse-slow"></div>
      </div>

      {/* Vibrant Top Line Accent */}
      <div className="w-full h-1 bg-gradient-to-r from-teal-500 via-cyan-500 to-emerald-400 z-20 shrink-0"></div>

      {/* Main Extension Header */}
      <header className="px-4 py-2.5 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between z-10 shrink-0 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-teal-600 to-cyan-500 flex items-center justify-center shadow-md shadow-teal-600/25">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round"></path>
              <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" strokeLinecap="round" strokeLinejoin="round"></path>
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-none">Handsfree</h1>
              
            </div>
          </div>
        </div>

        {/* Dynamic Status Indicator */}
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${isRunning
              ? 'bg-teal-50 border-teal-300 text-teal-800 shadow-xs'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${isRunning ? 'bg-teal-500 animate-ping' : 'bg-emerald-500 animate-ping'
                }`}
            ></span>
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${isRunning ? 'bg-teal-600' : 'bg-emerald-600'
                }`}
            ></span>
          </span>
          <span>{isRunning ? 'Active' : 'Ready'}</span>
        </div>
      </header>

      {/* Segmented Navigation Bar with Zero-Blink Smooth Track */}
      <nav className="px-3 py-1.5 bg-slate-50/90 border-b border-slate-200/80 z-10 shrink-0">
        <div className="bg-slate-200/60 p-0.5 rounded-lg flex items-center gap-0.5">
          <button
            onClick={() => setActiveTab('controls')}
            className={`flex-1 py-1 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors duration-150 ${activeTab === 'controls'
                ? 'bg-white text-teal-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
              }`}
            type="button"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" strokeLinecap="round" strokeLinejoin="round"></path>
            </svg>
            Controls
          </button>

          <button
            onClick={() => setActiveTab('calibration')}
            className={`flex-1 py-1 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors duration-150 ${activeTab === 'calibration'
                ? 'bg-white text-teal-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
              }`}
            type="button"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M3 12h3m12 0h3M12 3v3m0 12v3" strokeLinecap="round"></path>
            </svg>
            Calibration
          </button>

          <button
            onClick={() => setActiveTab('commands')}
            className={`flex-1 py-1 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors duration-150 ${activeTab === 'commands'
                ? 'bg-white text-teal-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
              }`}
            type="button"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" strokeLinecap="round" strokeLinejoin="round"></path>
            </svg>
            Voice Ref
          </button>
        </div>
      </nav>

      {/* Main Tab Content Viewport */}
      <main className="flex-1 px-3.5 py-2.5 overflow-y-auto min-h-0 z-10 space-y-2.5">
        {/* ================= TAB 1: CONTROLS ================= */}
        {activeTab === 'controls' && (
          <div className="space-y-2.5">
            {/* Primary Action Button */}
            <button
              onClick={toggleEngine}
              className="w-full relative group overflow-hidden rounded-xl bg-gradient-to-r from-teal-600 via-teal-500 to-cyan-600 p-[1px] font-medium transition-all duration-200 hover:scale-[1.008] active:scale-[0.99] glow-primary-light focus:outline-none focus:ring-2 focus:ring-teal-400"
              type="button"
            >
              <div
                className={`relative w-full py-2.5 px-3 rounded-[11px] transition-all flex items-center justify-center gap-2 shadow-md ${isRunning
                    ? 'bg-gradient-to-r from-slate-800 to-slate-900 text-white'
                    : 'bg-gradient-to-r from-teal-600 to-cyan-600 group-hover:from-teal-700 group-hover:to-cyan-700 text-white'
                  }`}
              >
                {!isRunning && (
                  <div className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 animate-shimmer pointer-events-none"></div>
                )}
                <svg className="w-4 h-4 text-white shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M12 3v9" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
                <span className="text-xs font-bold tracking-wide uppercase drop-shadow-sm">
                  {isRunning ? 'Stop Handsfree Engine' : 'Start Handsfree Engine'}
                </span>
              </div>
            </button>

            {/* WS-4 Phase C: real status errors (no fake telemetry) */}
            {statusError && (
              <div className="p-2 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-700 font-medium" role="alert">
                {describeStatusError(statusError)}
              </div>
            )}
            {!statusError && isConnecting && (
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-medium" role="status">
                Connecting to this tab…
              </div>
            )}
            {/* WS-4 Phase D: storage save errors (never imply success on failure) */}
            {saveError && (
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 font-medium" role="alert">
                Settings not saved: {saveError}. Changes apply for this session and will be retried on the next change.
              </div>
            )}

            {/* Feature Toggles List */}
            <div className="space-y-1.5" data-purpose="toggle-controls-list">
              {/* Toggle 1: Head Tracking */}
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-200 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round"></path>
                      <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900 leading-tight">Head Tracking</h3>
                    <p className="text-[10px] text-slate-500">Webcam gesture cursor navigation</p>
                  </div>
                </div>
                {/* Precision Mechanical Switch */}
                <button
                  onClick={() => {
                    const next = !settingsRef.current.trackingEnabled;
                    applyLocalUpdate({ trackingEnabled: next });
                    // Send unconditionally: with auto-activation the content
                    // script may be running while this popup never started it.
                    send(next ? MSG.START_TRACKING : MSG.STOP_TRACKING);
                  }}
                  aria-checked={trackingEnabled}
                  className={`relative inline-flex h-[22px] w-10 p-0.5 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${trackingEnabled ? 'bg-[#0f766e]' : 'bg-slate-300'
                    }`}
                  role="switch"
                  type="button"
                >
                  <span
                    className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${trackingEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                      }`}
                  ></span>
                </button>
              </div>

              {/* Toggle 2: Voice Commands */}
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center border border-sky-200 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xs font-semibold text-slate-900 leading-tight">Voice Commands</h3>
                      {voiceEnabled && (
                        <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-semibold ${
                          voiceListening
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {voiceListening ? 'LISTENING' : 'IDLE'}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500">"Click", "Scroll", "Back", "Tab"</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = !settingsRef.current.voiceEnabled;
                    applyLocalUpdate({ voiceEnabled: next });
                    // Send unconditionally: with auto-activation the content
                    // script may be running while this popup never started it.
                    send(next ? MSG.START_VOICE : MSG.STOP_VOICE);
                  }}
                  aria-checked={voiceEnabled}
                  className={`relative inline-flex h-[22px] w-10 p-0.5 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${voiceEnabled ? 'bg-[#0f766e]' : 'bg-slate-300'
                    }`}
                  role="switch"
                  type="button"
                >
                  <span
                    className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${voiceEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                      }`}
                  ></span>
                </button>
              </div>

              {/* Toggle 3: Voice Typing */}
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-200 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xs font-semibold text-slate-900 leading-tight">Voice Typing</h3>
                      {typingEnabled && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-100 text-indigo-800 font-mono font-semibold">
                          DICTATE
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500">Dictate into active input fields</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = !settingsRef.current.typingEnabled;
                    applyLocalUpdate({ typingEnabled: next });
                    send(next ? MSG.START_DICTATION : MSG.STOP_DICTATION);
                  }}
                  aria-checked={typingEnabled}
                  className={`relative inline-flex h-[22px] w-10 p-0.5 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${typingEnabled ? 'bg-[#0f766e]' : 'bg-slate-300'
                    }`}
                  role="switch"
                  type="button"
                >
                  <span
                    className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${typingEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                      }`}
                  ></span>
                </button>
              </div>

              {/* Toggle 4: Auto-Click (Dwell) */}
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xs font-semibold text-slate-900 leading-tight">Auto-Click (Dwell)</h3>
                      <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-semibold ${
                        intentLockEnabled ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {intentLockEnabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">Hover over elements to auto-click</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = !settingsRef.current.intentLockEnabled;
                    applyLocalUpdate({ intentLockEnabled: next, autoClickEnabled: next });
                  }}
                  aria-checked={intentLockEnabled}
                  className={`relative inline-flex h-[22px] w-10 p-0.5 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${intentLockEnabled ? 'bg-[#0f766e]' : 'bg-slate-300'
                    }`}
                  role="switch"
                  type="button"
                >
                  <span
                    className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${intentLockEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                      }`}
                  ></span>
                </button>
              </div>
            </div>

            {/* Quick Telemetry Mini-Cards */}
            <div className="grid grid-cols-2 gap-2" data-purpose="quick-metrics">
              <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">DWELL TIME</div>
                <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                  <span>{dwellTime}ms</span>
                  <span className="text-[9px] font-semibold text-teal-700">Dynamic</span>
                </div>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">SMOOTHING</div>
                <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                  <span>{smoothingFactor}</span>
                  <span className="text-[9px] font-semibold text-teal-700">Kalman</span>
                </div>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">ENGINE FPS</div>
                <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                  <span>—</span>
                  <span className="text-[9px] font-semibold text-slate-400">Phase C</span>
                </div>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-xs">
                <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">LATENCY</div>
                <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                  <span>—</span>
                  <span className="text-[9px] font-semibold text-slate-400">Phase C</span>
                </div>
              </div>
            </div>

            {/* Tracking Tuning Sliders (WS-4 Phase B) */}
            <div className="p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xs space-y-2.5" data-purpose="tracking-tuning">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">Tracking Tuning</span>
                <span className="text-[9px] font-mono font-semibold text-teal-700 uppercase">Persisted</span>
              </div>
              <div>
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                  <label htmlFor="handsfree-sensitivity">Sensitivity</label>
                  <span className="font-mono text-slate-900">{sensitivity}</span>
                </div>
                <input
                  id="handsfree-sensitivity"
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value={sensitivity}
                  onChange={(e) => {
                    applyLocalUpdate({ sensitivity: Number(e.target.value) });
                  }}
                  className="w-full accent-teal-600"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                  <label htmlFor="handsfree-smoothing">Smoothing</label>
                  <span className="font-mono text-slate-900">{smoothingFactor}</span>
                </div>
                <input
                  id="handsfree-smoothing"
                  type="range"
                  min="0.1"
                  max="0.95"
                  step="0.05"
                  value={smoothingFactor}
                  onChange={(e) => {
                    applyLocalUpdate({ smoothing: Number(e.target.value) });
                  }}
                  className="w-full accent-teal-600"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                  <label htmlFor="handsfree-deadzone">Dead zone</label>
                  <span className="font-mono text-slate-900">{deadZone}</span>
                </div>
                <input
                  id="handsfree-deadzone"
                  type="range"
                  min="0.005"
                  max="0.1"
                  step="0.005"
                  value={deadZone}
                  onChange={(e) => {
                    applyLocalUpdate({ deadZone: Number(e.target.value) });
                  }}
                  className="w-full accent-teal-600"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                  <label htmlFor="handsfree-dwell">Dwell duration (ms)</label>
                  <span className="font-mono text-slate-900">{dwellTime}ms</span>
                </div>
                <input
                  id="handsfree-dwell"
                  type="range"
                  min="500"
                  max="3000"
                  step="100"
                  value={dwellTime}
                  onChange={(e) => {
                    applyLocalUpdate({ dwellDuration: Number(e.target.value) });
                  }}
                  className="w-full accent-teal-600"
                />
              </div>
            </div>

            {/* Quick Calibration Banner */}
            <div
              onClick={() => {
                send(MSG.START_TRACKING);
                send(MSG.CALIBRATE);
                setTimeout(() => {
                  try { window.close(); } catch (_) {}
                }, 150);
              }}
              className="p-2.5 rounded-xl bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200/80 flex items-center justify-between cursor-pointer hover:border-teal-300 transition-all shadow-xs"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center shadow-xs">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M3 12h3m12 0h3M12 3v3m0 12v3" strokeLinecap="round"></path>
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Open Calibration Studio</h4>
                  <p className="text-[10px] text-slate-600">Live webcam · 3-sec countdown · Alt+C shortcut</p>
                </div>
              </div>
              <span className="text-xs text-teal-700 font-bold flex items-center gap-1">
                Launch &rarr;
              </span>
            </div>
          </div>
        )}

        {/* ================= TAB 2: CALIBRATION ================= */}
        {activeTab === 'calibration' && (
          /* Real interactive calibration is the on-screen overlay launched on the active tab */
          <div className="space-y-2.5">
            <div>
              <h3 className="text-xs font-bold text-slate-900">Calibration Studio</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Opens a full-screen guided calibration overlay with live webcam feed on your active tab.</p>
            </div>

            {/* Calibration Launch Card */}
            <div className="relative w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner flex flex-col items-center justify-center py-7 px-5 gap-3.5">
              {/* Animated face guide preview */}
              <div className="w-20 h-20 rounded-full border-2 border-cyan-500/60 bg-slate-900 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <svg className="w-10 h-10 text-cyan-400" fill="none" viewBox="0 0 200 240">
                  <ellipse cx="100" cy="120" opacity="0.7" rx="58" ry="82" stroke="currentColor" strokeDasharray="4 3" strokeWidth="3"/>
                  <circle cx="75" cy="105" fill="currentColor" r="6" opacity="0.8"/>
                  <circle cx="125" cy="105" fill="currentColor" r="6" opacity="0.8"/>
                  <polyline fill="none" points="100,105 100,130 95,140 105,140" stroke="currentColor" strokeWidth="2.5"/>
                  <ellipse cx="100" cy="162" fill="currentColor" rx="13" ry="4" opacity="0.6"/>
                </svg>
              </div>

              <div className="text-center">
                <p className="text-white text-xs font-bold mb-1">Live webcam overlay</p>
                <p className="text-slate-400 text-[10px] leading-relaxed">
                  Opens on the current web page with your camera feed.<br/>
                  Popup will close so you can see the alignment reticle.
                </p>
              </div>

              <div className="flex flex-col gap-1.5 w-full">
                <button
                  type="button"
                  onClick={() => {
                    send(MSG.START_TRACKING);
                    send(MSG.CALIBRATE);
                    setTimeout(() => {
                      try { window.close(); } catch (_) {}
                    }, 150);
                  }}
                  className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white font-bold text-xs transition-all shadow-md shadow-teal-600/25 flex items-center justify-center gap-2"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M3 12h3m12 0h3M12 3v3m0 12v3" strokeLinecap="round"/>
                  </svg>
                  Launch Calibration Studio
                </button>
                <p className="text-center text-[9px] text-slate-500 font-mono">
                  ⌨ Shortcut: <strong className="text-slate-400">Alt + C</strong> from any page
                </p>
              </div>
            </div>

            {/* Quick-tips */}
            <div className="p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xs space-y-1.5">
              <span className="text-[10px] font-mono font-bold text-teal-700 uppercase tracking-wider">How it works</span>
              <div className="space-y-1 mt-1">
                {[
                  ['1', 'Camera opens in a circular HUD on screen'],
                  ['2', 'Align your face inside the circular reticle'],
                  ['3', 'Press Space or click Calibrate'],
                  ['4', 'Hold still for 3 seconds — neutral posture locks in'],
                ].map(([step, tip]) => (
                  <div key={step} className="flex items-start gap-2 text-[10px] text-slate-600">
                    <span className="w-4 h-4 rounded-full bg-teal-100 text-teal-800 font-bold text-[9px] flex items-center justify-center shrink-0">{step}</span>
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Calibration Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => send(MSG.CALIBRATE, { quick: true })}
                className="flex-1 py-1.5 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all shadow-xs flex items-center justify-center gap-1.5"
                type="button"
              >
                <svg className="w-3.5 h-3.5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
                </svg>
                Quick Recenter
              </button>
              <button
                onClick={() => {
                  send(MSG.START_TRACKING);
                  send(MSG.CALIBRATE);
                  setTimeout(() => {
                    try { window.close(); } catch (_) {}
                  }, 150);
                }}
                className="flex-1 py-1.5 px-3 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white font-bold text-xs transition-all shadow-md shadow-teal-600/25 flex items-center justify-center gap-1"
                type="button"
              >
                <span>Full Studio</span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ================= TAB 3: VOICE COMMANDS REFERENCE ================= */}
        {activeTab === 'commands' && (
          <div className="space-y-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900">Voice Command Cheatsheet</h3>
              <p className="text-[10px] text-slate-500">Natural voice intents recognized by Handsfree</p>
            </div>

            <div className="space-y-2">
              {/* Category 1 */}
              <div className="p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xs">
                <span className="text-[10px] font-mono font-bold text-teal-700 uppercase tracking-wider">
                  Navigation &amp; Clicks
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-xs">
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Click"</span>
                    <span className="text-[10px] text-slate-500 font-mono">Primary</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Double Click"</span>
                    <span className="text-[10px] text-slate-500 font-mono">Select</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Back"</span>
                    <span className="text-[10px] text-slate-500 font-mono">History</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Forward"</span>
                    <span className="text-[10px] text-slate-500 font-mono">History</span>
                  </div>
                </div>
              </div>

              {/* Category 2 */}
              <div className="p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xs">
                <span className="text-[10px] font-mono font-bold text-sky-700 uppercase tracking-wider">
                  Page Scrolling
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-xs">
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Scroll Down"</span>
                    <span className="text-[10px] text-slate-500 font-mono">300px</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Scroll Up"</span>
                    <span className="text-[10px] text-slate-500 font-mono">300px</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Top"</span>
                    <span className="text-[10px] text-slate-500 font-mono">Home</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Bottom"</span>
                    <span className="text-[10px] text-slate-500 font-mono">End</span>
                  </div>
                </div>
              </div>

              {/* Category 3 */}
              <div className="p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xs">
                <span className="text-[10px] font-mono font-bold text-indigo-700 uppercase tracking-wider">
                  Modal &amp; Input Commands
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-xs">
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Type [phrase]"</span>
                    <span className="text-[10px] text-slate-500 font-mono">Dictate</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Press Enter"</span>
                    <span className="text-[10px] text-slate-500 font-mono">Submit</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Pause"</span>
                    <span className="text-[10px] text-slate-500 font-mono">Hold</span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-800">"Resume"</span>
                    <span className="text-[10px] text-slate-500 font-mono">Release</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Global Compact Footer */}
      <footer className="px-4 py-1.5 bg-white/80 backdrop-blur border-t border-slate-200/80 flex items-center justify-between text-[10px] text-slate-500 font-medium z-10 shrink-0">
      </footer>
    </div>
  );
}
