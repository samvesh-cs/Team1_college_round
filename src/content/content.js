import { MSG } from "../shared/messages.js";
import { VoiceController } from "./voice/voiceController.js";

console.log("[Handsfree] Content script loaded.");

const voiceController = new VoiceController();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Handsfree] Received message:", message.type);
  
  // === WS-2 (Jay) ===
  if (message.type === MSG.START_VOICE) {
    voiceController.start();
  } else if (message.type === MSG.STOP_VOICE) {
    voiceController.stop();
  }
  // ==================
  
  sendResponse({ ok: true });
});
