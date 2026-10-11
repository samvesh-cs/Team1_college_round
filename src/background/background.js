import { MSG } from "../shared/messages.js";
import { loadStats, resetStats } from "../shared/sessionStats.js";

// Reset session stats on browser startup (simulating browser-session lifespan)
try {
  chrome.runtime.onStartup?.addListener(() => {
    chrome.storage?.local?.remove?.("handsfree_session_stats");
  });
} catch (_) {}

// Grant content scripts access to chrome.storage.session if supported
try {
  if (chrome.storage?.session?.setAccessLevel) {
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});
  }
} catch (_) {}

// Keep background service worker active and responsive to messaging
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "INVALID_MESSAGE" });
    return false;
  }

  // Handle Session Stats queries directly from storage (instant, no active web tab required)
  if (message.type === MSG.GET_STATS) {
    loadStats()
      .then((stats) => sendResponse({ ok: true, stats }))
      .catch(() => sendResponse({ ok: false, error: "STATS_UNAVAILABLE" }));
    return true;
  }

  if (message.type === MSG.RESET_STATS) {
    resetStats()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "RESET_FAILED" }));
    return true;
  }

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

  // === WS-4: explicit settings forwarding ===
  if (message.type === MSG.UPDATE_SETTINGS || message.type === MSG.SETTINGS_CHANGED) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, message, (res) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(res || { ok: true });
          }
        });
      } else {
        sendResponse({ ok: false, error: "NO_ACTIVE_TAB" });
      }
    });
    return true;
  }

  if (message.type === MSG.GET_STATUS) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        sendResponse({ ok: false, error: "NO_ACTIVE_TAB" });
        return;
      }
      if (isRestrictedUrl(activeTab.url)) {
        sendResponse({ ok: false, error: "RESTRICTED_PAGE" });
        return;
      }
      chrome.tabs.sendMessage(activeTab.id, message, (res) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(res || { ok: true });
        }
      });
    });
    return true;
  }

  // Forward popup commands to the active web tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab?.id) {
      chrome.tabs.sendMessage(activeTab.id, message, (res) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(res || { ok: true });
        }
      });
    } else {
      // If active tab is the extension popup/tab itself, forward to the last focused web tab
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (webTabs) => {
        if (webTabs[0]?.id) {
          chrome.tabs.sendMessage(webTabs[0].id, message, (res) => {
            if (chrome.runtime.lastError) {
              sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse(res || { ok: true });
            }
          });
        } else {
          sendResponse({ ok: false, reason: "No web tab found" });
        }
      });
    }
  });
  return true;
});

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  );
}

// Auto-restore engine & AI voice agent across page navigation (Google search, back, forward)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    if (isRestrictedUrl(tab?.url)) {
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

// Follow tab focus across all tabs so newly selected tabs immediately activate
chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo.tabId;
  chrome.storage.local.get(["engineRunning", "voiceEnabled", "agentState"], (res) => {
    if (res?.engineRunning && res?.voiceEnabled !== false) {
      // 1. Tell all background tabs to yield mic
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) {
          if (t.id && t.id !== tabId && !isRestrictedUrl(t.url)) {
            chrome.tabs.sendMessage(t.id, { type: "YIELD_MIC" }).catch(() => {});
          }
        }
      });

      // 2. Activate voice agent on newly focused tab
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab || isRestrictedUrl(tab.url)) return;

        const startMsg = {
          type: MSG.START_VOICE,
          agentState: res.agentState || "bar",
          autoRestored: true,
          isTabFocus: true,
        };

        chrome.tabs.sendMessage(tabId, startMsg, () => {
          if (chrome.runtime.lastError && chrome.scripting) {
            chrome.scripting
              .insertCSS({
                target: { tabId },
                files: [
                  "src/content/styles/overlay.css",
                  "src/content/styles/voice-overlay.css",
                  "src/content/styles/ai-agent.css",
                ],
              })
              .catch(() => {});

            chrome.scripting
              .executeScript({
                target: { tabId },
                files: ["src/content/content.js"],
              })
              .then(() => {
                setTimeout(() => {
                  chrome.tabs.sendMessage(tabId, startMsg).catch(() => {});
                }, 200);
              })
              .catch(() => {});
          }
        });
      });
    }
  });
});
