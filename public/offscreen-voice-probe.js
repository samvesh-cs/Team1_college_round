// Handsfree Stage-0 voice probe logic (isolated diagnostics, removable).
// External file (not inline) so it satisfies the MV3 extension-pages
// Content Security Policy (script-src 'self'). Loaded only by
// public/offscreen-voice-probe.html; delete both files to remove the probe.
var state = {
  recognition: null,
  listening: false,
  mic: "unknown",
  hasApi: false,
  transcripts: [],
  errors: [],
  startedAt: null,
};

function logLine(text) {
  var log = document.getElementById("log");
  var line = new Date().toISOString() + " " + text + "\n";
  log.textContent += line;
  console.log("[VoiceProbe]", text);
}

function render() {
  document.getElementById("status").textContent =
    "listening=" + state.listening + " mic=" + state.mic +
    " api=" + state.hasApi + " transcripts=" + state.transcripts.length;
}

function snapshot(note) {
  return {
    note: note,
    listening: state.listening,
    mic: state.mic,
    hasApi: state.hasApi,
    transcriptCount: state.transcripts.length,
    lastTranscript: state.transcripts[state.transcripts.length - 1] || null,
    recentErrors: state.errors.slice(-5),
    ts: Date.now(),
  };
}

function report(note) {
  render();
  try {
    chrome.runtime.sendMessage({ type: "OFFSCREEN_PROBE_REPORT", report: snapshot(note) }, function () {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    logLine("report failed: " + (e && e.message ? e.message : e));
  }
}

function startProbe() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  state.hasApi = !!SR;
  if (!SR) {
    logLine("SpeechRecognition API unavailable in this context.");
    report("no-api");
    return;
  }
  // Stop any previous session before starting a new one (single session).
  try { if (state.recognition) state.recognition.stop(); } catch (e) { /* ignore */ }
  state.recognition = null;

  var micCheck = Promise.resolve();
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      micCheck = navigator.mediaDevices.getUserMedia({ audio: true }).then(
        function (stream) {
          state.mic = "granted";
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ignore */ }
        },
        function (err) {
          state.mic = (err && err.name) ? err.name : "denied";
        }
      );
    } else {
      state.mic = "no-getUserMedia";
    }
  } catch (e) {
    state.mic = (e && e.name) ? e.name : "error";
  }

  micCheck.then(function () {
    var rec = new SR();
    state.recognition = rec;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onstart = function () {
      state.listening = true;
      state.startedAt = Date.now();
      logLine("onstart (mic=" + state.mic + ")");
      report("onstart");
    };
    rec.onresult = function (event) {
      for (var i = event.resultIndex; i < event.results.length; i += 1) {
        var result = event.results[i];
        if (!result.isFinal) continue;
        var text = result[0].transcript;
        state.transcripts.push(text);
        logLine("onresult: " + text);
      }
      report("onresult");
    };
    rec.onerror = function (event) {
      state.listening = false;
      state.errors.push(event.error);
      logLine("onerror: " + event.error);
      report("onerror:" + event.error);
    };
    rec.onend = function () {
      state.listening = false;
      logLine("onend");
      report("onend");
    };
    try {
      rec.start();
      logLine("recognition.start() called (mic=" + state.mic + ")");
    } catch (e) {
      logLine("recognition.start() threw: " + (e && e.name ? e.name : e));
      report("start-threw:" + (e && e.name ? e.name : "error"));
    }
    render();
  });
}

function stopProbe() {
  try { if (state.recognition) state.recognition.stop(); } catch (e) { /* ignore */ }
  state.listening = false;
  logLine("stopped by user");
  report("stopped");
}

document.getElementById("btn-start").addEventListener("click", startProbe);
document.getElementById("btn-stop").addEventListener("click", stopProbe);

// Control channel from the service worker. Ignores everything else so
// this page can never interfere with unrelated extension messaging.
chrome.runtime.onMessage.addListener(function (message) {
  if (!message || message.target !== "offscreen-probe") return;
  if (message.cmd === "start") startProbe();
  else if (message.cmd === "stop") stopProbe();
});

logLine("probe page loaded; auto-starting.");
render();
startProbe();
