import { MSG } from "../shared/messages.js";
import { CursorController } from "./cursor/cursorController.js";
import "./styles/overlay.css";

console.log("[Handsfree] Content script loaded.");

// Initialize CursorController orchestrator
const cursor = new CursorController();

// Expose instance for easy inspection and debugging in DevTools
if (typeof window !== "undefined") {
  window.__handsfree_cursor = cursor;
}

/**
 * Message listener for commands sent from extension popup or background worker.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Handsfree] Received message:", message?.type);

  switch (message?.type) {
    case MSG.START_TRACKING:
      cursor
        .start()
        .then(() => sendResponse({ ok: true, status: "started" }))
        .catch((err) => {
          console.error("[Handsfree] Error starting tracking:", err);
          sendResponse({ ok: false, error: err.message });
        });
      return true; // Keep message port open for async response

    case MSG.STOP_TRACKING:
      cursor.stop();
      sendResponse({ ok: true, status: "stopped" });
      break;

    case MSG.PAUSE_CURSOR:
      cursor.pause();
      sendResponse({ ok: true, status: "paused" });
      break;

    case MSG.RESUME_CURSOR:
      cursor.resume();
      sendResponse({ ok: true, status: "resumed" });
      break;

    case MSG.CALIBRATE:
      cursor.calibrate();
      sendResponse({ ok: true, status: "calibrated" });
      break;

    case MSG.GET_STATUS:
      sendResponse({
        ok: true,
        tracking: cursor.isTracking,
        paused: cursor.isPaused,
      });
      break;

    default:
      if (message?.type === "UPDATE_SETTINGS" && message.settings) {
        if (message.settings.sensitivity !== undefined) {
          cursor.setSensitivity(message.settings.sensitivity);
        }
        if (message.settings.smoothing !== undefined) {
          cursor.setSmoothing(message.settings.smoothing);
        }
        sendResponse({ ok: true, status: "settings_updated" });
        break;
      }
      sendResponse({ ok: true, status: "unhandled" });
      break;
  }
});
