export class VoiceOverlay {
  constructor() {
    this.element = document.createElement("div");
    this.element.id = "handsfree-voice-overlay";
    this.element.className = "hidden";
    
    this.iconElement = document.createElement("span");
    this.iconElement.className = "handsfree-voice-icon";
    this.element.appendChild(this.iconElement);
    
    this.textElement = document.createElement("span");
    this.element.appendChild(this.textElement);
    
    this.commandElement = document.createElement("span");
    this.commandElement.className = "handsfree-voice-command";
    this.commandElement.style.display = "none";
    this.element.appendChild(this.commandElement);

    document.body.appendChild(this.element);
    
    this.hideTimeout = null;
    this.commandTimeout = null;
  }

  show(mode) {
    this.element.classList.remove("hidden");
    if (mode === "command") {
      this.iconElement.textContent = "🎤";
      this.textElement.textContent = "Listening…";
    } else if (mode === "dictation") {
      this.iconElement.textContent = "📝";
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

  flashCommand(commandText) {
    this.commandElement.textContent = `✓ ${commandText}`;
    this.commandElement.style.display = "inline-block";
    
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
    }
    
    this.commandTimeout = setTimeout(() => {
      this.commandElement.style.display = "none";
    }, 2000);
  }
}
