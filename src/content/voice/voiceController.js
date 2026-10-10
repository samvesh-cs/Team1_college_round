import { parseCommand } from "./commandParser.js";
import { VoiceOverlay } from "./voiceOverlay.js";
import { MSG } from "../../shared/messages.js";

export class VoiceController {
  constructor() {
    this.recognition = null;
    this.mode = "command"; // "command" or "dictation"
    this.enabled = false;
    this.typingEnabled = false;
    this.listening = false; // true only while recognition is actually running
    this.yielded = false; // true after yielding the session to another tab
    this.overlay = new VoiceOverlay();
    this.restartTimer = null;
    window.__handsfree_voice = this;

    this._init();
    this._initFocusTracking();
  }

  _init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[Handsfree] SpeechRecognition API is not supported in this browser.");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = "en-US";

    this.recognition.onstart = () => {
      this.listening = true;
      console.debug("[Handsfree] Speech recognition started.");
    };

    this.recognition.onresult = (event) => {
      // With continuous recognition, each event carries all results accumulated
      // so far; resultIndex marks the first new one. Handle every new final
      // result exactly once instead of only the last entry.
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const transcript = result[0].transcript;
        this._handleTranscript(transcript);
      }
    };

    let errorCooldown = false;

    this.recognition.onend = () => {
      this.listening = false;
      // Auto-restart if it stopped by itself (e.g. silence timeout) while
      // voice is still enabled. Restart is deferred (see _scheduleRestart).
      this._scheduleRestart();
    };

    this.recognition.onerror = (event) => {
      this.listening = false;
      console.error("[Handsfree] Speech recognition error:", event.error);
      // Fatal errors: microphone blocked or speech service unavailable.
      // Stop retrying and hide the listening indicator rather than
      // claiming the microphone is working.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.enabled = false;
        this._clearRestartTimer();
        this.overlay.hide();
      } else if (event.error === "network") {
        console.warn(
          "[Handsfree] Speech recognition network error. In Brave, Google Speech Services are blocked by default. You can enable them under brave://settings/system ('Use Google services for speech recognition') or test in standard Google Chrome."
        );
        this.overlay.flashCommand("Voice blocked in Brave: enable in brave://settings/system");
      }
    };

    // Re-assert recognition when returning to a visible tab: backgrounded
    // tabs can silently lose recognition while voice stays enabled.
    // Registered once here (never in start()) so duplicates are impossible.
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", () => {
        if (typeof document.visibilityState !== "undefined" && document.visibilityState !== "visible") return;
        if (!this.enabled || this.yielded || this.listening || !this.recognition) return;
        this._scheduleRestart();
      });
    }
  }

  _scheduleRestart() {
    // Auto-restart if it stopped by itself (e.g. silence timeout) while
    // voice is still enabled. The restart is deferred: calling start()
    // synchronously here can throw InvalidStateError because the
    // recognizer has not fully transitioned to the ended state, which
    // previously left recognition permanently inactive.
    // Exclusive voice ownership: a tab that yielded its session, or a tab
    // running in the background, must not restart recognition. The active
    // tab is re-armed via VOICE_RESUME / visibilitychange instead.
    if (!this.enabled || this.yielded) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this._clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.enabled || this.yielded || this.listening) return;
      try {
        this.recognition.start();
      } catch (e) {
        if (e && e.name === "InvalidStateError") {
          console.warn("[Handsfree] Restart raced recognizer state; waiting for next onend.", e);
        } else {
          console.error("[Handsfree] Error restarting SpeechRecognition", e);
        }
      }
    }, 250);
  }

  _clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  start() {
    if (!this.recognition) return;
    this.enabled = true;
    this.yielded = false;
    this.mode = "command";
    try {
      this.recognition.start();
      this.overlay.show(this.mode);
    } catch (e) {
      console.log("[Handsfree] Speech recognition already started.");
    }
  }

  stop() {
    if (!this.recognition) return;
    this.enabled = false;
    this.listening = false;
    this.yielded = false;
    this._clearRestartTimer();
    this.recognition.stop();
    this.overlay.hide();
  }

  /**
   * Yield the voice session to another tab without changing the user's
   * enabled preference. Stops recognition, cancels pending restarts, and
   * hides the listening indicator. Re-arm with activate() or start().
   */
  release() {
    if (!this.recognition) return;
    this.yielded = true;
    this.listening = false;
    this._clearRestartTimer();
    try {
      this.recognition.stop();
    } catch {
      // Already stopped; any trailing onend is suppressed via `yielded`.
    }
    this.overlay.hide();
  }

  /**
   * Re-arm voice after yielding, honoring the user's enabled preference.
   * Never starts when the user turned voice off.
   */
  activate() {
    this.yielded = false;
    if (!this.enabled || this.listening || !this.recognition) return;
    try {
      this.recognition.start();
      this.overlay.show(this.mode);
    } catch (e) {
      console.log("[Handsfree] Voice activation already running.");
    }
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

  _submitActiveInput(input) {
    if (!input) return;
    const enterDown = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true });
    const enterUp = new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true });
    input.dispatchEvent(enterDown);
    input.dispatchEvent(enterUp);

    const form = input.form || input.closest("form");
    if (form) {
      try {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.submit();
        }
      } catch (_) {}
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

  _handleTranscript(transcript) {
    const raw = transcript.trim();
    if (!raw) return;
    const lower = raw.toLowerCase();

    // 1. Explicit typing prefix: "type <text>" (e.g. "type top", "type bottom", "type hello")
    if (lower.startsWith("type ")) {
      const textToType = raw.slice(5).trim();
      if (textToType) {
        this._insertDictation(textToType);
        return;
      }
    }

    // 2. Form submission commands: "enter", "press enter", "search", "submit"
    if (lower === "enter" || lower === "press enter" || lower === "search" || lower === "submit") {
      const activeInput = this._getActiveInput();
      if (activeInput) {
        this._submitActiveInput(activeInput);
        return;
      }
    }

    // 3. Clear commands: "clear", "clear text", "clear input"
    if (lower === "clear" || lower === "clear text" || lower === "clear input" || lower === "delete all") {
      const activeInput = this._getActiveInput();
      if (activeInput) {
        this._clearActiveInput(activeInput);
        return;
      }
    }

    // 4. Command parsing
    const maybeCommand = parseCommand(raw);

    // Stop dictation or unfocus
    if (maybeCommand.type === "STOP_DICTATION" || lower === "escape" || lower === "unfocus") {
      const activeInput = this._getActiveInput();
      if (activeInput) activeInput.blur();
      this.setMode("command");
      this.typingEnabled = false;
      this.overlay.flashCommand("stop typing");
      return;
    }

    if (maybeCommand.type === "START_DICTATION") {
      this.setMode("dictation");
      this.typingEnabled = true;
      this.overlay.flashCommand("start dictation");
      return;
    }

    // 5. Normal voice commands (like "top", "bottom", "scroll down", "scroll up", "back", "forward", "click", "pause", "resume")
    // When recognized as a valid command, execute it immediately instead of typing it!
    if (maybeCommand.type !== "UNKNOWN") {
      this._executeCommand(maybeCommand);
      return;
    }

    // 6. Voice typing: if an input field is active OR dictation mode is enabled, type the words!
    const activeInput = this._getActiveInput();
    if (activeInput || this.mode === "dictation" || this.typingEnabled) {
      this._insertDictation(raw);
      return;
    }

    // 7. Standard command handler
    this._executeCommand(maybeCommand);
  }

  /**
   * Finds the element a generic scroll command should target. Prefers the
   * document itself (ordinary pages) and falls back to the main scrollable
   * container on dynamic app layouts (e.g. WhatsApp Web) where the document
   * does not scroll. Returns null when nothing on the page is scrollable.
   */
  _findScrollableContainer() {
    const docEl = document.scrollingElement || document.documentElement;
    if (docEl && docEl.scrollHeight > docEl.clientHeight + 1) {
      return docEl;
    }
    // Walk up from the viewport center: cheaply targets the main content
    // column the user is looking at, not unrelated nested scrollers.
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
    // Fallback: largest visible scrollable element on the page.
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
    if (!target) {
      console.debug("[Handsfree] Nothing scrollable found for scroll command.");
      return;
    }
    try {
      target.scrollBy({ top: dy, behavior: "smooth" });
    } catch (e) {
      console.warn("[Handsfree] Scroll command failed:", e);
    }
  }

  _scrollPageTo(position) {
    const target = this._findScrollableContainer();
    if (!target) {
      console.debug("[Handsfree] Nothing scrollable found for scroll command.");
      return;
    }
    try {
      target.scrollTo({ top: position === "top" ? 0 : target.scrollHeight, behavior: "smooth" });
    } catch (e) {
      console.warn("[Handsfree] Scroll command failed:", e);
    }
  }

  _executeCommand(command) {
    console.log("[Handsfree] Parsed command:", command);

    switch (command.type) {
      case "SCROLL_DOWN":
        this._scrollPage(300);
        this.overlay.flashCommand("scroll down");
        break;
      case "SCROLL_UP":
        this._scrollPage(-300);
        this.overlay.flashCommand("scroll up");
        break;
      case "GO_TOP":
        this._scrollPageTo("top");
        this.overlay.flashCommand("go to top");
        break;
      case "GO_BOTTOM":
        this._scrollPageTo("bottom");
        this.overlay.flashCommand("go to bottom");
        break;
      case "GO_BACK":
        window.history.back();
        this.overlay.flashCommand("go back");
        break;
      case "GO_FORWARD":
        window.history.forward();
        this.overlay.flashCommand("go forward");
        break;
      case "START_DICTATION":
        this.setMode("dictation");
        this.overlay.flashCommand("start dictation");
        break;
      case "CLICK":
        this._clickCursorTarget();
        this.overlay.flashCommand("click");
        break;
      case "CALIBRATE":
        if (window.__handsfree_calibration_overlay) {
          window.__handsfree_calibration_overlay.show();
        } else if (window.__handsfree_cursor) {
          window.__handsfree_cursor.calibrate();
        }
        this.overlay.flashCommand("calibrated");
        break;
      case "PRESS_ENTER": {
        const activeInput = this._getActiveInput();
        if (activeInput) {
          this._submitActiveInput(activeInput);
        }
        break;
      }
      case "CLEAR_INPUT": {
        const activeInput = this._getActiveInput();
        if (activeInput) {
          this._clearActiveInput(activeInput);
        }
        break;
      }
      // These will be wired up properly in WS-3 and WS-1 later, but we can emit messages or call APIs
      case "PAUSE_CURSOR":
      case "RESUME_CURSOR":
      case "SHOW_TARGETS":
      case "HIDE_TARGETS":
      case "CLICK_TARGET":
        // Fallback for WS-1 and WS-3 to listen to
        if (chrome && chrome.runtime) {
          chrome.runtime.sendMessage({ type: command.type, payload: command.payload });
        }
        this.overlay.flashCommand(command.payload);
        break;
      case "UNKNOWN":
      default:
        console.log("[Handsfree] Unknown voice command:", command.payload);
        break;
    }
  }

  _clickCursorTarget() {
    // Read coordinates from WS-1 global
    const cursor = window.__handsfree_cursor;
    const x = cursor?.currentX ?? cursor?.x;
    const y = cursor?.currentY ?? cursor?.y;
    if (typeof x === "number" && typeof y === "number") {
      const element = document.elementFromPoint(x, y);
      if (element) {
        const input = this._findInputElement(element);
        element.click();
        if (input) {
          try {
            input.focus({ preventScroll: true });
          } catch (_) {
            try { input.focus(); } catch (e) {}
          }
          this.overlay.show("dictation");
          this.overlay.flashCommand("Search/Input active — speak to type");
        } else {
          this.overlay.flashCommand("click");
        }
      }
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
        } catch (_) {}
      }
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
        } catch (_) {}
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (target.isContentEditable) {
        target.innerText += " " + textToInsert;
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    this.overlay.flashCommand(`Typed: "${trimmed}"`);
  }
}
