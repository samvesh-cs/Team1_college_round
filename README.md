# Handsfree

Handsfree is an accessibility-focused application that helps users interact with webpages using head movements and voice instead of relying entirely on a physical mouse and keyboard.

## Core Features (MVP)

1. **Head-Controlled Cursor** — Move a virtual cursor using webcam-based face tracking.
2. **Voice Navigation** — Use voice commands to navigate the interface and activate supported controls.
3. **Intentional Activation** — Reduce accidental clicks using dwell time or deliberate confirmation.
4. **Voice Typing** — Dictate text into supported input fields using speech recognition.
5. **Quick Calibration** — Calibrate the neutral head position and adjust cursor sensitivity.
6. **Combined Point-and-Voice Interaction** — Point at a target using head movement and activate it with a voice command.

## Additional Features (If Time Permits)

7. **Numbered Targets** — Say “Show targets” and then “Click 3” to select a numbered element.
8. **Adaptive Sensitivity** — Adjust cursor movement and smoothing for better control.
9. **Performance Evaluation** — Evaluate cursor accuracy, responsiveness, and ease of use.

## Future Improvements

10. **Chrome Extension** — Extend controls to compatible websites.
11. **System-Wide Cursor Control** — Control the operating-system mouse using native integration.
12. **User Profiles and Saved Settings** — Store user preferences and calibration settings.

## Tech Stack

### Frontend
- React
- Vite
- JavaScript
- CSS / Tailwind CSS

### Computer Vision and Cursor Control
- MediaPipe Tasks Vision
- Browser Webcam API (`getUserMedia`)
- JavaScript cursor mapping, calibration, dead zones, and smoothing

### Voice Interaction
- Web Speech API
- Speech recognition
- Speech synthesis (optional)

### Backend
- Python
- FastAPI
- Uvicorn
- Pydantic

### API Communication
- Fetch API
- REST APIs
- JSON

### Development Tools
- Git
- GitHub
- VS Code

## Architecture Overview

```text
Handsfree
├── Frontend (React + Vite)
│   ├── Webcam Preview
│   ├── Face Tracking (MediaPipe)
│   ├── Head-Controlled Virtual Cursor
│   ├── Voice Navigation
│   ├── Intentional Activation
│   ├── Voice Typing
│   └── Calibration and Sensitivity Controls
└── Backend (FastAPI + Python)
    ├── Custom REST API Endpoints
    ├── Request Validation
    └── Server-Side Logic
```

## Getting Started

### Prerequisites
- Node.js and npm
- Python 3.10 or newer
- A modern browser
- Webcam and microphone
- Git (optional, for version control)

### Run the Frontend

From the frontend project directory:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in your browser.

### Run the Backend

From the backend directory, create and activate a virtual environment.

**Windows:**

```powershell
python -m venv .venv
.venv\\Scripts\\activate
```

Install dependencies:

```bash
pip install fastapi uvicorn
```

Create `main.py`:

```python
from fastapi import FastAPI

app = FastAPI(title="Handsfree API")

@app.get("/")
def home():
    return {"message": "Handsfree API is running"}
```

Start the development server:

```bash
uvicorn main:app --reload
```

The backend runs at `http://127.0.0.1:8000`.

Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

## Important Notes

- Webcam frames are processed in the browser for the current prototype; they do not need to be sent continuously to the backend.
- FastAPI is used for custom server-side functionality when required.
- Browser support for speech recognition varies.
- The current prototype uses a virtual cursor inside the webpage.
- System-wide mouse control requires additional native integration beyond ordinary browser APIs.
- Keep the MVP focused on reliable head tracking, voice navigation, intentional activation, and voice typing.

## Project Goal

Build a reliable accessibility prototype that lets users navigate webpages using head movements and voice commands, reducing dependence on a physical mouse and keyboard.
