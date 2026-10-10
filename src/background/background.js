import { MSG } from "../shared/messages.js";

// Keep background service worker active and responsive to messaging
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // If message is from popup/content, broadcast to active web tabs
  if (
    message.type === MSG.START_VOICE ||
    message.type === MSG.STOP_VOICE ||
    message.type === MSG.START_TRACKING ||
    message.type === MSG.STOP_TRACKING
  ) {
    const isStarting =
      message.type === MSG.START_VOICE || message.type === MSG.START_TRACKING;

    // Save to storage so newly navigated pages auto-restore
    chrome.storage.local.set({
      engineRunning: isStarting,
      voiceEnabled: isStarting,
      agentState: isStarting ? (message.agentState || "bar") : "orb",
    });

    // Forward to all accessible web tabs
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          if (
            tab.url &&
            (tab.url.startsWith("chrome://") ||
              tab.url.startsWith("edge://") ||
              tab.url.startsWith("chrome-extension://") ||
              tab.url.startsWith("devtools://") ||
              tab.url.startsWith("view-source:"))
          ) {
            continue;
          }

          chrome.tabs.sendMessage(tab.id, message, () => {
            if (chrome.runtime.lastError) {
              // If tab doesn't have content script injected and engine is starting, inject it dynamically!
              if (isStarting && chrome.scripting) {
                chrome.scripting
                  .insertCSS({
                    target: { tabId: tab.id },
                    files: [
                      "src/content/styles/overlay.css",
                      "src/content/styles/voice-overlay.css",
                      "src/content/styles/ai-agent.css",
                    ],
                  })
                  .catch(() => {});

                chrome.scripting
                  .executeScript({
                    target: { tabId: tab.id },
                    files: ["src/content/content.js"],
                  })
                  .then(() => {
                    setTimeout(() => {
                      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
                    }, 200);
                  })
                  .catch(() => {});
              }
            }
          });
        }
      }
    });

    sendResponse({ ok: true });
    return true;
  }

  // Forward popup commands to the active web tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab?.id) {
      chrome.tabs.sendMessage(activeTab.id, message, sendResponse);
    } else {
      // If active tab is the extension popup/tab itself, forward to the last focused web tab
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (webTabs) => {
        if (webTabs[0]?.id) {
          chrome.tabs.sendMessage(webTabs[0].id, message, sendResponse);
        } else {
          sendResponse({ ok: false, reason: "No web tab found" });
        }
      });
    }
  });

  return true;
});

// Auto-restore engine & AI voice agent across page navigation (Google search, back, forward)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    if (
      tab.url &&
      (tab.url.startsWith("chrome://") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("devtools://"))
    ) {
      return;
    }

    chrome.storage.local.get(["engineRunning", "voiceEnabled", "agentState"], (res) => {
      if (res?.engineRunning && res?.voiceEnabled !== false) {
        chrome.tabs.sendMessage(
          tabId,
          {
            type: MSG.START_VOICE,
            agentState: res.agentState || "bar",
            autoRestored: true,
          },
          () => {
            if (chrome.runtime.lastError) {
              // Tab might not have script yet, ignore
            }
          }
        );
      }
    });
  }
});
