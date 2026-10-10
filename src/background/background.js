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

function isRestrictedUrl(url) {
  if (!url) return false;
  return /^(chrome|edge|about|chrome-extension|devtools|view-source):/.test(url)
    || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
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

// Exclusive voice ownership: at most one tab may hold an active
// recognition session. Chrome ends one tab's session when another tab
// starts, so without coordination both tabs restart each other forever.
// The active tab owns the session; everyone else must stay quiet.
let lastActiveTabId = null;

// --- Stage-0 offscreen voice probe: last report from the probe page.
// Module scope so it survives across messages (service worker lifetime).
let lastProbeReport = null;

function yieldVoiceTo(tabId) {
  // Fire-and-forget: tabs without a content script (restricted pages,
  // not-yet-injected) simply have no listener; that is not an error here.
  try {
    chrome.tabs.sendMessage(tabId, { type: MSG.VOICE_YIELD }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Never let a yield failure break tab switching or popup commands.
  }
}

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    try {
      const currentId = activeInfo && activeInfo.tabId;
      if (currentId === undefined) return;
      const previousId = lastActiveTabId;
      lastActiveTabId = currentId;
      if (previousId !== null && previousId !== currentId) {
        yieldVoiceTo(previousId);
      }
      chrome.tabs.sendMessage(currentId, { type: MSG.VOICE_RESUME }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Never let ownership bookkeeping break tab switching.
    }
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (lastActiveTabId === tabId) lastActiveTabId = null;
  });
}

// --- Stage-0 offscreen voice probe helpers (module scope so the service
// worker DevTools console can drive the probe; a worker never receives its
// own runtime.sendMessage calls, so messaging alone cannot test from there).
async function ensureProbeOffscreen() {
  if (!chrome.offscreen) {
    throw new Error("OFFSCREEN_UNSUPPORTED");
  }
  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) return true;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen-voice-probe.html"),
    reasons: ["USER_MEDIA"],
    justification: "Stage-0 feasibility probe: test microphone and speech recognition in an offscreen document.",
  });
  return true;
}

function broadcastToProbe(cmd) {
  // Fire-and-forget: only the probe page acts on these (it filters by
  // target); the broadcast response is intentionally unused so unrelated
  // responders can never corrupt probe control flow.
  try {
    chrome.runtime.sendMessage({ target: "offscreen-probe", cmd }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Control send must never break the service worker.
  }
}

function probeStatus() {
  if (!chrome.offscreen) {
    return Promise.resolve({ ok: true, offscreen: false, lastReport: lastProbeReport });
  }
  return chrome.offscreen.hasDocument().then(
    (hasDoc) => ({ ok: true, offscreen: hasDoc, lastReport: lastProbeReport }),
    () => ({ ok: true, offscreen: false, lastReport: lastProbeReport })
  );
}

globalThis.__handsfreeProbe = {
  start: () => ensureProbeOffscreen().then(() => {
    broadcastToProbe("start");
    return { ok: true, offscreen: true, dispatched: true };
  }),
  stop: () => {
    broadcastToProbe("stop");
    return Promise.resolve({ ok: true, dispatched: true });
  },
  close: () => (chrome.offscreen
    ? chrome.offscreen.closeDocument().then(
      () => ({ ok: true, closed: true }),
      (err) => ({ ok: false, error: err && err.message ? err.message : String(err) })
    )
    : Promise.resolve({ ok: false, error: "OFFSCREEN_UNSUPPORTED" })),
  status: () => probeStatus(),
};

// Boot marker: proves which bundle the running worker executed. If this line
// never appears in the service worker console, Chrome is running a stale or
// partial install, not the current dist/ output.
console.info("[Handsfree] Background worker started (probe hook ready).");

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
      if (isRestrictedUrl(tab.url)) {
        sendResponse({ ok: false, error: "RESTRICTED_PAGE" });
        return;
      }
      forwardToTab(tab.id, message, sendResponse);
    });
    return true; // async response
  }

  // Explicit user start: silence every other tab first so the newly
  // started session is not immediately killed and restarted elsewhere.
  if (message.type === MSG.START_VOICE) {
    queryActiveTab((err, tab) => {
      if (err) {
        sendResponse({ ok: false, error: err.message });
        return;
      }
      if (!tab || tab.id === undefined) {
        sendResponse({ ok: false, error: "NO_ACTIVE_TAB" });
        return;
      }
      try {
        chrome.tabs.query({}, (tabs) => {
          if (!chrome.runtime.lastError && Array.isArray(tabs)) {
            for (const t of tabs) {
              if (t && t.id !== undefined && t.id !== tab.id) {
                yieldVoiceTo(t.id);
              }
            }
          }
          forwardToTab(tab.id, message, sendResponse);
        });
      } catch (e) {
        forwardToTab(tab.id, message, sendResponse);
      }
    });
    return true;
  }

  // --- Stage-0 offscreen voice probe (isolated diagnostics, removable) ---
  if (message.type === MSG.OFFSCREEN_PROBE_START) {
    ensureProbeOffscreen().then(
      () => {
        broadcastToProbe("start");
        sendResponse({ ok: true, offscreen: true, dispatched: true });
      },
      (err) => {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    );
    return true;
  }

  if (message.type === MSG.OFFSCREEN_PROBE_STOP) {
    broadcastToProbe("stop");
    sendResponse({ ok: true, dispatched: true });
    return false;
  }

  if (message.type === MSG.OFFSCREEN_PROBE_CLOSE) {
    if (!chrome.offscreen) {
      sendResponse({ ok: false, error: "OFFSCREEN_UNSUPPORTED" });
      return false;
    }
    chrome.offscreen.closeDocument().then(
      () => sendResponse({ ok: true, closed: true }),
      (err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
    );
    return true;
  }

  if (message.type === MSG.OFFSCREEN_PROBE_STATUS) {
    probeStatus().then((res) => sendResponse(res));
    return true;
  }

  if (message.type === MSG.OFFSCREEN_PROBE_REPORT) {
    lastProbeReport = message.report || null;
    console.info("[VoiceProbe] report:", lastProbeReport);
    sendResponse({ ok: true });
    return false;
  }
  // --- end Stage-0 probe ---

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
