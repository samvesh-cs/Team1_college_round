import { DEFAULTS } from "../../shared/constants.js";
import { recordDwellClick } from "../../shared/sessionStats.js";

/**
 * DwellController tracks the cursor position over interactive elements,
 * renders a radial progress ring around the cursor, and triggers click activation
 * when the cursor dwells on an eligible element for the configured duration.
 */
export class DwellController {
  /**
   * @param {Object} [options]
   * @param {number} [options.dwellDuration] - Dwell time required for activation in ms (default: DEFAULTS.dwellDuration or 1200)
   * @param {number} [options.cooldownDuration] - Cooldown period in ms after activation (default: 500)
   */
  constructor(options = {}) {
    this.dwellDuration =
      typeof options.dwellDuration === "number" && options.dwellDuration > 0
        ? options.dwellDuration
        : DEFAULTS?.dwellDuration ?? 1200;

    this.cooldownDuration =
      typeof options.cooldownDuration === "number" && options.cooldownDuration >= 0
        ? options.cooldownDuration
        : 500;

    this.isEnabled = true;
    this.currentElement = null;
    this.dwellTime = 0;
    this.lastFrameTime = 0;
    this.cooldownUntil = 0;
    this.activatedForCurrentDwell = false;
    this._onActivateCallback = null;

    // DOM references
    this.overlayEl = null;
    this.progressCircle = null;
    this.ringCircumference = 2 * Math.PI * 18; // radius = 18px (~113.097px)
  }

  onActivate(callback) {
    this._onActivateCallback = callback;
  }

  /**
   * Updates or sets the required dwell duration in milliseconds.
   * @param {number} ms
   */
  setDwellDuration(ms) {
    if (typeof ms === "number" && ms > 0 && Number.isFinite(ms)) {
      this.dwellDuration = ms;
    }
  }

  /**
   * Returns current dwell duration in milliseconds.
   * @returns {number}
   */
  getDwellDuration() {
    return this.dwellDuration;
  }

  /**
   * Enables the dwell controller.
   */
  start() {
    this.isEnabled = true;
    this.ensureOverlay();
  }

  /**
   * Disables the dwell controller and resets current dwell state.
   */
  stop() {
    this.isEnabled = false;
    this.resetDwell();
  }

  /**
   * Cleans up DOM elements and resets controller state.
   */
  destroy() {
    this.stop();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
      this.progressCircle = null;
    }
  }

  /**
   * Checks if an element is eligible for dwell activation.
   * Evaluates connectivity, visibility, disabled state, handsfree ownership, and interactivity.
   *
   * @param {Element|null} element
   * @returns {boolean}
   */
  isEligible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    // Must be connected to the DOM
    if (!element.isConnected) {
      return false;
    }

    // Ignore elements belonging to Handsfree's own overlays
    if (
      element.id?.startsWith("handsfree-") ||
      element.closest?.('#handsfree-cursor, #handsfree-dwell, [id^="handsfree-"], [class*="handsfree-"]')
    ) {
      return false;
    }

    // Ignore disabled elements or disabled ancestors (e.g. within disabled fieldset)
    if (
      element.disabled === true ||
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.closest?.('[disabled], [aria-disabled="true"]')
    ) {
      return false;
    }

    // Ignore hidden inputs
    if (element.tagName === "INPUT" && element.getAttribute("type")?.toLowerCase() === "hidden") {
      return false;
    }

    // Check computed styles and visibility
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      try {
        const style = window.getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          parseFloat(style.opacity) === 0 ||
          style.pointerEvents === "none"
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }

    // Check dimensions to ignore zero-size or collapsed elements
    if (typeof element.getBoundingClientRect === "function") {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) {
        return false;
      }
    }

    // Check interactive tags
    const tagName = element.tagName.toUpperCase();
    const INTERACTIVE_TAGS = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"];
    if (INTERACTIVE_TAGS.includes(tagName)) {
      return true;
    }

    // Check ARIA interactive roles
    const role = element.getAttribute("role");
    if (role) {
      const INTERACTIVE_ROLES = [
        "button",
        "link",
        "checkbox",
        "radio",
        "switch",
        "tab",
        "menuitem",
        "option",
      ];
      if (INTERACTIVE_ROLES.includes(role.toLowerCase())) {
        return true;
      }
    }

    // Check elements with non-negative tabindex
    if (element.hasAttribute("tabindex")) {
      const tabIndex = parseInt(element.getAttribute("tabindex"), 10);
      if (!Number.isNaN(tabIndex) && tabIndex >= 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Resolves the target interactive element under the cursor.
   * If a child of an eligible element (e.g., an icon inside a button) is hit,
   * returns the closest eligible interactive ancestor.
   *
   * @param {Element|null} rawElement
   * @returns {Element|null}
   */
  getInteractiveElement(rawElement) {
    if (!rawElement || !(rawElement instanceof Element) || !rawElement.isConnected) {
      return null;
    }

    // Never target Handsfree overlay elements
    if (
      rawElement.id?.startsWith("handsfree-") ||
      rawElement.closest?.('#handsfree-cursor, #handsfree-dwell, [id^="handsfree-"], [class*="handsfree-"]')
    ) {
      return null;
    }

    // Search upwards for an interactive container
    const candidate = rawElement.closest?.(
      'a, button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [tabindex]'
    );

    if (candidate && this.isEligible(candidate)) {
      return candidate;
    }

    // Direct element check
    if (this.isEligible(rawElement)) {
      return rawElement;
    }

    return null;
  }

  /**
   * Updates dwell tracking on each frame.
   *
   * @param {number} cursorX - Viewport clientX coordinate
   * @param {number} cursorY - Viewport clientY coordinate
   * @param {number} [frameDelta] - Elapsed time in ms since previous frame
   */
  update(cursorX, cursorY, frameDelta) {
    if (!this.isEnabled) {
      return;
    }

    // Ensure valid coordinates
    if (
      typeof cursorX !== "number" ||
      typeof cursorY !== "number" ||
      !Number.isFinite(cursorX) ||
      !Number.isFinite(cursorY)
    ) {
      this.resetDwell();
      return;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();

    // Respect post-activation cooldown
    if (now < this.cooldownUntil) {
      this.resetDwell();
      return;
    }

    // Identify element at cursor position
    let rawElement = null;
    if (typeof document !== "undefined" && typeof document.elementFromPoint === "function") {
      try {
        rawElement = document.elementFromPoint(cursorX, cursorY);
      } catch {
        rawElement = null;
      }
    }

    const target = this.getInteractiveElement(rawElement);

    if (!target) {
      this.resetDwell();
      return;
    }

    // Calculate time delta for this frame
    let dt = 16.67;
    if (typeof frameDelta === "number" && frameDelta > 0 && Number.isFinite(frameDelta)) {
      dt = frameDelta;
    } else if (this.lastFrameTime > 0) {
      dt = Math.min(Math.max(now - this.lastFrameTime, 1), 100);
    }
    this.lastFrameTime = now;

    // Same target as previous frame
    if (target === this.currentElement) {
      if (this.activatedForCurrentDwell) {
        return;
      }

      this.dwellTime += dt;
      const progress = Math.min(this.dwellTime / this.dwellDuration, 1);
      this.showProgress(cursorX, cursorY, progress);

      if (this.dwellTime >= this.dwellDuration) {
        this.activate(this.currentElement);
      }
    } else {
      // Changed to a new target
      this.resetDwell();
      this.currentElement = target;
      this.activatedForCurrentDwell = false;
      this.dwellTime = 0;
      this.showProgress(cursorX, cursorY, 0);
    }
  }

  /**
   * Triggers click activation on the target element and initiates cooldown.
   * @param {Element} element
   */
  activate(element) {
    if (!element || !element.isConnected) {
      this.resetDwell();
      return;
    }

    this.activatedForCurrentDwell = true;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.cooldownUntil = now + this.cooldownDuration;
    this.hideProgress();

    try {
      recordDwellClick().catch(() => {});
      if (typeof this._onActivateCallback === "function") {
        try {
          this._onActivateCallback(element);
        } catch (_) {}
      }

      if (typeof element.click === "function") {
        element.click();
      } else {
        element.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      }

      // If clicked element is or contains an input or search field, make it active
      const input = element.matches?.("input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit']), textarea, [contenteditable='true'], [role='searchbox'], [role='textbox']")
        ? element
        : element.closest?.("input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit']), textarea, [contenteditable='true'], [role='searchbox'], [role='textbox']")
          || element.querySelector?.("input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit']), textarea, [contenteditable='true']");

      if (input && typeof input.focus === "function") {
        try {
          input.focus({ preventScroll: true });
        } catch (_) {
          try { input.focus(); } catch (e) {}
        }
        if (window.__handsfree_voice && window.__handsfree_voice.enabled) {
          window.__handsfree_voice.overlay.show("dictation");
          window.__handsfree_voice.overlay.flashCommand("Search/Input active — speak to type");
        }
      }
    } catch (err) {
      console.warn("[Handsfree] Dwell activation failed:", err);
    }
  }

  /**
   * Resets dwell time accumulator and hides the visual progress ring.
   */
  resetDwell() {
    this.currentElement = null;
    this.dwellTime = 0;
    this.activatedForCurrentDwell = false;
    this.hideProgress();
  }

  /**
   * Ensures the radial progress ring overlay exists in the document.
   */
  ensureOverlay() {
    if (typeof document === "undefined") {
      return;
    }

    if (this.overlayEl && this.overlayEl.isConnected) {
      return;
    }

    // Remove any stale overlay element
    const stale = document.getElementById("handsfree-dwell");
    if (stale) {
      stale.remove();
    }

    const container = document.createElement("div");
    container.id = "handsfree-dwell";
    container.className = "handsfree-dwell-overlay";
    container.setAttribute("aria-hidden", "true");

    // Baseline styles ensuring isolation and zero pointer interference
    container.style.position = "fixed";
    container.style.pointerEvents = "none";
    container.style.zIndex = "2147483646";
    container.style.transform = "translate(-50%, -50%)";
    container.style.display = "none";
    container.style.width = "44px";
    container.style.height = "44px";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "handsfree-dwell-svg");
    svg.setAttribute("viewBox", "0 0 44 44");
    svg.setAttribute("width", "44");
    svg.setAttribute("height", "44");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.transform = "rotate(-90deg)"; // Start radial stroke at 12 o'clock

    const radius = 18;
    this.ringCircumference = 2 * Math.PI * radius;

    // Track circle
    const trackCircle = document.createElementNS(svgNS, "circle");
    trackCircle.setAttribute("class", "handsfree-dwell-track");
    trackCircle.setAttribute("cx", "22");
    trackCircle.setAttribute("cy", "22");
    trackCircle.setAttribute("r", `${radius}`);
    trackCircle.setAttribute("fill", "none");
    trackCircle.setAttribute("stroke", "rgba(255, 255, 255, 0.3)");
    trackCircle.setAttribute("stroke-width", "3.5");

    // Dynamic progress circle
    const progressCircle = document.createElementNS(svgNS, "circle");
    progressCircle.setAttribute("class", "handsfree-dwell-progress");
    progressCircle.setAttribute("cx", "22");
    progressCircle.setAttribute("cy", "22");
    progressCircle.setAttribute("r", `${radius}`);
    progressCircle.setAttribute("fill", "none");
    progressCircle.setAttribute("stroke", "#3b82f6");
    progressCircle.setAttribute("stroke-width", "3.5");
    progressCircle.setAttribute("stroke-linecap", "round");
    progressCircle.style.strokeDasharray = `${this.ringCircumference}`;
    progressCircle.style.strokeDashoffset = `${this.ringCircumference}`;
    progressCircle.style.transition = "stroke-dashoffset 0.05s linear";

    svg.appendChild(trackCircle);
    svg.appendChild(progressCircle);
    container.appendChild(svg);

    const mountTarget = document.body || document.documentElement;
    if (mountTarget) {
      mountTarget.appendChild(container);
    }

    this.overlayEl = container;
    this.progressCircle = progressCircle;
  }

  /**
   * Positions and renders the radial progress indicator.
   * @param {number} x
   * @param {number} y
   * @param {number} progress - Float between 0 and 1
   */
  showProgress(x, y, progress) {
    this.ensureOverlay();
    if (!this.overlayEl) {
      return;
    }

    this.overlayEl.style.left = `${x}px`;
    this.overlayEl.style.top = `${y}px`;
    this.overlayEl.style.display = "block";

    if (this.progressCircle) {
      const clamped = Math.max(0, Math.min(1, progress));
      const offset = this.ringCircumference * (1 - clamped);
      this.progressCircle.style.strokeDashoffset = `${offset}`;
    }
  }

  /**
   * Hides the progress indicator and resets stroke dash offset.
   */
  hideProgress() {
    if (this.overlayEl) {
      this.overlayEl.style.display = "none";
    }
    if (this.progressCircle) {
      this.progressCircle.style.strokeDashoffset = `${this.ringCircumference}`;
    }
  }
}

export default DwellController;
