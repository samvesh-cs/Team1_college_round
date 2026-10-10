/**
 * ============================================
 *  TEST SCRIPT FOR cursorMath.js
 * ============================================
 *
 *  HOW TO RUN:
 *    node tests/test-cursorMath.js
 *
 *  Run this AFTER you create src/content/cursor/cursorMath.js
 *  It will import your functions and check them against known answers.
 */

import {
  calibrate,
  getDelta,
  applyDeadZone,
  applySmoothing,
  mapToViewport,
  clamp,
} from "../src/content/cursor/cursorMath.js";

// ── Helpers ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, actual, expected) {
  let ok = false;
  if (typeof expected === "object" && expected !== null) {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    if (actualKeys.length === expectedKeys.length) {
      ok = actualKeys.every((k) => Math.abs(actual[k] - expected[k]) < 0.0001);
    }
  } else {
    ok = Math.abs(actual - expected) < 0.0001;
  }

  if (ok) {
    passed++;
    console.log(`  ✅ PASS: ${name}`);
    console.log(`          Got: ${JSON.stringify(actual)}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`          Expected: ${JSON.stringify(expected)}`);
    console.log(`          Got:      ${JSON.stringify(actual)}`);
  }
}

// ── Tests ────────────────────────────────────────────────

console.log("");
console.log("╔══════════════════════════════════════════╗");
console.log("║   cursorMath.js — Test Suite             ║");
console.log("╚══════════════════════════════════════════╝");
console.log("");

// ── 1. calibrate + getDelta ──────────────────────────────
console.log("─── calibrate() + getDelta() ───");

calibrate(0.5, 0.5); // Set nose center at (0.5, 0.5)

test(
  "Head moved slightly right & up",
  getDelta(0.52, 0.48),
  { dx: 0.02, dy: -0.02 }
);

test(
  "Head at exact center → zero delta",
  getDelta(0.5, 0.5),
  { dx: 0, dy: 0 }
);

test(
  "Head moved far left & down",
  getDelta(0.3, 0.7),
  { dx: -0.2, dy: 0.2 }
);

// Re-calibrate to a new position
calibrate(0.6, 0.4);

test(
  "After re-calibrate(0.6, 0.4), head at (0.6, 0.4) → zero",
  getDelta(0.6, 0.4),
  { dx: 0, dy: 0 }
);

test(
  "After re-calibrate, head at (0.7, 0.5) → delta from new center",
  getDelta(0.7, 0.5),
  { dx: 0.1, dy: 0.1 }
);

console.log("");

// ── 2. applyDeadZone ─────────────────────────────────────
console.log("─── applyDeadZone() ───");

test(
  "Small movement inside dead zone (0.01 < 0.02) → 0",
  applyDeadZone(0.01, 0.02),
  0
);

test(
  "Negative small movement inside dead zone (-0.01) → 0",
  applyDeadZone(-0.01, 0.02),
  0
);

test(
  "Exactly at dead zone boundary (0.02) → 0 (boundary = still dead)",
  applyDeadZone(0.02, 0.02),
  0
);

test(
  "Movement outside dead zone (0.05 > 0.02) → 0.05",
  applyDeadZone(0.05, 0.02),
  0.05
);

test(
  "Negative movement outside dead zone (-0.05) → -0.05",
  applyDeadZone(-0.05, 0.02),
  -0.05
);

test(
  "Zero dead zone, any movement passes through",
  applyDeadZone(0.001, 0),
  0.001
);

console.log("");

// ── 3. applySmoothing (EMA) ──────────────────────────────
console.log("─── applySmoothing() ───");

test(
  "Smooth 100 → 200 with factor 0.3 → 170",
  applySmoothing(100, 200, 0.3),
  // 0.3 * 100 + 0.7 * 200 = 30 + 140 = 170
  170
);

test(
  "factor=0 means NO smoothing, jump directly to current",
  applySmoothing(100, 200, 0),
  // 0 * 100 + 1 * 200 = 200
  200
);

test(
  "factor=1 means FULL smoothing, stuck at previous value",
  applySmoothing(100, 200, 1),
  // 1 * 100 + 0 * 200 = 100
  100
);

test(
  "factor=0.5, equal blend",
  applySmoothing(100, 200, 0.5),
  // 0.5 * 100 + 0.5 * 200 = 150
  150
);

test(
  "Same prev and current → stays the same regardless of factor",
  applySmoothing(300, 300, 0.7),
  300
);

console.log("");

// ── 4. mapToViewport ─────────────────────────────────────
console.log("─── mapToViewport() ───");

test(
  "Zero delta → cursor at center",
  mapToViewport(0, 15, 960, 1920),
  // 960 + 0 * 15 * 1920 = 960
  960
);

test(
  "Positive delta → cursor moves right/down from center",
  mapToViewport(0.05, 15, 960, 1920),
  // 960 + 0.05 * 15 * 1920 = 960 + 1440 = 2400
  2400
);

test(
  "Negative delta → cursor moves left/up from center",
  mapToViewport(-0.03, 15, 540, 1080),
  // 540 + (-0.03) * 15 * 1080 = 540 - 486 = 54
  54
);

test(
  "Sensitivity=1 means small range of motion",
  mapToViewport(0.05, 1, 960, 1920),
  // 960 + 0.05 * 1 * 1920 = 960 + 96 = 1056
  1056
);

console.log("");

// ── 5. clamp ─────────────────────────────────────────────
console.log("─── clamp() ───");

test(
  "Value above max → clamped to max",
  clamp(2400, 0, 1920),
  1920
);

test(
  "Value below min → clamped to min",
  clamp(-50, 0, 1920),
  0
);

test(
  "Value within range → unchanged",
  clamp(500, 0, 1920),
  500
);

test(
  "Value exactly at min → stays at min",
  clamp(0, 0, 1920),
  0
);

test(
  "Value exactly at max → stays at max",
  clamp(1920, 0, 1920),
  1920
);

console.log("");

// ── Summary ──────────────────────────────────────────────
console.log("══════════════════════════════════════════");
console.log(`  Total: ${passed + failed}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
if (failed === 0) {
  console.log("  🎉 ALL TESTS PASSED! Move on to Bit 2.");
} else {
  console.log("  ⚠️  Fix the failing tests before moving on.");
}
console.log("══════════════════════════════════════════");
console.log("");
