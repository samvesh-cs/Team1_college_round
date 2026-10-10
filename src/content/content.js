import { MSG } from "../shared/messages.js";
import { getDefaults, loadSettings, validateSettingsPatch } from "../shared/settings.js";
import { CursorController } from "./cursor/cursorController.js";
import { VoiceController } from "./voice/voiceController.js";
import { DwellController } from "./activation/dwellController.js";
import { TargetManager } from "./activation/targetManager.js";
import { CalibrationOverlay } from "./calibration/calibrationOverlay.js";
import "./styles/overlay.css";
import "./styles/voice-overlay.css";
import "./styles/activation-overlay.css";
import "./styles/calibration-overlay.css";

console.log("[Handsfree] Content script loaded.");

// Prevent duplicate initialization on re-injected pages
if (!window.__handsfree_content_initialized) {
  window.__handsfree_content_initialized = true;

  // === WS-4: in-memory settings (popup is the primary writer) ===
  let currentSettings = getDefaults();
  let dirtyDuringLoad = false;
  let lastAppliedRev = 0;
  // Set once controllers are constructed below. The message listener is
  // registered first so GET_STATUS answers truthfully while heavy
  // initialization (e.g. MediaPipe loading) is still in flight.
  let initialized = false;

  // Controller holders. Assigned during initialization below; the early
  // listener never touches them until `initialized` is true.
  let cursor = null;
  let voiceController = null;
  let dwellController = null;
  let targetManager = null;

  chrome.runtime.onMessage.addListener(handleMessage);

  // === Controller construction (listener above already answers) ===
  // === WS-1: Head-Tracking Virtual Cursor ===
  cursor = new CursorController();
  window.__handsfree_cursor = cursor;

  // === Calibration Studio Overlay ===
  const calibrationOverlay = new CalibrationOverlay(cursor);
  window.__handsfree_calibration_overlay = calibrationOverlay;

  // === WS-2: Voice Controller ===
  voiceController = new VoiceController();
  window.__handsfree_voice = voiceController;

  // === WS-3: Dwell Activation & Target Management ===
  dwellController = new DwellController();
  targetManager = new TargetManager();

  window.__handsfree_dwell = dwellController;
  window.__handsfree_targets = targetManager;

  // Apply settings to controllers
  function applySettingsToControllers(settings) {
    if (!settings) return;
    try {
      if (typeof settings.sensitivity === "number" && typeof cursor.setSensitivity === "function") {
        cursor.setSensitivity(settings.sensitivity);
      }
      if (typeof settings.smoothing === "number" && typeof cursor.setSmoothing === "function") {
        cursor.setSmoothing(settings.smoothing);
      }
      if (typeof settings.deadZone === "number" && typeof cursor.setDeadZone === "function") {
        cursor.setDeadZone(settings.deadZone);
      }
      if (typeof settings.intentLockEnabled === "boolean" && typeof cursor.setIntentLock === "function") {
        cursor.setIntentLock(settings.intentLockEnabled);
      }
      if (typeof settings.dwellDuration === "number" && typeof dwellController.setDwellDuration === "function") {
        dwellController.setDwellDuration(settings.dwellDuration);
      }
    } catch (err) {
      console.warn("[Handsfree] Error applying settings to controllers:", err);
    }
  }

  // Load initial settings, then auto-activate from persisted preferences so
  // supported pages work without opening the popup. Runs once per page
  // context (guarded by __handsfree_content_initialized above).
  function autoStart(settings) {
    if (settings.trackingEnabled && !cursor.isTracking) {
      cursor.start().then(() => {
        try {
          dwellController.start();
        } catch (err) {
          console.warn("[Handsfree] Dwell auto-start failed:", err);
        }
      }).catch((err) => {
        console.warn("[Handsfree] Tracking auto-start unavailable:", err && err.message ? err.message : err);
      });
    }
    if (settings.voiceEnabled && !voiceController.enabled) {
      // Voice ownership is exclusive per active tab: a background tab must
      // not grab the recognition session at load; it is armed later via
      // VOICE_RESUME when the tab becomes active.
      const pageVisible = typeof document === "undefined"
        || typeof document.visibilityState === "undefined"
        || document.visibilityState === "visible";
      if (!pageVisible) {
        console.debug("[Handsfree] Skipping voice auto-start in background tab.");
      } else {
        try {
          voiceController.start();
        } catch (err) {
          console.warn("[Handsfree] Voice auto-start unavailable:", err && err.message ? err.message : err);
        }
      }
    }
  }

  loadSettings()
    .then((s) => {
      if (!dirtyDuringLoad) {
        const { clean } = validateSettingsPatch(s);
        currentSettings = { ...getDefaults(), ...clean };
        applySettingsToControllers(currentSettings);
      }
      autoStart(currentSettings);
    })
    .catch(() => {
      autoStart(currentSettings);
    });

  // Start dwell tracking loop synced with virtual cursor
  dwellController.start();

  let rafId = null;
  let lastFrameTime = performance.now();

  function renderLoop(now) {
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    // Check if virtual cursor is actively tracking and not paused
    if (cursor.isTracking && !cursor.isPaused) {
      const x = cursor.currentX;
      const y = cursor.currentY;
      if (typeof x === "number" && typeof y === "number") {
        dwellController.update(x, y, dt);
      }
    } else {
      dwellController.resetDwell();
    }

    rafId = requestAnimationFrame(renderLoop);
  }

  rafId = requestAnimationFrame(renderLoop);

  // Clean up on page navigation/hide
  window.addEventListener("pagehide", () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    cursor.stop();
    calibrationOverlay.hide();
    voiceController.stop();
    dwellController.destroy();
    targetManager.destroy();
  });

  /**
   * Unified Message Listener for commands from extension popup, background worker, and voice.
   * Hoisted function declaration: referenced by the early addListener call at
   * the top of this block, defined here to keep all handling in one place.
   */
  function handleMessage(message, sender, sendResponse) {
    console.log("[Handsfree] Received message:", message?.type);

    if (!message || typeof message.type !== "string") {
      sendResponse({ ok: false, error: "INVALID_MESSAGE" });
      return false;
    }

    if (!initialized) {
      // Controllers not ready yet: report initializing truthfully instead of
      // staying silent or claiming readiness.
      if (message.type === MSG.GET_STATUS) {
        sendResponse({
          ok: true,
          initializing: true,
          tracking: false,
          paused: false,
          voice: false,
          listening: false,
          yielded: false,
          fps: null,
          calibrated: false,
          settings: { ...currentSettings },
          rev: lastAppliedRev,
          controllersAvailable: false,
        });
        return false;
      }
      sendResponse({ ok: false, error: "NOT_INITIALIZED" });
      return false;
    }

    switch (message.type) {
      // === WS-1: Cursor & Tracking Controls ===
      case MSG.START_TRACKING:
        cursor
          .start()
          .then(() => {
            dwellController.start();
            sendResponse({ ok: true, status: "started" });
          })
          .catch((err) => {
            console.error("[Handsfree] Error starting tracking:", err);
            sendResponse({ ok: false, error: err.message });
          });
        return true; // Keep message channel open for async response

      case MSG.STOP_TRACKING:
        cursor.stop();
        calibrationOverlay.hide();
        dwellController.stop();
        sendResponse({ ok: true, status: "stopped" });
        break;

      case MSG.PAUSE_CURSOR:
        cursor.pause();
        dwellController.stop();
        sendResponse({ ok: true, status: "paused" });
        break;

      case MSG.RESUME_CURSOR:
        cursor.resume();
        dwellController.start();
        sendResponse({ ok: true, status: "resumed" });
        break;

      case MSG.CALIBRATE:
        if (message.quick) {
          cursor.calibrate();
        } else {
          calibrationOverlay.show();
        }
        dwellController.resetDwell();
        sendResponse({ ok: true, status: "calibrated" });
        break;

      // === WS-2: Voice Commands & Dictation ===
      case MSG.START_VOICE:
        voiceController.start();
        sendResponse({ ok: true, status: "voice_started" });
        break;

      case MSG.STOP_VOICE:
        voiceController.stop();
        sendResponse({ ok: true, status: "voice_stopped" });
        break;

      case MSG.VOICE_YIELD:
        voiceController.release();
        sendResponse({ ok: true, status: "voice_yielded" });
        break;

      case MSG.VOICE_RESUME:
        voiceController.activate();
        sendResponse({ ok: true, status: "voice_resumed", listening: voiceController.listening });
        break;

      case MSG.START_DICTATION:
        voiceController.setMode("dictation");
        sendResponse({ ok: true, status: "dictation_started" });
        break;

      case MSG.STOP_DICTATION:
        voiceController.setMode("command");
        sendResponse({ ok: true, status: "dictation_stopped" });
        break;

      // === WS-4: Status / Telemetry ===
      case MSG.GET_STATUS:
        sendResponse({
          ok: true,
          tracking: cursor.isTracking,
          paused: cursor.isPaused,
          voice: voiceController.enabled,
          listening: voiceController.listening,
          yielded: voiceController.yielded,
          fps: cursor.isTracking ? 30 : 0,
          calibrated: cursor.isCalibrated,
          neutral: cursor.getNeutralPoint ? cursor.getNeutralPoint() : { x: 0.5, y: 0.5 },
          dx: cursor.lastDx ?? 0,
          dy: cursor.lastDy ?? 0,
          settings: { ...currentSettings },
          rev: lastAppliedRev,
          controllersAvailable: true,
        });
        break;

      // === WS-4: Settings Updates ===
      case MSG.UPDATE_SETTINGS:
      case MSG.SETTINGS_CHANGED: {
        if (typeof message.rev === "number" && message.rev <= lastAppliedRev) {
          sendResponse({ ok: false, error: "STALE_REVISION" });
          return false;
        }

        const { clean, errors } = validateSettingsPatch(message.settings);
        if (errors.length > 0) {
          sendResponse({ ok: false, error: "INVALID_SETTINGS", details: errors });
          return false;
        }

        dirtyDuringLoad = true;
        if (typeof message.rev === "number") {
          lastAppliedRev = message.rev;
        }

        currentSettings = { ...currentSettings, ...clean };
        applySettingsToControllers(currentSettings);
        sendResponse({ ok: true, settings: { ...currentSettings }, rev: lastAppliedRev });
        break;
      }

      // === WS-3: Activation & Target Management ===
      case MSG.SHOW_TARGETS: {
        const result = targetManager.showTargets();
        sendResponse({ ok: true, count: result.count });
        break;
      }

      case MSG.HIDE_TARGETS: {
        targetManager.hideTargets();
        sendResponse({ ok: true });
        break;
      }

      case MSG.CLICK_TARGET: {
        const targetNum =
          (typeof message.payload === "number" ? message.payload : message.payload?.number) ??
          message.number ??
          message.targetNumber;
        const result = targetManager.activateTarget(targetNum);
        sendResponse({ ok: result.success, ...result });
        break;
      }

      default:
        sendResponse({ ok: true, status: "unhandled" });
        break;
    }

    return true;
  }

  initialized = true;
}
