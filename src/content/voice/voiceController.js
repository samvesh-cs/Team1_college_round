import { parseCommand } from "./commandParser.js";
import { VoiceOverlay } from "./voiceOverlay.js";
import { TargetManager } from "./targetManager.js";
import { AiVoiceAgent } from "./aiVoiceAgent.js";

export class VoiceController {
  constructor() {
    this.recognition = null;
    this.mode = "command"; // "command" or "dictation"
    this.enabled = false;
    
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
          } catch (e) {}
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
    this._initSpeechRecognition();
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
        this.aiAgent.setInterimText(interimTranscript.trim());
      }
    };

    this.recognition.onend = () => {
      this._isAborting = false;
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
      if (event.error === "not-allowed") {
        this.overlay.flashCommand("Mic permission denied", false);
        this.aiAgent.addAgentMessage("Microphone permission was denied. Please allow microphone access in Chrome.");
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
      } catch (e) {}
    }
    this.aiAgent.updateVoiceState(false);
  }

  resumeMic() {
    this.isTabBackgrounded = false;
    if (this.enabled) {
      this.aiAgent.updateVoiceState(true);
      this._safeRestart();
    }
  }

  /* ----------------------------------------------------
     WIPE AUDIO BUFFER & RESTART FRESH SESSION
  ---------------------------------------------------- */
  _abortAndFlush() {
    if (!this.enabled || !this.recognition || this.isTabBackgrounded) return;
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
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onend = null;
        this.recognition.onerror = null;
        this.recognition.abort();
      } catch (e) {}
    }
    this._initSpeechRecognition();
    if (this.enabled && this.recognition && !this.isTabBackgrounded && !this.isSpeaking) {
      try {
        this.recognition.start();
      } catch (e) {}
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
      } catch (e) {}
    }

    // Periodically recycle cloud speech connection to prevent audio buffer latency bloat
    if (this._sessionRefreshTimer) clearInterval(this._sessionRefreshTimer);
    this._sessionRefreshTimer = setInterval(() => {
      if (this.enabled && !this.isTabBackgrounded && Date.now() - this.lastFastCommandTime > 5000) {
        try {
          this.recognition && this.recognition.stop();
        } catch (e) {}
      }
    }, 35000);
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
      } catch (e) {}
    }
    this.overlay.hide();
    this.aiAgent.updateVoiceState(false);
    this.aiAgent.toOrb();
  }

  setMode(newMode) {
    this.mode = newMode;
    this.overlay.show(this.mode);
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
      if (command.type === "STOP_DICTATION") {
        this.setMode("command");
        this.overlay.flashCommand("stop dictation");
        this.aiAgent.addAgentMessage("Dictation mode stopped. Switched back to command mode.", "stop dictation", "Command mode");
        this._abortAndFlush();
        return true;
      }
      if (!isInterim) {
        this._insertDictation(trimmed);
        this.aiAgent.addAgentMessage(`Dictated: "${trimmed}"`, "dictate", "Done");
        this._abortAndFlush();
      }
      return false;
    }

    // 2. Command Mode Parsing
    const command = parseCommand(trimmed);
    if (command.type === "EMPTY") return false;

    // Conversational AI Assistant Query
    if (command.type === "AI_QUERY") {
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
    // Note: bare "CLICK" waits for phrase completion so it does not preempt "click 4" or "click target".
    const instantCommands = [
      "SCROLL_DOWN", "SCROLL_UP", "GO_TOP", "GO_BOTTOM",
      "GO_BACK", "GO_FORWARD", "RELOAD",
      "DOUBLE_CLICK", "CLICK_TARGET",
      "PRESS_ENTER", "PRESS_TAB", "PRESS_ESCAPE",
      "SHOW_TARGETS", "HIDE_TARGETS",
      "WAKE_UP", "EXPAND_MORE", "COLLAPSE_CHAT", "SLEEP",
      "PAUSE", "RESUME", "HELP", "START_DICTATION"
    ];

    const isInstant = instantCommands.includes(command.type) || (command.type === "SEARCH_PAGE" && !command.payload);

    if (isInterim && !isInstant) {
      // Multi-word commands (such as "search [query]" or "type [text]" or bare "click") wait for the full sentence
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

  _executeCommand(command, rawTranscript, isFastPath = false) {
    console.log("[Handsfree] Executing command:", command.type, command.payload);
    const scrollStep = Math.max(320, Math.floor(window.innerHeight * 0.65));

    switch (command.type) {
      case "SCROLL_DOWN":
        window.scrollBy({ top: scrollStep, behavior: "smooth" });
        this.overlay.flashCommand("scroll down");
        this.aiAgent.addAgentMessage(`Scrolled down ${scrollStep}px`, "scroll down", "Moving down");
        break;

      case "SCROLL_UP":
        window.scrollBy({ top: -scrollStep, behavior: "smooth" });
        this.overlay.flashCommand("scroll up");
        this.aiAgent.addAgentMessage(`Scrolled up ${scrollStep}px`, "scroll up", "Moving up");
        break;

      case "GO_TOP":
        window.scrollTo({ top: 0, behavior: "smooth" });
        this.overlay.flashCommand("top");
        this.aiAgent.addAgentMessage("Scrolled to top of page", "go to top", "At the top");
        break;

      case "GO_BOTTOM":
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        this.overlay.flashCommand("bottom");
        this.aiAgent.addAgentMessage("Scrolled to bottom of page", "go to bottom", "At the bottom");
        break;

      case "GO_BACK":
        this.overlay.flashCommand("go back");
        this.aiAgent.addAgentMessage("Navigating back in browser history", "back", "Going back");
        setTimeout(() => window.history.back(), 150);
        break;

      case "GO_FORWARD":
        this.overlay.flashCommand("go forward");
        this.aiAgent.addAgentMessage("Navigating forward in browser history", "forward", "Going forward");
        setTimeout(() => window.history.forward(), 150);
        break;

      case "RELOAD":
        this.overlay.flashCommand("reload");
        this.aiAgent.addAgentMessage("Reloading page...", "reload", "Reloading");
        setTimeout(() => window.location.reload(), 200);
        break;

      case "CLICK":
        const clicked = this._clickCursorTarget();
        this.overlay.flashCommand("click", clicked);
        this.aiAgent.addAgentMessage(
          clicked ? "Simulated click at cursor target" : "No interactive element found at cursor",
          "click",
          clicked ? "Done" : "No element"
        );
        break;

      case "DOUBLE_CLICK":
        const dblClicked = this._clickCursorTarget(true);
        this.overlay.flashCommand("double click", dblClicked);
        this.aiAgent.addAgentMessage("Simulated double-click at cursor target", "double click", "Double clicked");
        break;

      case "PRESS_ENTER":
        this._pressEnter();
        this.overlay.flashCommand("press enter");
        this.aiAgent.addAgentMessage("Pressed Enter key on active element", "enter", "Enter");
        break;

      case "PRESS_TAB":
        this._pressTab();
        this.overlay.flashCommand("tab");
        this.aiAgent.addAgentMessage("Advanced focus to next field", "tab", "Tab");
        break;

      case "PRESS_ESCAPE":
        if (document.activeElement) document.activeElement.blur();
        this.overlay.flashCommand("escape");
        this.aiAgent.addAgentMessage("Pressed Escape / blurred focus", "escape", "Escape");
        break;

      case "SEARCH_PAGE":
        this._searchPage(command.payload);
        break;

      case "TYPE_TEXT":
        this._typeText(command.payload);
        break;

      case "START_DICTATION":
        this.setMode("dictation");
        this.overlay.flashCommand("start dictation");
        this.aiAgent.addAgentMessage("Dictation mode active. Speak naturally to fill fields. Say 'stop dictation' to exit.", "start dictation", "Dictation active");
        break;

      case "STOP_DICTATION":
        this.setMode("command");
        this.overlay.flashCommand("stop dictation");
        this.aiAgent.addAgentMessage("Switched back to command mode.", "stop dictation", "Command mode");
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
          try { this.recognition.stop(); } catch (e) {}
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
    } catch (e) {}
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
      // If user just said "search" or "find", focus the search bar
      if (searchInput) {
        searchInput.focus();
        this.overlay.flashCommand("search focused");
        this.aiAgent.addAgentMessage("Search input focused. Speak or type your search query.", "search", "Search input focused");
      } else {
        this.overlay.flashCommand("no search bar", false);
        this.aiAgent.addAgentMessage("No search input on page. Say 'search [query]' to search Google.", "search", "Say search followed by query");
      }
      return;
    }

    if (searchInput && !isGoogle) {
      searchInput.focus();
      this._setInputValue(searchInput, cleanQuery);
      this._pressEnter(searchInput);
      this.overlay.flashCommand(`search: ${cleanQuery}`);
      this.aiAgent.addAgentMessage(`Searched for "${cleanQuery}" on page`, "search", `Searching for ${cleanQuery}`);
    } else {
      // Direct navigation to Google Search
      this.overlay.flashCommand(`google: ${cleanQuery}`);
      this.aiAgent.addAgentMessage(`Searching Google for "${cleanQuery}"...`, "search", `Searching Google for ${cleanQuery}`);
      setTimeout(() => {
        window.location.href = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`;
      }, 350);
    }
  }

  _typeText(text) {
    if (!text) return;

    const cleanText = text.replace(/^(?:type|write|input)\s+/i, "").trim();
    let target = document.activeElement;

    if (!target || target === document.body || target === document.documentElement) {
      target = this._findSearchInput();
    }

    if (target) {
      target.focus();
      this._setInputValue(target, cleanText);
      this.overlay.flashCommand(`type: ${cleanText}`);
      this.aiAgent.addAgentMessage(`Typed "${cleanText}" into field`, "type");
    } else {
      this.overlay.flashCommand("no input field", false);
      this.aiAgent.addAgentMessage("Could not find an active text input to type into.", "type");
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

  _clickCursorTarget(isDoubleClick = false) {
    const cursor = window.__handsfree_cursor || {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };

    let element = document.elementFromPoint(cursor.x, cursor.y);

    if (!element || element === document.body || element === document.documentElement || element.id?.startsWith("handsfree")) {
      if (document.activeElement && document.activeElement !== document.body) {
        element = document.activeElement;
      } else {
        element = document.querySelector("a, button, input") || element;
      }
    }

    if (!element) return false;

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

    const originalOutline = element.style.outline;
    element.style.outline = "2px solid #2dd4bf";
    setTimeout(() => {
      element.style.outline = originalOutline;
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
    let activeEl = document.activeElement;

    if (!activeEl || activeEl === document.body) {
      activeEl = this._findSearchInput();
    }

    if (!activeEl) return;

    if (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA") {
      const currentVal = activeEl.value;
      const space = currentVal.length > 0 && !currentVal.endsWith(" ") ? " " : "";
      const newValue = currentVal + space + transcript.trim();
      this._setInputValue(activeEl, newValue);
    } else if (activeEl.isContentEditable) {
      const space = activeEl.innerText.length > 0 && !activeEl.innerText.endsWith(" ") ? " " : "";
      activeEl.innerText += space + transcript.trim();
      activeEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  _handleAiQuery(query, rawTranscript) {
    const pageTitle = document.title || "this webpage";
    let reply = `I heard: "${rawTranscript}". `;

    const lower = query.toLowerCase();
    if (lower.includes("page") || lower.includes("about") || lower.includes("summary") || lower.includes("what is this")) {
      const metaDesc = document.querySelector('meta[name="description"]')?.content;
      const firstP = document.querySelector('p')?.innerText?.slice(0, 200);
      reply += `You are viewing "${pageTitle}". ${metaDesc || firstP || "Say 'scroll down' to explore or 'show targets' to click links."}`;
    } else {
      reply += `Handsfree is listening. Say 'search [query]' to search, 'type [text]' to type, 'show targets' for numbered buttons, or 'help' for commands.`;
    }

    this.aiAgent.addAgentMessage(reply);
    this.overlay.flashCommand(`heard: ${rawTranscript.slice(0, 15)}`);
  }
}
