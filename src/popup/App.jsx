import React from "react";
import { MSG } from "../shared/messages.js";

function send(type) {
  chrome.runtime.sendMessage({ type });
}

export default function App() {
  return (
    <div className="popup">
      <h1>Handsfree</h1>
      <p>Head & Voice Accessibility</p>
      <button onClick={() => send(MSG.START_TRACKING)}>Start Tracking</button>
      <button onClick={() => send(MSG.STOP_TRACKING)}>Stop Tracking</button>
    </div>
  );
}
