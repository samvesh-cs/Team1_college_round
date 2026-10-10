import { MSG } from "../shared/messages.js";

console.log("[Handsfree] Content script loaded.");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Handsfree] Received message:", message.type);
  sendResponse({ ok: true });
});
