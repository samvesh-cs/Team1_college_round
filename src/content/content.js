import { MSG } from "../shared/messages.js";
import { VoiceController } from "./voice/voiceController.js";

console.log("[Handsfree] Content script loaded.");

const voiceController = new VoiceController();

// Auto-restore engine state on page load (across navigation, back, forward, and Google searches)
try {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["engineRunning", "voiceEnabled", "agentState"], (res) => {
      if (res?.engineRunning && res?.voiceEnabled !== false) {
        console.log("[Handsfree] Auto-activating voice engine on navigated page with state:", res.agentState || "bar");
        setTimeout(() => {
          voiceController.start(res.agentState || "bar");
        }, 150);
      }
    });

    // Listen to storage changes so popup controls immediately sync across all open tabs
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        if (changes.engineRunning !== undefined) {
          if (changes.engineRunning.newValue) {
            chrome.storage.local.get(["agentState"], (st) => {
              voiceController.start(st?.agentState || "bar");
            });
          } else {
            voiceController.stop();
          }
        }
        if (changes.voiceEnabled !== undefined) {
          if (changes.voiceEnabled.newValue) {
            voiceController.start("bar");
          } else {
            voiceController.stop();
          }
        }
      }
    });
  }
} catch (e) {
  console.warn("[Handsfree] Storage access warning:", e);
}

window.__handsfree_voiceController = voiceController;

// Runtime message listener as direct channel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Handsfree] Received runtime message:", message.type, message);
  
  // === WS-2 (Jay) Voice Engine Activation ===
  if (message.type === MSG.START_VOICE || message.type === MSG.START_TRACKING) {
    const targetState = message.agentState || "bar";
    console.log("[Handsfree] Activating voiceController with state:", targetState);
    voiceController.start(targetState);
  } else if (message.type === MSG.STOP_VOICE || message.type === MSG.STOP_TRACKING) {
    console.log("[Handsfree] Deactivating voiceController");
    voiceController.stop();
  } else if (message.type === "YIELD_MIC") {
    console.log("[Handsfree] Yielding microphone on backgrounded tab");
    voiceController.yieldMic();
  }
  // ==========================================
  
  sendResponse({ ok: true, enabled: voiceController.enabled });
  return true;
});
