/**
 * Evaluation Storage Service
 * Persists Performance Evaluation sessions and history in chrome.storage.local
 * with fallback to window.localStorage in non-extension / testing environments.
 */

import { computeSessionSummary } from "./evaluationMetrics.js";

export const EVALUATION_STORAGE_KEY = "handsfree_evaluation_history";

const fallbackMemoryStore = new Map();

/**
 * Helper to get raw storage backend.
 */
function getStorageBackend() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    return {
      type: "chrome",
      get: (key) =>
        new Promise((resolve) => {
          chrome.storage.local.get([key], (res) => resolve(res?.[key] || null));
        }),
      set: (key, val) =>
        new Promise((resolve, reject) => {
          chrome.storage.local.set({ [key]: val }, () => {
            if (chrome.runtime?.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        }),
      remove: (key) =>
        new Promise((resolve) => {
          chrome.storage.local.remove([key], () => resolve());
        }),
    };
  }

  // Fallback to localStorage or in-memory
  return {
    type: "local",
    get: async (key) => {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          const item = window.localStorage.getItem(key);
          return item ? JSON.parse(item) : null;
        }
      } catch (_) {}
      return fallbackMemoryStore.get(key) || null;
    },
    set: async (key, val) => {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem(key, JSON.stringify(val));
          return;
        }
      } catch (_) {}
      fallbackMemoryStore.set(key, val);
    },
    remove: async (key) => {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.removeItem(key);
          return;
        }
      } catch (_) {}
      fallbackMemoryStore.delete(key);
    },
  };
}

/**
 * Validates and normalizes session object before storage.
 * @param {Object} session
 * @returns {Object|null}
 */
export function validateSession(session) {
  if (!session || typeof session !== "object") return null;
  if (!session.sessionId || typeof session.sessionId !== "string") return null;
  if (!session.mode || (session.mode !== "handsfree" && session.mode !== "conventional")) return null;

  // Recompute summary metrics to prevent tampering or inconsistency
  const taskResults = Array.isArray(session.taskResults) ? session.taskResults : [];
  const summary = computeSessionSummary(taskResults);

  return {
    sessionId: session.sessionId,
    comparisonId: session.comparisonId || null,
    mode: session.mode,
    startedAt: session.startedAt || new Date().toISOString(),
    completedAt: session.completedAt || new Date().toISOString(),
    status: session.status || "completed",
    taskResults,
    summary,
  };
}

/**
 * Loads all saved evaluation sessions, sorted newest first.
 * @returns {Promise<Array<Object>>}
 */
export async function getEvaluationSessions() {
  try {
    const backend = getStorageBackend();
    const raw = await backend.get(EVALUATION_STORAGE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.map(validateSession).filter(Boolean);
  } catch (err) {
    console.warn("[Handsfree Eval] Error loading sessions:", err);
    return [];
  }
}

/**
 * Saves a completed evaluation session to history.
 * Prevents duplicates by replacing matching sessionId.
 * @param {Object} session
 * @returns {Promise<boolean>}
 */
export async function saveEvaluationSession(session) {
  const clean = validateSession(session);
  if (!clean) {
    throw new Error("Invalid evaluation session data");
  }

  try {
    const backend = getStorageBackend();
    const existing = await getEvaluationSessions();
    const filtered = existing.filter((s) => s.sessionId !== clean.sessionId);
    filtered.unshift(clean); // Newest first

    // Keep at most 50 recent evaluation sessions
    const capped = filtered.slice(0, 50);
    await backend.set(EVALUATION_STORAGE_KEY, capped);
    return true;
  } catch (err) {
    console.error("[Handsfree Eval] Error saving session:", err);
    throw err;
  }
}

/**
 * Deletes a single evaluation session by ID.
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function deleteEvaluationSession(sessionId) {
  if (!sessionId) return false;
  try {
    const backend = getStorageBackend();
    const existing = await getEvaluationSessions();
    const filtered = existing.filter((s) => s.sessionId !== sessionId);
    await backend.set(EVALUATION_STORAGE_KEY, filtered);
    return true;
  } catch (err) {
    console.warn("[Handsfree Eval] Error deleting session:", err);
    return false;
  }
}

/**
 * Wipes all evaluation history.
 * @returns {Promise<boolean>}
 */
export async function clearEvaluationHistory() {
  try {
    const backend = getStorageBackend();
    await backend.remove(EVALUATION_STORAGE_KEY);
    return true;
  } catch (err) {
    console.warn("[Handsfree Eval] Error clearing history:", err);
    return false;
  }
}

/**
 * Finds the latest Handsfree and Conventional sessions to produce a comparison.
 * Prioritizes sessions sharing the same comparisonId if available.
 * @returns {Promise<{ handsfree: Object|null, conventional: Object|null }>}
 */
export async function getLatestComparison() {
  const sessions = await getEvaluationSessions();
  if (sessions.length === 0) {
    return { handsfree: null, conventional: null };
  }

  // 1. Try to find paired comparison sessions
  const withComparisonId = sessions.filter((s) => s.comparisonId);
  const byCompId = new Map();
  for (const s of withComparisonId) {
    if (!byCompId.has(s.comparisonId)) byCompId.set(s.comparisonId, {});
    byCompId.get(s.comparisonId)[s.mode] = s;
  }

  for (const pair of byCompId.values()) {
    if (pair.handsfree && pair.conventional) {
      return { handsfree: pair.handsfree, conventional: pair.conventional };
    }
  }

  // 2. Otherwise find the newest session of each mode
  const latestHandsfree = sessions.find((s) => s.mode === "handsfree") || null;
  const latestConventional = sessions.find((s) => s.mode === "conventional") || null;

  return {
    handsfree: latestHandsfree,
    conventional: latestConventional,
  };
}
