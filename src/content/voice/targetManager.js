// Target Manager for hands-free element numbering and click-by-number accessibility
export class TargetManager {
  constructor() {
    this.badges = [];
    this.targetElements = new Map(); // number -> HTMLElement
    this.isVisible = false;
  }

  showTargets() {
    this.hideTargets();

    // Query all clickable, focusable, or interactive elements in view
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[role="button"]',
      '[role="link"]',
      '[tabindex]:not([tabindex="-1"])',
      'summary',
      '[contenteditable="true"]'
    ];

    const elements = Array.from(document.querySelectorAll(selectors.join(', ')));
    let counter = 1;

    // Filter to visible elements in current viewport
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    for (const el of elements) {
      if (counter > 60) break; // Keep badge count performant and legible

      const rect = el.getBoundingClientRect();
      const isVisible = (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= -20 &&
        rect.left >= -20 &&
        rect.bottom <= viewportHeight + 20 &&
        rect.right <= viewportWidth + 20 &&
        window.getComputedStyle(el).visibility !== 'hidden' &&
        window.getComputedStyle(el).display !== 'none'
      );

      if (!isVisible) continue;

      // Create high-visibility turquoise badge
      const badge = document.createElement('div');
      badge.className = 'handsfree-target-badge';
      badge.textContent = counter.toString();
      badge.dataset.targetNumber = counter.toString();

      // Position badge at top-left corner of the element
      const badgeTop = Math.max(4, rect.top + window.scrollY - 10);
      const badgeLeft = Math.max(4, rect.left + window.scrollX - 10);

      badge.style.position = 'absolute';
      badge.style.top = `${badgeTop}px`;
      badge.style.left = `${badgeLeft}px`;
      badge.style.zIndex = '2147483646';
      badge.style.backgroundColor = '#0d9488'; // turquoise / teal-600
      badge.style.color = '#ffffff';
      badge.style.fontFamily = 'monospace';
      badge.style.fontSize = '12px';
      badge.style.fontWeight = 'bold';
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '9999px';
      badge.style.boxShadow = '0 0 10px rgba(13, 148, 136, 0.6), 0 2px 4px rgba(0,0,0,0.3)';
      badge.style.border = '2px solid #ffffff';
      badge.style.pointerEvents = 'auto';
      badge.style.cursor = 'pointer';
      badge.style.transition = 'transform 0.15s ease';

      const targetNum = counter;
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clickTarget(targetNum);
      });

      document.body.appendChild(badge);
      this.badges.push(badge);
      this.targetElements.set(counter, el);
      counter++;
    }

    this.isVisible = true;
    return this.badges.length;
  }

  hideTargets() {
    for (const badge of this.badges) {
      if (badge.parentNode) {
        badge.parentNode.removeChild(badge);
      }
    }
    this.badges = [];
    this.targetElements.clear();
    this.isVisible = false;
  }

  clickTarget(number) {
    const el = this.targetElements.get(number);
    if (!el) {
      console.warn(`[Handsfree] Target #${number} not found.`);
      return false;
    }

    // Scroll into view if needed
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Highlight briefly
    const originalOutline = el.style.outline;
    el.style.outline = '3px solid #0d9488';
    setTimeout(() => {
      el.style.outline = originalOutline;
    }, 800);

    // Dispatch focus and click events
    el.focus();
    
    // Simulate real pointer interaction
    const clickEvent = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    el.dispatchEvent(clickEvent);

    if (typeof el.click === 'function') {
      el.click();
    }

    // Hide badges shortly after click
    setTimeout(() => this.hideTargets(), 500);
    return true;
  }
}
