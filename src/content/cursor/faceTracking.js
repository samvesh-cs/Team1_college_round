/**
 * Face Tracking module using MediaPipe FaceLandmarker.
 * Manages webcam stream, model lifecycle, and per-frame nose landmark emission.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// CDN URLs for MediaPipe WebAssembly and models
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
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

  const vision = await FilesetResolver.forVisionTasks(WASM_URL);

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
    videoElement = document.createElement("video");
    videoElement.srcObject = mediaStream;
    videoElement.setAttribute("playsinline", "");
    videoElement.muted = true;
    videoElement.style.display = "none";
    document.body.appendChild(videoElement);

    await new Promise((resolve) => {
      videoElement.onloadeddata = () => resolve();
      videoElement.play().catch(() => resolve());
    });

    lastVideoTime = -1;

    // 4. Frame detection loop
    const detectFrame = () => {
      if (!isRunning) return;

      if (
        videoElement &&
        videoElement.readyState >= 2 &&
        videoElement.currentTime !== lastVideoTime
      ) {
        lastVideoTime = videoElement.currentTime;
        const nowInMs = performance.now();

        try {
          const results = landmarker.detectForVideo(videoElement, nowInMs);

          if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            // Index 1 corresponds to the nose tip landmark in the 478-point MediaPipe mesh
            const nose = results.faceLandmarks[0][1];
            if (nose && typeof onLandmark === "function") {
              onLandmark({ x: nose.x, y: nose.y });
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
