# Handsfree — Accessibility Through Head Tracking & AI Voice Control

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![React 19](https://img.shields.io/badge/React-19.3-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4.3-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![MediaPipe](https://img.shields.io/badge/Google_MediaPipe-Tasks_Vision-FF6F00?logo=google&logoColor=white)](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
[![License](https://img.shields.io/badge/License-ISC-green.svg)](LICENSE)

**Handsfree** is a Chrome browser extension that empowers individuals with motor disabilities, ALS, cerebral palsy, or severe repetitive strain injuries (RSI) to browse and interact with any webpage completely hands-free. 

By combining **on-device MediaPipe facial landmark tracking**, an **instantaneous (<100ms) AI voice navigation engine**, **numbered DOM target indexing**, and an **Intent-Lock radial dwell clicker**, Handsfree eliminates the need for physical mice, keyboards, or $1,500+ specialized eye-tracking hardware.

---

## Table of Contents

- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Technical Implementation Deep Dive](#technical-implementation-deep-dive)
  - [1. Head Tracking & Mathematical Transformation](#1-head-tracking--mathematical-transformation)
  - [2. Sub-100ms Voice Recognition & 3-State AI Agent](#2-sub-100ms-voice-recognition--3-state-ai-agent)
  - [3. Numbered Target Indexing (#1 to #60)](#3-numbered-target-indexing-1-to-60)
  - [4. Intent Lock & Radial Dwell Activation](#4-intent-lock--radial-dwell-activation)
  - [5. Cross-Script Message Architecture](#5-cross-script-message-architecture)
- [Voice Command Reference](#voice-command-reference)
- [Repository Structure](#repository-structure)
- [Getting Started & Installation](#getting-started--installation)
- [Performance & Safety Safeguards](#performance--safety-safeguards)
- [Future Roadmap: Audio-First for Blind Users](#future-roadmap-audio-first-for-blind-users)
- [License](#license)

---

## Key Features

- **Webcam-Based Head Pointer:** Real-time head tracking via 478-point 3D facial mesh running locally in the browser via WebAssembly. Uses nose landmark projection mapped to viewport pixel coordinates.
- **Sub-100ms Fast-Path Voice Recognition:** Dispatches single-intent commands (scroll, click, reload, sleep) on the very first interim speech token without waiting for sentence pauses.
- **3-State Holographic AI Voice Assistant:**
  - *State 1 (Celestial Sleep Orb):* 48px glowing ambient cyan corona docked at screen corner with minimal DOM footprint.
  - *State 2 (Slim Equalizer Dock Bar):* Horizontal floating pill bar with active CSS soundwave equalizer, interim speech preview, and quick controls.
  - *State 3 (Expanded Glassmorphic Chat Window):* Full conversational history window with audit tags, timestamps, and manual text input.
- **Numbered Target Indexing (`"show targets"`):** Dynamically scans visible interactive elements (`<a>`, `<button>`, `<input>`, dropdowns) and renders high-contrast turquoise badges (#1 to #60) for instant spoken selection (`"click 4"`).
- **Radial Dwell Activation:** Hover over an interactive element to start a 1200ms SVG countdown circle; auto-clicks upon completion. Protected by an **Intent Lock** cooldown to prevent accidental clicks.
- **Context-Aware Dictation:** Automatically detects input focus on search bars, forms, or `contenteditable` elements, switching seamlessly from command listening to continuous dictation.
- **Calibration Studio:** Interactive multi-sample neutral point recording and live sliders for sensitivity, smoothing, and dead-zone tuning.

---

## System Architecture

Handsfree is built strictly under **Manifest V3**, decoupling presentation, extension lifecycle, and page-level DOM execution across isolated JavaScript runtimes.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CHROME BROWSER ENVIRONMENT                       │
│                                                                             │
│  ┌─────────────────────────┐                 ┌───────────────────────────┐  │
│  │   React 19 Popup UI     │                 │   Background Service      │  │
│  │   (Tailwind CSS v4)     │                 │   Worker (MV3 Relay)      │  │
│  │                         │                 │                           │  │
│  │ • Engine Start / Stop   │◄─── chrome. ───►│ • Message Dispatcher      │  │
│  │ • Calibration Sliders   │     runtime     │ • Tab Focus Arbitration   │  │
│  │ • Voice & Dwell Config  │                 │ • Storage State Sync      │  │
│  └─────────────────────────┘                 └─────────────┬─────────────┘  │
│                                                            │                │
│                                                    chrome.tabs.sendMessage  │
│                                                            │                │
│                                                            ▼                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              Webpage Context (Content Script Runtime)                 │  │
│  │                                                                       │  │
│  │  ┌──────────────────────┐  ┌─────────────────────┐  ┌──────────────┐  │  │
│  │  │  CursorController    │  │   VoiceController   │  │   Dwell &    │  │  │
│  │  │  & MediaPipe Vision  │  │   & 3-State Agent   │  │ TargetManager│  │  │
│  │  └──────────┬───────────┘  └──────────┬──────────┘  └──────┬───────┘  │  │
│  │             │                         │                    │          │  │
│  │             ▼                         ▼                    ▼          │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │              Webpage DOM & Synthetic Event Dispatch             │  │  │
│  │  │  • Virtual Cursor Overlay     • Turquoise Badges (#1 to #60)    │  │  │
│  │  │  • Smooth Page Scroller       • Form Inputs / Synthetic Clicks  │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Extension Framework** | Chrome Manifest V3 | MV3 | Secure, sandboxed extension specification with service-worker lifecycle |
| **UI Library** | React | `19.3.0` | Declarative popup interface, responsive controls, and calibration studio |
| **Build & Tooling** | Vite + `@crxjs/vite-plugin` | `8.3.4` / `3.0.0` | Ultra-fast HMR, multi-entry asset bundling, and extension package generation |
| **Styling & Design** | Tailwind CSS | `4.3.3` | Modern utility styling via `@tailwindcss/vite` (zero legacy PostCSS) |
| **Computer Vision** | `@mediapipe/tasks-vision` | `1.1.0` | WebAssembly-accelerated 478-point facial landmark mesh detection |
| **Speech Recognition** | Web Speech API | Native | Continuous speech-to-text with interim streaming and zero network payload |
| **Speech Synthesis** | Web SpeechSynthesis | Native | Spoken confirmation audio feedback (TTS) with acoustic loop suppression |
| **Persistence** | Chrome Storage API | `chrome.storage.local` | Cross-session synchronization of sensitivity, dwell, and calibration settings |

---

## Technical Implementation Deep Dive

### 1. Head Tracking & Mathematical Transformation

Located in `src/content/cursor/`:
- **Landmark Extraction (`faceTracking.js`):** Queries user webcam via `getUserMedia()`. Feeds video frames at 60 FPS into `@mediapipe/tasks-vision`'s `FaceLandmarker`. Landmark `#1` (nose tip) is extracted from the 478-point 3D mesh.
- **Delta Calculation (`cursorMath.js`):** Computes difference between current position and calibrated neutral reference:
  $$\Delta x = -(x_{\text{current}} - x_{\text{neutral}}), \quad \Delta y = y_{\text{current}} - y_{\text{neutral}}$$
  *(X-axis is inverted to mirror natural head movements)*.
- **Continuous Dead Zone:** Suppresses resting physiological micro-tremors without abrupt velocity cliffs:
  $$f(\Delta, d) = \begin{cases} 0 & \text{if } |\Delta| \le d \\ \text{sign}(\Delta) \cdot \frac{|\Delta| - d}{1 - d} & \text{if } |\Delta| > d \end{cases}$$
- **Exponential Moving Average (EMA) Smoothing:**
  $$P_t = \alpha \cdot P_{t-1} + (1 - \alpha) \cdot P_{\text{raw}}$$
  Eliminates high-frequency camera noise while keeping latency under 16ms.
- **Direct DOM Manipulation:** Bypasses React state loops. Writes directly to `element.style.left` and `element.style.top` inside `requestAnimationFrame` to maintain 60 FPS.

### 2. Sub-100ms Voice Recognition & 3-State AI Agent

Located in `src/content/voice/`:
- **Fast-Path Interim Stream Token Processing (`voiceController.js`):**
  - Listens via continuous `SpeechRecognition` with `interimResults = true`.
  - Distinguishes **instant single-intent commands** (`"scroll down"`, `"click"`, `"go back"`) from multi-word commands (`"search [query]"`).
  - Evaluates interim tokens instantly, firing DOM actions **within 100ms** of the user finishing a syllable.
- **Buffer Flush & Memory Leak Prevention:**
  - Chrome's internal Web Speech pipeline degrades and leaks audio buffers after consecutive calls.
  - Automatically flushes and re-instantiates `SpeechRecognition` every 5 executed commands, keeping recognition snappy.
- **Acoustic Echo Rejection:**
  - Calling TTS audio risks the microphone picking up computer speakers.
  - Instantly calls `recognition.abort()` when TTS starts speaking, enforces a 350ms acoustic dissipation margin, and discards any transcript matching recently spoken TTS strings.
- **Synthetic Mouse Dispatch:**
  - Uses `document.elementFromPoint(x, y)` to traverse down to the nearest actionable element (`<a>`, `<button>`, `<input>`).
  - Dispatches full event lifecycle (`mousedown` $\rightarrow$ `mouseup` $\rightarrow$ `click`).
  - For inputs, calls native prototype setters (`HTMLInputElement.prototype.value`) so React and Vue controlled state trackers register the change.

### 3. Numbered Target Indexing (#1 to #60)

Located in `src/content/activation/targetManager.js`:
- Upon hearing `"show targets"` or `"numbers"`, queries the active viewport for interactive tags:
  ```js
  'a[href], button:not([disabled]), input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [contenteditable="true"]'
  ```
- Evaluates `getBoundingClientRect()` to filter out off-screen, hidden, or zero-dimension nodes.
- Injects up to 60 high-visibility turquoise badges (`#0d9488`, z-index `2147483646`) positioned at the top-left corner of each element.
- Speaking any number (`"4"`, `"twenty-one"`, or `"click 4"`) triggers an immediate synthetic click on that target and hides badges.

### 4. Intent Lock & Radial Dwell Activation

Located in `src/content/activation/dwellController.js`:
- Tracks cursor intersection with interactive elements.
- When hovering over an eligible target, attaches an SVG circular countdown ring (`radius: 18px`, `stroke-dashoffset` interpolation).
- If the cursor stays within the element bounding box for the duration (`1200ms` default), triggers a click.
- Enforces an **Intent Lock 500ms cooldown** post-activation, resetting dwell accumulation when the cursor leaves to prevent accidental re-triggers.

### 5. Cross-Script Message Architecture

Located in `src/shared/messages.js`:

| Message Constant | Direction | Functionality |
| :--- | :--- | :--- |
| `MSG.START_TRACKING` / `STOP_TRACKING` | Popup $\rightarrow$ Content | Starts/terminates MediaPipe camera pipeline and overlay |
| `MSG.PAUSE_CURSOR` / `RESUME_CURSOR` | Popup $\rightarrow$ Content | Freezes virtual cursor coordinates without dropping camera |
| `MSG.START_VOICE` / `STOP_VOICE` | Popup $\rightarrow$ Content | Toggles Web Speech recognition session |
| `MSG.CALIBRATE` | Popup $\rightarrow$ Content | Launches interactive calibration studio overlay |
| `MSG.SHOW_TARGETS` / `HIDE_TARGETS` | Voice/Popup $\rightarrow$ Content | Toggles numbered badges on interactive DOM elements |
| `MSG.CLICK_TARGET` | Voice $\rightarrow$ Content | Simulates click on target by numerical ID |
| `MSG.UPDATE_SETTINGS` | Popup $\rightarrow$ Content/Storage | Updates sensitivity, dead-zone, and dwell configurations |
| `MSG.VOICE_YIELD` / `VOICE_RESUME` | Tab $\rightarrow$ Background | Arbitrates microphone access to active tab on tab switch |

---

## Voice Command Reference

Handsfree supports natural phrase variations and direct number matching:

### Viewport & Navigation
| Commands | Action |
| :--- | :--- |
| `"scroll down"`, `"page down"`, `"down"` | Smooth scrolls down by 65% of viewport |
| `"scroll up"`, `"page up"`, `"up"` | Smooth scrolls up by 65% of viewport |
| `"go to top"`, `"top"`, `"home"` | Smooth scrolls to top of page (`scrollTop = 0`) |
| `"go to bottom"`, `"bottom"`, `"end"` | Smooth scrolls to page footer |
| `"go back"`, `"back"` | Navigates back in browser history |
| `"go forward"`, `"forward"` | Navigates forward in browser history |
| `"reload"`, `"refresh"` | Reloads the active page |

### Target Clicking & Selection
| Commands | Action |
| :--- | :--- |
| `"show targets"`, `"show numbers"` | Injects high-contrast numbered badges over clickable elements |
| `"hide targets"`, `"hide numbers"` | Dismisses target badges |
| `"[number]"` *(e.g. `"4"`, `"21"`)*, `"click [number]"` | Clicks target element by digit or spoken word |
| `"click"`, `"tap"` | Simulates mouse click at virtual cursor position |
| `"double click"` | Dispatches double-click event at cursor position |

### Search, Typing & Forms
| Commands | Action |
| :--- | :--- |
| `"search [query]"`, `"google [query]"` | Fills search box or opens Google Search |
| `"search"`, `"find"` *(bare)* | Focuses on-page search bar and activates dictation |
| `"type [phrase]"`, `"write [phrase]"` | Types phrase into active input or search bar |
| `"start dictation"`, `"start typing"` | Enters continuous dictation mode |
| `"stop dictation"`, `"done"` | Exits dictation mode and returns to command mode |
| `"press enter"`, `"submit"` | Submits active form or triggers Enter key event |
| `"press tab"`, `"next field"` | Advances focus to next interactive element |
| `"clear"`, `"clear text"` | Wipes content in active text field |
| `"escape"`, `"cancel"` | Blurs focus from current input |

### Assistant 3-State Controls
| Commands | Action |
| :--- | :--- |
| `"wake up"`, `"open bar"` | Expands from State 1 (Sleep Orb) to State 2 (Dock Bar) |
| `"expand more"`, `"show chat"` | Expands from State 2 (Dock Bar) to State 3 (Full Chat Window) |
| `"collapse chat"` | Minimizes from State 3 back to State 2 (Dock Bar) |
| `"sleep"`, `"orb mode"` | Minimizes assistant to State 1 (Celestial Sleep Orb) |
| `"calibrate"` | Centers cursor and opens calibration overlay |
| `"pause"` / `"resume"` | Halts or resumes speech listening |
| `"help"`, `"commands"` | Prints voice command reference cheat sheet |

---

## Repository Structure

```text
Team1_college_round/
├── public/
│   └── icons/                 # Extension PNG icons (16, 48, 128)
├── src/
│   ├── manifest.json          # Manifest V3 extension configuration
│   ├── background/
│   │   └── background.js      # Service worker message relay & tab arbitrator
│   ├── content/
│   │   ├── content.js         # Master content script orchestrator
│   │   ├── cursor/
│   │   │   ├── faceTracking.js     # MediaPipe FaceLandmarker lifecycle
│   │   │   ├── cursorMath.js       # Dead-zone, smoothing, and delta math
│   │   │   └── cursorController.js # Cursor DOM injection & frame loop
│   │   ├── voice/
│   │   │   ├── commandParser.js    # Regex & keyword command parser
│   │   │   ├── voiceController.js  # Web Speech STT/TTS engine & click synthesis
│   │   │   ├── aiVoiceAgent.js     # 3-State Assistant (Orb, Dock, Chat)
│   │   │   ├── targetManager.js    # Numbered DOM element badges (#1-#60)
│   │   │   └── voiceOverlay.js     # On-screen HUD command flash notification
│   │   ├── activation/
│   │   │   ├── dwellController.js  # Radial countdown dwell timer
│   │   │   └── targetManager.js    # Target eligibility validator
│   │   ├── calibration/
│   │   │   └── calibrationOverlay.js # Multi-point calibration studio
│   │   └── styles/
│   │       ├── overlay.css         # Virtual cursor overlay styling
│   │       ├── voice-overlay.css   # Voice HUD badge styling
│   │       ├── activation-overlay.css # SVG dwell progress styling
│   │       ├── calibration-overlay.css # Calibration UI styling
│   │       └── ai-agent.css        # 3-State assistant (Orb, Dock, Glassmorphic Chat)
│   ├── popup/
│   │   ├── index.html         # Extension popup HTML entry
│   │   ├── main.jsx           # React root mount
│   │   ├── App.jsx            # Tabbed popup interface (Controls, Calibration, Voice)
│   │   └── styles.css         # Popup styles with Tailwind CSS v4
│   └── shared/
│       ├── constants.js       # System defaults (sensitivity, smoothing, dwell)
│       ├── messages.js        # Strongly typed MSG constants
│       └── settings.js        # Chrome storage validation & retrieval
├── tests/
│   ├── test-cursorMath.js     # Mathematical unit tests
│   ├── test-cursorController.html # Interactive cursor controller test runner
│   └── test-faceTracking.html # MediaPipe camera tracking verification
├── package.json               # Node dependencies and scripts
└── vite.config.js             # Vite + CRXJS plugin configuration
```

---

## Getting Started & Installation

### Prerequisites
- Node.js `v18.0.0` or higher
- npm `v9.0.0` or higher
- Google Chrome or Chromium browser (`v116+` recommended for full Manifest V3 support)
- Functional webcam and microphone

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/samvesh-cs/Team1_college_round.git
cd Team1_college_round
npm install
```

### 2. Build the Extension
```bash
npm run build
```
The production bundle is compiled into the `dist/` directory.

### 3. Load into Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `dist/` folder inside the `Team1_college_round` repository.
5. Pin **Handsfree** to your Chrome toolbar.

### 4. Running Development with Live Reload
```bash
npm run dev
```
Vite with `@crxjs/vite-plugin` automatically triggers Hot Module Replacement (HMR) across popup and content scripts upon file modification.

### 5. Running Automated Tests
```bash
npm test
```
Executes cursor transformation mathematics, dead-zone verification, and storage tests.

---

## Performance & Safety Safeguards

1. **Zero External Frame Streaming (Privacy First):** Webcam video frames are processed exclusively inside WebAssembly memory buffers in the user's browser. No images, video streams, or facial landmarks are ever transmitted to a server.
2. **Tab Yielding:** Content scripts listen to `document.visibilitychange`. Background tabs automatically pause speech recognition to eliminate CPU usage and surrender the microphone to the foreground tab.
3. **Intent Lock Protection:** Dwell activation features an automatic 500ms cooldown timer to prevent accidental double-clicks on sensitive controls (such as payment submissions or destructive buttons).
4. **Memory Guard:** Cleans up animation frame loops, removes listeners, and closes camera tracks immediately whenever the engine is stopped.

---

## Future Roadmap: Audio-First for Blind Users

While Handsfree currently empowers individuals with motor disabilities, our planned architecture expands accessibility to **blind and low-vision individuals**:

- **Conversational Intent Navigation:** Replace visual DOM inspection with an on-device Small Language Model (SLM) parsing the Accessibility Tree (`AXTree`). Users can ask: *"What are the primary actions on this page?"* and receive a concise spoken summary (*"1. Add to cart, 2. View customer reviews"*).
- **3D Spatial Audio Radar:** Using the Web Audio API, map head orientation to spatial sound. Moving the head left/right pans sound across stereo channels; moving up/down changes audio pitch. Users can "hear" the layout of the webpage.
- **Multimodal AI Image Descriptions:** On-device vision model captures uncaptioned graphics or charts on demand and reads natural, context-aware descriptions aloud.

---

## License

This project is licensed under the **ISC License**. See the `LICENSE` file for details.
