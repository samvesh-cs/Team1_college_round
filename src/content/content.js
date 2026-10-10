import { MSG } from "../shared/messages.js";
import { CursorController } from "./cursor/cursorController.js";
import { DwellController } from "./activation/dwellController.js";
import { TargetManager } from "./activation/targetManager.js";
import "./styles/overlay.css";
import "./styles/activation-overlay.css";

console.log("[Handsfree] Content script loaded.");

// Prevent duplicate initialization on re-injected pages
if (!window.__handsfree_content_initialized) {
  window.__handsfree_content_initialized = true;

  // === WS-1: Head-Tracking Virtual Cursor ===
  const cursor = new CursorController();
  window.__handsfree_cursor = cursor;

  // === WS-3: Dwell Activation & Target Management ===
  const dwellController = new DwellController();
  const targetManager = new TargetManager();

  window.__handsfree_dwell = dwellController;
  window.__handsfree_targets = targetManager;

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
    dwellController.destroy();
    targetManager.destroy();
  });

  /**
   * Unified Message Listener for commands from extension popup, background, and voice
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Handsfree] Received message:", message?.type);

    switch (message?.type) {
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

      case MSG.GET_STATUS:
        sendResponse({
          ok: true,
          tracking: cursor.isTracking,
          paused: cursor.isPaused,
        });
        break;

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

      // === Settings Updates ===
      default:
        if (message?.type === "UPDATE_SETTINGS" && message.settings) {
          if (message.settings.sensitivity !== undefined) {
            cursor.setSensitivity(message.settings.sensitivity);
          }
          if (message.settings.smoothing !== undefined) {
            cursor.setSmoothing(message.settings.smoothing);
          }
          if (message.settings.dwellDuration !== undefined) {
            dwellController.setDwellDuration(message.settings.dwellDuration);
          }
          sendResponse({ ok: true, status: "settings_updated" });
          break;
        }
        sendResponse({ ok: true, status: "unhandled" });
        break;
    }
    return true;
  });
}
