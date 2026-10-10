// High-fidelity voice overlay with turquoise SVG microphone icon and smooth pill transitions
export class VoiceOverlay {
  constructor() {
    this.element = document.createElement("div");
    this.element.id = "handsfree-voice-overlay";
    this.element.className = "handsfree-overlay-pill hidden";
    
    // Modern SVG Microphone Icon matching uploaded design in turquoise
    this.iconContainer = document.createElement("span");
    this.iconContainer.className = "handsfree-voice-icon-box";
    this.iconContainer.innerHTML = `
      <svg class="handsfree-mic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" fill-opacity="0.25"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
        <line x1="8" y1="22" x2="16" y2="22"/>
      </svg>
    `;
    this.element.appendChild(this.iconContainer);
    
    this.textElement = document.createElement("span");
    this.textElement.className = "handsfree-voice-text";
    this.textElement.textContent = "Listening…";
    this.element.appendChild(this.textElement);
    
    this.commandElement = document.createElement("span");
    this.commandElement.className = "handsfree-voice-command";
    this.commandElement.style.display = "none";
    this.element.appendChild(this.commandElement);

    document.body.appendChild(this.element);
    
    this.hideTimeout = null;
    this.commandTimeout = null;
  }

  show(mode = "command") {
    this.element.classList.remove("hidden");
    if (mode === "command") {
      this.iconContainer.innerHTML = `
        <svg class="handsfree-mic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" fill-opacity="0.25"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="8" y1="22" x2="16" y2="22"/>
        </svg>
      `;
      this.textElement.textContent = "Listening…";
    } else if (mode === "dictation") {
      this.iconContainer.innerHTML = `
        <svg class="handsfree-mic-svg dictating" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      `;
      this.textElement.textContent = "Dictating…";
    }
    
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  hide() {
    this.element.classList.add("hidden");
  }

  flashCommand(commandText, isSuccess = true) {
    this.commandElement.textContent = `${isSuccess ? "✓ " : ""}${commandText}`;
    this.commandElement.style.display = "inline-block";
    this.commandElement.style.color = isSuccess ? "#2dd4bf" : "#f87171"; // turquoise or light red
    
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
    }
    
    this.commandTimeout = setTimeout(() => {
      this.commandElement.style.display = "none";
    }, 2500);
  }
}
