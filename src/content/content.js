import { MSG } from "../shared/messages.js";
import { getDefaults, loadSettings, validateSettingsPatch } from "../shared/settings.js";
import { CursorController } from "./cursor/cursorController.js";
import { VoiceController } from "./voice/voiceController.js";
import { DwellController } from "./activation/dwellController.js";
import { TargetManager } from "./activation/targetManager.js";
import "./styles/overlay.css";
import "./styles/voice-overlay.css";
import "./styles/activation-overlay.css";

console.log("[Handsfree] Content script loaded.");

// Prevent duplicate initialization on re-injected pages
if (!window.__handsfree_content_initialized) {
  window.__handsfree_content_initialized = true;

  // === WS-4: in-memory settings (popup is the primary writer) ===
  let currentSettings = getDefaults();
  let dirtyDuringLoad = false;
  let lastAppliedRev = 0;

  // === WS-1: Head-Tracking Virtual Cursor ===
  const cursor = new CursorController();
  window.__handsfree_cursor = cursor;

  // === WS-2: Voice Controller ===
  const voiceController = new VoiceController();
  window.__handsfree_voice = voiceController;

  // === WS-3: Dwell Activation & Target Management ===
  const dwellController = new DwellController();
  const targetManager = new TargetManager();

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
      if (typeof settings.dwellDuration === "number" && typeof dwellController.setDwellDuration === "function") {
        dwellController.setDwellDuration(settings.dwellDuration);
      }
    } catch (err) {
      console.warn("[Handsfree] Error applying settings to controllers:", err);
    }
  }

  // Load initial settings
  loadSettings()
    .then((s) => {
      if (!dirtyDuringLoad) {
        const { clean } = validateSettingsPatch(s);
        currentSettings = { ...getDefaults(), ...clean };
        applySettingsToControllers(currentSettings);
      }
    })
    .catch(() => {});

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

  // Clean up on page unload
  window.addEventListener("unload", () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    cursor.stop();
    voiceController.stop();
    dwellController.destroy();
    targetManager.destroy();
  });

  /**
   * Unified Message Listener for commands from extension popup, background worker, and voice
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Handsfree] Received message:", message?.type);

    if (!message || typeof message.type !== "string") {
      sendResponse({ ok: false, error: "INVALID_MESSAGE" });
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
        cursor.calibrate();
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
          fps: 60,
          calibrated: true,
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
        const targetNum = message.payload?.number ?? message.number ?? message.targetNumber;
        const result = targetManager.activateTarget(targetNum);
        sendResponse({ ok: result.success, ...result });
        break;
      }

      default:
        sendResponse({ ok: true, status: "unhandled" });
        break;
    }

    return true;
  });
}
