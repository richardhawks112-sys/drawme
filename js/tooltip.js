// Hover descriptions that show after half a second, instead of the browser's
// own title tooltips (which take about a second and can't be sped up).
//
// Any element with a title attribute gets one. The title is moved to
// data-tip when the pointer first reaches the element, so code can keep
// setting el.title as usual.

const DELAY = 500;
// Once one description is showing, moving to the next button shows its
// description right away, like the system tooltips do.
const QUICK_WINDOW = 400;

export function installTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('aria-hidden', 'true');
  const usePopover = typeof HTMLElement.prototype.showPopover === 'function';
  if (usePopover) tip.popover = 'manual';
  document.body.appendChild(tip);

  let target = null;
  let timer = 0;
  let shown = false;
  let lastHidden = 0;

  function takeTitle(el) {
    const title = el.getAttribute('title');
    if (title !== null) {
      el.dataset.tip = title;
      el.removeAttribute('title');
      // Keep a name for screen readers on buttons that only show a symbol.
      if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', title);
    }
    return el.dataset.tip || '';
  }

  function hide() {
    clearTimeout(timer);
    if (shown) {
      shown = false;
      lastHidden = performance.now();
      tip.classList.remove('show');
      if (usePopover) {
        try { tip.hidePopover(); } catch { /* already hidden */ }
      }
    }
    target = null;
  }

  function show() {
    if (!target || !target.isConnected) return hide();
    const text = takeTitle(target);
    if (!text) return hide();
    tip.textContent = text;
    // Inside an open modal dialog the tip has to be in the top layer too.
    if (usePopover) {
      try { tip.hidePopover(); } catch { /* not shown */ }
      tip.showPopover();
    } else {
      const host = target.closest('dialog[open]') || document.body;
      if (tip.parentNode !== host) host.appendChild(tip);
    }
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.classList.add('show');
    shown = true;
    place();
  }

  function place() {
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 6;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let top = r.bottom + gap;
    if (top + t.height > vh - 4) top = r.top - gap - t.height;
    let left = r.left + r.width / 2 - t.width / 2;
    // Buttons in the left toolbar: put the tip to their right.
    if (target.closest('.toolbar')) {
      left = r.right + gap;
      top = r.top + r.height / 2 - t.height / 2;
    }
    left = Math.max(4, Math.min(vw - t.width - 4, left));
    top = Math.max(4, Math.min(vh - t.height - 4, top));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[title], [data-tip]');
    if (el === target) return;
    hide();
    if (!el || e.buttons) return;
    takeTitle(el);
    target = el;
    const quick = performance.now() - lastHidden < QUICK_WINDOW;
    timer = setTimeout(show, quick ? 0 : DELAY);
  }, true);

  document.addEventListener('pointerout', (e) => {
    if (!target) return;
    const to = e.relatedTarget;
    if (to && target.contains(to)) return;
    hide();
  }, true);

  // Get out of the way as soon as the person does something.
  for (const type of ['pointerdown', 'keydown', 'wheel', 'scroll', 'blur']) {
    window.addEventListener(type, () => {
      if (target) {
        hide();
        lastHidden = 0;
      }
    }, true);
  }
}
