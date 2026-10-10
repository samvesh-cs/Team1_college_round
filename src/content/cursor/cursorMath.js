/**
 * Pure math functions for head-tracking cursor calculations.
 * Used to translate raw face landmark coordinates into smooth screen pixel positions.
 */

// Neutral reference point stored upon calibration (normalized 0 to 1)
let neutralX = 0.5;
let neutralY = 0.5;

/**
 * Calibrate the neutral reference position.
 * @param {number} landmarkX - Normalized X coordinate (0 to 1)
 * @param {number} landmarkY - Normalized Y coordinate (0 to 1)
 */
export function calibrate(landmarkX, landmarkY) {
  neutralX = landmarkX;
  neutralY = landmarkY;
}

/**
 * Calculate the delta between the current landmark position and the calibrated neutral position.
 * @param {number} currentX - Normalized current X coordinate
 * @param {number} currentY - Normalized current Y coordinate
 * @returns {{ dx: number, dy: number }}
 */
export function getDelta(currentX, currentY) {
  return {
    dx: currentX - neutralX,
    dy: currentY - neutralY,
  };
}

/**
 * Suppress micro-jitter by ignoring deltas below a threshold.
 * @param {number} delta - Displacement value
 * @param {number} deadZone - Threshold below which movement is ignored
 * @returns {number} 0 if inside deadzone, otherwise original delta
 */
export function applyDeadZone(delta, deadZone) {
  if (Math.abs(delta) <= deadZone) {
    return 0;
  }
  return delta;
}

/**
 * Exponential Moving Average (EMA) smoothing between consecutive frames.
 * @param {number} prev - Previous smoothed position value
 * @param {number} current - Target/current raw position value
 * @param {number} factor - Smoothing factor between 0 (no smooth, snappy) and 1 (fully frozen)
 * @returns {number} Smoothed value
 */
export function applySmoothing(prev, current, factor) {
  return factor * prev + (1 - factor) * current;
}

/**
 * Maps normalized displacement delta to screen viewport pixels.
 * @param {number} delta - Displacement from center (e.g. from applyDeadZone)
 * @param {number} sensitivity - Multiplier for range of motion
 * @param {number} viewportCenter - Center pixel coordinate (e.g. window.innerWidth / 2)
 * @param {number} viewportSize - Viewport dimension in pixels (e.g. window.innerWidth)
 * @returns {number} Target pixel coordinate
 */
export function mapToViewport(delta, sensitivity, viewportCenter, viewportSize) {
  return viewportCenter + delta * sensitivity * viewportSize;
}

/**
 * Clamps a numerical value within bounds [min, max].
 * @param {number} value - Input value
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
