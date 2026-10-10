const COMMANDS = [
  { phrases: ["scroll down"],    type: "SCROLL_DOWN" },
  { phrases: ["scroll up"],      type: "SCROLL_UP" },
  { phrases: ["go to top", "top"],  type: "GO_TOP" },
  { phrases: ["go to bottom", "bottom"], type: "GO_BOTTOM" },
  { phrases: ["click"],          type: "CLICK" },
  { phrases: ["double click"],   type: "DOUBLE_CLICK" },
  { phrases: ["back"],           type: "GO_BACK" },
  { phrases: ["forward"],        type: "GO_FORWARD" },
  { phrases: ["pause", "pause cursor"], type: "PAUSE_CURSOR" },
  { phrases: ["resume", "resume cursor"], type: "RESUME_CURSOR" },
  { phrases: ["start dictation", "start typing"], type: "START_DICTATION" },
  { phrases: ["stop dictation", "stop typing"],   type: "STOP_DICTATION" },
  { phrases: ["show targets"],   type: "SHOW_TARGETS" },
  { phrases: ["hide targets"],   type: "HIDE_TARGETS" },
];

export function parseCommand(transcript) {
  const normalized = transcript.trim().toLowerCase();
  
  // Handle "click <number>"
  const clickMatch = normalized.match(/^click (\d+)$/);
  if (clickMatch) {
    return { type: "CLICK_TARGET", payload: parseInt(clickMatch[1], 10) };
  }

  for (const cmd of COMMANDS) {
    if (cmd.phrases.some(p => normalized.includes(p))) {
      return { type: cmd.type, payload: normalized };
    }
  }
  
  return { type: "UNKNOWN", payload: normalized };
}
