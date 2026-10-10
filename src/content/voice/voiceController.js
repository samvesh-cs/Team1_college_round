import { parseCommand } from "./commandParser.js";
import { VoiceOverlay } from "./voiceOverlay.js";
import { MSG } from "../../shared/messages.js";

export class VoiceController {
  constructor() {
    this.recognition = null;
    this.mode = "command"; // "command" or "dictation"
    this.enabled = false;
    this.listening = false; // true only while recognition is actually running
    this.yielded = false; // true after yielding the session to another tab
    this.overlay = new VoiceOverlay();
    this.restartTimer = null;

    this._init();
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

  setMode(newMode) {
    this.mode = newMode;
    this.overlay.show(this.mode);
  }

  _handleTranscript(transcript) {
    if (this.mode === "command") {
      const command = parseCommand(transcript);
      this._executeCommand(command);
    } else if (this.mode === "dictation") {
      this._insertDictation(transcript);
      
      // Allow stopping dictation via voice even while dictating
      const maybeCommand = parseCommand(transcript);
      if (maybeCommand.type === "STOP_DICTATION") {
         this.setMode("command");
         this.overlay.flashCommand("stop dictation");
      }
    }
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
    if (cursor && cursor.x !== undefined && cursor.y !== undefined) {
      const element = document.elementFromPoint(cursor.x, cursor.y);
      if (element) {
        element.click();
      }
    }
  }

  _insertDictation(transcript) {
    const activeEl = document.activeElement;
    if (!activeEl) return;
    
    // Simple support for input and textarea
    if (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA") {
      const currentVal = activeEl.value;
      const space = currentVal.length > 0 && !currentVal.endsWith(" ") ? " " : "";
      const newValue = currentVal + space + transcript.trim();
      
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      
      if (setter) {
        setter.call(activeEl, newValue);
      } else {
        activeEl.value = newValue; // Fallback
      }
      
      activeEl.dispatchEvent(new Event('input', { bubbles: true }));
      activeEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (activeEl.isContentEditable) {
      const space = activeEl.innerText.length > 0 && !activeEl.innerText.endsWith(" ") ? " " : "";
      activeEl.innerText += space + transcript.trim();
      activeEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}
