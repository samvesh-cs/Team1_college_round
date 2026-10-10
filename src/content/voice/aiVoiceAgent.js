// Handsfree AI Voice Agent with 3-State Machine:
// State 1: 'orb'  - Holographic Sleep Orb (Image 2)
// State 2: 'bar'  - Slim Floating Pill Dock Bar (Image 4)
// State 3: 'chat' - Full Expanded Chat History Window (Image 1)
export class AiVoiceAgent {
  constructor(options = {}) {
    this.state = "orb"; // Starts in sleep/orb mode
    this.onCommandSubmit = options.onCommandSubmit || (() => {});
    this.onVoiceToggle = options.onVoiceToggle || (() => {});
    this.onSpeakingChange = options.onSpeakingChange || (() => {});
    this.isListening = true;
    this.ttsEnabled = true;

    this._createSleepOrb();
    this._createAgentWindow();
    this._setupDragging();

    // Default welcome message in agent window
    this.addAgentMessage(
      "Handsfree AI Voice Agent is active. Speak navigation commands ('scroll down', 'click', 'search') or ask questions.",
      "ready",
      "Handsfree ready"
    );
  }

  /* ----------------------------------------------------
     1. CREATE HOLOGRAPHIC SLEEP ORB (STATE 1: IMAGE 2)
  ---------------------------------------------------- */
  _createSleepOrb() {
    this.orbContainer = document.createElement("div");
    this.orbContainer.id = "handsfree-sleep-orb-container";
    this.orbContainer.title = "Handsfree AI • Click or say 'wake up' to open";

    this.orbContainer.innerHTML = `
      <div class="handsfree-orb-toast" id="handsfree-orb-toast"></div>
      <div class="handsfree-orb-wrapper" id="handsfree-orb-trigger">
        <div class="handsfree-orb-ring"></div>
        <div class="handsfree-orb-dots"></div>
        <div class="handsfree-orb-core">
          <div class="handsfree-orb-specular"></div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="#2dd4bf" fill-opacity="0.2"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="8" y1="22" x2="16" y2="22"/>
          </svg>
        </div>
        <div class="handsfree-orb-pip"></div>
      </div>
    `;

    if (document.body) {
      document.body.appendChild(this.orbContainer);
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        (document.body || document.documentElement).appendChild(this.orbContainer);
      });
    }

    this.orbTrigger = this.orbContainer.querySelector("#handsfree-orb-trigger");
    this.orbToast = this.orbContainer.querySelector("#handsfree-orb-toast");

    // Clicking the orb opens the slim dock bar (State 2)
    this.orbTrigger.addEventListener("click", () => {
      this.toBar();
    });
  }

  /* ----------------------------------------------------
     2. CREATE FLOATING AGENT (STATES 2 & 3: IMAGES 4 & 1)
  ---------------------------------------------------- */
  _createAgentWindow() {
    this.windowElement = document.createElement("div");
    this.windowElement.id = "handsfree-ai-agent-window";
    this.windowElement.className = "hidden mode-bar"; // Default mode

    this.windowElement.innerHTML = `
      <!-- Header (Visible in State 3: Chat) -->
      <div class="handsfree-agent-header" id="handsfree-agent-header">
        <div class="handsfree-agent-header-left">
          <span class="handsfree-header-orb-icon"></span>
          <span class="handsfree-agent-title">Handsfree AI</span>
          <span class="handsfree-agent-status-badge" id="handsfree-header-status">
            <span style="width:5px;height:5px;border-radius:50%;background:#2dd4bf;display:inline-block;"></span>
            Active
          </span>
        </div>
        <div class="handsfree-agent-header-actions">
          <button class="handsfree-header-btn" id="handsfree-btn-clear" title="Clear chat history">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
          <button class="handsfree-header-btn" id="handsfree-btn-minimize" title="Collapse to dock bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <button class="handsfree-header-btn" id="handsfree-btn-sleep" title="Collapse to sleep orb">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- Chat History (Visible in State 3: Chat) -->
      <div class="handsfree-agent-chat-body" id="handsfree-chat-body"></div>

      <!-- Real-time Live Reply Floating Pill (Above Dock in Bar Mode) -->
      <div class="handsfree-dock-reply-pill" id="handsfree-dock-reply-pill">
        <span class="handsfree-reply-icon" id="handsfree-reply-icon">✓</span>
        <span class="handsfree-reply-text" id="handsfree-dock-reply-text">Ready</span>
      </div>

      <!-- Dock Input Bar (Visible in States 2 & 3: Image 4 & 1) -->
      <div class="handsfree-agent-dock">
        <!-- Dock Orb (Click to Sleep) -->
        <div class="handsfree-dock-orb" id="handsfree-dock-orb" title="Collapse to sleep orb (or say 'sleep')">
          <div class="handsfree-dock-orb-ring"></div>
          <div class="handsfree-dock-orb-core"></div>
          <div class="handsfree-dock-orb-pip"></div>
        </div>

        <!-- Soundwave Equalizer -->
        <div class="handsfree-soundwave idle" id="handsfree-soundwave">
          <div class="handsfree-wave-bar"></div>
          <div class="handsfree-wave-bar"></div>
          <div class="handsfree-wave-bar"></div>
          <div class="handsfree-wave-bar"></div>
          <div class="handsfree-wave-bar"></div>
        </div>

        <!-- Real-time Speech & Text Input -->
        <input 
          type="text" 
          class="handsfree-dock-input" 
          id="handsfree-dock-input" 
          placeholder="Speak command or ask Handsfree..." 
        />

        <!-- Audio TTS Speaker Toggle Button -->
        <button class="handsfree-dock-speaker-btn active" id="handsfree-dock-speaker-btn" title="Toggle AI voice spoken replies (TTS)">
          <svg class="handsfree-speaker-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
        </button>

        <!-- Voice Button (Turquoise Mic Icon) -->
        <button class="handsfree-dock-voice-btn active" id="handsfree-dock-voice-btn" title="Toggle voice listening">
          <svg class="handsfree-mic-svg-dock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" fill-opacity="0.2"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="8" y1="22" x2="16" y2="22"/>
          </svg>
          <span>Voice</span>
        </button>

        <!-- Send Button -->
        <button class="handsfree-dock-send-btn" id="handsfree-dock-send-btn" title="Send command">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>

        <!-- Expand / Collapse Chevron Button (Image 4) -->
        <button class="handsfree-dock-expand-btn" id="handsfree-dock-expand-btn" title="Expand chat history (or say 'expand more')">
          <svg id="handsfree-expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
      </div>
    `;

    if (document.body) {
      document.body.appendChild(this.windowElement);
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        (document.body || document.documentElement).appendChild(this.windowElement);
      });
    }

    this.chatBody = this.windowElement.querySelector("#handsfree-chat-body");
    this.dockInput = this.windowElement.querySelector("#handsfree-dock-input");
    this.soundwave = this.windowElement.querySelector("#handsfree-soundwave");
    this.voiceBtn = this.windowElement.querySelector("#handsfree-dock-voice-btn");
    this.speakerBtn = this.windowElement.querySelector("#handsfree-dock-speaker-btn");
    this.sendBtn = this.windowElement.querySelector("#handsfree-dock-send-btn");
    this.dockOrb = this.windowElement.querySelector("#handsfree-dock-orb");
    this.expandBtn = this.windowElement.querySelector("#handsfree-dock-expand-btn");
    this.expandIcon = this.windowElement.querySelector("#handsfree-expand-icon");
    this.headerStatus = this.windowElement.querySelector("#handsfree-header-status");
    this.dockReplyPill = this.windowElement.querySelector("#handsfree-dock-reply-pill");
    this.dockReplyText = this.windowElement.querySelector("#handsfree-dock-reply-text");
    this.replyIcon = this.windowElement.querySelector("#handsfree-reply-icon");

    // State Transition Events
    // Mini orb clicks -> collapse to Sleep Orb (State 1)
    this.dockOrb.addEventListener("click", () => {
      this.toOrb();
    });

    // Minimize in header -> collapse from Chat (State 3) to Bar (State 2)
    this.windowElement.querySelector("#handsfree-btn-minimize").addEventListener("click", () => {
      this.toBar();
    });

    // Sleep button in header -> collapse to Sleep Orb (State 1)
    this.windowElement.querySelector("#handsfree-btn-sleep").addEventListener("click", () => {
      this.toOrb();
    });

    // Expand chevron button -> toggles between Bar (State 2) and Chat (State 3)
    this.expandBtn.addEventListener("click", () => {
      if (this.state === "chat") {
        this.toBar();
      } else {
        this.toChat();
      }
    });

    this.windowElement.querySelector("#handsfree-btn-clear").addEventListener("click", () => {
      this.chatBody.innerHTML = "";
      this.addAgentMessage("Chat cleared. Ready for your commands.", "clear", "Chat cleared");
    });

    this.voiceBtn.addEventListener("click", () => {
      this.isListening = !this.isListening;
      this.updateVoiceState(this.isListening);
      this.onVoiceToggle(this.isListening);
    });

    if (this.speakerBtn) {
      this.speakerBtn.addEventListener("click", () => {
        this.ttsEnabled = !this.ttsEnabled;
        if (this.ttsEnabled) {
          this.speakerBtn.classList.add("active");
          this.speak("Voice replies enabled");
          this.showDockReply("Voice replies enabled", "success");
        } else {
          this.speakerBtn.classList.remove("active");
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          this.showDockReply("Voice replies muted", "success");
        }
      });
    }

    const submitInput = () => {
      const text = this.dockInput.value.trim();
      if (!text) return;
      this.dockInput.value = "";
      this.onCommandSubmit(text);
    };

    this.sendBtn.addEventListener("click", submitInput);
    this.dockInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitInput();
      }
    });
  }

  _persistState(state) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ agentState: state });
      }
    } catch (e) {}
  }

  _ensureMounted() {
    try {
      const root = document.body || document.documentElement;
      if (this.orbContainer && (!this.orbContainer.parentNode || !document.contains(this.orbContainer))) {
        root && root.appendChild(this.orbContainer);
      }
      if (this.windowElement && (!this.windowElement.parentNode || !document.contains(this.windowElement))) {
        root && root.appendChild(this.windowElement);
      }
    } catch (e) {}
  }

  /* ----------------------------------------------------
     3. 3-STATE TRANSITIONS
  ---------------------------------------------------- */
  // State 1: Sleep Orb
  toOrb() {
    this._ensureMounted();
    this.state = "orb";

    // Hide chat / bar
    this.windowElement.classList.add("hidden");
    this.windowElement.style.setProperty("display", "none", "important");

    // Show sleep orb with guaranteed visibility
    this.orbContainer.classList.remove("hidden");
    this.orbContainer.style.setProperty("display", "flex", "important");
    this.orbContainer.style.setProperty("opacity", "1", "important");
    this.orbContainer.style.setProperty("visibility", "visible", "important");
    this.orbContainer.style.setProperty("pointer-events", "auto", "important");
    this.orbContainer.style.setProperty("z-index", "2147483647", "important");

    this._persistState("orb");
  }

  // State 2: Slim Floating Pill Dock Bar (Image 4)
  toBar() {
    this._ensureMounted();
    this.state = "bar";

    // Hide sleep orb
    this.orbContainer.classList.add("hidden");
    this.orbContainer.style.setProperty("display", "none", "important");

    // Show floating pill bar with guaranteed visibility
    this.windowElement.classList.remove("hidden");
    this.windowElement.classList.remove("mode-chat");
    this.windowElement.classList.add("mode-bar");
    this.windowElement.style.setProperty("display", "flex", "important");
    this.windowElement.style.setProperty("opacity", "1", "important");
    this.windowElement.style.setProperty("visibility", "visible", "important");
    this.windowElement.style.setProperty("pointer-events", "auto", "important");
    this.windowElement.style.setProperty("z-index", "2147483647", "important");

    // Chevron points UP (ready to expand to chat)
    if (this.expandIcon) {
      this.expandIcon.innerHTML = `<polyline points="18 15 12 9 6 15"></polyline>`;
    }
    if (this.expandBtn) {
      this.expandBtn.title = "Expand chat history (or say 'expand more')";
    }
    this._persistState("bar");
  }

  // State 3: Full Expanded Chat History Window (Image 1)
  toChat() {
    this._ensureMounted();
    this.state = "chat";

    // Hide sleep orb
    this.orbContainer.classList.add("hidden");
    this.orbContainer.style.setProperty("display", "none", "important");

    // Show full chat window with guaranteed visibility
    this.windowElement.classList.remove("hidden");
    this.windowElement.classList.remove("mode-bar");
    this.windowElement.classList.add("mode-chat");
    this.windowElement.style.setProperty("display", "flex", "important");
    this.windowElement.style.setProperty("opacity", "1", "important");
    this.windowElement.style.setProperty("visibility", "visible", "important");
    this.windowElement.style.setProperty("pointer-events", "auto", "important");
    this.windowElement.style.setProperty("z-index", "2147483647", "important");

    // Chevron points DOWN (ready to collapse back to bar)
    if (this.expandIcon) {
      this.expandIcon.innerHTML = `<polyline points="6 9 12 15 18 9"></polyline>`;
    }
    if (this.expandBtn) {
      this.expandBtn.title = "Collapse to dock bar (or say 'collapse')";
    }
    this.scrollToBottom();
    this._persistState("chat");
  }

  /* ----------------------------------------------------
     4. REAL-TIME TRANSCRIPTION STREAMING & MESSAGES
  ---------------------------------------------------- */
  speak(text) {
    if (!this.ttsEnabled || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      // Clean special characters, ticks, and hashes
      const clean = text.replace(/[✓*•#]/g, "").replace(/\s+/g, " ").trim();
      if (!clean) return;

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.08; // Natural, crisp response rate
      utterance.pitch = 1.0;
      utterance.volume = 0.9;

      if (this.onSpeakingChange) this.onSpeakingChange(true);

      utterance.onend = () => {
        setTimeout(() => {
          if (this.onSpeakingChange) this.onSpeakingChange(false);
        }, 150);
      };

      utterance.onerror = () => {
        if (this.onSpeakingChange) this.onSpeakingChange(false);
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {}
  }

  showDockReply(text, type = "success") {
    if (!this.dockReplyPill || !this.dockReplyText) return;
    this.dockReplyText.textContent = text;
    this.dockReplyPill.className = `handsfree-dock-reply-pill visible ${type}`;
    if (this.replyIcon) {
      this.replyIcon.textContent = type === "hearing" ? "🎙" : "✓";
    }

    if (this._dockReplyTimer) clearTimeout(this._dockReplyTimer);
    if (type !== "hearing") {
      this._dockReplyTimer = setTimeout(() => {
        if (this.dockReplyPill) {
          this.dockReplyPill.classList.remove("visible");
        }
      }, 3500);
    }
  }

  setInterimText(text) {
    if (!this.dockInput) return;
    if (text) {
      this.dockInput.placeholder = `Hearing: "${text}"...`;
      this.dockInput.classList.add("hearing");
      this.setEqualizerActive(true);
      this.showDockReply(`Hearing: "${text}"`, "hearing");
    } else {
      this.dockInput.placeholder = "Speak command or ask Handsfree...";
      this.dockInput.classList.remove("hearing");
      if (this.dockReplyPill && this.dockReplyPill.classList.contains("hearing")) {
        this.dockReplyPill.classList.remove("visible");
      }
    }
  }

  addUserMessage(text) {
    this.setInterimText("");
    const timeStr = this._getCurrentTime();
    const row = document.createElement("div");
    row.className = "handsfree-msg-row user";
    row.innerHTML = `
      <div class="handsfree-msg-bubble">${this._escapeHtml(text)}</div>
      <div class="handsfree-msg-time">${timeStr}</div>
    `;
    this.chatBody.appendChild(row);
    this.scrollToBottom();
  }

  addAgentMessage(text, commandTag = null, spokenReply = null) {
    this.setInterimText("");
    const timeStr = this._getCurrentTime();
    const row = document.createElement("div");
    row.className = "handsfree-msg-row agent";
    
    let tagHtml = "";
    if (commandTag) {
      tagHtml = `<div class="handsfree-cmd-tag">✓ ${this._escapeHtml(commandTag)}</div>`;
    }

    row.innerHTML = `
      <div class="handsfree-msg-bubble">
        ${this._escapeHtml(text)}
        ${tagHtml}
      </div>
      <div class="handsfree-msg-time">${timeStr}</div>
    `;
    this.chatBody.appendChild(row);
    this.scrollToBottom();

    // 1. Real-time Visual Reply in Dock Bar (State 2)
    const replySummary = commandTag ? `✓ ${commandTag}` : text;
    this.showDockReply(replySummary, "success");

    // 2. Real-time Toast in Orb Mode (State 1)
    if (this.state === "orb") {
      this.flashOrbToast(replySummary);
    }

    // 3. Real-time Audio Spoken Reply (TTS)
    const toSpeak = spokenReply || (commandTag ? commandTag : text);
    this.speak(toSpeak);
  }

  setEqualizerActive(isActive) {
    if (!this.soundwave) return;
    if (isActive) {
      this.soundwave.classList.remove("idle");
      this.soundwave.classList.add("active");
    } else {
      this.soundwave.classList.remove("active");
      this.soundwave.classList.add("idle");
    }
  }

  updateVoiceState(isListening) {
    this.isListening = isListening;
    if (isListening) {
      this.voiceBtn.classList.add("active");
      this.headerStatus.innerHTML = `
        <span style="width:5px;height:5px;border-radius:50%;background:#2dd4bf;display:inline-block;"></span>
        Active
      `;
      this.setEqualizerActive(true);
    } else {
      this.voiceBtn.classList.remove("active");
      this.headerStatus.innerHTML = `
        <span style="width:5px;height:5px;border-radius:50%;background:#94a3b8;display:inline-block;"></span>
        Muted
      `;
      this.setEqualizerActive(false);
    }
  }

  flashOrbToast(text) {
    if (!this.orbToast) return;
    this.orbToast.textContent = text.length > 32 ? text.substring(0, 32) + "…" : text;
    this.orbToast.classList.add("visible");
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      this.orbToast.classList.remove("visible");
    }, 2800);
  }

  scrollToBottom() {
    if (this.chatBody) {
      setTimeout(() => {
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
      }, 50);
    }
  }

  /* ----------------------------------------------------
     5. DRAGGABLE BEHAVIOR
  ---------------------------------------------------- */
  _setupDragging() {
    this._makeDraggable(this.windowElement, this.windowElement.querySelector("#handsfree-agent-header"));
    this._makeDraggable(this.orbContainer, this.orbTrigger);
  }

  _makeDraggable(targetEl, handleEl) {
    if (!handleEl) return;
    let isDragging = false;
    let startX, startY, origX, origY;

    handleEl.addEventListener("mousedown", (e) => {
      if (e.target.closest("button") || e.target.closest("input")) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = targetEl.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      targetEl.style.left = `${origX + dx}px`;
      targetEl.style.top = `${origY + dy}px`;
      targetEl.style.right = "auto";
      targetEl.style.bottom = "auto";
    });

    window.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = "";
      }
    });
  }

  _getCurrentTime() {
    const d = new Date();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  _escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
