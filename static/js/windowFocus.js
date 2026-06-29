// Ariadne — windowFocus.js  (Phase 5: calm, focused multitasking)
//
// A PURELY ADDITIVE, behavior-preserving layer over the floating tool-window
// system. It does NOT open, close, minimize, move, resize, or re-parent any
// window — modalManager.js / windowDrag / tileManager / each tool's own
// open() keep full ownership of that. This module only *observes* the live
// set of open windows and layers on the "multitasking polish" the design
// audit asked for:
//
//   • Focus state — the front-most window reads as active; the others dim
//     slightly (calm focus) when 2+ are open.
//   • Click-to-front — clicking anywhere inside a background window raises it,
//     so focus follows intent (windowDrag only raised on header-drag before).
//   • Dialog semantics — role="dialog" + aria-labelledby on every window, and
//     aria-modal on the active one (matching the focus trap), so screen
//     readers announce each window by its title.
//   • Open-windows switcher — a small top-center bar (shown only with 2+
//     windows) to focus or close any open window at a glance.
//
// Focus trapping + restoring focus to the opener on close are already owned by
// focusTrap.js; Esc-to-close-the-front-window by the arbiter in ui.js. We don't
// duplicate either. The windows are intentionally non-modal (their .modal
// overlay is pointer-events:none / click-through) so multitasking works — we
// deliberately do NOT add a blocking scrim, which would defeat that.

import { TOOL_WINDOW_SELECTOR, nextToolWindowZ } from './toolWindowZOrder.js';

// Matches a single tool-window element (the selector above uses `body > …`,
// which closest() can't express).
const WINDOW_MATCH = '.modal, .research-overlay, .notes-pane-backdrop';

// Fallback display names for windows whose header has no <h4> (or none yet).
const FALLBACK_LABELS = {
  'cookbook-modal': 'Cookbook', 'calendar-modal': 'Calendar', 'gallery-modal': 'Gallery',
  'tasks-modal': 'Tasks', 'doclib-modal': 'Library', 'memory-modal': 'Brain',
  'notes-panel': 'Notes', 'email-lib-modal': 'Email', 'custom-preset-modal': 'Prompt',
  'research-overlay': 'Research', 'theme-modal': 'Theme', 'compare-model-overlay': 'Compare',
  'settings-modal': 'Settings', 'ge-shortcuts-modal': 'Shortcuts',
};

let _scheduled = false;
let _switcherEl = null;

function isOpenWindow(el) {
  if (!el || !el.classList) return false;
  if (el.classList.contains('hidden') || el.classList.contains('modal-minimized')) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}

function openWindows() {
  return Array.from(document.querySelectorAll(TOOL_WINDOW_SELECTOR)).filter(isOpenWindow);
}

function zOf(el) { return parseInt(getComputedStyle(el).zIndex, 10) || 0; }

function frontWindow(list) {
  return list.reduce((top, el) => (zOf(el) >= zOf(top) ? el : top), list[0]);
}

function labelOf(el) {
  const h = el.querySelector('.modal-header h4, .notes-pane-title, .modal-title');
  const raw = h && h.textContent ? h.textContent.trim().replace(/\s+/g, ' ') : '';
  if (raw) return raw.length > 22 ? raw.slice(0, 21) + '…' : raw;
  if (el.id && FALLBACK_LABELS[el.id]) return FALLBACK_LABELS[el.id];
  return el.id ? el.id.replace(/-(modal|overlay|panel|backdrop)$/, '') : 'Window';
}

// Raise a window above all others — the same monotonic helper modalManager and
// the Esc arbiter use, so the three agree on "front" instead of fighting.
function raise(el) {
  const z = nextToolWindowZ({ exclude: el, current: getComputedStyle(el).zIndex });
  el.style.setProperty('z-index', String(z), 'important');
}

// role="dialog" + a stable label so SR users hear each window announced. We set
// aria-modal only on the active window, mirroring the focus trap's reality
// (Tab is trapped in the front window); leaving it off the rest avoids falsely
// telling AT that the backgrounded windows are inert.
function applySemantics(el, isActive) {
  if (el.getAttribute('role') !== 'dialog') el.setAttribute('role', 'dialog');
  const h = el.querySelector('.modal-header h4, .notes-pane-title, .modal-title');
  if (h) {
    if (!h.id) h.id = (el.id || 'win') + '-title';
    if (el.getAttribute('aria-labelledby') !== h.id) el.setAttribute('aria-labelledby', h.id);
  } else if (!el.getAttribute('aria-label')) {
    el.setAttribute('aria-label', labelOf(el));
  }
  if (isActive) el.setAttribute('aria-modal', 'true');
  else el.removeAttribute('aria-modal');
}

function refresh() {
  _scheduled = false;
  const list = openWindows();
  const multi = list.length >= 2;
  const front = list.length ? frontWindow(list) : null;

  // Scrub state from any window that just closed/minimized.
  document.querySelectorAll('[data-window-focus]').forEach((el) => {
    if (!list.includes(el)) {
      el.removeAttribute('data-window-focus');
      el.removeAttribute('aria-modal');
    }
  });

  // IMPORTANT: focus state rides on a `data-` attribute, NOT a class. The Esc
  // arbiter (ui.js) and modalManager both run MutationObservers filtered to
  // `class`/`style` on `.modal` and re-promote z-index on any change — toggling
  // a class here would ping-pong z-index forever and lock the main thread. A
  // data attribute is invisible to those observers, so this stays inert.
  for (const el of list) {
    const active = el === front;
    // Only contrast (active vs dimmed) when 2+ windows compete for attention;
    // a lone window stays at its natural elevation.
    if (multi) el.setAttribute('data-window-focus', active ? 'active' : 'inactive');
    else el.removeAttribute('data-window-focus');
    applySemantics(el, active);
  }

  renderSwitcher(list, front, multi);
}

function schedule() {
  if (_scheduled) return;
  _scheduled = true;
  requestAnimationFrame(refresh);
}

// ── Open-windows switcher ────────────────────────────────────────────────
function ensureSwitcher() {
  if (_switcherEl && document.body.contains(_switcherEl)) return _switcherEl;
  const el = document.createElement('div');
  el.id = 'ax-window-switcher';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Open windows');
  document.body.appendChild(el);
  _switcherEl = el;
  return el;
}

const CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function closeWindow(win) {
  const btn = win.querySelector('.close-btn, .modal-close-btn, .modal-close, [data-action="close"], [data-close]');
  if (btn) { try { btn.click(); } catch (_) {} }
  else win.classList.add('hidden');
  setTimeout(schedule, 60);
}

function renderSwitcher(list, front, multi) {
  if (!multi) { if (_switcherEl) _switcherEl.style.display = 'none'; return; }
  const el = ensureSwitcher();
  el.style.display = '';
  el.innerHTML = '';
  for (const win of list) {
    const name = labelOf(win);
    const item = document.createElement('div');
    item.className = 'ax-window-switcher-item' + (win === front ? ' is-active' : '');

    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'ax-window-switcher-focus';
    focusBtn.textContent = name;
    focusBtn.title = 'Focus ' + name;
    focusBtn.setAttribute('aria-pressed', win === front ? 'true' : 'false');
    focusBtn.addEventListener('click', () => { raise(win); schedule(); });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ax-window-switcher-close';
    closeBtn.setAttribute('aria-label', 'Close ' + name);
    closeBtn.title = 'Close ' + name;
    closeBtn.innerHTML = CLOSE_SVG;
    closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); closeWindow(win); });

    item.append(focusBtn, closeBtn);
    el.appendChild(item);
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────
// Click anywhere in a background window → bring it to front (focus follows
// intent). Capture phase so we settle z BEFORE any inner handler reads it; the
// switcher lives outside .modal so its own clicks don't match here.
function onPointerDown(e) {
  const win = e.target.closest && e.target.closest(WINDOW_MATCH);
  if (!win || !isOpenWindow(win)) return;
  const list = openWindows();
  if (list.length > 1 && win !== frontWindow(list)) raise(win);
  schedule();
}

// Esc hygiene for stacked windows. Each tool registers its OWN document-level
// Escape handler that closes that tool. With 2+ windows open, one Esc pressed
// while a text field inside a window has focus fires ALL of them at once — the
// global arbiter (ui.js) deliberately defers to the field in that case (so Esc
// can clear/blur an input), which leaves the per-tool handlers free to cascade
// and nuke every open tool. This listener is added at load, so it runs FIRST
// in the bubble phase (before any tool's open() adds its handler) and, in
// exactly that situation, stops the cascade: the field keeps this keypress
// (clear/blur), and a second Esc — focus no longer in the field — closes just
// the front window via the normal arbiter path. Narrowly scoped so it never
// interferes with the single-window or non-field cases.
function onEscapeBubble(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (!inField || !t.closest || !t.closest(WINDOW_MATCH)) return;
  if (openWindows().length < 2) return;
  e.stopImmediatePropagation();
}

function isWindowish(node) {
  return node && node.nodeType === 1 && typeof node.matches === 'function' && node.matches(WINDOW_MATCH);
}

function relevant(records) {
  for (const r of records) {
    if (r.type === 'attributes' && isWindowish(r.target)) return true;
    if (r.type === 'childList') {
      for (const n of r.addedNodes) if (isWindowish(n)) return true;
      for (const n of r.removedNodes) if (isWindowish(n)) return true;
    }
  }
  return false;
}

function start() {
  window.addEventListener('odysseus:modal-opened', schedule);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onEscapeBubble, false);
  new MutationObserver((records) => { if (relevant(records)) schedule(); })
    .observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: true,
      subtree: true,
    });
  schedule();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
