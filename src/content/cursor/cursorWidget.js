/**
 * On-page floating controller widget for Handsfree Cursor and Voice.
 * Mounts directly into webpages so users can start, pause, calibrate, and tweak tracking
 * anywhere without needing DevTools or losing track of the extension state.
 */

export function initCursorWidget(cursor, voiceController = null) {
  if (typeof document === "undefined") return;

  const mountWidget = () => {
    if (document.getElementById("handsfree-cursor-widget")) return;

    const widget = document.createElement("div");
    widget.id = "handsfree-cursor-widget";

    widget.innerHTML = `
      <div id="hfcw-minimized" class="hfcw-min-bar">
        <span class="hfcw-dot"></span>
        <span class="hfcw-brand">🎯 Handsfree</span>
        <button id="hfcw-quick-toggle" class="hfcw-quick-btn">▶ Start</button>
        <button id="hfcw-btn-expand" class="hfcw-icon-btn" title="Expand controller">⚙️</button>
      </div>

      <div id="hfcw-expanded" class="hfcw-card" style="display: none;">
        <div class="hfcw-card-header">
          <div class="hfcw-card-title">
            <span class="hfcw-glow-icon">🎯</span>
            <div>
              <h3>Handsfree Controller</h3>
              <p>Head-tracking & voice navigation</p>
            </div>
          </div>
          <button id="hfcw-btn-collapse" class="hfcw-icon-btn" title="Minimize">—</button>
        </div>

        <div id="hfcw-status-badge" class="hfcw-badge">Status: Idle</div>

        <div class="hfcw-btn-grid">
          <button id="hfcw-btn-start" class="hfcw-btn hfcw-btn-primary">▶ Start Engine (Cursor + Voice)</button>
          <button id="hfcw-btn-pause" class="hfcw-btn hfcw-btn-secondary" disabled>⏸ Pause</button>
          <button id="hfcw-btn-resume" class="hfcw-btn hfcw-btn-secondary" disabled>▶ Resume</button>
          <button id="hfcw-btn-calibrate" class="hfcw-btn hfcw-btn-secondary" disabled>🎯 Calibrate</button>
          <button id="hfcw-btn-stop" class="hfcw-btn hfcw-btn-danger" disabled>⏹ Stop</button>
        </div>

        <!-- Voice Command Controls -->
        <div class="hfcw-voice-panel">
          <div class="hfcw-voice-header">
            <span style="font-size: 13px;">🎤 Voice Commands</span>
            <button id="hfcw-btn-voice-toggle" class="hfcw-voice-toggle-btn">Voice: Off</button>
          </div>
          <div class="hfcw-voice-hints">
            Commands: <strong>"scroll down"</strong>, <strong>"scroll up"</strong>, <strong>"top"</strong>, <strong>"bottom"</strong>
          </div>
        </div>

        <div class="hfcw-sliders">
          <div class="hfcw-slider-row">
            <label>⚡ Speed: <span id="hfcw-sens-val">${cursor.sensitivity}</span></label>
            <input type="range" id="hfcw-sens-slider" min="1" max="20" step="0.5" value="${cursor.sensitivity}">
          </div>
          <div class="hfcw-slider-row">
            <label>🌊 Smoothing: <span id="hfcw-smooth-val">${cursor.smoothing}</span></label>
            <input type="range" id="hfcw-smooth-slider" min="0.1" max="0.9" step="0.05" value="${cursor.smoothing}">
          </div>
        </div>

        <div class="hfcw-footer">
          💡 Say <strong>"scroll down"</strong> or <strong>"scroll up"</strong> to navigate!
        </div>
      </div>
    `;

    (document.body || document.documentElement).appendChild(widget);

    // DOM Elements
    const minBar = widget.querySelector("#hfcw-minimized");
    const expandedCard = widget.querySelector("#hfcw-expanded");
    const btnExpand = widget.querySelector("#hfcw-btn-expand");
    const btnCollapse = widget.querySelector("#hfcw-btn-collapse");
    const quickToggle = widget.querySelector("#hfcw-quick-toggle");

    const btnStart = widget.querySelector("#hfcw-btn-start");
    const btnPause = widget.querySelector("#hfcw-btn-pause");
    const btnResume = widget.querySelector("#hfcw-btn-resume");
    const btnCalibrate = widget.querySelector("#hfcw-btn-calibrate");
    const btnStop = widget.querySelector("#hfcw-btn-stop");
    const btnVoiceToggle = widget.querySelector("#hfcw-btn-voice-toggle");
    const statusBadge = widget.querySelector("#hfcw-status-badge");

    const sensSlider = widget.querySelector("#hfcw-sens-slider");
    const sensVal = widget.querySelector("#hfcw-sens-val");
    const smoothSlider = widget.querySelector("#hfcw-smooth-slider");
    const smoothVal = widget.querySelector("#hfcw-smooth-val");

    function updateVoiceBtnState() {
      if (voiceController && voiceController.enabled) {
        btnVoiceToggle.textContent = "🎤 Voice: Active";
        btnVoiceToggle.className = "hfcw-voice-toggle-btn hfcw-voice-active";
      } else {
        btnVoiceToggle.textContent = "🎤 Voice: Off";
        btnVoiceToggle.className = "hfcw-voice-toggle-btn";
      }
    }

    function updateUIState() {
      if (cursor.isTracking && !cursor.isPaused) {
        // Running
        btnStart.disabled = true;
        btnPause.disabled = false;
        btnResume.disabled = true;
        btnCalibrate.disabled = false;
        btnStop.disabled = false;
        quickToggle.textContent = "⏹ Stop";
        quickToggle.className = "hfcw-quick-btn hfcw-quick-stop";
        statusBadge.className = "hfcw-badge hfcw-badge-active";
        statusBadge.textContent = "Status: 🟢 Tracking Active — Move Head / Speak";
      } else if (cursor.isTracking && cursor.isPaused) {
        // Paused
        btnStart.disabled = true;
        btnPause.disabled = true;
        btnResume.disabled = false;
        btnCalibrate.disabled = false;
        btnStop.disabled = false;
        quickToggle.textContent = "▶ Resume";
        quickToggle.className = "hfcw-quick-btn";
        statusBadge.className = "hfcw-badge hfcw-badge-paused";
        statusBadge.textContent = "Status: 🟡 Paused — Dot Dimmed";
      } else {
        // Idle
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnResume.disabled = true;
        btnCalibrate.disabled = true;
        btnStop.disabled = true;
        quickToggle.textContent = "▶ Start";
        quickToggle.className = "hfcw-quick-btn";
        statusBadge.className = "hfcw-badge";
        statusBadge.textContent = "Status: Idle";
      }

      updateVoiceBtnState();
    }

    // Toggle card visibility
    btnExpand.addEventListener("click", () => {
      minBar.style.display = "none";
      expandedCard.style.display = "block";
    });

    btnCollapse.addEventListener("click", () => {
      expandedCard.style.display = "none";
      minBar.style.display = "flex";
    });

    // Tracking actions
    async function handleStart() {
      statusBadge.textContent = "Status: ⏳ Initializing Camera & Mic...";
      try {
        await cursor.start();
        if (voiceController && !voiceController.enabled) {
          voiceController.start();
        }
        updateUIState();
      } catch (err) {
        console.error("[Handsfree] Error starting:", err);
        statusBadge.className = "hfcw-badge hfcw-badge-error";
        statusBadge.textContent = `Error: ${err.message || "Failed to start camera"}`;
        setTimeout(updateUIState, 3500);
      }
    }

    quickToggle.addEventListener("click", () => {
      if (!cursor.isTracking) {
        handleStart();
      } else if (cursor.isPaused) {
        cursor.resume();
        if (voiceController && !voiceController.enabled) voiceController.start();
        updateUIState();
      } else {
        cursor.stop();
        if (voiceController) voiceController.stop();
        updateUIState();
      }
    });

    btnStart.addEventListener("click", handleStart);

    btnPause.addEventListener("click", () => {
      cursor.pause();
      updateUIState();
    });

    btnResume.addEventListener("click", () => {
      cursor.resume();
      if (voiceController && !voiceController.enabled) voiceController.start();
      updateUIState();
    });

    btnCalibrate.addEventListener("click", () => {
      cursor.calibrate();
      statusBadge.textContent = "Status: 🎯 Calibrated to current head position!";
      setTimeout(updateUIState, 1500);
    });

    btnStop.addEventListener("click", () => {
      cursor.stop();
      if (voiceController) voiceController.stop();
      updateUIState();
    });

    btnVoiceToggle.addEventListener("click", () => {
      if (voiceController) {
        if (voiceController.enabled) {
          voiceController.stop();
        } else {
          voiceController.start();
        }
        updateVoiceBtnState();
      }
    });

    // Sliders
    sensSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      sensVal.textContent = val;
      cursor.setSensitivity(val);
    });

    smoothSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      smoothVal.textContent = val;
      cursor.setSmoothing(val);
    });

    // Subscribe to state changes from cursor & voice
    cursor.onStateChange(() => {
      updateUIState();
    });

    if (voiceController && typeof voiceController.onStateChange === "function") {
      voiceController.onStateChange(() => {
        updateVoiceBtnState();
      });
    }

    updateUIState();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWidget);
  } else {
    mountWidget();
  }
}
