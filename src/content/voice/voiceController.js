import { parseCommand } from "./commandParser.js";
import { VoiceOverlay } from "./voiceOverlay.js";
import { TargetManager } from "./targetManager.js";
import { AiVoiceAgent } from "./aiVoiceAgent.js";
import { MSG } from "../../shared/messages.js";

export class VoiceController {
  constructor() {
    this.recognition = null;
    this.mode = "command"; // "command" or "dictation"
    this.enabled = false;
    
    // UI Elements
    this.overlay = new VoiceOverlay();
    this.targetManager = new TargetManager();
    this.aiAgent = new AiVoiceAgent({
      onCommandSubmit: (text) => this.handleExternalInput(text),
      onVoiceToggle: (isListening) => {
        if (isListening) {
          this.start();
        } else {
          this.stop();
        }
      }
    });

    // Fallback cursor position tracking so "click" always works
    this._initCursorTracking();
    this._initSpeechRecognition();
  }

  _initCursorTracking() {
    // Default cursor to center of screen until moved
    if (!window.__handsfree_cursor) {
      window.__handsfree_cursor = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
      };
    }

    // Continuously update fallback coordinates on mouse move
    window.addEventListener("mousemove", (e) => {
      // Don't overwrite if head tracking is actively providing coords
      if (!window.__handsfree_cursor_from_head) {
        window.__handsfree_cursor = { x: e.clientX, y: e.clientY };
      }
    }, { passive: true });
  }

  _initSpeechRecognition() {
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
      this.aiAgent.updateVoiceState(true);
      this.aiAgent.setEqualizerActive(true);
    };

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
          // Ignore if already started
        }
      } else {
        this.aiAgent.setEqualizerActive(false);
      }
    };
    
    this.recognition.onerror = (event) => {
      console.warn("[Handsfree] Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        this.overlay.flashCommand("Mic permission denied", false);
        this.aiAgent.addAgentMessage("Microphone permission was denied. Please allow microphone access in Chrome.");
      }
    };
  }

  start() {
    this.enabled = true;
    this.mode = "command";
    this.overlay.show(this.mode);
    this.aiAgent.updateVoiceState(true);

    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (e) {
        // Recognition might already be running
      }
    }
  }

  stop() {
    this.enabled = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    this.overlay.hide();
    this.aiAgent.updateVoiceState(false);
  }

  setMode(newMode) {
    this.mode = newMode;
    this.overlay.show(this.mode);
  }

  handleExternalInput(text) {
    this._handleTranscript(text);
  }

  _handleTranscript(transcript) {
    const trimmed = transcript.trim();
    if (!trimmed) return;

    // Log user speech in the AI Voice Agent chat stream
    this.aiAgent.addUserMessage(trimmed);

    if (this.mode === "command") {
      const command = parseCommand(trimmed);
      this._executeCommand(command, trimmed);
    } else if (this.mode === "dictation") {
      // Allow stopping dictation via voice
      const command = parseCommand(trimmed);
      if (command.type === "STOP_DICTATION") {
        this.setMode("command");
        this.overlay.flashCommand("stop dictation");
        this.aiAgent.addAgentMessage("Dictation mode stopped. Switched back to command mode.", "stop dictation");
        return;
      }

      this._insertDictation(trimmed);
      this.aiAgent.addAgentMessage(`Dictated: "${trimmed}"`, "dictate");
    }
  }

  _executeCommand(command, rawTranscript) {
    console.log("[Handsfree] Executing command:", command);
    const scrollStep = Math.max(300, Math.floor(window.innerHeight * 0.65));

    switch (command.type) {
      case "SCROLL_DOWN":
        window.scrollBy({ top: scrollStep, behavior: "smooth" });
        this.overlay.flashCommand("scroll down");
        this.aiAgent.addAgentMessage(`Scrolled down ${scrollStep}px`, "scroll down");
        break;

      case "SCROLL_UP":
        window.scrollBy({ top: -scrollStep, behavior: "smooth" });
        this.overlay.flashCommand("scroll up");
        this.aiAgent.addAgentMessage(`Scrolled up ${scrollStep}px`, "scroll up");
        break;

      case "GO_TOP":
        window.scrollTo({ top: 0, behavior: "smooth" });
        this.overlay.flashCommand("top");
        this.aiAgent.addAgentMessage("Scrolled to top of page", "go to top");
        break;

      case "GO_BOTTOM":
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        this.overlay.flashCommand("bottom");
        this.aiAgent.addAgentMessage("Scrolled to bottom of page", "go to bottom");
        break;

      case "GO_BACK":
        this.overlay.flashCommand("go back");
        this.aiAgent.addAgentMessage("Navigating back in browser history", "back");
        setTimeout(() => window.history.back(), 200);
        break;

      case "GO_FORWARD":
        this.overlay.flashCommand("go forward");
        this.aiAgent.addAgentMessage("Navigating forward in browser history", "forward");
        setTimeout(() => window.history.forward(), 200);
        break;

      case "RELOAD":
        this.overlay.flashCommand("reload");
        this.aiAgent.addAgentMessage("Reloading page...", "reload");
        setTimeout(() => window.location.reload(), 300);
        break;

      case "CLICK":
        const clicked = this._clickCursorTarget();
        this.overlay.flashCommand("click", clicked);
        this.aiAgent.addAgentMessage(
          clicked ? "Simulated click at cursor target" : "No interactive element found at cursor",
          "click"
        );
        break;

      case "DOUBLE_CLICK":
        const dblClicked = this._clickCursorTarget(true);
        this.overlay.flashCommand("double click", dblClicked);
        this.aiAgent.addAgentMessage("Simulated double-click at cursor target", "double click");
        break;

      case "PRESS_ENTER":
        this._pressEnter();
        this.overlay.flashCommand("press enter");
        this.aiAgent.addAgentMessage("Pressed Enter key on active element", "enter");
        break;

      case "PRESS_TAB":
        this._pressTab();
        this.overlay.flashCommand("tab");
        this.aiAgent.addAgentMessage("Advanced focus to next field", "tab");
        break;

      case "PRESS_ESCAPE":
        if (document.activeElement) document.activeElement.blur();
        this.overlay.flashCommand("escape");
        this.aiAgent.addAgentMessage("Pressed Escape / blurred focus", "escape");
        break;

      case "TYPE_TEXT":
        this._insertDictation(command.payload);
        this.overlay.flashCommand(`type: ${command.payload}`);
        this.aiAgent.addAgentMessage(`Typed: "${command.payload}"`, "type");
        break;

      case "START_DICTATION":
        this.setMode("dictation");
        this.overlay.flashCommand("start dictation");
        this.aiAgent.addAgentMessage("Dictation mode active. Speak naturally to fill fields. Say 'stop dictation' to exit.", "start dictation");
        break;

      case "STOP_DICTATION":
        this.setMode("command");
        this.overlay.flashCommand("stop dictation");
        this.aiAgent.addAgentMessage("Switched back to command mode.", "stop dictation");
        break;

      case "SHOW_TARGETS":
        const count = this.targetManager.showTargets();
        this.overlay.flashCommand(`targets: ${count}`);
        this.aiAgent.addAgentMessage(`Generated ${count} numbered click targets. Say 'click [number]' or '# [number]' to select.`, "show targets");
        break;

      case "HIDE_TARGETS":
        this.targetManager.hideTargets();
        this.overlay.flashCommand("targets hidden");
        this.aiAgent.addAgentMessage("Numbered target badges hidden.", "hide targets");
        break;

      case "CLICK_TARGET":
        const targetNum = command.payload;
        const success = this.targetManager.clickTarget(targetNum);
        this.overlay.flashCommand(`click #${targetNum}`, success);
        this.aiAgent.addAgentMessage(
          success ? `Clicked numbered target #${targetNum}` : `Target #${targetNum} not found. Say 'show targets' to re-index.`,
          `click ${targetNum}`
        );
        break;

      case "EXPAND_ASSISTANT":
        this.aiAgent.expand();
        this.overlay.flashCommand("assistant opened");
        break;

      case "COLLAPSE_ASSISTANT":
        this.aiAgent.collapse();
        this.overlay.flashCommand("assistant collapsed");
        break;

      case "PAUSE":
        this.enabled = false;
        if (this.recognition) {
          try { this.recognition.stop(); } catch (e) {}
        }
        this.overlay.flashCommand("paused");
        this.aiAgent.addAgentMessage("Voice listening paused. Say 'resume' or click the mic button to reactivate.", "pause");
        break;

      case "RESUME":
        this.start();
        this.overlay.flashCommand("resumed");
        this.aiAgent.addAgentMessage("Voice listening resumed.", "resume");
        break;

      case "SEARCH_PAGE":
        this._searchPage(command.payload);
        break;

      case "HELP":
        this.aiAgent.expand();
        this.aiAgent.addAgentMessage(
          "Available Voice Commands:\n" +
          "• Scrolling: 'scroll down', 'scroll up', 'top', 'bottom'\n" +
          "• Navigation: 'back', 'forward', 'reload'\n" +
          "• Clicking: 'click', 'double click', 'show targets', 'click [number]'\n" +
          "• Typing: 'type [phrase]', 'enter', 'tab', 'start dictation'\n" +
          "• Assistant: 'wake up', 'sleep', 'pause', 'resume'",
          "help"
        );
        break;

      case "AI_QUERY":
      default:
        this._handleAiQuery(command.payload, rawTranscript);
        break;
    }

    // Forward message to runtime for background / other workstreams
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: command.type, payload: command.payload });
      }
    } catch (e) {}
  }

  _clickCursorTarget(isDoubleClick = false) {
    const cursor = window.__handsfree_cursor || {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };

    let element = document.elementFromPoint(cursor.x, cursor.y);

    // If cursor is over overlay or body, try to find active or nearest clickable element
    if (!element || element === document.body || element === document.documentElement || element.id?.startsWith("handsfree")) {
      if (document.activeElement && document.activeElement !== document.body) {
        element = document.activeElement;
      } else {
        // Find center-most button or link in view
        element = document.querySelector("a, button, input") || element;
      }
    }

    if (!element) return false;

    // Simulate pointer and mouse events
    const eventInit = {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: cursor.x,
      clientY: cursor.y
    };

    element.dispatchEvent(new MouseEvent("mousedown", eventInit));
    element.dispatchEvent(new MouseEvent("mouseup", eventInit));
    element.dispatchEvent(new MouseEvent("click", eventInit));

    if (isDoubleClick) {
      element.dispatchEvent(new MouseEvent("mousedown", eventInit));
      element.dispatchEvent(new MouseEvent("mouseup", eventInit));
      element.dispatchEvent(new MouseEvent("click", eventInit));
      element.dispatchEvent(new MouseEvent("dblclick", eventInit));
    }

    if (typeof element.focus === "function") {
      element.focus();
    }
    if (typeof element.click === "function") {
      element.click();
    }

    // Brief highlight animation
    const originalOutline = element.style.outline;
    element.style.outline = "2px solid #2dd4bf";
    setTimeout(() => {
      element.style.outline = originalOutline;
    }, 400);

    return true;
  }

  _pressEnter() {
    const el = document.activeElement || document.body;
    const evtInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", evtInit));
    el.dispatchEvent(new KeyboardEvent("keypress", evtInit));
    el.dispatchEvent(new KeyboardEvent("keyup", evtInit));

    // If active element is an input inside a form, submit form
    if (el.form) {
      if (typeof el.form.requestSubmit === "function") {
        el.form.requestSubmit();
      } else {
        el.form.submit();
      }
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

  _searchPage(query) {
    if (!query) return;
    
    // Check for search input on page first (e.g., Wikipedia #searchInput)
    const searchInput = document.querySelector('input[type="search"], input[name="search"], #searchInput, input[placeholder*="Search" i]');
    if (searchInput) {
      searchInput.focus();
      this._insertDictation(query);
      this._pressEnter();
      this.overlay.flashCommand(`search: ${query}`);
      this.aiAgent.addAgentMessage(`Entered search query: "${query}"`, "search");
      return;
    }

    // Fallback: window.find
    if (window.find) {
      const found = window.find(query, false, false, true, false, true, false);
      this.overlay.flashCommand(found ? `found: ${query}` : "not found", found);
      this.aiAgent.addAgentMessage(
        found ? `Found occurrence of "${query}" on page.` : `Could not find "${query}" on this page.`,
        "find"
      );
    }
  }

  _insertDictation(transcript) {
    let activeEl = document.activeElement;

    // If no text element is focused, try to locate a search or text input on the page
    if (!activeEl || activeEl === document.body) {
      activeEl = document.querySelector('input[type="search"], input[type="text"], textarea') || activeEl;
      if (activeEl && activeEl !== document.body) {
        activeEl.focus();
      }
    }

    if (!activeEl || activeEl === document.body) return;

    if (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA") {
      const currentVal = activeEl.value;
      const space = currentVal.length > 0 && !currentVal.endsWith(" ") ? " " : "";
      const newValue = currentVal + space + transcript.trim();

      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;

      if (setter) {
        setter.call(activeEl, newValue);
      } else {
        activeEl.value = newValue;
      }

      activeEl.dispatchEvent(new Event("input", { bubbles: true }));
      activeEl.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (activeEl.isContentEditable) {
      const space = activeEl.innerText.length > 0 && !activeEl.innerText.endsWith(" ") ? " " : "";
      activeEl.innerText += space + transcript.trim();
      activeEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  _handleAiQuery(query, rawTranscript) {
    // Generate intelligent contextual response
    const pageTitle = document.title || "this webpage";
    let reply = `I heard: "${rawTranscript}". `;

    const lower = query.toLowerCase();
    if (lower.includes("page") || lower.includes("about") || lower.includes("summary") || lower.includes("what is this")) {
      const metaDesc = document.querySelector('meta[name="description"]')?.content;
      const firstP = document.querySelector('p')?.innerText?.slice(0, 200);
      reply += `You are viewing "${pageTitle}". ${metaDesc || firstP || "Say 'scroll down' to explore or 'show targets' to click links."}`;
    } else {
      reply += `Handsfree provides hands-free web navigation and voice control. Say 'show targets' to click elements by number, 'scroll down' to scroll, or 'help' for command list.`;
    }

    this.aiAgent.addAgentMessage(reply);
    this.overlay.flashCommand(`heard: ${rawTranscript.slice(0, 15)}`);
  }
}
