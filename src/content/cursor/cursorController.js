/**
 * CursorController orchestrates head-tracking input and updates the cursor DOM element.
 * It combines faceTracking landmark streams with cursorMath transformations.
 */

import { start as startTracking, stop as stopTracking } from "./faceTracking.js";
import {
  calibrate as mathCalibrate,
  getDelta,
  applyContinuousDeadZone,
  applySmoothing,
  mapToViewport,
  clamp,
  getNeutral,
} from "./cursorMath.js";
import { DEFAULTS } from "../../shared/constants.js";

export class CursorController {
  /**
   * @param {Object} options
   * @param {number} [options.sensitivity]
   * @param {number} [options.smoothing]
   * @param {number} [options.deadZone]
   * @param {boolean} [options.intentLockEnabled]
   */
  constructor(options = {}) {
    this.sensitivity = options.sensitivity ?? DEFAULTS.sensitivity;
    this.smoothing = options.smoothing ?? DEFAULTS.smoothing;
    this.deadZone = options.deadZone ?? DEFAULTS.deadZone;
    this.intentLockEnabled = options.intentLockEnabled ?? DEFAULTS.intentLockEnabled;

    this.cursorEl = null;
    this.isTracking = false;
    this.isPaused = false;
    this.isCalibrated = false;

    // Last known raw landmark coordinates
    this.lastRawX = 0.5;
    this.lastRawY = 0.5;
    this.lastDx = 0;
    this.lastDy = 0;

    // Multi-sample calibration buffer
    this.isCalibrating = false;
    this.calibrationSamples = [];
    this.targetCalibrationSamples = 15;
    this.onCalibrationComplete = null;

    // Current smoothed cursor pixel coordinates
    this.currentX = window.innerWidth / 2;
    this.currentY = window.innerHeight / 2;
  }

  get x() {
    return this.currentX;
  }

  get y() {
    return this.currentY;
  }

  getNeutralPoint() {
    return getNeutral();
  }

  /**
   * Ensures the cursor element exists in the DOM.
   * @returns {HTMLElement}
   */
  ensureCursorElement() {
    if (!this.cursorEl || !document.body.contains(this.cursorEl)) {
      let existing = document.getElementById("handsfree-cursor");
      if (!existing) {
        existing = document.createElement("div");
        existing.id = "handsfree-cursor";
        document.body.appendChild(existing);
      }
      this.cursorEl = existing;
    }
    return this.cursorEl;
  }

  /**
   * Starts head tracking and activates the cursor overlay.
   */
  async start() {
    if (this.isTracking) return;

    const el = this.ensureCursorElement();
    el.classList.add("active");
    el.classList.remove("paused");

    // Initialize to viewport center
    this.currentX = window.innerWidth / 2;
    this.currentY = window.innerHeight / 2;
    el.style.left = `${this.currentX}px`;
    el.style.top = `${this.currentY}px`;

    this.isTracking = true;
    this.isPaused = false;

    // If not yet calibrated, start collecting an initial 15-frame average
    if (!this.isCalibrated) {
      this.calibrateWithSampling(15);
    }

    try {
      await startTracking(({ x, y }) => {
        if (!this.isTracking) return;

        this.lastRawX = x;
        this.lastRawY = y;

        // Multi-sample calibration mode
        if (this.isCalibrating) {
          this.calibrationSamples.push({ x, y });
          if (this.calibrationSamples.length >= this.targetCalibrationSamples) {
            const avgX =
              this.calibrationSamples.reduce((sum, s) => sum + s.x, 0) /
              this.calibrationSamples.length;
            const avgY =
              this.calibrationSamples.reduce((sum, s) => sum + s.y, 0) /
              this.calibrationSamples.length;

            mathCalibrate(avgX, avgY);
            this.isCalibrating = false;
            this.isCalibrated = true;
            this.calibrationSamples = [];

            // Reset cursor cleanly to screen center
            this.currentX = window.innerWidth / 2;
            this.currentY = window.innerHeight / 2;
            if (this.cursorEl) {
              this.cursorEl.style.left = `${this.currentX}px`;
              this.cursorEl.style.top = `${this.currentY}px`;
            }

            const cb = this.onCalibrationComplete;
            this.onCalibrationComplete = null;
            if (typeof cb === "function") {
              cb({ x: avgX, y: avgY });
            }
          }
          return;
        }

        // If paused, ignore updates so cursor stays stationary
        if (this.isPaused) return;

        this.updatePosition(x, y);
      });
    } catch (err) {
      this.isTracking = false;
      if (this.cursorEl) {
        this.cursorEl.classList.remove("active");
      }
      throw err;
    }
  }

  /**
   * Frame processing pipeline: transforms raw landmark to viewport pixel coordinates.
   * @param {number} rawX
   * @param {number} rawY
   */
  updatePosition(rawX, rawY) {
    const { dx, dy } = getDelta(rawX, rawY);

    // Mirror X axis so moving head right moves cursor right
    const mirroredDx = -dx;
    const deltaY = dy;
    this.lastDx = mirroredDx;
    this.lastDy = deltaY;

    // Apply continuous dead zone (prevents sudden 500px cursor jumps when crossing threshold)
    const dzX = applyContinuousDeadZone(mirroredDx, this.deadZone);
    const dzY = applyContinuousDeadZone(deltaY, this.deadZone);

    const vpWidth = window.innerWidth;
    const vpHeight = window.innerHeight;
    const centerX = vpWidth / 2;
    const centerY = vpHeight / 2;

    // Map delta displacements to target screen pixels
    const targetX = mapToViewport(dzX, this.sensitivity, centerX, vpWidth);
    const targetY = mapToViewport(dzY, this.sensitivity, centerY, vpHeight);

    // Dynamic IntentLock smoothing: when moving very slowly / lingering over target,
    // boost smoothing to firmly lock against micro-tremor.
    let effectiveSmoothing = this.smoothing;
    if (this.intentLockEnabled) {
      const motionMagnitude = Math.hypot(dzX, dzY);
      if (motionMagnitude < this.deadZone * 2) {
        effectiveSmoothing = Math.min(0.92, this.smoothing + 0.12);
      }
    }

    // Smooth movement using Exponential Moving Average (EMA)
    this.currentX = applySmoothing(this.currentX, targetX, effectiveSmoothing);
    this.currentY = applySmoothing(this.currentY, targetY, effectiveSmoothing);

    // Keep cursor within visible viewport bounds
    const clampedX = clamp(this.currentX, 0, vpWidth);
    const clampedY = clamp(this.currentY, 0, vpHeight);

    // Direct DOM style update for 60fps performance
    if (this.cursorEl) {
      this.cursorEl.style.left = `${clampedX}px`;
      this.cursorEl.style.top = `${clampedY}px`;
    }
  }

  /**
   * Calibrates using a multi-frame rolling average for rock-steady neutral center.
   * @param {number} [sampleCount=20]
   * @param {Function} [onComplete]
   */
  calibrateWithSampling(sampleCount = 20, onComplete = null) {
    this.isCalibrating = true;
    this.calibrationSamples = [];
    this.targetCalibrationSamples = sampleCount;
    this.onCalibrationComplete = onComplete;
  }

  /**
   * Immediate calibration of current head position as new neutral/center point.
   */
  calibrate() {
    mathCalibrate(this.lastRawX, this.lastRawY);
    this.isCalibrated = true;
    this.currentX = window.innerWidth / 2;
    this.currentY = window.innerHeight / 2;

    if (this.cursorEl) {
      this.cursorEl.style.left = `${this.currentX}px`;
      this.cursorEl.style.top = `${this.currentY}px`;
    }
  }

  /**
   * Pauses cursor movement and dims its visual appearance.
   */
  pause() {
    this.isPaused = true;
    if (this.cursorEl) {
      this.cursorEl.classList.add("paused");
    }
  }

  /**
   * Resumes cursor tracking and restores normal brightness.
   */
  resume() {
    this.isPaused = false;
    if (this.cursorEl) {
      this.cursorEl.classList.remove("paused");
    }
  }

  /**
   * Flashes a visual click ripple and pulse on the blue cursor.
   */
  flashClick() {
    if (this.cursorEl) {
      this.cursorEl.classList.remove("clicked");
      void this.cursorEl.offsetWidth; // trigger DOM reflow
      this.cursorEl.classList.add("clicked");
      setTimeout(() => {
        if (this.cursorEl) {
          this.cursorEl.classList.remove("clicked");
        }
      }, 400);
    }
  }

  /**
   * Dynamically adjust sensitivity (cursor speed/travel distance).
   * @param {number} val
   */
  setSensitivity(val) {
    this.sensitivity = Number(val);
  }

  /**
   * Dynamically adjust smoothing factor (0 = instant/raw, 0.95 = very smooth/gradual).
   * @param {number} val
   */
  setSmoothing(val) {
    this.smoothing = Number(val);
  }

  /**
   * Dynamically adjust deadzone threshold.
   * @param {number} val
   */
  setDeadZone(val) {
    this.deadZone = Number(val);
  }

  /**
   * Enable or disable IntentLock anti-jitter stabilization.
   * @param {boolean} val
   */
  setIntentLock(val) {
    this.intentLockEnabled = Boolean(val);
  }

  /**
   * Stops tracking, frees the camera, and hides the cursor element.
   */
  stop() {
    this.isTracking = false;
    this.isPaused = false;
    this.isCalibrating = false;
    this.calibrationSamples = [];

    stopTracking();

    if (this.cursorEl) {
      this.cursorEl.classList.remove("active", "paused");
    }
  }
}
