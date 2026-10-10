/**
 * Face Tracking module using MediaPipe FaceLandmarker.
 * Manages webcam stream, model lifecycle, and per-frame nose landmark emission.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Use locally bundled WASM files (copied to public/mediapipe-wasm/) to avoid CDN CSP violations
const WASM_URL = (typeof chrome !== "undefined" && chrome.runtime?.getURL)
  ? chrome.runtime.getURL("mediapipe-wasm")
  : "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

// Face landmarker model — loaded from Google's CDN (large binary, not bundled)
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let faceLandmarker = null;
let videoElement = null;
let mediaStream = null;
let animFrameId = null;
let lastVideoTime = -1;
let isRunning = false;

/**
 * Initializes the MediaPipe FaceLandmarker instance.
 * Reuses existing instance if already created.
 */
async function initLandmarker() {
  if (faceLandmarker) return faceLandmarker;

  // Use the ES module variant of MediaPipe vision tasks
  const vision = await FilesetResolver.forVisionTasks(WASM_URL, true);

  // In Chrome Extensions, content scripts run in an isolated JS world.
  // MediaPipe's default DOM script injection executes in the host page's world,
  // leaving self.ModuleFactory undefined in the content script.
  // We directly import the ES module variant inside the content script's world.
  let factory = typeof self !== "undefined" ? self.ModuleFactory : undefined;
  if (!factory) {
    try {
      const moduleUrl = (typeof chrome !== "undefined" && chrome.runtime?.getURL)
        ? chrome.runtime.getURL("mediapipe-wasm/vision_wasm_module_internal.js")
        : `${WASM_URL}/vision_wasm_module_internal.js`;
      const wasmMod = await import(/* @vite-ignore */ moduleUrl);
      factory = wasmMod.default || wasmMod.ModuleFactory || globalThis.ModuleFactory;
      if (typeof self !== "undefined") {
        self.ModuleFactory = factory;
      }
    } catch (e) {
      console.warn("[Handsfree] Direct WASM module import warning:", e);
    }
  }

  // Prevent MediaPipe from injecting a redundant <script> tag into the host page
  if (typeof self !== "undefined" && self.ModuleFactory) {
    vision.wasmLoaderPath = "";
  }

  try {
    // Attempt GPU acceleration first for best performance
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
  } catch (gpuError) {
    console.warn("[Handsfree] GPU delegate unavailable, falling back to CPU:", gpuError);
    // Restore ModuleFactory since MediaPipe cleans it up after each instantiation attempt
    if (typeof self !== "undefined" && factory) {
      self.ModuleFactory = factory;
      vision.wasmLoaderPath = "";
    }
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
  }

  return faceLandmarker;
}

/**
 * Starts webcam and begins facial landmark detection loop.
 * @param {Function} onLandmark - Callback receiving `{ x: number, y: number }` for nose landmark
 */
export async function start(onLandmark) {
  if (isRunning) {
    console.warn("[Handsfree] Face tracking is already running.");
    return;
  }

  isRunning = true;

  try {
    // 1. Initialize landmarker model
    const landmarker = await initLandmarker();

    // Check if stopped while loading
    if (!isRunning) return;

    // 2. Request webcam video stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });

    if (!isRunning) {
      stop();
      return;
    }

    // 3. Create hidden offscreen video element for frame processing
    // Note: Do NOT use display: none, as Chromium suspends video frame decoding for display:none elements
    videoElement = document.createElement("video");
    videoElement.srcObject = mediaStream;
    videoElement.setAttribute("playsinline", "");
    videoElement.muted = true;
    videoElement.style.position = "fixed";
    videoElement.style.top = "-9999px";
    videoElement.style.left = "-9999px";
    videoElement.style.width = "640px";
    videoElement.style.height = "480px";
    videoElement.style.opacity = "0";
    videoElement.style.pointerEvents = "none";
    videoElement.style.zIndex = "-2147483648";
    videoElement.width = 640;
    videoElement.height = 480;
    document.body.appendChild(videoElement);

    await new Promise((resolve) => {
      if (videoElement.readyState >= 2) {
        resolve();
      } else {
        videoElement.onloadeddata = () => resolve();
        videoElement.oncanplay = () => resolve();
      }
      videoElement.play().then(resolve).catch(resolve);
      setTimeout(resolve, 500);
    });

    let lastProcessTime = 0;
    const FRAME_INTERVAL_MS = 33; // ~30 FPS

    // 4. Frame detection loop
    const detectFrame = () => {
      if (!isRunning) return;

      const nowInMs = performance.now();

      if (
        videoElement &&
        videoElement.readyState >= 2 &&
        (nowInMs - lastProcessTime >= FRAME_INTERVAL_MS)
      ) {
        lastProcessTime = nowInMs;

        try {
          const results = landmarker.detectForVideo(videoElement, nowInMs);

          if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            // Index 1 corresponds to the nose tip landmark in the 478-point MediaPipe mesh
            const nose = results.faceLandmarks[0][1];
            if (nose) {
              latestLandmark = { x: nose.x, y: nose.y };
              if (typeof onLandmark === "function") {
                onLandmark({ x: nose.x, y: nose.y });
              }
            }
          }
        } catch (frameError) {
          // Robust error handling: prevent crash on frame drop
          console.debug("[Handsfree] Frame detection warning:", frameError);
        }
      }

      animFrameId = requestAnimationFrame(detectFrame);
    };

    animFrameId = requestAnimationFrame(detectFrame);
    console.log("[Handsfree] Face tracking started successfully.");
  } catch (error) {
    console.error("[Handsfree] Failed to start face tracking:", error);
    stop();
    throw error;
  }
}

/**
 * Stops webcam capture, halts detection loop, and cleans up resources.
 */
export function stop() {
  isRunning = false;

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (videoElement) {
    videoElement.pause();
    videoElement.srcObject = null;
    if (videoElement.parentNode) {
      videoElement.parentNode.removeChild(videoElement);
    }
    videoElement = null;
  }

  lastVideoTime = -1;
  console.log("[Handsfree] Face tracking stopped.");
}

let latestLandmark = null;

export function getLatestLandmark() {
  return latestLandmark;
}

export function getMediaStream() {
  return mediaStream;
}

export function getVideoElement() {
  return videoElement;
}

let offscreenCanvas = null;
let offscreenCtx = null;

export function captureFrameDataUrl(quality = 0.5) {
  if (!videoElement || videoElement.readyState < 2) return null;
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = 320;
    offscreenCanvas.height = 240;
    offscreenCtx = offscreenCanvas.getContext("2d");
  }
  try {
    offscreenCtx.drawImage(videoElement, 0, 0, 320, 240);
    return offscreenCanvas.toDataURL("image/jpeg", quality);
  } catch (e) {
    return null;
  }
}

/**
 * Returns whether tracking is currently active.
 * @returns {boolean}
 */
export function isTracking() {
  return isRunning;
}

// Aliases for flexibility and consistency
export const startTracking = start;
export const stopTracking = stop;
