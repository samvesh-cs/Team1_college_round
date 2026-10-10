const WORD_TO_NUMBER = {
  zero: 0,
  one: 1, won: 1,
  two: 2, to: 2, too: 2,
  three: 3, tree: 3,
  four: 4, for: 4, fore: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8, ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  "twenty one": 21, "twenty-one": 21,
  "twenty two": 22, "twenty-two": 22,
  "twenty three": 23, "twenty-three": 23,
  "twenty four": 24, "twenty-four": 24,
  "twenty five": 25, "twenty-five": 25,
  "twenty six": 26, "twenty-six": 26,
  "twenty seven": 27, "twenty-seven": 27,
  "twenty eight": 28, "twenty-eight": 28,
  "twenty nine": 29, "twenty-nine": 29,
  thirty: 30,
  "thirty one": 31, "thirty-one": 31,
  "thirty two": 32, "thirty-two": 32,
  "thirty three": 33, "thirty-three": 33,
  "thirty four": 34, "thirty-four": 34,
  "thirty five": 35, "thirty-five": 35,
  "thirty six": 36, "thirty-six": 36,
  "thirty seven": 37, "thirty-seven": 37,
  "thirty eight": 38, "thirty-eight": 38,
  "thirty nine": 39, "thirty-nine": 39,
  forty: 40,
  "forty one": 41, "forty-one": 41,
  "forty two": 42, "forty-two": 42,
  "forty three": 43, "forty-three": 43,
  "forty four": 44, "forty-four": 44,
  "forty five": 45, "forty-five": 45,
  fifty: 50,
  sixty: 60,
};

// Enhanced Voice Command Parser with 3-state assistant transitions, fast-path parsing, and robust search
const COMMANDS = [
  // Page Scrolling (Fast-path eligible)
  { phrases: ["scroll down", "page down", "go down", "scroll downward", "down"], type: "SCROLL_DOWN" },
  { phrases: ["scroll up", "page up", "go up", "scroll upward", "up"], type: "SCROLL_UP" },
  { phrases: ["go to top", "scroll to top", "scroll top", "page top", "top", "home"], type: "GO_TOP" },
  { phrases: ["go to bottom", "scroll to bottom", "scroll bottom", "page bottom", "bottom", "end"], type: "GO_BOTTOM" },

  // Navigation (Fast-path eligible)
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

  // 3-State Assistant Transitions
  // State 1 -> State 2 (Orb to Bar Dock)
  { phrases: ["wake up", "open assistant", "open agent", "open bar", "expand", "show bar", "show dock"], type: "WAKE_UP" },

  // State 2 -> State 3 (Bar Dock to Full Chat Window)
  { phrases: ["expand more", "show chat", "open chat", "chat history", "show history", "maximize chat", "full window"], type: "EXPAND_MORE" },

  // State 3 -> State 2 (Full Chat Window back to Bar Dock)
  { phrases: ["collapse chat", "hide chat", "close chat", "shrink chat", "minimize chat"], type: "COLLAPSE_CHAT" },

  // State 2 / State 3 -> State 1 (Back to Sleep Orb)
  { phrases: ["go to sleep", "sleep", "hide assistant", "close assistant", "sleep mode", "orb mode"], type: "SLEEP" },

  { phrases: ["pause", "pause listening", "pause cursor"], type: "PAUSE" },
  { phrases: ["resume", "resume listening", "resume cursor"], type: "RESUME" },

  // Help
  { phrases: ["help", "what can i say", "commands", "show commands"], type: "HELP" },
];

export function parseCommand(rawTranscript) {
  if (!rawTranscript) return { type: "EMPTY", payload: "" };

  // Normalize: lowercase, remove punctuation, collapse extra spaces
  let normalized = rawTranscript
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "")
    .replace(/\s+/g, " ");

  // Fix common Web Speech concatenation issues (e.g., "typehow" -> "type how", "typesearch" -> "type search")
  normalized = normalized.replace(/^type([a-z])/i, "type $1");
  normalized = normalized.replace(/^search([a-z])/i, "search $1");
  normalized = normalized.replace(/^click([0-9])/i, "click $1");

  // 1. Direct Target click by digit or number word:
  // e.g. "4", "four", "for", "click 4", "click four", "click on 4", "target 2", "select 3", "#3", "badge 4"
  const clickDigitMatch = normalized.match(/^(?:click\s+on|click|target|press|number|choose|select|badge|button)?\s*(?:number)?\s*#?\s*(\d+)$/);
  if (clickDigitMatch) {
    return { type: "CLICK_TARGET", payload: parseInt(clickDigitMatch[1], 10), raw: rawTranscript };
  }

  const wordNumberMatch = normalized.match(/^(?:click\s+on|click|target|press|number|choose|select|badge|button)?\s*(?:number)?\s*#?\s*([a-z\s-]+)$/);
  if (wordNumberMatch && WORD_TO_NUMBER[wordNumberMatch[1].trim()] !== undefined) {
    return { type: "CLICK_TARGET", payload: WORD_TO_NUMBER[wordNumberMatch[1].trim()], raw: rawTranscript };
  }

  // 2. Direct Search / Google command: "search [query]", "google [query]", "find [query]"
  const searchMatch = normalized.match(/^(?:search for|search|google|find)\s+(.+)$/i);
  if (searchMatch) {
    return { type: "SEARCH_PAGE", payload: searchMatch[1].trim(), raw: rawTranscript };
  }

  // 3. Direct Type command: "type [phrase]", "write [phrase]", "input [phrase]"
  const typeMatch = normalized.match(/^(?:type|write|input)\s+(.+)$/i);
  if (typeMatch) {
    return { type: "TYPE_TEXT", payload: typeMatch[1].trim(), raw: rawTranscript };
  }

  // 4. Exact and phrase matching for built-in commands
  for (const cmd of COMMANDS) {
    for (const phrase of cmd.phrases) {
      if (normalized === phrase || normalized.startsWith(phrase + " ") || normalized.endsWith(" " + phrase) || normalized.includes(" " + phrase + " ")) {
        return { type: cmd.type, payload: phrase, raw: rawTranscript };
      }
    }
  }

  // 5. If not a recognized control command, treat as AI conversational query / assistant prompt
  return { type: "AI_QUERY", payload: normalized, raw: rawTranscript };
}
