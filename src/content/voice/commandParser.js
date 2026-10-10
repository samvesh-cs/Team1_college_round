// Enhanced Voice Command Parser with normalization and natural command grammar
const COMMANDS = [
  // Page Scrolling
  { phrases: ["scroll down", "page down", "go down", "scroll downward"], type: "SCROLL_DOWN" },
  { phrases: ["scroll up", "page up", "go up", "scroll upward"], type: "SCROLL_UP" },
  { phrases: ["go to top", "scroll to top", "scroll top", "page top", "top", "home"], type: "GO_TOP" },
  { phrases: ["go to bottom", "scroll to bottom", "scroll bottom", "page bottom", "bottom", "end"], type: "GO_BOTTOM" },

  // Navigation
  { phrases: ["go back", "back", "previous page", "history back"], type: "GO_BACK" },
  { phrases: ["go forward", "forward", "next page", "history forward"], type: "GO_FORWARD" },
  { phrases: ["reload", "refresh", "reload page", "refresh page"], type: "RELOAD" },

  // Clicks & Actions
  { phrases: ["double click", "double-click"], type: "DOUBLE_CLICK" },
  { phrases: ["click", "select", "press"], type: "CLICK" },

  // Keyboard & Form Controls
  { phrases: ["press enter", "hit enter", "enter", "submit"], type: "PRESS_ENTER" },
  { phrases: ["press tab", "tab", "next field"], type: "PRESS_TAB" },
  { phrases: ["escape", "press escape", "cancel"], type: "PRESS_ESCAPE" },

  // Dictation & Typing
  { phrases: ["start dictation", "start typing", "begin dictation"], type: "START_DICTATION" },
  { phrases: ["stop dictation", "stop typing", "end dictation"], type: "STOP_DICTATION" },

  // Targets & Numbers
  { phrases: ["show targets", "show numbers", "show badges", "targets", "numbers"], type: "SHOW_TARGETS" },
  { phrases: ["hide targets", "hide numbers", "hide badges"], type: "HIDE_TARGETS" },

  // Assistant & Window State
  { phrases: ["wake up", "open assistant", "open agent", "open chat", "expand assistant", "show assistant"], type: "EXPAND_ASSISTANT" },
  { phrases: ["go to sleep", "sleep", "collapse assistant", "hide assistant", "minimize assistant", "close assistant"], type: "COLLAPSE_ASSISTANT" },
  { phrases: ["pause", "pause listening", "pause cursor"], type: "PAUSE" },
  { phrases: ["resume", "resume listening", "resume cursor"], type: "RESUME" },

  // Help
  { phrases: ["help", "what can i say", "commands", "show commands"], type: "HELP" },
];

export function parseCommand(rawTranscript) {
  if (!rawTranscript) return { type: "EMPTY", payload: "" };

  // Normalize: lowercase, remove punctuation, collapse extra spaces
  const normalized = rawTranscript
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "")
    .replace(/\s+/g, " ");

  // 1. Direct Target click by number: "click 4", "target 2", "press 7", "number 5", "#3"
  const clickNumberMatch = normalized.match(/^(?:click|target|press|number|choose)?\s*#?\s*(\d+)$/);
  if (clickNumberMatch) {
    return { type: "CLICK_TARGET", payload: parseInt(clickNumberMatch[1], 10), raw: rawTranscript };
  }

  // 2. Direct Type command: "type [phrase]", "write [phrase]", "input [phrase]"
  const typeMatch = normalized.match(/^(?:type|write|input)\s+(.+)$/);
  if (typeMatch) {
    return { type: "TYPE_TEXT", payload: typeMatch[1], raw: rawTranscript };
  }

  // 3. Search command: "search [query]", "search for [query]", "find [query]"
  const searchMatch = normalized.match(/^(?:search for|search|find)\s+(.+)$/);
  if (searchMatch) {
    return { type: "SEARCH_PAGE", payload: searchMatch[1], raw: rawTranscript };
  }

  // 4. Exact and phrase matching for built-in commands
  for (const cmd of COMMANDS) {
    // Check exact matches or whole-word phrase matches
    for (const phrase of cmd.phrases) {
      if (normalized === phrase || normalized.startsWith(phrase + " ") || normalized.endsWith(" " + phrase) || normalized.includes(" " + phrase + " ")) {
        return { type: cmd.type, payload: phrase, raw: rawTranscript };
      }
    }
  }

  // 5. If not a recognized control command, treat as AI conversational query / assistant prompt
  return { type: "AI_QUERY", payload: normalized, raw: rawTranscript };
}
