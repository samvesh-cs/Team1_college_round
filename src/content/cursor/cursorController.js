/**
 * CursorController orchestrates head-tracking input and updates the cursor DOM element.
 * It combines faceTracking landmark streams with cursorMath transformations.
 */

import { start as startTracking, stop as stopTracking } from "./faceTracking.js";
import {
  calibrate as mathCalibrate,
  getDelta,
  applyDeadZone,
  applySmoothing,
  mapToViewport,
  clamp,
} from "./cursorMath.js";
import { DEFAULTS } from "../../shared/constants.js";

export class CursorController {
  /**
   * @param {Object} options
   * @param {number} [options.sensitivity]
   * @param {number} [options.smoothing]
   * @param {number} [options.deadZone]
   */
  constructor(options = {}) {
    this.sensitivity = options.sensitivity ?? DEFAULTS.sensitivity;
    this.smoothing = options.smoothing ?? DEFAULTS.smoothing;
    this.deadZone = options.deadZone ?? DEFAULTS.deadZone;

    this.cursorEl = null;
    this.isTracking = false;
    this.isPaused = false;

    // Last known raw landmark coordinates
    this.lastRawX = 0.5;
    this.lastRawY = 0.5;

    // Current smoothed cursor pixel coordinates
    this.currentX = window.innerWidth / 2;
    this.currentY = window.innerHeight / 2;
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

    let isFirstFrame = true;

    try {
      await startTracking(({ x, y }) => {
        if (!this.isTracking) return;

        this.lastRawX = x;
        this.lastRawY = y;

        // Auto-calibrate on the very first detected frame
        if (isFirstFrame) {
          mathCalibrate(x, y);
          isFirstFrame = false;
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

    // Apply dead zone to suppress natural micro-tremor
    const dzX = applyDeadZone(mirroredDx, this.deadZone);
    const dzY = applyDeadZone(deltaY, this.deadZone);

    const vpWidth = window.innerWidth;
    const vpHeight = window.innerHeight;
    const centerX = vpWidth / 2;
    const centerY = vpHeight / 2;

    // Map delta displacements to target screen pixels
    const targetX = mapToViewport(dzX, this.sensitivity, centerX, vpWidth);
    const targetY = mapToViewport(dzY, this.sensitivity, centerY, vpHeight);

    // Smooth movement using Exponential Moving Average (EMA)
    this.currentX = applySmoothing(this.currentX, targetX, this.smoothing);
    this.currentY = applySmoothing(this.currentY, targetY, this.smoothing);

    // Keep cursor within visible viewport bounds
    const clampedX = clamp(this.currentX, 0, vpWidth);
    const clampedY = clamp(this.currentY, 0, vpHeight);

    // Direct DOM style update for 60fps performance (bypassing any virtual DOM)
    if (this.cursorEl) {
      this.cursorEl.style.left = `${clampedX}px`;
      this.cursorEl.style.top = `${clampedY}px`;
    }
  }

  /**
   * Calibrates the current head position as the new neutral/center point.
   */
  calibrate() {
    mathCalibrate(this.lastRawX, this.lastRawY);
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
   * Dynamically adjust sensitivity (cursor speed/travel distance).
   * @param {number} val
   */
  setSensitivity(val) {
    this.sensitivity = Number(val);
  }

  /**
   * Dynamically adjust smoothing factor (0 = instant/raw, 0.9 = very smooth/gradual).
   * @param {number} val
   */
  setSmoothing(val) {
    this.smoothing = Number(val);
  }

  /**
   * Stops tracking, frees the camera, and hides the cursor element.
   */
  stop() {
    this.isTracking = false;
    this.isPaused = false;

    stopTracking();

    if (this.cursorEl) {
      this.cursorEl.classList.remove("active", "paused");
    }
  }
}
