/**
 * Interactive On-Screen Face Calibration Overlay
 * Displays live mirrored webcam video with face framing guides and real-time landmark reticle.
 * Guides the user to establish a perfect, jitter-free neutral head posture.
 */

import { getMediaStream, getLatestLandmark } from "../cursor/faceTracking.js";

export class CalibrationOverlay {
  constructor(cursorController) {
    this.cursor = cursorController;
    this.el = null;
    this.videoEl = null;
    this.dotEl = null;
    this.viewportEl = null;
    this.statusEl = null;
    this.actionBtn = null;
    this.isVisible = false;
    this.rafId = null;
    this.countdownTimer = null;
    this.isCalibrating = false;

    this._initDOM();
    this._initShortcuts();
  }

  _initDOM() {
    let overlay = document.getElementById("handsfree-calibration-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "handsfree-calibration-overlay";
      overlay.innerHTML = `
        <div class="handsfree-calib-card" role="dialog" aria-modal="true" aria-label="Handsfree Calibration">
          <h2 class="handsfree-calib-title">Face Calibration Studio</h2>
          <p class="handsfree-calib-subtitle">
            Sit naturally and align your face in the circle.<br/>Look directly at the center crosshair.
          </p>

          <div class="handsfree-calib-viewport" id="handsfree-calib-vp">
            <video class="handsfree-calib-video" id="handsfree-calib-vid" autoplay playsinline muted></video>
            <div class="handsfree-calib-reticle">
              <div class="handsfree-calib-oval"></div>
              <div class="handsfree-calib-crosshair"></div>
            </div>
            <div class="handsfree-calib-dot" id="handsfree-calib-nose-dot"></div>
          </div>

          <div class="handsfree-calib-status" id="handsfree-calib-status-badge">
            <span id="handsfree-calib-status-text">Align face in center...</span>
          </div>

          <div class="handsfree-calib-actions">
            <button type="button" class="handsfree-calib-btn-primary" id="handsfree-calib-start-btn">
              Calibrate Center (Space)
            </button>
            <button type="button" class="handsfree-calib-btn-secondary" id="handsfree-calib-close-btn">
              Cancel (Esc)
            </button>
          </div>

          <div class="handsfree-calib-hint">
            ⌨ Tip: Press <strong>Alt + C</strong> anytime to recenter your cursor.
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    this.el = overlay;
    this.videoEl = overlay.querySelector("#handsfree-calib-vid");
    this.viewportEl = overlay.querySelector("#handsfree-calib-vp");
    this.dotEl = overlay.querySelector("#handsfree-calib-nose-dot");
    this.statusEl = overlay.querySelector("#handsfree-calib-status-badge");
    this.statusTextEl = overlay.querySelector("#handsfree-calib-status-text");
    this.actionBtn = overlay.querySelector("#handsfree-calib-start-btn");
    this.closeBtn = overlay.querySelector("#handsfree-calib-close-btn");

    this.actionBtn.addEventListener("click", () => {
      const stream = getMediaStream();
      if (!stream) {
        this.isVisible = false;
        this.show();
      } else {
        this.startCountdown();
      }
    });
    this.closeBtn.addEventListener("click", () => this.hide());
  }

  _initShortcuts() {
    window.addEventListener("keydown", (e) => {
      // Global Alt+C shortcut to open/trigger calibration
      if (e.altKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        if (this.isVisible) {
          this.startCountdown();
        } else {
          this.show();
        }
        return;
      }

      if (!this.isVisible) return;

      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        this.startCountdown();
      }
    });
  }

  /**
   * Opens the calibration HUD and attaches the live webcam feed.
   */
  async show() {
    if (this.isVisible) return;
    this.isVisible = true;
    this.isCalibrating = false;

    this.el.classList.add("active");
    this.setStatus("Opening camera...", false);
    if (this.actionBtn) {
      this.actionBtn.textContent = "Calibrate Center (Space)";
      this.actionBtn.disabled = true;
    }

    // 1. Ensure cursor / face tracking is started
    if (this.cursor && !this.cursor.isTracking) {
      this.setStatus("Starting camera & face tracking...", false);
      try {
        await this.cursor.start();
      } catch (err) {
        console.error("[Handsfree] Failed to start tracking for calibration:", err);
        const isPerm =
          err?.name === "NotAllowedError" ||
          (err?.message && err.message.includes("Permission"));
        this.setStatus(
          isPerm
            ? "⚠️ Camera permission denied. Please allow camera in browser."
            : "⚠️ Camera failed to open. Check webcam connection.",
          false
        );
        if (this.actionBtn) {
          this.actionBtn.disabled = false;
          this.actionBtn.textContent = "Retry Camera";
        }
        return;
      }
    }

    // 2. Obtain active media stream (poll up to 4s if still initializing)
    let stream = getMediaStream();
    if (!stream) {
      this.setStatus("Connecting camera feed...", false);
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (!this.isVisible) return; // dismissed during wait
        stream = getMediaStream();
        if (stream) break;
      }
    }

    if (!stream) {
      this.setStatus("⚠️ Camera stream unavailable. Reload page and try again.", false);
      if (this.actionBtn) {
        this.actionBtn.disabled = false;
        this.actionBtn.textContent = "Retry Camera";
      }
      return;
    }

    // 3. Attach stream to mirrored video element
    if (this.videoEl) {
      this.videoEl.srcObject = stream;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      try {
        await this.videoEl.play();
      } catch (e) {
        console.warn("[Handsfree] Video play warning:", e);
      }
    }

    if (this.actionBtn) {
      this.actionBtn.textContent = "Calibrate Center (Space)";
      this.actionBtn.disabled = false;
    }

    this.setStatus("Align face in center...", false);
    this._startRenderLoop();
  }

  /**
   * Closes the calibration HUD.
   */
  hide() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.isCalibrating = false;

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
    }

    this.el.classList.remove("active");
  }

  setStatus(text, aligned = false, success = false) {
    if (!this.statusTextEl || !this.statusEl) return;
    this.statusTextEl.textContent = text;
    this.statusEl.className = "handsfree-calib-status";
    if (aligned) this.statusEl.classList.add("aligned");
    if (success) this.statusEl.classList.add("success");

    if (this.viewportEl) {
      if (aligned || success) {
        this.viewportEl.classList.add("aligned");
      } else {
        this.viewportEl.classList.remove("aligned");
      }
    }
  }

  _startRenderLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const updateLoop = () => {
      if (!this.isVisible) return;

      const landmark = getLatestLandmark();
      if (landmark && typeof landmark.x === "number" && typeof landmark.y === "number") {
        // Mirrored X for mirror view (1 - x)
        const mirroredX = 1 - landmark.x;
        const normY = landmark.y;

        // Position tracking dot relative to 190x190 viewport
        if (this.dotEl) {
          this.dotEl.classList.add("active");
          this.dotEl.style.left = `${mirroredX * 100}%`;
          this.dotEl.style.top = `${normY * 100}%`;
        }

        // Check if user is well aligned near center (within 15% radius)
        const dx = mirroredX - 0.5;
        const dy = normY - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isAligned = dist < 0.15;

        if (!this.isCalibrating) {
          if (isAligned) {
            this.setStatus("✓ Face Centered! Ready to calibrate.", true);
          } else {
            this.setStatus("Center face inside circle...", false);
          }
        }
      } else {
        if (!this.isCalibrating) {
          this.setStatus("Detecting face...", false);
        }
        if (this.dotEl) {
          this.dotEl.classList.remove("active");
        }
      }

      this.rafId = requestAnimationFrame(updateLoop);
    };

    this.rafId = requestAnimationFrame(updateLoop);
  }

  /**
   * Starts a smooth 3-second countdown to calibrate rock-steady neutral point.
   */
  startCountdown() {
    if (this.isCalibrating) return;

    const stream = getMediaStream();
    if (!stream) {
      this.isVisible = false;
      this.show();
      return;
    }

    this.isCalibrating = true;

    if (this.actionBtn) {
      this.actionBtn.disabled = true;
    }

    let remaining = 3;
    this.setStatus(`Calibrating in ${remaining}... Sit naturally!`, true);

    if (this.countdownTimer) clearInterval(this.countdownTimer);

    this.countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        this.setStatus(`Calibrating in ${remaining}... Hold steady!`, true);
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this._executeCalibration();
      }
    }, 800);
  }

  _executeCalibration() {
    this.setStatus("Locking neutral center point...", true);

    // Perform multi-sample calibration (collects 20 frames to eliminate tremor)
    if (this.cursor && typeof this.cursor.calibrateWithSampling === "function") {
      this.cursor.calibrateWithSampling(20, ({ x, y }) => {
        this._onCalibrationComplete(x, y);
      });
    } else if (this.cursor) {
      this.cursor.calibrate();
      this._onCalibrationComplete();
    }
  }

  _onCalibrationComplete(x = 0.5, y = 0.5) {
    this.setStatus("🎉 Neutral Point Locked! Calibrated.", false, true);

    if (this.actionBtn) {
      this.actionBtn.textContent = "✓ Calibrated!";
    }

    // Auto-dismiss smoothly after user sees confirmation
    setTimeout(() => {
      this.hide();
    }, 1200);
  }
}
