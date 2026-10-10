import { MSG } from "../shared/messages.js";
import { getDefaults, loadSettings, validateSettingsPatch } from "../shared/settings.js";

console.log("[Handsfree] Content script loaded.");

// === WS-4 Phase D: in-memory settings (popup is the primary writer) ===
let currentSettings = getDefaults();
let dirtyDuringLoad = false;
let lastAppliedRev = 0;

loadSettings()
  .then((s) => {
    // Fix 1: ignore the initial load if a newer UPDATE_SETTINGS already arrived.
    if (!dirtyDuringLoad) {
      const { clean } = validateSettingsPatch(s);
      currentSettings = { ...getDefaults(), ...clean };
    }
  })
  .catch(() => {});

// === WS-4: runtime activity flags (controllers from WS-1/WS-2/WS-3 not present) ===
// These track actual activity, not configured intent. They stay at
// unavailable/unknown values until teammate controllers land.
const runtime = {
  tracking: false,
  voice: false,
  fps: null,
  calibrated: false,
};

// === WS-4: apply settings to controllers only when their APIs genuinely exist ===
// WS-1 (CursorController), WS-2 (VoiceController), WS-3 (DwellController) have no
// modules or globals on this branch, so this function only feature-detects the
// documented shared global and otherwise no-ops. Teammates can extend it.
function applySettingsToControllers(settings) {
  try {
    if (typeof window !== "undefined" && window.__handsfree_cursor) {
      // Presence check only — the cursor loop is owned by WS-1.
      void settings;
    }
  } catch {
    // Never let a missing controller break settings persistence.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Handsfree] Received message:", message && message.type);

  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "INVALID_MESSAGE" });
    return false;
  }

  // === WS-4 Phase D: settings updates (in-memory only; popup persists) ===
  if (message.type === MSG.UPDATE_SETTINGS || message.type === MSG.SETTINGS_CHANGED) {
    // Fix 2: ignore out-of-order duplicates; messages without rev always apply.
    if (typeof message.rev === "number" && message.rev <= lastAppliedRev) {
      sendResponse({ ok: false, error: "STALE_REVISION" });
      return false;
    }
    // Fix 4: reject invalid types/ranges and empty patches; accept valid partials.
    const { clean, errors } = validateSettingsPatch(message.settings);
    if (errors.length > 0) {
      sendResponse({ ok: false, error: "INVALID_SETTINGS", details: errors });
      return false;
    }
    dirtyDuringLoad = true;
    if (typeof message.rev === "number") {
      lastAppliedRev = message.rev;
    }
    currentSettings = { ...currentSettings, ...clean };
    applySettingsToControllers(currentSettings);
    sendResponse({ ok: true, settings: { ...currentSettings }, rev: lastAppliedRev });
    return false;
  }

  // === WS-4: real status (honest about missing controllers) ===
  if (message.type === MSG.GET_STATUS) {
    sendResponse({
      ok: true,
      tracking: runtime.tracking,
      voice: runtime.voice,
      fps: runtime.fps,
      calibrated: runtime.calibrated,
      settings: { ...currentSettings },
      rev: lastAppliedRev,
      controllersAvailable: false,
      note: "WS-1/WS-2/WS-3 controllers not present; runtime values are unavailable/unknown.",
    });
    return false;
  }

  sendResponse({ ok: true });
  return false;
});
