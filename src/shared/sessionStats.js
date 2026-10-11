/**
 * sessionStats.js — Lightweight session statistics tracker.
 *
 * Stores stats in chrome.storage.local with key "handsfree_session_stats".
 * Cleared on browser startup by the background service worker.
 *
 * Stats tracked:
 *  - sessionStart        : timestamp when tracking or activity began
 *  - dwellClicks         : total dwell-activated clicks
 *  - voiceCommandsFired  : total recognized voice commands
 *  - commandCounts       : { commandName: count } frequency map
 *  - calibrations        : number of calibrations performed
 *  - pauseCount          : number of times tracking was paused
 *  - faceNotDetected     : frames where no face was found
 *  - totalFrames         : total face-detection frames processed
 */

const STORAGE_KEY = "handsfree_session_stats";

const DEFAULT_STATS = {
  sessionStart: null,
  dwellClicks: 0,
  voiceCommandsFired: 0,
  commandCounts: {},
  calibrations: 0,
  pauseCount: 0,
  faceNotDetected: 0,
  totalFrames: 0,
};

// In-memory buffer for high-frequency frame tracking (~30fps)
let pendingFrames = 0;
let pendingFaceMisses = 0;
let frameFlushTimeout = null;

// Sequential update queue to prevent concurrent read-modify-write race conditions
let updateQueue = Promise.resolve();

/** Load stats from storage. Returns defaults if nothing saved yet. */
export async function loadStats() {
  return new Promise((resolve) => {
    try {
      const store = chrome.storage?.local;
      if (!store) {
        resolve({ ...DEFAULT_STATS });
        return;
      }
      store.get(STORAGE_KEY, (res) => {
        if (chrome.runtime?.lastError || !res || !res[STORAGE_KEY]) {
          const stats = { ...DEFAULT_STATS };
          // Merge any buffered in-memory frame counts
          stats.totalFrames += pendingFrames;
          stats.faceNotDetected += pendingFaceMisses;
          resolve(stats);
        } else {
          const stats = { ...DEFAULT_STATS, ...res[STORAGE_KEY] };
          stats.totalFrames = (stats.totalFrames || 0) + pendingFrames;
          stats.faceNotDetected = (stats.faceNotDetected || 0) + pendingFaceMisses;
          resolve(stats);
        }
      });
    } catch {
      resolve({ ...DEFAULT_STATS });
    }
  });
}

/** Persist stats to storage. */
async function saveStats(stats) {
  return new Promise((resolve) => {
    try {
      const store = chrome.storage?.local;
      if (!store) {
        resolve();
        return;
      }
      store.set({ [STORAGE_KEY]: stats }, () => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

/** Apply an atomic serialized update to the persisted stats object. */
async function updateStats(updater) {
  updateQueue = updateQueue
    .then(async () => {
      const current = await loadStats();
      const next = updater(current);
      await saveStats(next);
      return next;
    })
    .catch((err) => {
      console.warn("[Handsfree] updateStats warning:", err);
    });
  return updateQueue;
}

// ─── Public recording API ─────────────────────────────────────────────────

/** Call when head tracking starts for the first time this session. */
export async function recordSessionStart() {
  await updateStats((s) => ({
    ...s,
    sessionStart: s.sessionStart ?? Date.now(),
  }));
}

/** Call on every dwell-activated click. */
export async function recordDwellClick() {
  await updateStats((s) => ({
    ...s,
    sessionStart: s.sessionStart ?? Date.now(),
    dwellClicks: (s.dwellClicks || 0) + 1,
  }));
}

/** Call when a voice command is successfully executed. */
export async function recordVoiceCommand(commandName) {
  if (!commandName) return;
  const name = String(commandName).trim();
  if (!name) return;

  await updateStats((s) => {
    const counts = { ...(s.commandCounts || {}) };
    counts[name] = (counts[name] || 0) + 1;
    return {
      ...s,
      sessionStart: s.sessionStart ?? Date.now(),
      voiceCommandsFired: (s.voiceCommandsFired || 0) + 1,
      commandCounts: counts,
    };
  });
}

/** Call each time the user calibrates. */
export async function recordCalibration() {
  await updateStats((s) => ({
    ...s,
    sessionStart: s.sessionStart ?? Date.now(),
    calibrations: (s.calibrations || 0) + 1,
  }));
}

/** Call each time tracking is paused. */
export async function recordPause() {
  await updateStats((s) => ({
    ...s,
    sessionStart: s.sessionStart ?? Date.now(),
    pauseCount: (s.pauseCount || 0) + 1,
  }));
}

/**
 * Call every face-detection frame.
 * Batched in memory and flushed every 2 seconds to avoid storage thrashing.
 * @param {boolean} faceFound - whether a face was detected this frame
 */
export function recordFrame(faceFound) {
  pendingFrames++;
  if (!faceFound) pendingFaceMisses++;

  if (!frameFlushTimeout) {
    frameFlushTimeout = setTimeout(() => {
      frameFlushTimeout = null;
      if (pendingFrames === 0) return;
      const f = pendingFrames;
      const m = pendingFaceMisses;
      pendingFrames = 0;
      pendingFaceMisses = 0;
      updateStats((s) => ({
        ...s,
        sessionStart: s.sessionStart ?? Date.now(),
        totalFrames: (s.totalFrames || 0) + f,
        faceNotDetected: (s.faceNotDetected || 0) + m,
      })).catch(() => {});
    }, 2000);
  }
}

/** Reset all stats (e.g., when the user clicks "Reset" in the dashboard). */
export async function resetStats() {
  pendingFrames = 0;
  pendingFaceMisses = 0;
  await saveStats({ ...DEFAULT_STATS });
}

/** Compute derived metrics from raw stats. */
export function deriveMetrics(stats) {
  const now = Date.now();
  const sessionMs = stats?.sessionStart ? now - stats.sessionStart : 0;
  const sessionMins = Math.floor(sessionMs / 60000);
  const sessionSecs = Math.floor((sessionMs % 60000) / 1000);

  const totalFrames = stats?.totalFrames || 0;
  const faceFoundFrames = Math.max(0, totalFrames - (stats?.faceNotDetected || 0));
  const detectionRate = totalFrames > 0
    ? Math.round((faceFoundFrames / totalFrames) * 100)
    : null;

  // Top 5 commands by frequency
  const sortedCommands = Object.entries(stats?.commandCounts || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return {
    sessionDuration: sessionMs > 0 ? `${sessionMins}m ${sessionSecs}s` : "—",
    dwellClicks: stats?.dwellClicks || 0,
    voiceCommandsFired: stats?.voiceCommandsFired || 0,
    calibrations: stats?.calibrations || 0,
    pauseCount: stats?.pauseCount || 0,
    detectionRate,
    topCommands: sortedCommands,
  };
}
