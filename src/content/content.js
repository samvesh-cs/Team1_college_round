import { MSG } from "../shared/messages.js";
import { DwellController } from "./activation/dwellController.js";
import { TargetManager } from "./activation/targetManager.js";
import "./styles/activation-overlay.css";

console.log("[Handsfree] Content script loaded.");

// Prevent duplicate initialization on re-injected pages
if (!window.__handsfree_content_initialized) {
  window.__handsfree_content_initialized = true;

  // === WS-3: Controllers ===
  const dwellController = new DwellController();
  const targetManager = new TargetManager();

  // Expose on window for inter-controller / WS-1 / WS-2 interoperability
  window.__handsfree_dwell = dwellController;
  window.__handsfree_targets = targetManager;

  // Start dwell tracking loop synced with virtual cursor interface
  dwellController.start();

  let rafId = null;
  let lastFrameTime = performance.now();

  function cursorSyncLoop(now) {
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    // Read virtual cursor position exposed by WS-1
    const cursor = window.__handsfree_cursor;
    if (cursor && cursor.active !== false && typeof cursor.x === "number" && typeof cursor.y === "number") {
      dwellController.update(cursor.x, cursor.y, dt);
    }

    rafId = requestAnimationFrame(cursorSyncLoop);
  }

  rafId = requestAnimationFrame(cursorSyncLoop);

  // Clean up on page unload
  window.addEventListener("unload", () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    dwellController.destroy();
    targetManager.destroy();
  });

  // Message dispatcher
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Handsfree] Received message:", message?.type);

    // === WS-3 Handlers ===
    if (message?.type === MSG.SHOW_TARGETS) {
      const result = targetManager.showTargets();
      sendResponse({ ok: true, count: result.count });
      return true;
    }

    if (message?.type === MSG.HIDE_TARGETS) {
      targetManager.hideTargets();
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === MSG.CLICK_TARGET) {
      const targetNum = message.payload?.number ?? message.number ?? message.targetNumber;
      const result = targetManager.activateTarget(targetNum);
      sendResponse({ ok: result.success, ...result });
      return true;
    }

    // Coordinate dwell state with tracking controls
    if (message?.type === MSG.PAUSE_CURSOR || message?.type === MSG.STOP_TRACKING) {
      dwellController.stop();
    } else if (message?.type === MSG.RESUME_CURSOR || message?.type === MSG.START_TRACKING) {
      dwellController.start();
    }

    // Fallback response for unhandled messages (preserves WS-1/WS-2/WS-4 handlers)
    sendResponse({ ok: true });
    return true;
  });
}
