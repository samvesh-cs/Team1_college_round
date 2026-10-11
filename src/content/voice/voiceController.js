import { parseCommand } from "./commandParser.js";
import { VoiceOverlay } from "./voiceOverlay.js";
import { TargetManager } from "./targetManager.js";
import { AiVoiceAgent } from "./aiVoiceAgent.js";

export class VoiceController {
  constructor() {
    this.recognition = null;
    this.mode = "command"; // "command" or "dictation"
    this.enabled = false;
    this.typingEnabled = false;

    // Fast-path execution tracking for near-zero latency
    this.lastFastCommand = null;
    this.lastFastCommandTime = 0;

    // UI Elements
    this.overlay = new VoiceOverlay();
    this.targetManager = new TargetManager();
    this.isSpeaking = false;
    this.lastSpokenText = "";
    this.lastSpokenTime = 0;
    this.isTabBackgrounded = typeof document !== "undefined" ? document.hidden : false;
    this._executedCommandCount = 0;

    // Listen to tab visibility changes to yield microphone to active tab
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this.yieldMic();
        } else {
          this.resumeMic();
        }
      });
    }

    this.aiAgent = new AiVoiceAgent({
      onCommandSubmit: (text) => this.handleExternalInput(text),
      onVoiceToggle: (isListening) => {
        if (isListening) {
          this.start();
        } else {
          this.stop();
        }
      },
      onSpeakingChange: (isSpeaking, spokenText) => {
        this.isSpeaking = isSpeaking;
        if (isSpeaking) {
          this.lastSpokenText = spokenText || "";
          this.lastSpokenTime = Date.now();
          // IMMEDIATELY ABORT STT while TTS is talking to eliminate speaker pickup!
          try {
            if (this.recognition) this.recognition.abort();
          } catch (e) { }
        } else {
          // TTS finished, wait room acoustic margin and restart clean
          setTimeout(() => {
            if (this.enabled && !this.isSpeaking) {
              this._safeRestart();
            }
          }, 100);
        }
      }
    });

    // Fallback cursor position tracking
    this._initCursorTracking();
    this._initFocusTracking();
    this._initSpeechRecognition();

    window.__handsfree_voice = this;
  }

  _initCursorTracking() {
    if (!window.__handsfree_cursor) {
      window.__handsfree_cursor = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
      };
    }

    window.addEventListener("mousemove", (e) => {
      if (!window.__handsfree_cursor_from_head) {
        window.__handsfree_cursor = { x: e.clientX, y: e.clientY };
      }
    }, { passive: true });
  }

  _initFocusTracking() {
    if (typeof document === "undefined") return;

    document.addEventListener("focusin", (e) => {
      const target = e.target;
      if (target && this._isInputElement(target)) {
        if (this.enabled) {
          this.overlay.show("dictation");
          this.overlay.flashCommand("Input active — speak to type");
        }
      }
    });

    document.addEventListener("focusout", () => {
      setTimeout(() => {
        if (this.enabled && !this._getActiveInput() && !this.typingEnabled) {
          this.overlay.show("command");
        }
      }, 120);
    });
  }

  _initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[Handsfree] SpeechRecognition API is not supported in this browser.");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true; // Real-time streaming for near-zero latency
    this.recognition.lang = "en-US";
    this._isAborting = false;

    this.recognition.onstart = () => {
      this._isAborting = false;
      this.aiAgent.updateVoiceState(true);
      this.aiAgent.setEqualizerActive(true);
    };

    this.recognition.onresult = (event) => {
      if (this._isAborting || this.isSpeaking) return;

      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();

        if (result.isFinal) {
          const executed = this._processTranscript(transcript, false);
          if (executed) return;
        } else {
          interimTranscript += transcript + " ";
          const executed = this._processTranscript(transcript, true);
          if (executed) {
            // Command recognized and executed immediately on partial token!
            return;
          }
        }
      }

      if (interimTranscript && !this._isAborting) {
        const text = interimTranscript.trim();
        this.aiAgent.setInterimText(text);
        this.overlay.setGhostText(text);
      } else {
        this.overlay.setGhostText("");
      }
    };

    this.recognition.onend = () => {
      this._isAborting = false;
      this.overlay.setGhostText("");
      // CRITICAL: DO NOT RESTART recognition while TTS is speaking or tab is in background!
      if (this.isSpeaking || this.isTabBackgrounded) {
        return;
      }
      if (this.enabled) {
        // Immediately invoke recognition.start() inside onend handler to wipe buffer latency
        try {
          this.recognition.start();
        } catch (e) {
          // If Chrome's audio thread is finalizing, retry with micro-backoff
          this._safeRestart();
        }
      } else {
        this.aiAgent.setEqualizerActive(false);
      }
    };

    this.recognition.onerror = (event) => {
      // "aborted" is expected when we intentionally call recognition.abort() to wipe trailing buffer
      // "no-speech" is normal pause
      if (event.error === "aborted" || event.error === "no-speech") {
        return;
      }
      console.warn("[Handsfree] Speech recognition error:", event.error);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.enabled = false;
        this.overlay.flashCommand("Mic permission denied", false);
        this.overlay.hide();
        this.aiAgent.addAgentMessage("Microphone permission was denied. Please allow microphone access in Chrome.");
      } else if (event.error === "network") {
        console.warn(
          "[Handsfree] Speech recognition network error. In Brave, Google Speech Services are blocked by default. You can enable them under brave://settings/system ('Use Google services for speech recognition') or test in standard Google Chrome."
        );
        this.overlay.flashCommand("Voice blocked in Brave: enable in brave://settings/system");
      }
    };
  }

  /* ----------------------------------------------------
     TAB FOCUS MANAGEMENT & MIC ARBITRATION
  ---------------------------------------------------- */
  yieldMic() {
    this.isTabBackgrounded = true;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (e) { }
    }
    this.aiAgent.updateVoiceState(false);
  }

  release() {
    this.yieldMic();
  }

  resumeMic() {
    this.isTabBackgrounded = false;
    if (this.enabled) {
      this.aiAgent.updateVoiceState(true);
      this._safeRestart();
    }
  }

  activate() {
    this.resumeMic();
  }

  get yielded() {
    return !!this.isTabBackgrounded;
  }

  /* ----------------------------------------------------
     WIPE AUDIO BUFFER & RESTART FRESH SESSION
  ---------------------------------------------------- */
  _abortAndFlush() {
    this.overlay.setGhostText("");
    this.aiAgent.setInterimText("");
    if (!this.enabled || !this.recognition || this.isTabBackgrounded) return;

    // After 5 commands, Chrome's internal Web Speech pipeline begins leaking audio buffers & latency degrades.
    // Cleanly re-instantiate SpeechRecognition to maintain 100-200ms instantaneous responsiveness!
    if (this._executedCommandCount >= 5) {
      this._recreateRecognition();
      return;
    }

    try {
      this._isAborting = true;
      // Immediately wipe internal audio buffer so cloud server stops processing trailing syllables
      this.recognition.abort();
    } catch (e) {
      this._safeRestart();
    }
  }

  _safeRestart() {
    if (!this.enabled || this.isTabBackgrounded || this.isSpeaking) return;
    if (this._restartTimer) clearTimeout(this._restartTimer);

    const tryStart = (retries = 3, delay = 20) => {
      this._restartTimer = setTimeout(() => {
        if (!this.enabled || this.isTabBackgrounded || this.isSpeaking) return;
        this._isAborting = false;
        try {
          this.recognition.start();
        } catch (err) {
          if (retries > 0) {
            tryStart(retries - 1, delay * 2);
          } else {
            // Re-instantiate recognition to clear any stuck native state
            this._recreateRecognition();
          }
        }
      }, delay);
    };

    tryStart();
  }

  _recreateRecognition() {
    this._executedCommandCount = 0;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onend = null;
        this.recognition.onerror = null;
        this.recognition.abort();
      } catch (e) { }
      this.recognition = null;
    }
    this._initSpeechRecognition();
    if (this.enabled && this.recognition && !this.isTabBackgrounded && !this.isSpeaking) {
      try {
        this.recognition.start();
      } catch (e) {
        this._safeRestart();
      }
    }
  }

  start(targetState = "bar") {
    this.enabled = true;
    this.mode = "command";
    this.overlay.show(this.mode);

    if (targetState === "chat") {
      this.aiAgent.toChat();
    } else if (targetState === "orb") {
      this.aiAgent.toOrb();
    } else {
      this.aiAgent.toBar();
    }

    // If tab is in background, don't hijack microphone from foreground tab
    if (typeof document !== "undefined" && document.hidden) {
      this.isTabBackgrounded = true;
      this.aiAgent.updateVoiceState(false);
      return;
    }

    this.isTabBackgrounded = false;
    this.aiAgent.updateVoiceState(true);

    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (e) { }
    }

    // Periodically recycle cloud speech connection to prevent audio buffer latency bloat
    if (this._sessionRefreshTimer) clearInterval(this._sessionRefreshTimer);
    this._sessionRefreshTimer = setInterval(() => {
      if (this.enabled && !this.isTabBackgrounded && !this.isSpeaking && Date.now() - this.lastFastCommandTime > 4000) {
        this._recreateRecognition();
      }
    }, 20000);
  }

  stop() {
    this.enabled = false;
    if (this._sessionRefreshTimer) {
      clearInterval(this._sessionRefreshTimer);
      this._sessionRefreshTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) { }
    }
    this.overlay.hide();
    this.aiAgent.updateVoiceState(false);
    this.aiAgent.toOrb();
  }

  // --- Input element helpers (from HEAD) ---
  _isInputElement(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
    if (el.getAttribute("role") === "searchbox" || el.getAttribute("role") === "textbox") return true;
    if (el.tagName === "INPUT") {
      const type = (el.type || "").toLowerCase();
      return !["checkbox", "radio", "submit", "button", "reset", "file", "image", "hidden"].includes(type);
    }
    return false;
  }

  _getActiveInput() {
    const el = document.activeElement;
    if (el && this._isInputElement(el)) {
      return el;
    }
    return null;
  }

  _findInputElement(element) {
    if (!element || !(element instanceof Element)) return null;
    if (this._isInputElement(element)) return element;
    const parent = element.closest?.("input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit']), textarea, [contenteditable='true'], [role='searchbox'], [role='textbox']");
    if (parent) return parent;
    const child = element.querySelector?.("input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit']), textarea, [contenteditable='true']");
    if (child) return child;
    return null;
  }

  setMode(newMode) {
    this.mode = newMode;
    if (this.enabled) {
      this.overlay.show(this.mode);
    }
  }

  setTypingEnabled(enabled) {
    this.typingEnabled = Boolean(enabled);
    if (this.typingEnabled) {
      this.setMode("dictation");
      this.overlay.flashCommand("Voice typing active");
    } else {
      this.setMode("command");
    }
  }

  handleExternalInput(text) {
    this._processTranscript(text, false);
  }

  /* ----------------------------------------------------
     RAW PARTIAL TOKENS STREAM PROCESSOR (< 100ms LATENCY)
     WIPES TRAILING AUDIO BUFFER ON INSTANT COMMAND MATCH
  ---------------------------------------------------- */
  _processTranscript(transcript, isInterim = false) {
    if (this._isAborting || this.isSpeaking) return false;
    const trimmed = transcript.trim();
    if (!trimmed) return false;

    // Layer 3: Discard any residual audio matching the recently spoken TTS response
    if (this.lastSpokenText && Date.now() - this.lastSpokenTime < 2800) {
      const lowerTrimmed = trimmed.toLowerCase();
      const lowerSpoken = this.lastSpokenText.toLowerCase();
      if (lowerTrimmed.includes(lowerSpoken) || lowerSpoken.includes(lowerTrimmed)) {
        console.log("[Handsfree] Blocked TTS acoustic echo:", trimmed);
        return false;
      }
    }

    // 1. Dictation Mode
    if (this.mode === "dictation") {
      const command = parseCommand(trimmed);

      // A. Submit search / active input and exit dictation: "enter", "press enter", "search", "submit"
      if (command.type === "PRESS_ENTER" || (command.type === "SEARCH_PAGE" && !command.payload)) {
        const activeInput = this._getActiveInput() || this._findSearchInput();
        if (activeInput) {
          this._submitActiveInput(activeInput);
          try { activeInput.blur(); } catch (_) { }
        } else {
          this._pressEnter();
        }
        this.setMode("command");
        this.overlay.show("command");
        this.overlay.flashCommand("Search submitted");
        this.aiAgent.addAgentMessage("Submitted search. Back in command mode.", "search submitted", null);
        this._abortAndFlush();
        return true;
      }

      // B. Exit dictation / Cancel: "escape", "cancel", "exit", "stop dictation", "stop typing", "done typing", "done"
      if (command.type === "STOP_DICTATION" || command.type === "PRESS_ESCAPE") {
        const activeInput = this._getActiveInput() || this._findSearchInput();
        if (activeInput) {
          try { activeInput.blur(); } catch (_) { }
        }
        this.setMode("command");
        this.overlay.show("command");
        this.overlay.flashCommand("Command mode");
        this.aiAgent.addAgentMessage("Exited typing mode. Back in command mode.", "command mode", null);
        this._abortAndFlush();
        return true;
      }

      // C. Clear input: "clear", "clear text", "delete all"
      if (command.type === "CLEAR_INPUT") {
        const activeInput = this._getActiveInput() || this._findSearchInput();
        if (activeInput) {
          this._clearActiveInput(activeInput);
        }
        this.overlay.flashCommand("Cleared input");
        this.aiAgent.addAgentMessage("Cleared input field.", "clear", null);
        this._abortAndFlush();
        return true;
      }

      // D. Global control escape commands (scroll, top, bottom, sleep, click target, show targets)
      const isControlEscape = [
        "SCROLL_DOWN", "SCROLL_UP", "GO_TOP", "GO_BOTTOM",
        "GO_BACK", "GO_FORWARD", "RELOAD", "SLEEP", "WAKE_UP",
        "SHOW_TARGETS", "HIDE_TARGETS", "CLICK_TARGET"
      ].includes(command.type);

      if (isControlEscape) {
        const activeInput = this._getActiveInput() || this._findSearchInput();
        if (activeInput) {
          try { activeInput.blur(); } catch (_) { }
        }
        this.setMode("command");
        this.overlay.show("command");
        this._executeCommand(command, trimmed, false);
        this._abortAndFlush();
        return true;
      }

      // E. If user said "start dictation" or "type" while already dictating, ignore command keyword
      if (command.type === "START_DICTATION") {
        this.overlay.flashCommand("Dictation active");
        return true;
      }

      // F. If user explicitly said "type [words]", strip "type" and insert just the words
      if (command.type === "TYPE_TEXT" && command.payload) {
        if (!isInterim) {
          this._insertDictation(command.payload);
          this._abortAndFlush();
        }
        return true;
      }

      // G. Actual dictation text
      if (!isInterim) {
        this._insertDictation(trimmed);
        this._abortAndFlush();
      }
      return false;
    }

    // 2. Command Mode Parsing
    const command = parseCommand(trimmed);
    if (command.type === "EMPTY") return false;

    // Conversational AI Assistant Query or Direct Input Typing
    if (command.type === "AI_QUERY") {
      const activeInput = this._getActiveInput();
      if (activeInput) {
        // If an input is focused, type the spoken words directly into it!
        if (!isInterim) {
          this.aiAgent.setInterimText("");
          this._typeText(trimmed);
          this._abortAndFlush();
        }
        return true;
      }

      if (!isInterim) {
        this.aiAgent.setInterimText("");
        this.aiAgent.addUserMessage(trimmed);
        this._executeCommand(command, trimmed, false);
        this._abortAndFlush();
        return true;
      }
      return false;
    }

    // 3. Instant Single-Intent Commands
    // Execute IMMEDIATELY on the very first interim token (< 100ms) without waiting for silence!
    const instantCommands = [
      "SCROLL_DOWN", "SCROLL_UP", "GO_TOP", "GO_BOTTOM",
      "GO_BACK", "GO_FORWARD", "RELOAD",
      "CLICK", "DOUBLE_CLICK", "CLICK_TARGET",
      "PRESS_ENTER", "PRESS_TAB", "PRESS_ESCAPE", "CLEAR_INPUT",
      "SHOW_TARGETS", "HIDE_TARGETS",
      "WAKE_UP", "EXPAND_MORE", "COLLAPSE_CHAT", "SLEEP",
      "PAUSE", "RESUME", "HELP", "START_DICTATION", "CALIBRATE"
    ];

    const isInstant = instantCommands.includes(command.type) || (command.type === "SEARCH_PAGE" && !command.payload);

    if (isInterim && !isInstant) {
      // Multi-word commands (such as "search [query]" or "type [text]") wait for the full sentence
      return false;
    }

    // Debounce to prevent duplicate executions across micro audio frames
    const now = Date.now();
    if (
      now - this.lastFastCommandTime < 350 &&
      this.lastFastCommand === command.type &&
      this.lastFastTargetPayload === command.payload
    ) {
      return false;
    }

    this.lastFastCommand = command.type;
    this.lastFastTargetPayload = command.payload;
    this.lastFastCommandTime = now;

    // Execute command immediately on raw partial token!
    this.aiAgent.setInterimText("");
    this.aiAgent.addUserMessage(trimmed);
    this._executeCommand(command, trimmed, isInterim);

    // Call recognition.abort() immediately to wipe trailing audio buffer and silence lag!
    this._abortAndFlush();
    return true;
  }

  /**
   * Finds the element a generic scroll command should target. Prefers the
   * document itself (ordinary pages) and falls back to the main scrollable
   * container on dynamic app layouts (e.g. WhatsApp Web) where the document
   * does not scroll.
   */
  _findScrollableContainer() {
    const docEl = document.scrollingElement || document.documentElement;
    if (docEl && docEl.scrollHeight > docEl.clientHeight + 1) {
      return docEl;
    }
    let node = null;
    try {
      node = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    } catch {
      node = null;
    }
    while (node && node !== document.body && node !== document.documentElement) {
      if (this._isScrollable(node)) return node;
      node = node.parentElement;
    }
    let best = null;
    let bestArea = 0;
    const all = document.querySelectorAll("*");
    for (const el of all) {
      if (!this._isScrollable(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
      if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  _isScrollable(el) {
    if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
    let overflowY = "";
    try {
      overflowY = window.getComputedStyle(el).overflowY;
    } catch {
      return false;
    }
    return overflowY === "auto" || overflowY === "scroll";
  }

  _scrollPage(dy) {
    const target = this._findScrollableContainer();
    try {
      window.scrollBy({ top: dy, behavior: "smooth" });
    } catch (_) { }

    if (target && target !== document.documentElement && target !== document.body) {
      try {
        target.scrollBy({ top: dy, behavior: "smooth" });
      } catch (e) {
        console.warn("[Handsfree] Scroll container scrollBy failed:", e);
      }
    }
  }

  _scrollPageTo(position) {
    const isTop = position === "top";
    const target = this._findScrollableContainer();

    try {
      window.scrollTo({
        top: isTop ? 0 : (document.documentElement.scrollHeight || document.body.scrollHeight || 10000),
        behavior: "smooth"
      });
    } catch (_) { }

    try {
      const docEl = document.scrollingElement || document.documentElement;
      if (docEl) {
        docEl.scrollTo({
          top: isTop ? 0 : docEl.scrollHeight,
          behavior: "smooth"
        });
      }
    } catch (_) { }

    try {
      if (document.body) {
        document.body.scrollTo({
          top: isTop ? 0 : document.body.scrollHeight,
          behavior: "smooth"
        });
      }
    } catch (_) { }

    if (target && target !== document.documentElement && target !== document.body) {
      try {
        target.scrollTo({
          top: isTop ? 0 : target.scrollHeight,
          behavior: "smooth"
        });
      } catch (e) {
        console.warn("[Handsfree] Scroll container scrollTo failed:", e);
      }
    }
  }

  _executeCommand(command, rawTranscript, isFastPath = false) {
    this._executedCommandCount++;
    console.log("[Handsfree] Executing command:", command.type, command.payload, `(count: ${this._executedCommandCount})`);
    const scrollStep = Math.max(320, Math.floor(window.innerHeight * 0.65));

    switch (command.type) {
      case "SCROLL_DOWN":
        this._scrollPage(scrollStep);
        this.overlay.flashCommand("scroll down");
        this.aiAgent.addAgentMessage(`Scrolled down ${scrollStep}px`, "scroll down", null);
        break;

      case "SCROLL_UP":
        this._scrollPage(-scrollStep);
        this.overlay.flashCommand("scroll up");
        this.aiAgent.addAgentMessage(`Scrolled up ${scrollStep}px`, "scroll up", null);
        break;

      case "GO_TOP":
        this._scrollPageTo("top");
        this.overlay.flashCommand("top");
        this.aiAgent.addAgentMessage("Scrolled to top of page", "top", null);
        break;

      case "GO_BOTTOM":
        this._scrollPageTo("bottom");
        this.overlay.flashCommand("bottom");
        this.aiAgent.addAgentMessage("Scrolled to bottom of page", "bottom", null);
        break;

      case "GO_BACK":
        this.overlay.flashCommand("go back");
        this.aiAgent.addAgentMessage("Navigating back in browser history", "back", null);
        setTimeout(() => window.history.back(), 150);
        break;

      case "GO_FORWARD":
        this.overlay.flashCommand("go forward");
        this.aiAgent.addAgentMessage("Navigating forward in browser history", "forward", null);
        setTimeout(() => window.history.forward(), 150);
        break;

      case "RELOAD":
        this.overlay.flashCommand("reload");
        this.aiAgent.addAgentMessage("Reloading page...", "reload", null);
        setTimeout(() => window.location.reload(), 200);
        break;

      case "CLICK":
        const clicked = this._clickCursorTarget();
        this.overlay.flashCommand("click", clicked);
        this.aiAgent.addAgentMessage(
          clicked ? "Simulated click at target" : "No element found at cursor",
          "click",
          null
        );
        break;

      case "DOUBLE_CLICK":
        const dblClicked = this._clickCursorTarget(true);
        this.overlay.flashCommand("double click", dblClicked);
        this.aiAgent.addAgentMessage("Simulated double-click at target", "double click", null);
        break;

      case "PRESS_ENTER": {
        const activeInput = this._getActiveInput();
        if (activeInput) {
          this._submitActiveInput(activeInput);
        } else {
          this._pressEnter();
        }
        this.overlay.flashCommand("press enter");
        this.aiAgent.addAgentMessage("Pressed Enter key on active element", "enter", null);
        break;
      }

      case "CLEAR_INPUT": {
        const activeInput = this._getActiveInput();
        if (activeInput) {
          this._clearActiveInput(activeInput);
        }
        this.aiAgent.addAgentMessage("Cleared active text field", "clear", null);
        break;
      }

      case "PRESS_TAB":
        this._pressTab();
        this.overlay.flashCommand("tab");
        this.aiAgent.addAgentMessage("Advanced focus to next field", "tab", null);
        break;

      case "PRESS_ESCAPE":
        if (document.activeElement) document.activeElement.blur();
        this.overlay.flashCommand("escape");
        this.aiAgent.addAgentMessage("Pressed Escape / blurred focus", "escape", null);
        break;

      case "SEARCH_PAGE":
        this._searchPage(command.payload);
        break;

      case "TYPE_TEXT":
        this._typeText(command.payload);
        break;

      case "START_DICTATION":
        this.setMode("dictation");
        this.overlay.show("dictation");
        this.overlay.flashCommand("start dictation");
        this.aiAgent.addAgentMessage("Dictation mode active. Speak naturally to fill fields. Say 'stop dictation' to exit.", "dictation", null);
        break;

      case "STOP_DICTATION":
        this.setMode("command");
        this.overlay.show("command");
        this.overlay.flashCommand("stop dictation");
        this.aiAgent.addAgentMessage("Switched back to command mode.", "command mode", null);
        break;

      case "CALIBRATE":
        if (window.__handsfree_calibration_overlay) {
          window.__handsfree_calibration_overlay.show();
        } else if (window.__handsfree_cursor) {
          window.__handsfree_cursor.calibrate();
        }
        this.overlay.flashCommand("calibrated");
        this.aiAgent.addAgentMessage("Calibration overlay opened.", "calibrate", "Calibrating");
        break;

      case "SHOW_TARGETS":
        const count = this.targetManager.showTargets();
        this.overlay.flashCommand(`targets: ${count}`);
        this.aiAgent.addAgentMessage(`Generated ${count} numbered click targets. Say a number to click.`, "show targets", "Badges visible");
        break;

      case "HIDE_TARGETS":
        this.targetManager.hideTargets();
        this.overlay.flashCommand("targets hidden");
        this.aiAgent.addAgentMessage("Numbered target badges hidden.", "hide targets", "Badges hidden");
        break;

      case "CLICK_TARGET":
        const targetNum = command.payload;
        const success = this.targetManager.clickTarget(targetNum);
        this.overlay.flashCommand(`click #${targetNum}`, success);
        this.aiAgent.addAgentMessage(
          success ? `Clicked numbered target #${targetNum}` : `Target #${targetNum} not found. Say 'show targets' to re-index.`,
          `click ${targetNum}`,
          success ? `Selected ${targetNum}` : `Target ${targetNum} not found`
        );
        break;

      // 3-State Assistant Transitions
      case "WAKE_UP":
        this.aiAgent.toBar();
        this.overlay.flashCommand("bar opened");
        this.aiAgent.addAgentMessage("Handsfree AI Agent is awake and listening.", "wake up", "I am awake");
        break;

      case "EXPAND_MORE":
        this.aiAgent.toChat();
        this.overlay.flashCommand("chat expanded");
        this.aiAgent.addAgentMessage("Expanded full chat history window.", "expand more", "Window opened");
        break;

      case "COLLAPSE_CHAT":
        this.aiAgent.toBar();
        this.overlay.flashCommand("chat collapsed");
        this.aiAgent.addAgentMessage("Collapsed back to slim dock bar.", "collapse chat", "Window docked");
        break;

      case "SLEEP":
        this.aiAgent.toOrb();
        this.overlay.flashCommand("sleep mode");
        this.aiAgent.addAgentMessage("Handsfree entered sleep mode. Say 'wake up' to activate.", "sleep", "Goodnight");
        break;

      case "PAUSE":
        this.enabled = false;
        if (this.recognition) {
          try { this.recognition.stop(); } catch (e) { }
        }
        this.overlay.flashCommand("paused");
        this.aiAgent.addAgentMessage("Voice listening paused. Say 'resume' or click the mic button to reactivate.", "pause", "Listening paused");
        break;

      case "RESUME":
        this.start();
        this.overlay.flashCommand("resumed");
        this.aiAgent.addAgentMessage("Voice listening resumed.", "resume", "Listening resumed");
        break;

      case "HELP":
        this.aiAgent.toChat();
        this.aiAgent.addAgentMessage(
          "Available Voice Commands:\n" +
          "• Scrolling: 'scroll down', 'scroll up', 'top', 'bottom'\n" +
          "• Search & Type: 'search [query]', 'type [text]'\n" +
          "• Navigation: 'back', 'forward', 'reload'\n" +
          "• Clicking: 'click', 'double click', 'show targets', 'click [number]'\n" +
          "• 3-State Controls: 'wake up' (open bar), 'expand more' (open chat), 'collapse chat' (bar mode), 'sleep' (orb mode)",
          "help",
          "Here are available commands"
        );
        break;

      case "AI_QUERY":
      default:
        this._handleAiQuery(command.payload, rawTranscript);
        break;
    }

    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: command.type, payload: command.payload });
      }
    } catch (e) { }
  }

  /* ----------------------------------------------------
     SEARCH & INPUT HELPERS (GOOGLE, WIKIPEDIA, ALL SITES)
  ---------------------------------------------------- */
  _findSearchInput() {
    const selectors = [
      'textarea[name="q"]', // Google Search bar
      'input[name="q"]',    // Google, Bing, DuckDuckGo
      '#searchInput',       // Wikipedia search
      'input[type="search"]',
      'input[name*="search" i]',
      'input[id*="search" i]',
      'input[placeholder*="search" i]',
      'textarea[placeholder*="search" i]',
      '[role="searchbox"]'
    ];

    for (const sel of selectors) {
      const candidates = document.querySelectorAll(sel);
      for (const el of candidates) {
        // STRICTLY IGNORE any element belonging to Handsfree!
        if (
          el.closest('#handsfree-ai-agent-window') ||
          el.closest('#handsfree-sleep-orb-container') ||
          el.id?.startsWith('handsfree')
        ) {
          continue;
        }
        if (el.offsetWidth > 0 && el.offsetHeight > 0 && !el.disabled) {
          return el;
        }
      }
    }
    return null;
  }

  _searchPage(query) {
    const cleanQuery = (query || "").replace(/^(?:search for|search|google|find)\s*/i, "").trim();
    const isGoogle = window.location.hostname.includes("google.");
    const searchInput = this._findSearchInput();

    if (!cleanQuery) {
      // If user just said "search" or "find", focus the search bar and switch to dictation
      if (searchInput) {
        searchInput.focus();
        this.setMode("dictation");
        this.overlay.show("dictation");
        this.overlay.flashCommand("Search active — speak to type");
        this.aiAgent.addAgentMessage("Search input focused. Speak your query to type.", "search", null);
      } else {
        this.overlay.flashCommand("no search bar", false);
        this.aiAgent.addAgentMessage("No search input on page. Say 'search [query]' to search Google.", "search", null);
      }
      return;
    }

    if (searchInput && !isGoogle) {
      searchInput.focus();
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, cleanQuery);
      } catch (_) { }
      if (!inserted) {
        this._setInputValue(searchInput, cleanQuery);
      }
      this._pressEnter(searchInput);
      this.overlay.flashCommand(`search: ${cleanQuery}`);
      this.aiAgent.addAgentMessage(`Searched for "${cleanQuery}" on page`, "search", null);
    } else {
      // Direct navigation to Google Search
      this.overlay.flashCommand(`google: ${cleanQuery}`);
      this.aiAgent.addAgentMessage(`Searching Google for "${cleanQuery}"...`, "search", null);
      setTimeout(() => {
        window.location.href = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`;
      }, 350);
    }
  }

  _typeText(text) {
    if (!text) return;

    const cleanText = text.replace(/^(?:type|write|input)\s*/i, "").trim();
    if (!cleanText) return;

    let target = this._getActiveInput();
    if (!target) {
      target = this._findSearchInput();
    }

    if (target) {
      target.focus();

      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, cleanText);
      } catch (_) {
        inserted = false;
      }

      if (!inserted) {
        this._setInputValue(target, (target.value || "") + cleanText);
      }

      this.overlay.flashCommand(`typed: ${cleanText}`);
      this.aiAgent.addAgentMessage(`Typed "${cleanText}" into field`, "type", null);
    } else {
      this.overlay.flashCommand("no input field", false);
      this.aiAgent.addAgentMessage("Could not find an active text input to type into.", "type", null);
    }
  }

  _setInputValue(element, val) {
    element.focus();

    // Use native prototype descriptor so React, Vue, Google listeners update
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;

    if (setter) {
      setter.call(element, val);
    } else {
      element.value = val;
    }

    // Trigger standard input events
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  _submitActiveInput(input) {
    if (!input) return;
    const evtOptions = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    input.dispatchEvent(new KeyboardEvent("keydown", evtOptions));
    input.dispatchEvent(new KeyboardEvent("keypress", evtOptions));
    input.dispatchEvent(new KeyboardEvent("keyup", evtOptions));

    const form = input.form || input.closest("form");
    if (form) {
      try {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.submit();
        }
      } catch (_) { }
    } else {
      const submitBtn = input.parentElement?.querySelector('button[type="submit"], input[type="submit"], [aria-label*="search" i]');
      if (submitBtn) {
        try { submitBtn.click(); } catch (_) { }
      }
    }
    this.overlay.flashCommand("Search / Enter submitted");
  }

  _clearActiveInput(input) {
    if (!input) return;
    if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (input.isContentEditable) {
      input.innerText = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    this.overlay.flashCommand("Cleared input");
  }

  _clickCursorTarget(isDoubleClick = false) {
    const cursor = window.__handsfree_cursor;
    let x = typeof cursor?.currentX === "number" ? cursor.currentX : (cursor?.x ?? window.innerWidth / 2);
    let y = typeof cursor?.currentY === "number" ? cursor.currentY : (cursor?.y ?? window.innerHeight / 2);

    let rawElement = null;
    try {
      rawElement = document.elementFromPoint(x, y);
    } catch (_) { }

    if (
      !rawElement ||
      rawElement === document.body ||
      rawElement === document.documentElement ||
      rawElement.id?.startsWith("handsfree") ||
      rawElement.closest?.("#handsfree-ai-agent-window") ||
      rawElement.closest?.("#handsfree-sleep-orb-container")
    ) {
      if (document.activeElement && document.activeElement !== document.body) {
        rawElement = document.activeElement;
      }
    }

    if (!rawElement) return false;

    // Find nearest actionable interactive element (anchor, button, input, textarea, select, role=button)
    const targetElement = rawElement.closest?.(
      "a[href], button, input, textarea, select, [role='button'], [role='link'], [role='checkbox'], [role='tab'], [contenteditable='true'], label"
    ) || rawElement;

    const eventInit = {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y
    };

    targetElement.dispatchEvent(new MouseEvent("mousedown", eventInit));
    targetElement.dispatchEvent(new MouseEvent("mouseup", eventInit));
    targetElement.dispatchEvent(new MouseEvent("click", eventInit));

    if (isDoubleClick) {
      targetElement.dispatchEvent(new MouseEvent("mousedown", eventInit));
      targetElement.dispatchEvent(new MouseEvent("mouseup", eventInit));
      targetElement.dispatchEvent(new MouseEvent("click", eventInit));
      targetElement.dispatchEvent(new MouseEvent("dblclick", eventInit));
    }

    if (this._isInputElement(targetElement)) {
      try {
        targetElement.focus({ preventScroll: true });
      } catch (_) {
        try { targetElement.focus(); } catch (e) { }
      }
      this.setMode("dictation");
      this.overlay.show("dictation");
      this.overlay.flashCommand("Search/Input active — speak to type");
    } else {
      if (typeof targetElement.click === "function") {
        try { targetElement.click(); } catch (_) { }
      }
    }

    const originalOutline = targetElement.style.outline;
    targetElement.style.outline = "2px solid #2dd4bf";
    setTimeout(() => {
      targetElement.style.outline = originalOutline;
    }, 400);

    return true;
  }

  _pressEnter(targetEl = null) {
    const el = targetEl || document.activeElement || document.body;
    const evtInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", evtInit));
    el.dispatchEvent(new KeyboardEvent("keypress", evtInit));
    el.dispatchEvent(new KeyboardEvent("keyup", evtInit));

    if (el.form) {
      if (typeof el.form.requestSubmit === "function") {
        el.form.requestSubmit();
      } else {
        el.form.submit();
      }
    } else {
      // Find submit or search button near the input
      const submitBtn = el.parentElement?.querySelector('button[type="submit"], input[type="submit"], [aria-label*="search" i]');
      if (submitBtn) submitBtn.click();
    }
  }

  _pressTab() {
    const focusable = Array.from(document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));

    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIndex = (currentIndex + 1) % focusable.length;
    if (focusable[nextIndex]) {
      focusable[nextIndex].focus();
    }
  }

  _insertDictation(transcript) {
    let target = document.activeElement;

    // If activeElement is body or not an editable field, check if cursor is over an input
    if (!target || target === document.body || target === document.documentElement) {
      const cursor = window.__handsfree_cursor;
      const x = cursor?.currentX ?? cursor?.x;
      const y = cursor?.currentY ?? cursor?.y;
      if (typeof x === "number" && typeof y === "number") {
        try {
          const hovered = document.elementFromPoint(x, y);
          if (hovered) {
            const inputCandidate = hovered.closest("input, textarea, [contenteditable='true']");
            if (inputCandidate) {
              inputCandidate.focus();
              target = inputCandidate;
            }
          }
        } catch (_) { }
      }
    }

    // Fallback to search input
    if (!target || target === document.body || target === document.documentElement) {
      target = this._findSearchInput();
    }

    if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable)) {
      this.overlay.flashCommand("Focus an input to type");
      return;
    }

    const trimmed = transcript.trim();
    if (!trimmed) return;
    const textToInsert = trimmed + " ";

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, textToInsert);
    } catch (_) {
      inserted = false;
    }

    if (!inserted) {
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        const val = target.value;
        const newVal = val.slice(0, start) + textToInsert + val.slice(end);

        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, "value"
        )?.set;

        if (setter) {
          setter.call(target, newVal);
        } else {
          target.value = newVal;
        }

        try {
          target.selectionStart = target.selectionEnd = start + textToInsert.length;
        } catch (_) { }
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (target.isContentEditable) {
        target.innerText += " " + textToInsert;
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    this.overlay.flashCommand(`Typed: "${trimmed}"`);
  }

  _handleAiQuery(query, rawTranscript) {
    const activeInput = this._getActiveInput();
    if (activeInput) {
      this._typeText(rawTranscript);
      return;
    }

    const pageTitle = document.title || "this webpage";
    const lower = query.toLowerCase();

    if (lower.includes("page") || lower.includes("about") || lower.includes("summary") || lower.includes("what is this")) {
      const metaDesc = document.querySelector('meta[name="description"]')?.content;
      const firstP = document.querySelector('p')?.innerText?.slice(0, 160);
      const summary = `You are on "${pageTitle}". ${metaDesc || firstP || "Webpage loaded."}`;
      this.aiAgent.addAgentMessage(summary, "page info", summary);
      this.overlay.flashCommand("page info");
      return;
    }

    // For unrecognized speech or ambient noise: display visually in dock and chat, NEVER speak aloud!
    this.aiAgent.addAgentMessage(`Heard: "${rawTranscript}"`, "heard", null);
    this.overlay.flashCommand(`heard: ${rawTranscript.slice(0, 18)}`);
  }
}
