// Ariadne — modal focus management (trap + restore).
//
// Centralised, decoupled accessibility layer: keeps keyboard focus inside the
// top-most open dialog and returns focus to the element that opened it on
// close. No per-modal wiring — it observes `.modal` elements toggling visible
// and reacts. Opt-in for non-`.modal` overlays via `data-focus-trap`.
//
// Esc-to-close is intentionally NOT handled here; the existing keyboard
// handlers already close modals, and closing removes `.hidden`, which this
// module detects to restore focus.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const SELECTOR = '.modal, [data-focus-trap]';

let _activeModal = null;
let _lastTrigger = null;
let _keyHandler = null;
let _scheduled = false;

function isVisible(el) {
  return !!el
    && !el.classList.contains('hidden')
    && el.offsetParent !== null;
}

// The element that should receive/trap focus for a given modal shell.
function containerOf(modal) {
  return modal.querySelector('.modal-content') || modal;
}

function focusables(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE))
    .filter(el => el.offsetParent !== null && !el.closest('[aria-hidden="true"]'));
}

function activate(modal) {
  if (_activeModal === modal) return;
  // Switching directly between stacked modals: restore the prior trigger first.
  if (_activeModal) teardown();
  _activeModal = modal;
  _lastTrigger = document.activeElement;

  const container = containerOf(modal);
  // Only move focus inward if it isn't already inside (respect autofocus and
  // any field the open handler intentionally focused).
  if (!modal.contains(document.activeElement)) {
    const auto = container.querySelector('[autofocus]');
    const target = auto || focusables(container)[0] || container;
    if (target === container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }
    try { target.focus({ preventScroll: true }); } catch (_) {}
  }

  _keyHandler = (e) => {
    if (e.key !== 'Tab' || _activeModal !== modal) return;
    const items = focusables(container);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', _keyHandler, true);
}

function teardown() {
  if (_keyHandler) document.removeEventListener('keydown', _keyHandler, true);
  _keyHandler = null;
  _activeModal = null;
}

function deactivate() {
  if (!_activeModal) return;
  const trigger = _lastTrigger;
  teardown();
  _lastTrigger = null;
  if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') {
    try { trigger.focus({ preventScroll: true }); } catch (_) {}
  }
}

function scan() {
  _scheduled = false;
  const open = Array.from(document.querySelectorAll(SELECTOR)).filter(isVisible);
  if (!open.length) { deactivate(); return; }
  // Trap the visually top-most dialog (highest z-index) so stacked modals
  // hand focus to the front one.
  const top = open.reduce((a, b) => {
    const za = parseInt(getComputedStyle(a).zIndex, 10) || 0;
    const zb = parseInt(getComputedStyle(b).zIndex, 10) || 0;
    return zb >= za ? b : a;
  });
  activate(top);
}

function schedule() {
  if (_scheduled) return;
  _scheduled = true;
  requestAnimationFrame(scan);
}

// Cheap observer: only schedules a scan when a dialog-ish element actually
// mutated (or was added/removed). The app mutates the chat DOM constantly
// during streaming, so we early-out on anything that isn't a modal.
function isDialogish(node) {
  return node && node.nodeType === 1 && typeof node.matches === 'function'
    && node.matches(SELECTOR);
}

function relevant(records) {
  for (const r of records) {
    if (r.type === 'attributes' && isDialogish(r.target)) return true;
    if (r.type === 'childList') {
      for (const n of r.addedNodes) if (isDialogish(n)) return true;
      for (const n of r.removedNodes) if (isDialogish(n)) return true;
    }
  }
  return false;
}

function start() {
  const obs = new MutationObserver((records) => {
    if (relevant(records)) schedule();
  });
  obs.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'style'],
    childList: true,
    subtree: true,
  });
  // Catch any dialog already visible at load.
  schedule();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
