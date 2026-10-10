const COMMANDS = [
  { phrases: ["scroll down"],    type: "SCROLL_DOWN" },
  { phrases: ["scroll up"],      type: "SCROLL_UP" },
  { phrases: ["go to top", "top"],  type: "GO_TOP" },
  { phrases: ["go to bottom", "bottom"], type: "GO_BOTTOM" },
  { phrases: ["click"],          type: "CLICK" },
  { phrases: ["double click"],   type: "DOUBLE_CLICK" },
  { phrases: ["back", "go back"], type: "GO_BACK" },
  { phrases: ["forward", "go forward"], type: "GO_FORWARD" },
  { phrases: ["pause", "pause cursor"], type: "PAUSE_CURSOR" },
  { phrases: ["resume", "resume cursor"], type: "RESUME_CURSOR" },
  { phrases: ["start dictation", "start typing"], type: "START_DICTATION" },
  { phrases: ["stop dictation", "stop typing", "cancel typing"], type: "STOP_DICTATION" },
  { phrases: ["press enter", "enter", "search", "submit"], type: "PRESS_ENTER" },
  { phrases: ["clear", "clear text", "clear input", "delete all"], type: "CLEAR_INPUT" },
  { phrases: ["show targets"],   type: "SHOW_TARGETS" },
  { phrases: ["hide targets"],   type: "HIDE_TARGETS" },
  { phrases: ["calibrate", "center cursor", "reset cursor", "recalibrate"], type: "CALIBRATE" },
];

export function parseCommand(transcript) {
  const normalized = transcript.trim().toLowerCase();
  if (!normalized) return { type: "UNKNOWN", payload: "" };
  
  // Handle "click <number>"
  const clickMatch = normalized.match(/^click\s+(\d+)$/);
  if (clickMatch) {
    return { type: "CLICK_TARGET", payload: parseInt(clickMatch[1], 10) };
  }

  for (const cmd of COMMANDS) {
    for (const phrase of cmd.phrases) {
      // 1. Exact match for single or multi-word command (e.g. "top", "bottom", "scroll down")
      if (normalized === phrase) {
        return { type: cmd.type, payload: normalized };
      }
      // 2. Multi-word commands: matches standalone phrase (e.g. "please scroll down" or "scroll down now")
      if (phrase.includes(" ") && (normalized.startsWith(phrase + " ") || normalized.endsWith(" " + phrase))) {
        return { type: cmd.type, payload: normalized };
      }
    }
  }
  
  return { type: "UNKNOWN", payload: normalized };
}
