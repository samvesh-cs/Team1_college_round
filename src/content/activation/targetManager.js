/**
 * TargetManager scans the document for visible, interactive elements,
 * overlays numbered badges without altering the page layout, and provides
 * voice-activated target selection ("Click N").
 */
export class TargetManager {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxTargets] - Upper limit on targets indexed per scan (default: 150)
   */
  constructor(options = {}) {
    this.maxTargets =
      typeof options.maxTargets === "number" && options.maxTargets > 0
        ? options.maxTargets
        : 150;

    /** @type {Map<number, Element>} */
    this.targetMap = new Map();

    this.containerEl = null;
    this.isVisible = false;
    this.rafId = null;

    this.handleScrollOrResize = this.handleScrollOrResize.bind(this);
  }

  /**
   * Scans the page for visible interactive elements, registers them,
   * and renders numbered badges over them.
   *
   * @returns {{ count: number, targets: Map<number, Element> }}
   */
  showTargets() {
    // Clear any previous badges before scanning
    this.hideTargets();

    if (typeof document === "undefined") {
      return { count: 0, targets: this.targetMap };
    }

    const eligibleElements = this.scanEligibleElements();
    if (eligibleElements.length === 0) {
      return { count: 0, targets: this.targetMap };
    }

    const container = this.ensureContainer();

    eligibleElements.forEach((element, index) => {
      const targetNumber = index + 1;
      this.targetMap.set(targetNumber, element);

      const badge = this.createBadge(targetNumber, element);
      container.appendChild(badge);
    });

    this.isVisible = true;

    // Keep badge positions synced on viewport changes
    if (typeof window !== "undefined") {
      window.addEventListener("scroll", this.handleScrollOrResize, { passive: true });
      window.addEventListener("resize", this.handleScrollOrResize, { passive: true });
    }

    return { count: eligibleElements.length, targets: this.targetMap };
  }

  /**
   * Hides and removes all badge overlays from the DOM and clears the target registry.
   */
  hideTargets() {
    if (this.rafId) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("scroll", this.handleScrollOrResize);
      window.removeEventListener("resize", this.handleScrollOrResize);
    }

    this.targetMap.clear();

    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }

    this.isVisible = false;
  }

  /**
   * Re-scans and refreshes badge overlays if target mode is currently active.
   *
   * @returns {{ count: number, targets: Map<number, Element> } | null}
   */
  refresh() {
    if (this.isVisible) {
      return this.showTargets();
    }
    return null;
  }

  /**
   * Activates a target by its assigned badge number.
   * Validates target connectivity, visibility, and enabled state before dispatching click.
   *
   * @param {number|string} number - Target number or string identifier (e.g. 3, "3", "target 3")
   * @returns {{ success: boolean, targetNumber?: number, element?: Element, reason?: string }}
   */
  activateTarget(number) {
    const parsedNumber = this.parseTargetNumber(number);

    if (parsedNumber === null) {
      return { success: false, reason: "invalid_number" };
    }

    const element = this.targetMap.get(parsedNumber);

    if (!element) {
      return { success: false, reason: "target_not_found" };
    }

    // Verify target is still connected to the DOM
    if (!element.isConnected) {
      this.targetMap.delete(parsedNumber);
      return { success: false, reason: "disconnected" };
    }

    // Verify target remains visible and enabled
    if (!this.isElementVisibleAndEnabled(element)) {
      this.targetMap.delete(parsedNumber);
      return { success: false, reason: "ineligible_or_hidden" };
    }

    try {
      if (typeof element.focus === "function") {
        element.focus({ preventScroll: true });
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

      // Hide targets upon successful activation
      this.hideTargets();

      return { success: true, targetNumber: parsedNumber, element };
    } catch (err) {
      console.warn("[Handsfree] Target activation failed:", err);
      return { success: false, reason: "activation_error" };
    }
  }

  /**
   * Destroys the controller and cleans up all listeners and DOM overlays.
   */
  destroy() {
    this.hideTargets();
  }

  /**
   * Parses various representation of target numbers (number, string, or phrase).
   * @param {*} input
   * @returns {number|null}
   */
  parseTargetNumber(input) {
    if (typeof input === "number" && Number.isInteger(input) && input > 0) {
      return input;
    }

    if (typeof input === "string") {
      const match = input.match(/\b\d+\b/);
      if (match) {
        const parsed = parseInt(match[0], 10);
        if (Number.isInteger(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }

    return null;
  }

  /**
   * Scans document for eligible interactive candidates within the viewport.
   * @returns {Element[]}
   */
  scanEligibleElements() {
    const SELECTORS = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='option']",
      "[tabindex]:not([tabindex='-1'])",
      "[contenteditable='true']",
    ].join(", ");

    let rawNodes = [];
    try {
      rawNodes = Array.from(document.querySelectorAll(SELECTORS));
    } catch {
      return [];
    }

    const filtered = [];

    for (const node of rawNodes) {
      if (this.isElementVisibleAndEnabled(node)) {
        filtered.push(node);
      }
      if (filtered.length >= this.maxTargets) {
        break;
      }
    }

    return filtered;
  }

  /**
   * Validates whether an element is currently connected, visible, enabled, and eligible.
   *
   * @param {Element|null} element
   * @returns {boolean}
   */
  isElementVisibleAndEnabled(element) {
    if (!element || !(element instanceof Element) || !element.isConnected) {
      return false;
    }

    // Ignore Handsfree overlay elements (unless they are evaluation targets)
    const isEvalTarget = element.closest?.('[data-eval-target], .eval-target, #eval-task-canvas');
    if (!isEvalTarget) {
      if (
        element.id?.startsWith("handsfree-cursor") ||
        element.id?.startsWith("handsfree-dwell") ||
        element.id?.startsWith("handsfree-calib") ||
        element.id?.startsWith("handsfree-voice") ||
        element.closest?.(
          '#handsfree-cursor, #handsfree-dwell, #handsfree-targets-container, #handsfree-voice-status, #handsfree-calibration-overlay'
        )
      ) {
        return false;
      }
    }

    // Ignore disabled elements or disabled fieldset ancestors
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

    // Check geometry and viewport bounds
    if (typeof element.getBoundingClientRect === "function") {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      const viewportWidth =
        window.innerWidth || document.documentElement?.clientWidth || 0;
      const viewportHeight =
        window.innerHeight || document.documentElement?.clientHeight || 0;

      // Must be partially or fully within the current visible viewport
      const isInViewport =
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < viewportHeight &&
        rect.left < viewportWidth;

      if (!isInViewport) {
        return false;
      }
    }

    return true;
  }

  /**
   * Ensures the badge container overlay exists and is appended to the document.
   * @returns {HTMLElement}
   */
  ensureContainer() {
    if (this.containerEl && this.containerEl.isConnected) {
      return this.containerEl;
    }

    // Remove any stale container
    const stale = document.getElementById("handsfree-targets-container");
    if (stale) {
      stale.remove();
    }

    const container = document.createElement("div");
    container.id = "handsfree-targets-container";
    container.className = "handsfree-target-container";
    container.setAttribute("aria-hidden", "true");

    // Inline fallback styles ensuring zero layout shift and pointer pass-through
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.pointerEvents = "none";
    container.style.zIndex = "2147483645";
    container.style.overflow = "hidden";
    container.style.margin = "0";
    container.style.padding = "0";

    const mountTarget = document.body || document.documentElement;
    if (mountTarget) {
      mountTarget.appendChild(container);
    }

    this.containerEl = container;
    return container;
  }

  /**
   * Creates a numbered badge element positioned over the target element.
   *
   * @param {number} targetNumber
   * @param {Element} element
   * @returns {HTMLElement}
   */
  createBadge(targetNumber, element) {
    const badge = document.createElement("span");
    badge.className = "handsfree-target-badge";
    badge.dataset.targetNumber = String(targetNumber);
    badge.textContent = String(targetNumber);

    // Baseline fallback styles for badge
    badge.style.position = "fixed";
    badge.style.pointerEvents = "none";
    badge.style.zIndex = "2147483645";
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.minWidth = "20px";
    badge.style.height = "20px";
    badge.style.padding = "0 5px";
    badge.style.background = "linear-gradient(135deg, #f59e0b, #d97706)";
    badge.style.color = "#0f172a";
    badge.style.fontSize = "11px";
    badge.style.fontWeight = "800";
    badge.style.lineHeight = "1";
    badge.style.borderRadius = "10px";
    badge.style.border = "1.5px solid #ffffff";
    badge.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.35)";
    badge.style.userSelect = "none";
    badge.style.transform = "translate(-30%, -30%)";
    badge.style.whiteSpace = "nowrap";

    this.positionBadge(badge, element);
    return badge;
  }

  /**
   * Positions a badge over an element's top-left corner within the viewport.
   *
   * @param {HTMLElement} badge
   * @param {Element} element
   */
  positionBadge(badge, element) {
    const rect = element.getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || document.documentElement?.clientWidth || 1024;
    const viewportHeight =
      window.innerHeight || document.documentElement?.clientHeight || 768;

    const x = Math.max(6, Math.min(rect.left, viewportWidth - 24));
    const y = Math.max(6, Math.min(rect.top, viewportHeight - 24));

    badge.style.left = `${x}px`;
    badge.style.top = `${y}px`;
  }

  /**
   * Updates positions of all rendered badges when viewport scrolls or resizes.
   */
  handleScrollOrResize() {
    if (this.rafId) {
      return;
    }

    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(() => {
        this.updateBadgePositions();
        this.rafId = null;
      });
    } else {
      this.updateBadgePositions();
    }
  }

  /**
   * Recalculates badge coordinates for each registered target.
   */
  updateBadgePositions() {
    if (!this.isVisible || !this.containerEl) {
      return;
    }

    for (const [number, element] of this.targetMap.entries()) {
      const badge = this.containerEl.querySelector(`[data-target-number="${number}"]`);
      if (!badge) {
        continue;
      }

      if (!element.isConnected || !this.isElementVisibleAndEnabled(element)) {
        badge.style.display = "none";
        continue;
      }

      badge.style.display = "inline-flex";
      this.positionBadge(badge, element);
    }
  }
}

export default TargetManager;
