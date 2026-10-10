import { parseCommand } from "./commandParser.js";
import { VoiceOverlay } from "./voiceOverlay.js";
import { MSG } from "../../shared/messages.js";

export class VoiceController {
  constructor() {
    this.recognition = null;
    this.mode = "command"; // "command" or "dictation"
    this.enabled = false;
    this.overlay = new VoiceOverlay();
    
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

    this.recognition.onresult = (event) => {
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript;
      this._handleTranscript(transcript);
    };

    this.recognition.onend = () => {
      // Auto-restart if it was stopped by silence but feature is still enabled
      if (this.enabled) {
        try {
          this.recognition.start();
        } catch (e) {
          console.error("[Handsfree] Error restarting SpeechRecognition", e);
        }
      }
    };
    
    this.recognition.onerror = (event) => {
      console.error("[Handsfree] Speech recognition error:", event.error);
    };
  }

  start() {
    if (!this.recognition) return;
    this.enabled = true;
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
    this.recognition.stop();
    this.overlay.hide();
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

  _executeCommand(command) {
    console.log("[Handsfree] Parsed command:", command);
    
    switch (command.type) {
      case "SCROLL_DOWN":
        window.scrollBy({ top: 300, behavior: 'smooth' });
        this.overlay.flashCommand("scroll down");
        break;
      case "SCROLL_UP":
        window.scrollBy({ top: -300, behavior: 'smooth' });
        this.overlay.flashCommand("scroll up");
        break;
      case "GO_TOP":
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.overlay.flashCommand("go to top");
        break;
      case "GO_BOTTOM":
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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
