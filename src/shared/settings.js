import { DEFAULTS } from "./constants.js";

const STORAGE_KEY = "handsfree_settings";

function hasSyncStorage() {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.storage &&
    !!chrome.storage.sync &&
    typeof chrome.storage.sync.get === "function" &&
    typeof chrome.storage.sync.set === "function"
  );
}

export function getDefaults() {
  return { ...DEFAULTS };
}

function getAsync(key) {
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = chrome.storage.sync.get(key, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

function setAsync(data) {
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = chrome.storage.sync.set(data, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

export async function loadSettings() {
  const defaults = getDefaults();
  if (!hasSyncStorage()) {
    return defaults;
  }
  try {
    const result = await getAsync(STORAGE_KEY);
    const stored = result ? result[STORAGE_KEY] : undefined;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return defaults;
    }
    return { ...defaults, ...stored };
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings) {
  if (!hasSyncStorage()) {
    throw new Error("NO_EXTENSION_API");
  }
  await setAsync({ [STORAGE_KEY]: settings });
}

const NUMERIC_RANGES = {
  sensitivity: [5, 30],
  smoothing: [0.1, 0.8],
  deadZone: [0.01, 0.1],
  dwellDuration: [500, 3000],
};

const BOOLEAN_KEYS = [
  "trackingEnabled",
  "voiceEnabled",
  "typingEnabled",
  "intentLockEnabled",
];

export function validateSettingsPatch(patch) {
  const clean = {};
  const errors = [];
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { clean, errors: ["INVALID_SETTINGS"] };
  }
  let knownKeyCount = 0;
  for (const key of Object.keys(patch)) {
    if (key in NUMERIC_RANGES) {
      knownKeyCount += 1;
      const value = patch[key];
      const [min, max] = NUMERIC_RANGES[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        errors.push(`${key} must be a number between ${min} and ${max}`);
      } else {
        clean[key] = value;
      }
    } else if (BOOLEAN_KEYS.includes(key)) {
      knownKeyCount += 1;
      if (typeof patch[key] !== "boolean") {
        errors.push(`${key} must be a boolean`);
      } else {
        clean[key] = patch[key];
      }
    }
    // Unknown keys are ignored so future settings can be added compatibly.
  }
  if (knownKeyCount === 0) {
    errors.push("EMPTY_PATCH");
  }
  return { clean, errors };
}
