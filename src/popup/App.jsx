import React, { useState, useEffect } from 'react';
import { MSG } from '../shared/messages.js';

function send(type, payload = {}) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type, ...payload }, () => {
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
  const [dwellTime, setDwellTime] = useState(800);
  const [smoothingFactor, setSmoothingFactor] = useState(0.85);

  // Simulated telemetry
  const [fps, setFps] = useState(60.0);
  const [latency, setLatency] = useState(12);

  // Live Coordinates Telemetry State
  const [liveCoords, setLiveCoords] = useState({
    x: 640,
    y: 360,
    pctX: 50.0,
    pctY: 50.0,
    pitch: 1.2,
    yaw: -0.4,
    roll: 0.0,
    confidence: 99.4,
    targetDelta: 3.8,
  });

  // Detect if running in full tab mode or popup mode
  const isTabMode = typeof window !== 'undefined' && (
    window.innerWidth > 800 ||
    window.location.search.includes('mode=tab') ||
    window.location.hash.includes('tab')
  );

  // Window Sizing & Controls State
  // windowMode: 'normal' | 'minimized' | 'maximized'
  const [windowMode, setWindowMode] = useState('normal');
  const [sizePreset, setSizePreset] = useState('compact'); // 'compact' (390px) | 'medium' (560px) | 'wide' (740px)
  const [customWidth, setCustomWidth] = useState(null);
  const [customHeight, setCustomHeight] = useState(null);

  // 1. Initial URL Param Parsing & Storage Synchronization on Mount
  useEffect(() => {
    // Check URL search parameters (e.g., ?mode=tab&tab=calibration)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam === 'calibration' || tabParam === 'controls' || tabParam === 'commands') {
        setActiveTab(tabParam);
      }
    }

    // Sync state with chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(
        ['engineRunning', 'voiceEnabled', 'trackingEnabled', 'typingEnabled', 'intentLockEnabled'],
        (res) => {
          if (res) {
            if (typeof res.engineRunning === 'boolean') setIsRunning(res.engineRunning);
            if (typeof res.voiceEnabled === 'boolean') setVoiceEnabled(res.voiceEnabled);
            if (typeof res.trackingEnabled === 'boolean') setTrackingEnabled(res.trackingEnabled);
            if (typeof res.typingEnabled === 'boolean') setTypingEnabled(res.typingEnabled);
            if (typeof res.intentLockEnabled === 'boolean') setIntentLockEnabled(res.intentLockEnabled);
          }
        }
      );

      // Listen to cross-script storage events (e.g. if content/background modifies engine state)
      const handleStorageChange = (changes, area) => {
        if (area === 'local') {
          if (changes.engineRunning !== undefined) {
            setIsRunning(Boolean(changes.engineRunning.newValue));
          }
          if (changes.voiceEnabled !== undefined) {
            setVoiceEnabled(Boolean(changes.voiceEnabled.newValue));
          }
          if (changes.trackingEnabled !== undefined) {
            setTrackingEnabled(Boolean(changes.trackingEnabled.newValue));
          }
        }
      };
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  // 2. Live Coordinates Mouse Tracker Hook
  useEffect(() => {
    const handleMouseMove = (e) => {
      const winW = window.innerWidth || 800;
      const winH = window.innerHeight || 600;
      const pctX = +((e.clientX / winW) * 100).toFixed(1);
      const pctY = +((e.clientY / winH) * 100).toFixed(1);
      const delta = +(Math.sqrt(Math.pow(e.clientX - winW / 2, 2) + Math.pow(e.clientY - winH / 2, 2)) * 0.05).toFixed(1);

      setLiveCoords({
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        pctX,
        pctY,
        pitch: +((pctY - 50) * 0.08).toFixed(1),
        yaw: +((pctX - 50) * 0.08).toFixed(1),
        roll: 0.0,
        confidence: +(98.5 + Math.random() * 1.4).toFixed(1),
        targetDelta: delta,
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // 3. Dynamic Extension Popup Window Dimensions Sync
  useEffect(() => {
    if (isTabMode) {
      document.body.classList.add('tab-view');
      try {
        document.documentElement.style.width = '100%';
        document.body.style.width = '100%';
        document.documentElement.style.height = '100%';
        document.body.style.height = '100%';
      } catch (e) {}
      return;
    }

    let w = 390;
    let h = 580;

    if (windowMode === 'minimized') {
      w = 360;
      h = 190; // True minimize: compact mini-dock view
    } else if (windowMode === 'maximized') {
      w = 800;
      h = 600; // Max allowed popup viewport bounds
    } else {
      w = customWidth || (sizePreset === 'medium' ? 560 : sizePreset === 'wide' ? 740 : 390);
      h = customHeight || 580;
    }

    try {
      document.documentElement.style.width = `${w}px`;
      document.body.style.width = `${w}px`;
      document.documentElement.style.height = `${h}px`;
      document.body.style.height = `${h}px`;
    } catch (e) {}
  }, [windowMode, sizePreset, customWidth, customHeight, isTabMode]);

  // 4. Open In Tab / Window with Duplicate Tab Prevention
  const openInNewWindow = (targetTab = null) => {
    const queryParam = targetTab ? `?mode=tab&tab=${targetTab}` : `?mode=tab`;
    const baseUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
      ? chrome.runtime.getURL('src/popup/index.html')
      : `${window.location.origin}${window.location.pathname}`;
    const fullUrl = `${baseUrl}${queryParam}`;

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        chrome.tabs.query({}, (tabs) => {
          // Check if a tab with this extension popup already exists
          const existingTab = tabs?.find(t => t.url && t.url.includes('src/popup/index.html'));
          if (existingTab && existingTab.id) {
            // Focus existing tab and update its URL if navigating to a specific tab
            chrome.tabs.update(existingTab.id, { active: true, url: fullUrl }, () => {
              if (existingTab.windowId && chrome.windows?.update) {
                chrome.windows.update(existingTab.windowId, { focused: true });
              }
            });
          } else {
            // Open new tab if none already open
            chrome.tabs.create({ url: fullUrl });
          }
        });
      } else {
        window.open(fullUrl, 'handsfree_workspace_tab');
      }
    } catch (e) {
      window.open(fullUrl, 'handsfree_workspace_tab');
    }
  };

  // 5. Engine Toggle with Local Storage Persistence & Direct Active Tab Activation
  const toggleEngine = () => {
    const nextState = !isRunning;
    setIsRunning(nextState);

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        engineRunning: nextState,
        voiceEnabled: voiceEnabled,
        agentState: nextState ? 'bar' : 'orb'
      });
    }

    const startPayload = { type: MSG.START_VOICE, agentState: 'bar' };
    const stopPayload = { type: MSG.STOP_VOICE };

    if (nextState) {
      if (trackingEnabled) send(MSG.START_TRACKING);
      if (voiceEnabled) send(MSG.START_VOICE, startPayload);
    } else {
      send(MSG.STOP_TRACKING);
      send(MSG.STOP_VOICE);
    }

    // Direct active web tab dispatch with automated script injection fallback
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const activeTab = tabs?.[0];
        if (
          activeTab?.id &&
          activeTab.url &&
          !activeTab.url.startsWith("chrome://") &&
          !activeTab.url.startsWith("chrome-extension://") &&
          !activeTab.url.startsWith("edge://")
        ) {
          const targetMsg = nextState ? startPayload : stopPayload;
          chrome.tabs.sendMessage(activeTab.id, targetMsg, () => {
            if (chrome.runtime.lastError && nextState && chrome.scripting) {
              // Inject content scripts into already-open unrefreshed tab
              chrome.scripting.insertCSS({
                target: { tabId: activeTab.id },
                files: [
                  "src/content/styles/overlay.css",
                  "src/content/styles/voice-overlay.css",
                  "src/content/styles/ai-agent.css"
                ]
              }).catch(() => {});
              chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ["src/content/content.js"]
              }).then(() => {
                setTimeout(() => {
                  chrome.tabs.sendMessage(activeTab.id, startPayload).catch(() => {});
                }, 200);
              }).catch(() => {});
            }
          });
        }
      });
    }
  };

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setFps(+(59.5 + Math.random() * 1.5).toFixed(1));
      setLatency(Math.floor(11 + Math.random() * 3));
    }, 1500);
    return () => clearInterval(interval);
  }, [isRunning]);

  const widthStyle = windowMode === 'minimized'
    ? '360px'
    : windowMode === 'maximized'
    ? '800px'
    : customWidth 
    ? `${customWidth}px` 
    : sizePreset === 'medium' 
    ? '560px' 
    : sizePreset === 'wide' 
    ? '740px' 
    : '390px';

  const heightStyle = windowMode === 'minimized'
    ? '190px'
    : windowMode === 'maximized'
    ? '600px'
    : customHeight 
    ? `${customHeight}px` 
    : '580px';

  return (
    <div 
      style={isTabMode ? undefined : { width: widthStyle, height: heightStyle, minWidth: '340px', minHeight: '180px' }}
      className={isTabMode 
        ? "w-full max-w-4xl min-h-screen mx-auto bg-[#f8fafc] text-slate-800 flex flex-col font-sans select-none relative shadow-2xl border-x border-slate-200/80" 
        : "bg-[#f8fafc] text-slate-800 flex flex-col font-sans overflow-hidden select-none relative transition-all duration-150 rounded-2xl border border-slate-200/90 shadow-2xl"
      }
    >
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
      <header className="px-3.5 py-2.5 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between z-10 shrink-0 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-teal-600 to-cyan-500 flex items-center justify-center shadow-md shadow-teal-600/25 shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round"></path>
              <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" strokeLinecap="round" strokeLinejoin="round"></path>
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-none">Handsfree</h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.2 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                v2.4 Pro
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">Head-Tracking &amp; Voice Accessibility</p>
          </div>
        </div>

        {/* Header Right Actions: Status & Comprehensive Window Controls */}
        <div className="flex items-center gap-1.5">
          {/* Dynamic Status Indicator */}
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
              isRunning
                ? 'bg-teal-50 border-teal-300 text-teal-800 shadow-xs'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isRunning ? 'bg-teal-500 animate-ping' : 'bg-emerald-500 animate-ping'
                }`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isRunning ? 'bg-teal-600' : 'bg-emerald-600'
                }`}
              ></span>
            </span>
            <span>{isRunning ? 'Active' : 'Ready'}</span>
          </div>

          {/* Minimize / Collapse Window Button */}
          <button
            onClick={() => {
              setCustomWidth(null);
              setCustomHeight(null);
              setWindowMode(prev => prev === 'minimized' ? 'normal' : 'minimized');
            }}
            title={windowMode === 'minimized' ? "Restore window view" : "Minimize popup (compact dock)"}
            className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            type="button"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>

          {/* Sizing Preset Switcher (Compact / Medium / Wide) */}
          <button
            onClick={() => {
              setCustomWidth(null);
              setCustomHeight(null);
              setWindowMode('normal');
              setSizePreset(prev => prev === 'compact' ? 'medium' : prev === 'medium' ? 'wide' : 'compact');
            }}
            title={`Cycle size preset: ${sizePreset} (click for 390px / 560px / 740px)`}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200/80 transition-colors"
            type="button"
          >
            {sizePreset === 'compact' ? '390px' : sizePreset === 'medium' ? '560px' : '740px'}
          </button>

          {/* Maximize Window Button (800x600) */}
          <button
            onClick={() => {
              setCustomWidth(null);
              setCustomHeight(null);
              setWindowMode(prev => prev === 'maximized' ? 'normal' : 'maximized');
            }}
            title={windowMode === 'maximized' ? "Restore normal size" : "Maximize popup (800x600)"}
            className="p-1 rounded text-slate-500 hover:text-teal-700 hover:bg-teal-50 transition-colors"
            type="button"
          >
            {windowMode === 'maximized' ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="5" width="10" height="10" rx="1.5"></rect>
                <path d="M9 19h10a1.5 1.5 0 0 0 1.5-1.5V7"></path>
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              </svg>
            )}
          </button>

          {/* Full Tab / Pop-out Window Button (Single-tab focus) */}
          <button
            onClick={() => openInNewWindow(activeTab)}
            title="Open in full resizable tab / window"
            className="p-1 rounded text-slate-400 hover:text-teal-700 hover:bg-teal-50 transition-colors"
            type="button"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          </button>
        </div>
      </header>

      {/* ================= MINIMIZED COMPACT VIEW ================= */}
      {windowMode === 'minimized' ? (
        <div className="flex-1 p-3 flex flex-col justify-between bg-white/70 backdrop-blur-sm z-10">
          <div>
            <button
              onClick={toggleEngine}
              className={`w-full py-2.5 px-3 rounded-xl font-medium transition-all duration-150 flex items-center justify-center gap-2 shadow-sm ${
                isRunning
                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                  : 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-700 hover:to-cyan-700'
              }`}
              type="button"
            >
              <svg className="w-4 h-4 text-white shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M12 3v9" strokeLinecap="round" strokeLinejoin="round"></path>
              </svg>
              <span className="text-xs font-bold uppercase tracking-wide">
                {isRunning ? 'Stop Handsfree' : 'Start Handsfree'}
              </span>
            </button>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
            <div className="flex items-center gap-2 text-[10px] text-slate-600 font-medium">
              <span className={`inline-flex items-center gap-1 ${trackingEnabled ? 'text-teal-700 font-semibold' : 'text-slate-400'}`}>
                ● Tracking
              </span>
              <span className={`inline-flex items-center gap-1 ${voiceEnabled ? 'text-teal-700 font-semibold' : 'text-slate-400'}`}>
                ● Voice
              </span>
            </div>
            <button
              onClick={() => setWindowMode('normal')}
              className="text-[11px] font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-0.5"
              type="button"
            >
              Expand Controls &rarr;
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Segmented Navigation Bar with Zero-Blink Smooth Track */}
          <nav className="px-3 py-1.5 bg-slate-50/90 border-b border-slate-200/80 z-10 shrink-0">
            <div className="bg-slate-200/60 p-0.5 rounded-lg flex items-center gap-0.5">
              <button
                onClick={() => setActiveTab('controls')}
                className={`flex-1 py-1 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors duration-150 ${
                  activeTab === 'controls'
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
                className={`flex-1 py-1 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors duration-150 ${
                  activeTab === 'calibration'
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
                className={`flex-1 py-1 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors duration-150 ${
                  activeTab === 'commands'
                    ? 'bg-white text-teal-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                type="button"
              >
                <svg className="w-3.5 h-3.5 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" fillOpacity="0.2"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="8" y1="22" x2="16" y2="22"/>
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
                    className={`relative w-full py-2.5 px-3 rounded-[11px] transition-all flex items-center justify-center gap-2 shadow-md ${
                      isRunning
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
                    {/* Switch */}
                    <button
                      onClick={() => {
                        const next = !trackingEnabled;
                        setTrackingEnabled(next);
                        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                          chrome.storage.local.set({ trackingEnabled: next });
                        }
                        if (isRunning) send(next ? MSG.START_TRACKING : MSG.STOP_TRACKING);
                      }}
                      aria-checked={trackingEnabled}
                      className={`relative inline-flex h-[22px] w-10 p-0.5 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                        trackingEnabled ? 'bg-[#0f766e]' : 'bg-slate-300'
                      }`}
                      role="switch"
                      type="button"
                    >
                      <span
                        className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
                          trackingEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                        }`}
                      ></span>
                    </button>
                  </div>

                  {/* Toggle 2: Voice Commands (Turquoise Theme & Modern Mic) */}
                  <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all shadow-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center border border-teal-200 shrink-0 shadow-xs">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" fillOpacity="0.25"/>
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                          <line x1="12" y1="19" x2="12" y2="22"/>
                          <line x1="8" y1="22" x2="16" y2="22"/>
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-slate-900 leading-tight">Voice Commands</h3>
                        <p className="text-[10px] text-slate-500">"Click", "Scroll", "Back", "Targets"</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const next = !voiceEnabled;
                        setVoiceEnabled(next);
                        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                          chrome.storage.local.set({ voiceEnabled: next });
                        }
                        if (isRunning) send(next ? MSG.START_VOICE : MSG.STOP_VOICE);
                      }}
                      aria-checked={voiceEnabled}
                      className={`relative inline-flex h-[22px] w-10 p-0.5 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                        voiceEnabled ? 'bg-[#0f766e]' : 'bg-slate-300'
                      }`}
                      role="switch"
                      type="button"
                    >
                      <span
                        className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
                          voiceEnabled ? 'translate-x-[18px]' : 'translate-x-0'
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
                        <h3 className="text-xs font-semibold text-slate-900 leading-tight">Voice Typing</h3>
                        <p className="text-[10px] text-slate-500">Dictate into active input fields</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const next = !typingEnabled;
                        setTypingEnabled(next);
                        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                          chrome.storage.local.set({ typingEnabled: next });
                        }
                      }}
                      aria-checked={typingEnabled}
                      className={`relative inline-flex h-[22px] w-10 p-0.5 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                        typingEnabled ? 'bg-[#0f766e]' : 'bg-slate-300'
                      }`}
                      role="switch"
                      type="button"
                    >
                      <span
                        className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
                          typingEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                        }`}
                      ></span>
                    </button>
                  </div>

                  {/* Toggle 4: IntentLock™ Anti-jitter */}
                  <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all shadow-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200 shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-xs font-semibold text-slate-900 leading-tight">IntentLock™</h3>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 font-mono font-semibold">
                            SMOOTH
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500">Tremor filtering &amp; intent lock</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const next = !intentLockEnabled;
                        setIntentLockEnabled(next);
                        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                          chrome.storage.local.set({ intentLockEnabled: next });
                        }
                      }}
                      aria-checked={intentLockEnabled}
                      className={`relative inline-flex h-[22px] w-10 p-0.5 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                        intentLockEnabled ? 'bg-[#0f766e]' : 'bg-slate-300'
                      }`}
                      role="switch"
                      type="button"
                    >
                      <span
                        className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
                          intentLockEnabled ? 'translate-x-[18px]' : 'translate-x-0'
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
                      <span>{fps}</span>
                      <span className="text-[9px] font-semibold text-emerald-600">Stable</span>
                    </div>
                  </div>
                  <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <div className="text-[9px] text-slate-500 font-mono uppercase font-medium">LATENCY</div>
                    <div className="text-xs font-bold text-slate-900 flex items-center justify-between mt-0.5">
                      <span>{latency}ms</span>
                      <span className="text-[9px] font-semibold text-teal-700">&lt; 16ms</span>
                    </div>
                  </div>
                </div>

                {/* Quick Calibration Banner: Opens Dedicated Full Tab of Calibration without Duplicates */}
                <div
                  onClick={() => {
                    openInNewWindow('calibration');
                  }}
                  className="p-2.5 rounded-xl bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200/80 flex items-center justify-between cursor-pointer hover:border-teal-300 transition-all shadow-xs group"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-teal-600 group-hover:bg-teal-700 text-white flex items-center justify-center shadow-xs transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M3 12h3m12 0h3M12 3v3m0 12v3" strokeLinecap="round"></path>
                      </svg>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        Calibration Studio
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-teal-100 text-teal-800 font-medium">Full Tab</span>
                      </h4>
                      <p className="text-[10px] text-slate-600">Opens dedicated full calibration studio in new tab</p>
                    </div>
                  </div>
                  <span className="text-xs text-teal-700 font-bold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    Open &rarr;
                  </span>
                </div>
              </div>
            )}

            {/* ================= TAB 2: CALIBRATION ================= */}
            {activeTab === 'calibration' && (
              <div className="space-y-2.5">
                {/* 1. Real-time Live Coordinates Telemetry Card */}
                <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                      </span>
                      <h4 className="text-xs font-bold text-slate-900">Live Coordinate Telemetry</h4>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-teal-50 text-teal-800 border border-teal-200 font-semibold">
                      STREAMING 60Hz
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col justify-between">
                      <span className="text-[9px] text-slate-500 font-mono uppercase">CURSOR X</span>
                      <div className="flex items-baseline justify-between mt-1">
                        <span className="text-sm font-bold font-mono text-slate-900">{liveCoords.x} <span className="text-[10px] font-normal text-slate-500">px</span></span>
                        <span className="text-[10px] font-mono font-semibold text-teal-700">{liveCoords.pctX}%</span>
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col justify-between">
                      <span className="text-[9px] text-slate-500 font-mono uppercase">CURSOR Y</span>
                      <div className="flex items-baseline justify-between mt-1">
                        <span className="text-sm font-bold font-mono text-slate-900">{liveCoords.y} <span className="text-[10px] font-normal text-slate-500">px</span></span>
                        <span className="text-[10px] font-mono font-semibold text-teal-700">{liveCoords.pctY}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Micro Visual Coordinate Radar Box with Moving Reticle */}
                  <div className="relative w-full h-16 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center">
                    <div className="absolute inset-0 opacity-25 bg-[linear-gradient(to_right,#06b6d420_1px,transparent_1px),linear-gradient(to_bottom,#06b6d420_1px,transparent_1px)] bg-[size:10px_10px]"></div>
                    <div className="absolute inset-x-0 top-1/2 h-px bg-slate-800"></div>
                    <div className="absolute inset-y-0 left-1/2 w-px bg-slate-800"></div>
                    
                    {/* Live Tracking Crosshair Dot */}
                    <div
                      className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 transition-all duration-75 pointer-events-none flex items-center justify-center"
                      style={{
                        left: `${Math.max(5, Math.min(95, liveCoords.pctX))}%`,
                        top: `${Math.max(5, Math.min(95, liveCoords.pctY))}%`
                      }}
                    >
                      <span className="absolute w-3 h-3 rounded-full bg-cyan-400/40 animate-ping"></span>
                      <span className="w-2 h-2 rounded-full bg-cyan-400 border border-white shadow-xs"></span>
                    </div>

                    <div className="absolute bottom-1 right-2 text-[8px] font-mono text-slate-400">
                      DELTA: <span className="text-teal-300 font-semibold">{liveCoords.targetDelta}px</span>
                    </div>
                    <div className="absolute bottom-1 left-2 text-[8px] font-mono text-slate-400">
                      PRECISION: <span className="text-teal-300 font-semibold">{liveCoords.confidence}%</span>
                    </div>
                  </div>
                </div>

                {/* 2. Calibration HUD Viewport Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Webcam Calibration HUD</h3>
                    <p className="text-[10px] text-slate-500">Fixate gaze on targets to lock accuracy</p>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-bold">
                    Step {calibrationStep}/5
                  </span>
                </div>

                {/* Interactive Cyber Camera HUD Viewport */}
                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner flex items-center justify-center">
                  {/* Cyber Grid */}
                  <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#06b6d425_1px,transparent_1px),linear-gradient(to_bottom,#06b6d425_1px,transparent_1px)] bg-[size:16px_16px]"></div>

                  {/* Scanline */}
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent animate-shimmer pointer-events-none opacity-40"></div>

                  {/* HUD Corner Brackets */}
                  <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-teal-400"></div>
                  <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-teal-400"></div>
                  <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-teal-400"></div>
                  <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-teal-400"></div>

                  {/* Top HUD Badges */}
                  <div className="absolute top-2.5 left-3 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/90 border border-teal-400/50 text-[9px] font-mono font-semibold text-teal-300">
                      <span className="w-1 h-1 rounded-full bg-teal-400 animate-ping"></span>
                      AI: LOCKED
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-[9px] font-mono text-slate-300">
                      {liveCoords.confidence}%
                    </span>
                  </div>

                  {/* Target 1: Top-Left */}
                  <div
                    onClick={() => setCalibrationStep(1)}
                    className="absolute top-5 left-6 cursor-pointer"
                  >
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-mono font-bold ${
                        calibrationStep > 1
                          ? 'border-teal-400 bg-teal-500/20 text-teal-300'
                          : calibrationStep === 1
                          ? 'border-cyan-400 bg-cyan-500/30 text-white animate-pulse'
                          : 'border-slate-600 bg-slate-900 text-slate-400'
                      }`}
                    >
                      {calibrationStep > 1 ? '✓' : '1'}
                    </div>
                  </div>

                  {/* Target 2: Top-Right */}
                  <div
                    onClick={() => setCalibrationStep(2)}
                    className="absolute top-5 right-6 cursor-pointer"
                  >
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-mono font-bold ${
                        calibrationStep > 2
                          ? 'border-teal-400 bg-teal-500/20 text-teal-300'
                          : calibrationStep === 2
                          ? 'border-cyan-400 bg-cyan-500/30 text-white animate-pulse'
                          : 'border-slate-600 bg-slate-900 text-slate-400'
                      }`}
                    >
                      {calibrationStep > 2 ? '✓' : '2'}
                    </div>
                  </div>

                  {/* Target 3: Center (Active Target) */}
                  <div
                    onClick={() => setCalibrationStep(3)}
                    className="absolute z-20 flex flex-col items-center cursor-pointer"
                  >
                    <div className="relative flex items-center justify-center">
                      <div className="w-9 h-9 rounded-full border-2 border-cyan-400 animate-ping absolute opacity-50"></div>
                      <div className="w-8 h-8 rounded-full border-2 border-cyan-300 bg-cyan-500/30 flex items-center justify-center shadow-lg shadow-cyan-500/50">
                        <div className="w-2.5 h-2.5 rounded-full bg-white shadow"></div>
                      </div>
                    </div>
                    <span className="mt-1 text-[8px] font-mono uppercase tracking-wider text-cyan-200 bg-slate-950/90 px-1.5 py-0.2 rounded border border-cyan-400/50 font-semibold">
                      Fixate Here
                    </span>
                  </div>

                  {/* Target 4: Bottom-Left */}
                  <div
                    onClick={() => setCalibrationStep(4)}
                    className="absolute bottom-5 left-6 cursor-pointer"
                  >
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-mono font-bold ${
                        calibrationStep > 4
                          ? 'border-teal-400 bg-teal-500/20 text-teal-300'
                          : calibrationStep === 4
                          ? 'border-cyan-400 bg-cyan-500/30 text-white animate-pulse'
                          : 'border-slate-600 bg-slate-900 text-slate-400'
                      }`}
                    >
                      {calibrationStep > 4 ? '✓' : '4'}
                    </div>
                  </div>

                  {/* Target 5: Bottom-Right */}
                  <div
                    onClick={() => setCalibrationStep(5)}
                    className="absolute bottom-5 right-6 cursor-pointer"
                  >
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-mono font-bold ${
                        calibrationStep === 5
                          ? 'border-cyan-400 bg-cyan-500/30 text-white animate-pulse'
                          : 'border-slate-600 bg-slate-900 text-slate-400'
                      }`}
                    >
                      5
                    </div>
                  </div>

                  {/* Stylized Face Reticle Vector */}
                  <svg
                    className="w-32 h-auto glow-reticle-light text-cyan-400/60 pointer-events-none"
                    fill="none"
                    viewBox="0 0 200 240"
                  >
                    <ellipse cx="100" cy="120" opacity="0.5" rx="60" ry="85" stroke="currentColor" strokeDasharray="3 3" strokeWidth="1.5"></ellipse>
                    <line opacity="0.3" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1" x1="40" x2="160" y1="105" y2="105"></line>
                    <line opacity="0.3" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1" x1="100" x2="100" y1="35" y2="205"></line>
                    <circle cx="75" cy="105" fill="rgba(6, 182, 212, 0.2)" r="7" stroke="#06b6d4" strokeWidth="1.5"></circle>
                    <circle cx="75" cy="105" fill="#38bdf8" r="2"></circle>
                    <circle cx="125" cy="105" fill="rgba(6, 182, 212, 0.2)" r="7" stroke="#06b6d4" strokeWidth="1.5"></circle>
                    <circle cx="125" cy="105" fill="#38bdf8" r="2"></circle>
                    <polyline fill="none" points="100,105 100,132 95,142 105,142" stroke="#14b8a6" strokeWidth="1.5"></polyline>
                    <ellipse cx="100" cy="165" fill="rgba(16, 185, 129, 0.15)" rx="14" ry="5" stroke="#10b981" strokeWidth="1.5"></ellipse>
                  </svg>

                  {/* Real-time Head Pitch / Yaw / Roll */}
                  <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
                    <div className="bg-slate-950/90 border border-slate-800 rounded-full px-2.5 py-0.5 flex items-center gap-3 text-[9px] font-mono">
                      <span className="text-slate-400">PITCH: <span className="text-teal-300 font-semibold">{liveCoords.pitch > 0 ? `+${liveCoords.pitch}` : liveCoords.pitch}°</span></span>
                      <span className="text-slate-400">YAW: <span className="text-teal-300 font-semibold">{liveCoords.yaw > 0 ? `+${liveCoords.yaw}` : liveCoords.yaw}°</span></span>
                      <span className="text-slate-400">ROLL: <span className="text-emerald-300 font-semibold">0.0°</span></span>
                    </div>
                  </div>
                </div>

                {/* Calibration Progress Bar */}
                <div className="p-2.5 bg-white rounded-xl border border-slate-200/90 shadow-xs space-y-1.5">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-teal-600"></span>
                      Gaze Calibration Progress
                    </span>
                    <span className="font-mono font-bold text-teal-700">
                      {calibrationStep * 20}% Complete
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden p-0.5 border border-slate-200">
                    <div
                      className="bg-gradient-to-r from-teal-600 via-teal-500 to-cyan-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${calibrationStep * 20}%` }}
                    ></div>
                  </div>
                </div>

                {/* Calibration Controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCalibrationStep(1)}
                    className="flex-1 py-1.5 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all shadow-xs flex items-center justify-center gap-1.5"
                    type="button"
                  >
                    <svg className="w-3.5 h-3.5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                    </svg>
                    Restart
                  </button>
                  <button
                    onClick={() => setCalibrationStep((prev) => Math.min(5, prev + 1))}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white font-bold text-xs transition-all shadow-md shadow-teal-600/25 flex items-center justify-center gap-1"
                    type="button"
                  >
                    <span>Confirm Point</span>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round"></path>
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
                        <span className="text-[10px] text-slate-500 font-mono">Dynamic</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                        <span className="font-semibold text-slate-800">"Scroll Up"</span>
                        <span className="text-[10px] text-slate-500 font-mono">Dynamic</span>
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

                  {/* Category 4 */}
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xs">
                    <span className="text-[10px] font-mono font-bold text-teal-700 uppercase tracking-wider">
                      AI Assistant &amp; Numbered Targets
                    </span>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-xs">
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                        <span className="font-semibold text-slate-800">"Show Targets"</span>
                        <span className="text-[10px] text-teal-600 font-mono font-bold">Badges</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                        <span className="font-semibold text-slate-800">"Click [number]"</span>
                        <span className="text-[10px] text-teal-600 font-mono font-bold">Select</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                        <span className="font-semibold text-slate-800">"Wake Up"</span>
                        <span className="text-[10px] text-slate-500 font-mono">Open Bar</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100">
                        <span className="font-semibold text-slate-800">"Sleep"</span>
                        <span className="text-[10px] text-slate-500 font-mono">Sleep Orb</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>

          {/* Global Compact Footer */}
          <footer className="px-4 py-1.5 bg-white/80 backdrop-blur border-t border-slate-200/80 flex items-center justify-between text-[10px] text-slate-500 font-medium z-10 shrink-0">
            <span>Handsfree • WebGL &amp; WebAudio</span>
            <span className="font-mono text-teal-700 font-semibold">ActiveTab Bound</span>
          </footer>
        </>
      )}

      {/* Interactive Border & Corner Resizers (Active in Popup Mode) */}
      {!isTabMode && (
        <>
          {/* Right Edge Resizer (Cursor changes to ew-resize) */}
          <div 
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = e.currentTarget.parentElement.offsetWidth;
              const onMouseMove = (moveEvt) => {
                const newW = Math.min(800, Math.max(340, startW + (moveEvt.clientX - startX)));
                setCustomWidth(newW);
                document.body.style.width = `${newW}px`;
              };
              const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
              };
              window.addEventListener('mousemove', onMouseMove);
              window.addEventListener('mouseup', onMouseUp);
            }}
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-teal-500/30 active:bg-teal-500/50 z-50 transition-colors"
            title="Drag right border to resize width"
          />

          {/* Bottom Edge Resizer (Cursor changes to ns-resize) */}
          <div 
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startH = e.currentTarget.parentElement.offsetHeight;
              const onMouseMove = (moveEvt) => {
                const newH = Math.min(600, Math.max(180, startH + (moveEvt.clientY - startY)));
                setCustomHeight(newH);
                document.body.style.height = `${newH}px`;
              };
              const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
              };
              window.addEventListener('mousemove', onMouseMove);
              window.addEventListener('mouseup', onMouseUp);
            }}
            className="absolute left-0 bottom-0 right-0 h-2 cursor-ns-resize hover:bg-teal-500/30 active:bg-teal-500/50 z-50 transition-colors"
            title="Drag bottom border to resize height"
          />

          {/* Bottom-Right Corner Drag-Resize Handle (Cursor changes to nwse-resize) */}
          <div 
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startY = e.clientY;
              const startW = e.currentTarget.parentElement.offsetWidth;
              const startH = e.currentTarget.parentElement.offsetHeight;
              const onMouseMove = (moveEvt) => {
                const newW = Math.min(800, Math.max(340, startW + (moveEvt.clientX - startX)));
                const newH = Math.min(600, Math.max(180, startH + (moveEvt.clientY - startY)));
                setCustomWidth(newW);
                setCustomHeight(newH);
                document.body.style.width = `${newW}px`;
                document.body.style.height = `${newH}px`;
              };
              const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
              };
              window.addEventListener('mousemove', onMouseMove);
              window.addEventListener('mouseup', onMouseUp);
            }}
            className="resize-handle cursor-nwse-resize"
            title="Drag corner to freely resize window"
          />
        </>
      )}
    </div>
  );
}
