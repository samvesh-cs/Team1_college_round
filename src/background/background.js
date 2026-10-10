import { MSG } from "../shared/messages.js";

function queryActiveTab(callback) {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        callback(new Error(chrome.runtime.lastError.message), null);
        return;
      }
      callback(null, tabs && tabs[0] ? tabs[0] : null);
    });
  } catch (err) {
    callback(err, null);
  }
}

function forwardToTab(tabId, message, sendResponse) {
  try {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (res === undefined) {
        sendResponse({ ok: false, error: "NO_RESPONSE_FROM_CONTENT" });
        return;
      }
      sendResponse(res);
    });
  } catch (err) {
    sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "INVALID_MESSAGE" });
    return false;
  }

  // === WS-4: explicit settings forwarding (same payload shape as popup: { settings }) ===
  if (message.type === MSG.UPDATE_SETTINGS || message.type === MSG.SETTINGS_CHANGED) {
    queryActiveTab((err, tab) => {
      if (err) {
        sendResponse({ ok: false, error: err.message });
        return;
      }
      if (!tab || tab.id === undefined) {
        sendResponse({ ok: false, error: "NO_ACTIVE_TAB" });
        return;
      }
      forwardToTab(tab.id, message, sendResponse);
    });
    return true;
  }

  if (message.type === MSG.GET_STATUS) {
    queryActiveTab((err, tab) => {
      if (err) {
        sendResponse({ ok: false, error: err.message });
        return;
      }
      if (!tab || tab.id === undefined) {
        sendResponse({ ok: false, error: "NO_ACTIVE_TAB" });
        return;
      }
      forwardToTab(tab.id, message, sendResponse);
    });
    return true; // async response
  }

  // Forward popup commands to the active tab's content script
  queryActiveTab((err, tab) => {
    if (err) {
      sendResponse({ ok: false, error: err.message });
      return;
    }
    if (!tab || tab.id === undefined) {
      sendResponse({ ok: false, error: "NO_ACTIVE_TAB" });
      return;
    }
    forwardToTab(tab.id, message, sendResponse);
  });
  return true;
});
