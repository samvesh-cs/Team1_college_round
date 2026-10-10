# Handsfree — Accessibility Through Head and Voice Control

Handsfree is a Chrome browser extension concept that helps people interact with webpages without relying entirely on a physical mouse or keyboard. It combines webcam-based head tracking, voice commands, voice typing, and deliberate activation to make common browser interactions more accessible.

The project is designed as a **Manifest V3 Chrome extension** with a **React + Vite popup interface**. Extension-specific scripts communicate with webpages, while computer-vision and speech features run in the browser whenever possible. A **FastAPI backend is optional** and should only be added for functionality that genuinely needs a server.

> **Prototype scope:** The initial version targets a virtual cursor inside supported webpages. It does not automatically control the operating-system mouse across all applications. Browser and speech-recognition support can vary.

---
> **🤖 AI Context (Current Project Status — Updated 2026-10-10):**
> Phase 0 (Extension Foundation) and Popup UI Polish are **complete**.
>
> **What has been built:**
> - Vite 8.3.4 + React 19 + `@crxjs/vite-plugin` v3 scaffold.
> - **Tailwind CSS v4** with `@tailwindcss/vite` plugin (no `postcss.config.js` or `tailwind.config.js` — those are deprecated and must NOT be re-added).
> - Polished tabbed popup UI (`Controls`, `Calibration`, `Voice Ref`) in [`src/popup/App.jsx`](src/popup/App.jsx).
> - Custom design system via `@theme` block in [`src/popup/styles.css`](src/popup/styles.css) (brand colors, animations, fonts).
> - Shared message protocol in [`src/shared/messages.js`](src/shared/messages.js) — all inter-script communication uses the `MSG` constants.
> - Background worker (`src/background/background.js`) relays popup ↔ content-script messages.
> - Content script (`src/content/content.js`) is a skeleton listener.
> - Extension loads, popup renders with full CSS styling, messaging works end-to-end.
>
> **What is NOT yet implemented (all core features are stubs):**
> - Head tracking / MediaPipe face landmark detection.
> - Voice command recognition / SpeechRecognition API.
> - Dwell activation / target management.
> - Voice typing / dictation mode.
> - Calibration logic (UI exists, but no actual webcam calibration).
> - Settings persistence (`chrome.storage.sync`).
>
> **Next up:** See [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the 4-workstream parallel plan.

---

## Table of contents

- [Project goals](#project-goals)
- [Core features](#core-features)
- [Additional and future features](#additional-and-future-features)
- [How the extension works](#how-the-extension-works)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Project structure](#project-structure)
- [Chrome extension fundamentals](#chrome-extension-fundamentals)
- [Feature implementation details](#feature-implementation-details)
- [Permissions and privacy](#permissions-and-privacy)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Development workflow](#development-workflow)
- [Testing checklist](#testing-checklist)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Project goals

Handsfree aims to:

1. Provide an alternative way to point at and activate webpage controls.
2. Allow users to navigate and interact using spoken commands.
3. Reduce accidental activations through dwell timing or deliberate confirmation.
4. Support dictation into compatible text fields.
5. Let users calibrate and adjust cursor behavior to suit their movement and comfort.
6. Keep the prototype modular so features can be developed and tested independently.

The project should prioritize **reliable core interactions, clear feedback, privacy, and accessibility** over adding many features that are difficult to demonstrate reliably.

## Core features

### 1. Head-controlled virtual cursor

The user enables webcam access and positions their head in a comfortable neutral position. Handsfree tracks facial landmarks and maps head movement to a virtual cursor displayed over a webpage.

Planned behavior:

- Request webcam permission only when the user enables head tracking.
- Detect facial landmarks using MediaPipe Tasks Vision in the browser.
- Use a selected landmark, such as the nose position, as an input signal.
- Record a neutral reference position during calibration.
- Calculate movement relative to the reference position.
- Map movement to the available viewport area.
- Apply sensitivity, a dead zone, and smoothing to reduce jitter.
- Pause tracking when requested and stop camera tracks when tracking is disabled or the feature is shut down.

**Important:** a webpage virtual cursor is not the same as the operating-system pointer. The prototype moves a cursor rendered within a webpage; native mouse control is outside the initial scope.

### 2. Voice navigation

Users can speak supported commands to navigate or interact with a webpage.

Potential commands include:

- “Scroll down”
- “Scroll up”
- “Go to top”
- “Go to bottom”
- “Show targets”
- “Click 3”
- “Start dictation”
- “Stop listening”
- “Pause cursor”
- “Resume cursor”

The exact supported commands should be listed in the UI and documentation and must match the implemented command parser.

Expected flow:

1. The user enables voice control.
2. The browser's speech-recognition interface listens for speech.
3. The recognized phrase is normalized into text.
4. The command parser matches it against supported commands.
5. The appropriate action is called.
6. The UI provides feedback about what was recognized or executed.

Speech recognition is not equally supported in every browser and may rely on a browser-managed online recognition service. Handsfree should not imply that all speech processing is necessarily offline.

### 3. Intentional activation

Head tracking can be imprecise, so moving the cursor over a control should not automatically activate it.

Handsfree can support deliberate activation through:

- **Dwell activation:** keep the cursor over an eligible target for a configurable duration.
- **Voice confirmation:** point at a target and say a supported activation command.
- **Explicit target selection:** show numbered targets and let the user say “Click 3.”

Recommended safeguards:

- Activate a target no more than once per activation attempt.
- Reset dwell progress when the cursor leaves the target.
- Ignore targets that are not eligible for activation.
- Provide visible progress or confirmation feedback.
- Provide a way to pause activation immediately.
- Avoid automatically activating sensitive controls such as payment, deletion, or permission-confirmation actions without an intentional confirmation step.

### 4. Voice typing

Voice typing converts recognized speech into text in supported input fields and text areas.

Expected flow:

1. The user focuses or selects a supported text field.
2. The user starts dictation using the UI or a voice command.
3. Speech recognition produces text.
4. Handsfree inserts the recognized text into the selected field.
5. The user reviews and edits the result before submitting the form.

The implementation must handle React-controlled inputs carefully. Updating only the visible DOM value may not update the application's internal state. Where possible, dispatch compatible input events or use an integration strategy appropriate to the target field.

Voice typing should never submit a form automatically unless the user explicitly requests and confirms that action.

### 5. Quick calibration and cursor settings

Calibration establishes a comfortable neutral head position and helps map movement to cursor movement.

Settings may include:

- Recalibrate neutral position.
- Cursor sensitivity.
- Smoothing strength.
- Dead-zone size.
- Dwell duration.
- Pause and resume controls.

Use sensible defaults. Keep settings understandable and avoid requiring users to adjust many technical parameters before they can try the prototype.

### 6. Combined pointing and voice interaction

The user points with head movement and uses voice to activate the intended target.

For example:

1. The user moves their head until the virtual cursor is over a search field.
2. The user says “Start dictation.”
3. Handsfree starts voice typing in the selected field.
4. The user dictates a search phrase.
5. The user reviews the phrase and says an implemented navigation command or deliberately activates the search button.

This combines pointing and speech instead of relying on either interaction method alone.

## Additional features

### Numbered targets

Handsfree can identify eligible interactive elements and display temporary numbers beside them. A user can then say “Click 3” to select a target.

The implementation should:

- Include only eligible, visible targets.
- Keep target numbers synchronized with the current page state.
- Avoid numbering hidden or disabled controls.
- Provide a clear way to cancel target mode.
- Revalidate the target before activation because pages can change dynamically.

### Adaptive sensitivity

Allow users to adjust how strongly head movement affects cursor movement. Smoothing can reduce jitter, but excessive smoothing adds delay. The goal is a practical balance between precision and responsiveness.

### Performance evaluation

Evaluate the prototype with repeatable tasks rather than relying only on whether the demo appears to work.

Possible measurements:

- Target-selection success rate.
- Time required to select a target.
- Accidental activation count.
- Speech-command recognition success rate.
- Dictation correction rate.
- User-reported comfort and ease of use.

Clearly distinguish measured results from estimates or informal observations.

## Future improvements

- Publish and distribute the extension through an appropriate Chrome extension channel.
- Add saved user profiles and calibration settings, using suitable extension storage.
- Improve support for dynamic webpages and complex interactive controls.
- Add keyboard-accessible settings and comprehensive screen-reader labels.
- Explore an optional native companion application for operating-system-wide cursor control.
- Add more automated tests and compatibility checks.
- Consider an optional FastAPI service if future features require server-side processing.

These are future possibilities, not promises that the initial prototype already supports them.

---

## How the extension works

At a high level, Handsfree contains several separate parts:

1. **Popup interface:** the panel that opens when the user clicks the Handsfree extension icon.
2. **Background service worker:** coordinates extension events and messages when needed.
3. **Content script:** runs in an allowed webpage and manages webpage-level interaction.
4. **Head-tracking module:** processes webcam frames and estimates cursor movement.
5. **Voice module:** recognizes speech and maps phrases to supported commands.
6. **Activation module:** checks whether a target should be activated deliberately.
7. **Shared messaging and settings:** pass messages and configuration between extension components.

### Typical head-cursor flow

1. The user opens the extension popup and enables head tracking.
2. The extension checks whether the feature can run on the current tab.
3. The relevant page-level component starts the camera flow after the user grants permission.
4. MediaPipe estimates facial landmarks from camera frames.
5. Cursor logic compares the current landmark position with the calibrated neutral position.
6. Sensitivity and smoothing are applied.
7. The resulting coordinates are mapped to the webpage viewport.
8. A virtual cursor is rendered and updated.
9. The user pauses tracking, recalibrates, or disables the feature when needed.

The implementation should avoid doing unnecessary work on every animation frame. High-frequency cursor updates may use references and direct style updates where appropriate, while React state can manage lower-frequency UI status such as whether tracking is enabled.

### Typical voice-command flow

1. The user enables voice recognition.
2. The browser supplies a recognized phrase.
3. The command parser normalizes the phrase, for example by trimming whitespace and converting it to lowercase.
4. The parser identifies a supported command.
5. The command handler calls a known action.
6. Handsfree shows status feedback and reports unsupported commands clearly.

Use a defined set of supported commands rather than evaluating arbitrary spoken text as code.

### Typical intentional-activation flow

1. The virtual cursor reaches a point in the viewport.
2. Handsfree checks which element is under that point.
3. The activation module checks whether that element is eligible.
4. Dwell activation tracks how long the cursor remains over the same target, or voice confirmation requests an explicit action.
5. The target is rechecked before activation.
6. The activation runs once and the state is reset.

Browser APIs such as `document.elementFromPoint(x, y)` can identify an element at viewport coordinates. This is useful for webpage-level targeting, but it does not provide unrestricted control over every browser UI element or every page.

---

## Architecture

```text
+------------------------------------------------------+
|                    Chrome Browser                    |
|                                                      |
|  +----------------------+                            |
|  | React Popup          |                            |
|  | Start / Pause        |                            |
|  | Calibration / Config |                            |
|  +-----------+----------+                            |
|              | Extension messages                    |
|              v                                       |
|  +----------------------+                            |
|  | Background Worker    |                            |
|  | Events / Coordination|                            |
|  +-----------+----------+                            |
|              | Extension messages                    |
|              v                                       |
|  +-----------------------------------------------+   |
|  | Content Script / Page-Level Runtime           |   |
|  |                                               |   |
|  |  +----------------+  +---------------------+  |   |
|  |  | Head Tracking  |  | Voice Recognition   |  |   |
|  |  +--------+-------+  +----------+----------+  |   |
|  |           |                     |             |   |
|  |           v                     v             |   |
|  |  +----------------+  +---------------------+  |   |
|  |  | Cursor Logic   |  | Command Parser      |  |   |
|  |  +--------+-------+  +----------+----------+  |   |
|  |           +----------+----------+             |   |
|  |                      v                        |   |
|  |            Activation / Targeting             |   |
|  +-----------------------------------------------+   |
|                                                      |
+------------------------------------------------------+

Optional:
Chrome extension runtime ---- HTTP/JSON ---- FastAPI API
```

### Important architecture considerations

- Chrome extension components do not all run in the same JavaScript environment.
- The popup can close when the user clicks away, so long-running tracking should not depend on popup state remaining mounted.
- A Manifest V3 background service worker can be suspended by Chrome and must not be treated as a permanently running process.
- Content scripts are restricted on certain browser pages, Chrome Web Store pages, and other protected URLs.
- Cross-origin iframes, shadow DOM, and complex webpages may require extra work to support correctly.
- Extension messaging should use a documented message format and validate incoming messages.
- Keep webcam and microphone access user-initiated and explain when they are active.

---

## Technology stack

| Technology | Purpose |
|---|---|
| Chrome Extension Manifest V3 | Declares extension components, permissions, and entry points |
| JavaScript | Core extension and interaction logic |
| React 19 | Popup and settings interface |
| Vite 8.x | Frontend development server and build tooling |
| Tailwind CSS v4 | Utility-first CSS via `@tailwindcss/vite` plugin (no PostCSS config) |
| `@crxjs/vite-plugin` v3 | Chrome extension build integration with HMR |
| MediaPipe Tasks Vision | Face-landmark detection in the browser |
| `navigator.mediaDevices.getUserMedia()` | Requests webcam access |
| Web Speech API | Browser speech recognition and optional speech output |
| HTML and CSS | Popup, virtual cursor, overlays, and status indicators |
| Chrome Extension APIs | Tabs, runtime messaging, storage, and extension events |
| Python + FastAPI | Optional backend API |
| Uvicorn | Runs the FastAPI application |
| Pydantic | Validates API data |
| Fetch API | Makes HTTP requests from extension components where required |
| Git and GitHub | Version control and team collaboration |

### Why process vision in the browser?

For the initial prototype, running MediaPipe in the browser avoids sending webcam frames to a server. This can reduce network overhead and simplify the architecture. Performance still depends on the user's device and the selected model.

### Why is FastAPI optional?

Head tracking, cursor movement, voice recognition, and most webpage interactions can run on the client side. A backend is not automatically necessary just because the project uses a modern stack.

Add FastAPI only when a feature needs server-side work, such as a future service, shared data, or processing that cannot reasonably be performed in the extension. Do not add a database unless a real feature requires persistent structured data.

---

## Project structure

The following is the **recommended target structure**. Create files as features are implemented; do not create empty modules solely to match the tree.

```text
handsfree/
├── public/
│   ├── manifest.json
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
├── src/
│   ├── background/
│   │   └── background.js
│   │
│   ├── content/
│   │   ├── content.js
│   │   ├── cursor/
│   │   │   ├── cursorController.js
│   │   │   ├── faceTracking.js
│   │   │   └── cursorMath.js
│   │   ├── voice/
│   │   │   ├── voiceController.js
│   │   │   └── commandParser.js
│   │   ├── activation/
│   │   │   ├── dwellController.js
│   │   │   └── targetManager.js
│   │   └── styles/
│   │       └── overlay.css
│   │
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   └── components/
│   │       ├── TrackingControls.jsx
│   │       ├── VoiceControls.jsx
│   │       ├── CalibrationPanel.jsx
│   │       └── StatusIndicator.jsx
│   │
│   ├── options/
│   │   ├── index.html
│   │   ├── main.jsx
│   │   └── Options.jsx
│   │
│   ├── shared/
│   │   ├── messages.js
│   │   └── constants.js
│   │
│   ├── services/
│   │   └── apiClient.js
│   │
│   └── styles/
│       └── index.css
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   └── routes/
│   │   ├── core/
│   │   │   └── config.py
│   │   ├── schemas/
│   │   └── services/
│   ├── tests/
│   └── requirements.txt
│
├── tests/
│   ├── unit/
│   └── manual-test-plan.md
│
├── docs/
│   ├── architecture.md
│   └── api-contract.md
│
├── .env.example
├── .gitignore
├── package.json
├── vite.config.js
├── README.md
└── LICENSE
```

### Directory responsibilities

- `public/manifest.json`: the extension manifest copied into the build output.
- `src/background/`: background service worker and extension event coordination.
- `src/content/`: webpage integration, cursor, voice commands, and activation.
- `src/popup/`: React UI shown when the extension icon is clicked.
- `src/options/`: optional full-page settings interface.
- `src/shared/`: message names and constants used across extension components.
- `src/services/`: integrations such as an optional FastAPI client.
- `backend/`: optional Python API, isolated from the extension build.
- `tests/`: unit tests and manual test plans.
- `docs/`: architecture decisions and API documentation.

**Build configuration matters:** Vite's default single-page-app output is not automatically a complete Chrome extension. The build must preserve or generate the manifest and emit separate bundles for the popup, background service worker, and content script. Use an extension-aware Vite setup or configure multiple entry points explicitly. Confirm the final output directory contains every file referenced by `manifest.json`.

---

## Chrome extension fundamentals

### `manifest.json`

The manifest is the configuration file Chrome uses to understand the extension. It declares metadata, permissions, service workers, popup pages, content scripts, icons, and other extension behavior.

A simplified illustrative Manifest V3 example:

```json
{
  "manifest_version": 3,
  "name": "Handsfree",
  "version": "0.1.0",
  "description": "Navigate webpages using head movement and voice.",
  "action": {
    "default_title": "Handsfree",
    "default_popup": "popup/index.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "permissions": [
    "activeTab",
    "storage"
  ],
  "host_permissions": [],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

This example is **illustrative, not a complete ready-to-load configuration**. Paths must match the actual build output. The extension may require additional permissions or host access depending on whether content scripts are injected on demand or declared in the manifest. Request only the permissions that are needed.

### `background.js`

The Manifest V3 background service worker handles extension lifecycle events and coordination. It can:

- Receive messages from the popup or content scripts.
- Coordinate commands for the active tab.
- Handle supported extension events.
- Read or write appropriate extension storage.
- Respond to requests to enable, pause, or stop features.

It should not be used as a permanently running webcam or animation loop. Chrome can suspend it when idle.

### `content.js`

A content script runs in the context of an allowed webpage and can interact with that page's DOM (Document Object Model — the browser's representation of the page's elements).

It can:

- Add and update a virtual cursor overlay.
- Identify elements under the virtual cursor.
- Scroll the page.
- Display numbered target overlays.
- Activate eligible webpage controls after deliberate user input.
- Host or coordinate page-level tracking logic.

A content script cannot directly control Chrome's toolbar, address bar, extension popup after it closes, or arbitrary operating-system applications.

### React popup

The popup is the extension's main control panel. It can display:

- Head-tracking status.
- Voice-recognition status.
- Start, pause, and stop controls.
- Calibration instructions.
- Sensitivity and dwell settings.
- Permission and error messages.

Because the popup can close at any time, it should send commands to the long-lived extension architecture instead of owning all runtime state.

### Extension messaging

Use Chrome extension messaging to coordinate components. A shared message contract makes the implementation easier to maintain.

Example message types:

```js
export const MESSAGE_TYPES = {
  START_TRACKING: "START_TRACKING",
  STOP_TRACKING: "STOP_TRACKING",
  PAUSE_CURSOR: "PAUSE_CURSOR",
  RESUME_CURSOR: "RESUME_CURSOR",
  START_VOICE: "START_VOICE",
  STOP_VOICE: "STOP_VOICE",
  GET_STATUS: "GET_STATUS"
};
```

These names are examples; they must be implemented consistently by the sender and receiver. Validate messages, handle missing tabs and disconnected receivers, and return clear errors instead of assuming that every message succeeds.

---

## Feature implementation details

### Face tracking and cursor mapping

A typical cursor pipeline is:

```text
Webcam frame
    ↓
MediaPipe face-landmark detection
    ↓
Select a stable landmark
    ↓
Compare with calibrated neutral position
    ↓
Apply dead zone and sensitivity
    ↓
Smooth movement
    ↓
Clamp coordinates to viewport bounds
    ↓
Update virtual cursor overlay
```

Key concepts:

- **Landmark:** a point estimated on the face, such as the nose.
- **Calibration:** recording a reference position to make movement relative to the user's natural posture.
- **Dead zone:** a small region where minor movement does not move the cursor.
- **Smoothing:** reducing rapid changes that cause cursor jitter.
- **Viewport:** the visible portion of a webpage inside the browser window.

A simple conceptual mapping is:

```js
const deltaX = currentX - neutralX;
const deltaY = currentY - neutralY;

const cursorX = clamp(
  viewportCenterX + deltaX * sensitivityX,
  0,
  viewportWidth - 1
);

const cursorY = clamp(
  viewportCenterY + deltaY * sensitivityY,
  0,
  viewportHeight - 1
);
```

This is explanatory pseudocode, not a complete tracking implementation. Coordinate direction, normalization, camera mirroring, and sensitivity need to be verified in the actual implementation.

### Virtual cursor overlay

The virtual cursor should be visually distinct and should not block the page from receiving intended pointer interactions.

Implementation considerations:

- Use a fixed-position overlay for viewport-relative coordinates.
- Consider `pointer-events: none` for the cursor graphic itself.
- Keep the cursor visible against different backgrounds.
- Show a clear state when tracking is paused or face detection is lost.
- Remove event listeners, animation loops, and camera tracks when stopping the feature.
- Avoid unnecessary React re-renders for every tiny cursor movement.

### Voice command parsing

Keep recognition separate from command interpretation. A parser should map known phrases to known actions.

Conceptual example:

```js
function normalizeCommand(transcript) {
  return transcript.trim().toLowerCase();
}

function parseCommand(transcript) {
  const command = normalizeCommand(transcript);

  if (command === "scroll down") {
    return { type: "SCROLL_DOWN" };
  }

  if (command === "scroll up") {
    return { type: "SCROLL_UP" };
  }

  if (command === "pause cursor") {
    return { type: "PAUSE_CURSOR" };
  }

  return { type: "UNKNOWN" };
}
```

A production implementation should also handle recognition errors, repeated results, partial transcripts, language settings, and unsupported browsers. Never interpret arbitrary speech as JavaScript or execute spoken text as code.

### Target selection and activation

`document.elementFromPoint(x, y)` can identify the topmost element at viewport coordinates. The result might be a nested element inside a button or link, so the implementation may need to find an appropriate eligible ancestor.

Before activating a target:

1. Verify that the target is still connected to the document.
2. Verify that it is visible and enabled.
3. Determine whether the target is eligible for activation.
4. Confirm the user's intent through the chosen activation mechanism.
5. Activate at most once for that interaction.
6. Reset the activation state and provide feedback.

Webpages can change between target detection and activation. Recheck targets rather than storing an element indefinitely.

### Voice typing

Voice typing should distinguish between ordinary navigation commands and dictation text. While dictation is active, spoken words should normally be inserted into the selected text field rather than interpreted as navigation commands.

The implementation should provide clear controls to start and stop dictation, show the recognized text, and allow correction before form submission. Support for custom web applications and controlled fields may vary.

### Settings and persistence

If the project needs to remember sensitivity, dwell duration, or other preferences, Chrome's storage APIs can persist extension settings. Store only what is needed, validate stored values, and define defaults for missing or invalid settings.

Camera and microphone access should not be silently started just because a setting was loaded.

---

## Permissions and privacy

Permissions should be limited to what the extension needs.

Potential capabilities include:

- `activeTab`: temporary access to a tab after a user action, for supported interactions.
- `storage`: persist settings.
- `scripting`: inject scripts programmatically, if that architecture is chosen.
- Host permissions or declared content-script matches: access specific webpages, depending on the chosen design.

Do not add every possible permission in advance. Verify each permission against the implementation and explain why it is needed.

### Webcam and microphone

- Ask for camera access when the user enables head tracking.
- Ask for microphone access when the user enables voice features.
- Display clear indicators when either feature is active.
- Stop camera tracks when tracking ends.
- Handle permission denial without crashing the extension.
- Explain whether speech recognition may use a browser-managed online service.
- Do not upload camera frames or recognized text to a backend unless the feature explicitly requires it and the user is informed.

### Data handling

The initial prototype should avoid collecting personal data or transmitting webcam frames to a server. If future features store profiles or usage measurements, document what is collected, why it is collected, where it is stored, and how the user can clear it.

---

## Prerequisites

Install the tools needed for the part of the project you are working on:

- Google Chrome or another compatible Chromium-based browser.
- Node.js LTS and npm.
- Git.
- A webcam and microphone for testing head and voice features.
- Python 3.10 or later only if working on the optional FastAPI backend.
- A code editor such as Visual Studio Code.

Check installations:

```bash
node --version
npm --version
git --version
python --version
```

The exact versions should be verified against the project's dependencies.

---

## Getting started

### 1. Clone the repository

```bash
git clone <repository-url>
cd handsfree
```

Replace `<repository-url>` with the actual repository URL.

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Run the development build

```bash
npm run dev
```

The Vite development server is useful for developing the popup UI. It does **not by itself guarantee that the project is a valid Chrome extension**. The extension's manifest, background worker, and content scripts must also be built to the configured extension output directory.

### 4. Build the extension

```bash
npm run build
```

After building, verify that the output directory (for example, `dist/`) contains:

- `manifest.json`
- The popup HTML and its bundled assets.
- The background service worker bundle at the path declared in the manifest.
- The content script bundle at the path declared in the manifest, if used.
- Referenced icons and other static resources.

The exact build commands depend on the project's Vite configuration. Update `package.json` scripts and this section to match the real repository before treating these commands as final.

### 5. Load the unpacked extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the built extension directory that contains `manifest.json`.
5. Pin Handsfree to the toolbar if desired.
6. Open a normal webpage that the extension is allowed to access.
7. Click the Handsfree icon and test the available controls.

If you change the manifest, background worker, or build output, rebuild and reload the extension. Some changes can be applied by reloading the extension, but active tabs may need refreshing.

### 6. Run the optional FastAPI backend

Only do this if the repository actually includes a backend feature that needs it.

Create a virtual environment:

**Windows PowerShell**

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**macOS/Linux**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run the server if the app entry point is `app/main.py`:

```bash
uvicorn app.main:app --reload
```

FastAPI's interactive API documentation is typically available at:

```text
http://127.0.0.1:8000/docs
```

If the backend is not needed by the current prototype, skip this section. Do not create an API just to make the project appear more complex.

---

## Development workflow

### Recommended feature order

1. Establish a valid Manifest V3 extension that loads in Chrome.
2. Build the React popup and extension build pipeline.
3. Implement popup-to-background/content-script messaging.
4. Render a virtual cursor on an allowed webpage.
5. Add webcam permission handling and face tracking.
6. Add calibration, smoothing, sensitivity, and pause/resume.
7. Add voice recognition and a small, clearly documented command set.
8. Add deliberate activation and safeguards.
9. Add voice typing to supported text fields.
10. Add numbered targets and optional performance measurements.
11. Add the FastAPI backend only if a concrete requirement emerges.

Keep each step independently testable. A working basic extension is a better foundation than many unfinished features.

### Git workflow

Use descriptive branches and small commits. For example:

```bash
git switch -c feature/virtual-cursor
git add .
git commit -m "feat: add webpage virtual cursor"
git push -u origin feature/virtual-cursor
```

Example commit prefixes:

- `feat:` new functionality.
- `fix:` bug fix.
- `docs:` documentation changes.
- `refactor:` code restructuring without intended behavior change.
- `test:` add or update tests.
- `chore:` tooling and maintenance.

Avoid committing `.env` files, credentials, dependency folders, build artifacts that are excluded by the project's workflow, or personal test recordings.

---

## Testing checklist

### Extension loading

- [ ] The extension loads without manifest errors.
- [ ] Every manifest path exists in the built output.
- [ ] The popup opens and its controls render.
- [ ] The background service worker has no unexpected errors.
- [ ] Content scripts work on permitted webpages.
- [ ] Protected browser pages are handled gracefully.

### Head tracking

- [ ] Camera permission is requested at the appropriate time.
- [ ] Permission denial is handled.
- [ ] Face detection starts and stops reliably.
- [ ] Calibration works from a comfortable neutral position.
- [ ] Sensitivity changes movement as expected.
- [ ] Smoothing reduces jitter without excessive delay.
- [ ] Tracking pauses and resumes reliably.
- [ ] Camera tracks stop when tracking is disabled.
- [ ] Cursor coordinates remain inside viewport bounds.
- [ ] Face loss does not cause unexpected cursor jumps.

### Voice navigation and typing

- [ ] Unsupported speech-recognition environments show a helpful message.
- [ ] Start and stop controls work.
- [ ] Supported commands trigger the correct actions.
- [ ] Unknown commands do not trigger actions.
- [ ] Repeated recognition results do not duplicate actions.
- [ ] Dictation text is inserted into the intended field.
- [ ] Navigation commands are not accidentally processed as dictation.
- [ ] Forms are not submitted without deliberate user action.

### Intentional activation

- [ ] Dwell progress resets when leaving a target.
- [ ] One dwell produces no more than one activation.
- [ ] Disabled and hidden controls are not activated.
- [ ] The target is rechecked before activation.
- [ ] Pause controls stop activation immediately.
- [ ] Destructive or sensitive actions require deliberate confirmation.

### Privacy and performance

- [ ] Camera and microphone status is visible to the user.
- [ ] Camera access stops when tracking ends.
- [ ] No webcam frames are sent to a server unintentionally.
- [ ] The extension remains responsive during cursor updates.
- [ ] CPU usage is reasonable on the target development laptop.
- [ ] Stored settings have sensible defaults and can be reset.

---

## Known limitations

- **Virtual cursor only:** the initial version interacts within supported webpages and does not control the system mouse across all applications.
- **Browser restrictions:** extension scripts cannot run on every browser page or protected URL.
- **Speech recognition:** availability, language support, accuracy, and privacy behavior depend on the browser and its implementation.
- **Webpage compatibility:** custom controls, cross-origin frames, shadow DOM, and dynamically changing pages may need additional handling.
- **Computer-vision performance:** lighting, camera position, face visibility, device performance, and model choice affect tracking.
- **Popup lifecycle:** the popup can close when focus changes, so it must not be the only place where persistent interaction logic runs.
- **Backend is optional:** the initial client-side functionality does not inherently require FastAPI or a database.
- **Accessibility is iterative:** the interface should be tested with intended users and refined based on observed barriers.

## Troubleshooting

### The extension does not load

- Check the error displayed on `chrome://extensions`.
- Verify that `manifest.json` is valid JSON.
- Verify that all paths referenced by the manifest exist in the built directory.
- Rebuild the extension and load the directory containing the generated manifest.

### The popup opens but the page does not respond

- Confirm the current page allows extension scripts.
- Refresh the page after reloading the extension.
- Inspect the page's DevTools console.
- Inspect the extension service worker console from `chrome://extensions`.
- Check that the popup sends the correct message and the receiving script handles it.

### The webcam does not start

- Confirm the user granted camera permission.
- Ensure another application is not exclusively using the camera.
- Check for errors from `getUserMedia()` or MediaPipe model loading.
- Confirm model and WASM asset URLs resolve correctly and are served with appropriate MIME types.
- Test on a supported browser and a normal webpage.

### Voice commands do not work

- Confirm the browser supports the speech-recognition implementation being used.
- Check microphone permission and operating-system microphone settings.
- Test a simple command first.
- Log recognized transcripts and parser results during development, without logging unnecessary personal information.
- Ensure duplicate or interim recognition results do not execute commands multiple times.

### The cursor jitters or moves in the wrong direction

- Recalibrate while sitting in a comfortable, neutral position.
- Check whether the video preview is mirrored and whether the coordinate mapping accounts for it.
- Adjust sensitivity, dead zone, and smoothing.
- Confirm coordinates are normalized consistently before mapping them to viewport pixels.

---

## Roadmap

### Phase 1 — Extension foundation ✅

- [x] Valid Manifest V3 extension.
- [x] React + Vite popup.
- [x] Background/content messaging.
- [x] Polished tabbed popup UI (Controls, Calibration, Voice Ref).
- [x] Tailwind CSS v4 integration (`@tailwindcss/vite`).
- [x] Shared message protocol (`src/shared/messages.js`).
- [ ] Virtual cursor overlay on supported webpages.

### Phase 2 — Head control

- [ ] MediaPipe face tracking.
- [ ] Calibration.
- [ ] Sensitivity and smoothing.
- [ ] Pause/resume and camera cleanup.

### Phase 3 — Voice and activation

- [ ] Voice navigation.
- [ ] Voice typing.
- [ ] Dwell or voice-confirmed activation.
- [ ] Combined head pointing and voice activation.

### Phase 4 — Refinement

- [ ] Numbered targets.
- [ ] Better error handling and status feedback.
- [ ] Accessibility and usability testing.
- [ ] Performance evaluation and documentation.

### Phase 5 — Future exploration

- [ ] Saved settings and profiles.
- [ ] Broader webpage compatibility.
- [ ] Optional FastAPI service if justified.
- [ ] Explore a native companion for system-wide cursor control.

> **For the detailed, parallelized 4-workstream implementation plan, see [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).**

Update the checkboxes only when the corresponding feature has been implemented and tested.

---

## Contributing

Contributions should be small, focused, and easy to review.

1. Discuss or document the issue being addressed.
2. Create a feature or fix branch.
3. Follow the existing directory responsibilities.
4. Keep extension permissions minimal.
5. Test the feature on a supported webpage.
6. Update documentation when behavior or commands change.
7. Open a pull request with a concise summary and testing notes.

For a team project, agree on shared message types, component ownership, and API contracts before parallel development.

## License

Add the license chosen by the project maintainers in `LICENSE`. Until a license is selected, do not assume the repository grants permissions beyond those provided by applicable law.

---

## Official references

- [Chrome Extensions — Get started](https://developer.chrome.com/docs/extensions/get-started)
- [Manifest V3 overview](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome extension manifest](https://developer.chrome.com/docs/extensions/reference/manifest)
- [Chrome extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
- [Chrome extension content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome extension permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [FastAPI documentation](https://fastapi.tiangolo.com/)
- [Vite documentation](https://vite.dev/)

---

**Handsfree is intended to make webpage interaction more accessible by combining head movement, speech, and deliberate activation. The priority is a dependable, privacy-conscious prototype that can grow into a more capable extension through measured improvements.**
