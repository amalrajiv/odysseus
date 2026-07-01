// static/js/commandPalette.js
// ⌘K command palette — a unified fuzzy launcher that ties every surface of
// Ariadne together: actions, slash commands, chats, memories, documents, and
// contacts. Inspired by Raycast / Linear / Cmd-K patterns.
//
// Design notes:
//  - Self-contained: the overlay DOM is built lazily in JS (like
//    slashAutocomplete's popup), so there's no markup to maintain in
//    index.html and nothing renders until first invoked.
//  - No business logic is duplicated. Every result delegates to an existing
//    module or UI control (clicking a tool button, sessionModule.selectSession,
//    /api endpoints, the composer). This keeps the palette a thin "router".
//  - Deep message search is preserved: it's surfaced as a first-class result
//    that hands off to the untouched searchChatModule.

import { COMMANDS } from './slashCommands.js';
import sessionModule from './sessions.js';
import uiModule from './ui.js';
import searchChatModule from './search-chat.js';

const OVERLAY_ID = 'command-palette';
const PER_GROUP_CAP = 6;     // max rows shown per source group
const TOTAL_CAP = 40;        // hard ceiling across all groups
const CACHE_TTL_MS = 20000;  // async sources are re-fetched if older than this

let API_BASE = '';

// ── Inline icons (16px, stroke-based to match the app's iconography) ──
const ICON = {
  search:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  plus:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  brain:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/></svg>',
  tasks:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  notes:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5"/><path d="M8 17.5 15.5 10l2.5 2.5L10.5 20H8z"/></svg>',
  library:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  gallery:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 21"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  compare:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/><line x1="3" y1="8" x2="8" y2="8"/><line x1="16" y1="16" x2="21" y2="16"/></svg>',
  research: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  cookbook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  email:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  theme:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  incognito:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a3 3 0 1 0 0-.01M15 12a3 3 0 1 0 0-.01M2 12h3m14 0h3M5 12c1-3 3-4 7-4s6 1 7 4"/></svg>',
  sidebar:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  chat:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  command:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z"/></svg>',
  doc:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  contact:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
};

// Group ordering + a base score boost so equally-fuzzy results from
// higher-value groups rank first.
const GROUP_ORDER = ['Search', 'Actions', 'Chats', 'Commands', 'Memory', 'Documents', 'Contacts'];
const GROUP_BOOST = {
  Actions: 60, Chats: 45, Commands: 30, Memory: 25, Documents: 12, Contacts: 12, Search: 0,
};

// Tool launchers — each opens an existing tool window by clicking its
// sidebar/section button (so the tool's own open logic runs). `modal` lets us
// detect "already open" and avoid the click-toggles-to-minimize footgun.
const TOOL_ACTIONS = [
  { key: 'memory',   title: 'Open Brain',     kw: 'memory brain facts recall remember', btn: 'tool-memory-btn',   modal: 'memory-modal',          icon: ICON.brain },
  { key: 'tasks',    title: 'Open Tasks',     kw: 'tasks todo todos checklist',          btn: 'tool-tasks-btn',    modal: 'tasks-modal',           icon: ICON.tasks },
  { key: 'notes',    title: 'Open Notes',     kw: 'notes scratch quick',                 btn: 'tool-notes-btn',    modal: 'notes-panel',           icon: ICON.notes },
  { key: 'library',  title: 'Open Library',   kw: 'library documents docs files archive',btn: 'tool-library-btn',  modal: 'doclib-modal',          icon: ICON.library },
  { key: 'gallery',  title: 'Open Gallery',   kw: 'gallery images photos pictures',      btn: 'tool-gallery-btn',  modal: 'gallery-modal',         icon: ICON.gallery },
  { key: 'calendar', title: 'Open Calendar',  kw: 'calendar events schedule agenda',     btn: 'tool-calendar-btn', modal: 'calendar-modal',        icon: ICON.calendar },
  { key: 'compare',  title: 'Open Compare',   kw: 'compare models side by side',         btn: 'tool-compare-btn',  modal: 'compare-model-overlay', icon: ICON.compare },
  { key: 'research', title: 'Open Research',  kw: 'research deep report',                btn: 'tool-research-btn', modal: 'research-overlay',      icon: ICON.research },
  { key: 'cookbook', title: 'Open Cookbook',  kw: 'cookbook recipes local models gpu',   btn: 'tool-cookbook-btn', modal: 'cookbook-modal',        icon: ICON.cookbook },
  { key: 'email',    title: 'Open Email',     kw: 'email inbox mail messages',           btn: 'email-section-title', modal: 'email-lib-modal',     icon: ICON.email },
  { key: 'theme',    title: 'Open Theme',     kw: 'theme appearance dark light color',   btn: 'tool-theme-btn',    modal: 'theme-modal',           icon: ICON.theme },
  { key: 'settings', title: 'Open Settings',  kw: 'settings preferences configuration',  btn: 'user-bar-settings', modal: 'settings-modal',        icon: ICON.settings },
];

// ── State ──
let overlay = null, input = null, list = null, countLive = null;
let visible = false;
let flat = [];          // flat list of currently-rendered items (for nav)
let activeIdx = -1;
let lastTrigger = null;
let staticItems = null; // actions + slash commands (built once)
const cache = { memory: { ts: 0, items: [] }, contacts: { ts: 0, items: [] }, docs: { ts: 0, items: [] } };

const esc = uiModule && uiModule.esc ? uiModule.esc : (s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

function el(id) { return document.getElementById(id); }

// ── Fuzzy scoring ──────────────────────────────────────────────────────
// Subsequence match with bonuses for prefix, consecutive runs, and word
// boundaries. Returns -1 when `q` is not a subsequence of `text`.
function _fuzzy(q, text) {
  if (!q) return 0;
  if (!text) return -1;
  const t = String(text).toLowerCase();
  q = q.toLowerCase();
  if (t === q) return 1000;
  let ti = 0, score = 0, streak = 0;
  if (t.startsWith(q)) score += 120;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = -1;
    for (let k = ti; k < t.length; k++) { if (t[k] === c) { found = k; break; } }
    if (found < 0) return -1;
    if (found === ti && qi > 0) { streak++; score += 6 + streak * 2; } else { streak = 0; score += 1; }
    if (found === 0) score += 14;
    else {
      const prev = t[found - 1];
      if (prev === ' ' || prev === '-' || prev === '_' || prev === '/' || prev === '.') score += 9;
    }
    ti = found + 1;
  }
  score += Math.max(0, 16 - (t.length - q.length)) / 4;  // prefer shorter targets
  return score;
}

// Score an item against a (possibly multi-word) query. Every query term must
// match at least one of the item's fields (AND semantics); the score is the
// sum of each term's best field match plus the group boost.
function _scoreItem(item, query) {
  const terms = query.split(/\s+/).filter(Boolean);
  if (!terms.length) return item._boost || 0;
  let total = 0;
  for (const term of terms) {
    const best = Math.max(
      _fuzzy(term, item.title),
      item.token ? _fuzzy(term, item.token) : -1,
      _fuzzy(term, item._kw || '') * 0.6,
      _fuzzy(term, item.subtitle || '') * 0.5,
    );
    if (best < 0) return -1;
    total += best;
  }
  return total + (item._boost || 0);
}

// ── Sources ────────────────────────────────────────────────────────────

function _isModalOpen(modalId) {
  const m = el(modalId);
  if (!m || m.classList.contains('hidden') || m.classList.contains('modal-minimized')) return false;
  const cs = getComputedStyle(m);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  return m.offsetWidth > 0 || m.offsetHeight > 0 || m.getClientRects().length > 0;
}

// Open a tool by clicking its button — but only when it isn't already open,
// because the rail/sidebar buttons toggle (open→minimize).
function _openTool(btnId, modalId) {
  if (modalId && _isModalOpen(modalId)) return;
  const btn = el(btnId);
  if (btn) btn.click();
}

function _insertIntoComposer(text, { focus = true } = {}) {
  const ta = el('message');
  if (!ta) return;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (focus) {
    ta.focus();
    const len = ta.value.length;
    try { ta.setSelectionRange(len, len); } catch (_) {}
  }
}

function _buildStaticItems() {
  const items = [];

  // New chat — clicking the brand always starts a fresh session.
  items.push({
    group: 'Actions', title: 'New chat', subtitle: 'Start a fresh conversation',
    icon: ICON.plus, _kw: 'new chat conversation create start',
    run: () => { const b = el('sidebar-brand-btn'); if (b) b.click(); },
  });

  // Tool launchers (only those whose button exists in the DOM).
  for (const t of TOOL_ACTIONS) {
    if (!el(t.btn)) continue;
    items.push({
      group: 'Actions', title: t.title, icon: t.icon, _kw: t.kw,
      run: () => _openTool(t.btn, t.modal),
    });
  }

  // Toggle incognito ("Nobody" mode).
  if (el('incognito-btn')) {
    items.push({
      group: 'Actions', title: 'Toggle incognito', subtitle: 'Nobody mode — no memory or history',
      icon: ICON.incognito, _kw: 'incognito nobody private ephemeral no memory',
      run: () => { const b = el('incognito-btn'); if (b) b.click(); },
    });
  }

  // Toggle sidebar (mirrors the keyboard shortcut behavior).
  items.push({
    group: 'Actions', title: 'Toggle sidebar', icon: ICON.sidebar, _kw: 'sidebar hide show panel collapse',
    run: () => {
      const sb = el('sidebar'), ir = el('icon-rail');
      if (sb && !sb.classList.contains('hidden')) { sb.classList.add('hidden'); }
      else { if (ir) ir.classList.remove('rail-hidden'); if (sb) sb.classList.remove('hidden'); }
      if (typeof window.syncRailSide === 'function') { try { window.syncRailSide(); } catch (_) {} }
    },
  });

  // Slash commands — selecting inserts the token into the composer so the
  // user can add arguments before sending (matches the inline autocomplete).
  for (const [name, def] of Object.entries(COMMANDS)) {
    if (!def || def.hidden || (!def.handler && !def.subs)) continue;
    const token = `/${name}`;
    items.push({
      group: 'Commands', title: token, subtitle: def.help || '', token,
      icon: ICON.command, _kw: `${name} ${(def.alias || []).join(' ')} ${def.help || ''}`,
      hint: 'Insert',
      run: () => _insertIntoComposer(token + ' '),
    });
  }

  return items;
}

function _relTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function _sessionItems() {
  const sessions = (sessionModule && sessionModule.getSessions) ? sessionModule.getSessions() : [];
  const items = [];
  for (const s of sessions) {
    if (!s || !s.id) continue;
    const name = (s.name || '').trim();
    if (!name || name === 'Nobody' || name === 'Incognito') continue;
    const model = s.model ? s.model.split('/').pop() : '';
    const when = _relTime(s.last_message_at || s.updated_at || s.created_at);
    const subtitle = [model, when].filter(Boolean).join(' · ') + (s.archived ? ' · archived' : '');
    items.push({
      group: 'Chats', title: name, subtitle, icon: ICON.chat, _kw: name + ' ' + model,
      _recencyKey: new Date(s.last_message_at || s.updated_at || s.created_at || 0).getTime() || 0,
      run: () => { if (sessionModule && sessionModule.selectSession) sessionModule.selectSession(s.id); },
    });
  }
  return items;
}

async function _fetchJSON(url) {
  const res = await fetch(`${API_BASE}${url}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function _loadMemory() {
  if (Date.now() - cache.memory.ts < CACHE_TTL_MS && cache.memory.items.length) return cache.memory.items;
  try {
    const data = await _fetchJSON('/api/memory');
    const mems = Array.isArray(data) ? data : (data.memories || []);
    cache.memory.items = mems.filter(m => m && m.text).map(m => ({
      group: 'Memory', title: m.text, subtitle: (m.pinned ? 'pinned · ' : '') + (m.category || 'fact'),
      icon: ICON.brain, _kw: (m.text || '') + ' ' + (m.category || ''),
      run: () => {
        _openTool('tool-memory-btn', 'memory-modal');
        setTimeout(() => {
          const search = el('memory-search');
          if (search) { search.value = (m.text || '').slice(0, 60); search.dispatchEvent(new Event('input', { bubbles: true })); }
        }, 120);
      },
    }));
    cache.memory.ts = Date.now();
  } catch (_) { /* leave previous cache */ }
  return cache.memory.items;
}

async function _loadContacts() {
  if (Date.now() - cache.contacts.ts < CACHE_TTL_MS && cache.contacts.items.length) return cache.contacts.items;
  try {
    const data = await _fetchJSON('/api/contacts/list');
    const contacts = (data && data.contacts) || [];
    cache.contacts.items = contacts.filter(c => c && c.name).map(c => {
      const email = (c.emails && c.emails[0]) || '';
      const phone = (c.phones && c.phones[0]) || '';
      return {
        group: 'Contacts', title: c.name, subtitle: email || phone || '',
        icon: ICON.contact, _kw: `${c.name} ${(c.emails || []).join(' ')} ${(c.phones || []).join(' ')}`,
        hint: 'Insert',
        run: () => { _insertIntoComposer(c.name + ' '); if (uiModule && uiModule.showToast) uiModule.showToast(`Inserted ${c.name}`); },
      };
    });
    cache.contacts.ts = Date.now();
  } catch (_) { /* leave previous cache */ }
  return cache.contacts.items;
}

async function _loadDocs() {
  if (Date.now() - cache.docs.ts < CACHE_TTL_MS && cache.docs.items.length) return cache.docs.items;
  try {
    const data = await _fetchJSON('/api/documents/library?limit=50&sort=recent');
    const docs = (data && data.documents) || [];
    cache.docs.items = docs.filter(d => d && d.title).map(d => ({
      group: 'Documents', title: d.title,
      subtitle: [d.session_name, d.language, _relTime(d.updated_at)].filter(Boolean).join(' · '),
      icon: ICON.doc, _kw: `${d.title} ${d.session_name || ''} ${d.language || ''}`,
      run: () => _openTool('tool-library-btn', 'doclib-modal'),
    }));
    cache.docs.ts = Date.now();
  } catch (_) { /* leave previous cache */ }
  return cache.docs.items;
}

// ── Rendering ──────────────────────────────────────────────────────────

function _ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'cmdk-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Command palette');
  overlay.innerHTML = `
    <div class="cmdk-panel" role="document">
      <div class="cmdk-input-wrap">
        <span class="cmdk-input-icon" aria-hidden="true">${ICON.search}</span>
        <input id="cmdk-input" class="cmdk-input" type="text" autocomplete="off" autocapitalize="off"
               autocorrect="off" spellcheck="false" role="combobox" aria-expanded="true"
               aria-controls="cmdk-list" aria-autocomplete="list"
               placeholder="Search actions, chats, memories, docs, contacts\u2026" />
      </div>
      <div id="cmdk-list" class="cmdk-list" role="listbox" aria-label="Results"></div>
      <div class="cmdk-footer">
        <span class="cmdk-hints">
          <span><kbd>\u2191</kbd><kbd>\u2193</kbd> navigate</span>
          <span><kbd>\u21B5</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </span>
        <span class="cmdk-count" id="cmdk-count" aria-live="polite"></span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  input = overlay.querySelector('#cmdk-input');
  list = overlay.querySelector('#cmdk-list');
  countLive = overlay.querySelector('#cmdk-count');

  // Close when clicking the dim backdrop (but not the panel).
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('input', () => render());
  input.addEventListener('keydown', _onKeydown);

  // Delegated row interactions.
  list.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.cmdk-item');
    if (row && row.dataset.idx != null) _setActive(Number(row.dataset.idx), false);
  });
  list.addEventListener('mousedown', (e) => {
    const row = e.target.closest('.cmdk-item');
    if (!row) return;
    e.preventDefault();  // keep focus in the input
    const idx = Number(row.dataset.idx);
    if (!Number.isNaN(idx)) _execute(idx);
  });
}

function _groupItems(query) {
  const out = [];

  if (!query) {
    // Default "launcher" view: recent chats + primary actions.
    const recents = _sessionItems().sort((a, b) => b._recencyKey - a._recencyKey).slice(0, 5);
    out.push(...recents);
    const primary = new Set(['New chat', 'Open Brain', 'Open Tasks', 'Open Notes', 'Open Library', 'Open Settings']);
    out.push(...staticItems.filter(i => i.group === 'Actions' && primary.has(i.title)));
    return out;
  }

  // Score every candidate from all sources.
  const pool = staticItems
    .concat(_sessionItems())
    .concat(cache.memory.items, cache.docs.items, cache.contacts.items);

  const scored = [];
  for (const item of pool) {
    const s = _scoreItem(item, query);
    if (s >= 0) scored.push({ item, s });
  }
  scored.sort((a, b) => b.s - a.s);

  // Cap per group, then flatten in group order.
  const byGroup = {};
  for (const { item } of scored) {
    (byGroup[item.group] = byGroup[item.group] || []).push(item);
  }
  for (const g of GROUP_ORDER) {
    const arr = byGroup[g];
    if (arr && arr.length) out.push(...arr.slice(0, PER_GROUP_CAP));
  }
  return out.slice(0, TOTAL_CAP);
}

function render() {
  const query = input.value.trim();
  let items = _groupItems(query);

  // Always offer deep message search as a fallback / explicit path.
  if (query.length >= 2) {
    items = items.concat([{
      group: 'Search', title: `Search messages for \u201C${query}\u201D`,
      subtitle: 'Full-text search across all conversations', icon: ICON.search,
      run: () => {
        if (!searchChatModule) return;
        searchChatModule.openSearch();
        const si = el('search-input');
        if (si) { si.value = query; si.dispatchEvent(new Event('input', { bubbles: true })); }
      },
    }]);
  }

  flat = items;
  activeIdx = items.length ? 0 : -1;

  if (!items.length) {
    list.innerHTML = `<div class="cmdk-empty">No results for <strong>${esc(query)}</strong></div>`;
    countLive.textContent = '';
    input.removeAttribute('aria-activedescendant');
    return;
  }

  let html = '';
  let lastGroup = null;
  items.forEach((it, i) => {
    if (it.group !== lastGroup) {
      html += `<div class="cmdk-group" role="presentation">${esc(it.group)}</div>`;
      lastGroup = it.group;
    }
    const sub = it.subtitle ? `<span class="cmdk-item-sub">${esc(it.subtitle)}</span>` : '';
    const hint = it.hint ? `<span class="cmdk-item-hint">${esc(it.hint)}</span>` : '';
    html += `<div class="cmdk-item${i === activeIdx ? ' cmdk-item-active' : ''}" role="option" id="cmdk-opt-${i}" data-idx="${i}" aria-selected="${i === activeIdx}">`
      + `<span class="cmdk-item-icon" aria-hidden="true">${it.icon || ICON.command}</span>`
      + `<span class="cmdk-item-body"><span class="cmdk-item-title">${esc(it.title)}</span>${sub}</span>`
      + hint
      + `</div>`;
  });
  list.innerHTML = html;
  countLive.textContent = `${items.length} result${items.length === 1 ? '' : 's'}`;
  _syncActiveDescendant();
}

function _setActive(idx, scroll = true) {
  if (idx === activeIdx || idx < 0 || idx >= flat.length) return;
  const rows = list.querySelectorAll('.cmdk-item');
  if (rows[activeIdx]) { rows[activeIdx].classList.remove('cmdk-item-active'); rows[activeIdx].setAttribute('aria-selected', 'false'); }
  activeIdx = idx;
  const row = rows[activeIdx];
  if (row) {
    row.classList.add('cmdk-item-active');
    row.setAttribute('aria-selected', 'true');
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }
  _syncActiveDescendant();
}

function _syncActiveDescendant() {
  if (activeIdx >= 0) input.setAttribute('aria-activedescendant', `cmdk-opt-${activeIdx}`);
  else input.removeAttribute('aria-activedescendant');
}

function _move(delta) {
  if (!flat.length) return;
  let next = activeIdx + delta;
  if (next < 0) next = flat.length - 1;
  if (next >= flat.length) next = 0;
  _setActive(next);
}

function _execute(idx) {
  const item = flat[idx];
  if (!item) return;
  close();
  try { item.run(); }
  catch (e) {
    console.error('Command palette action failed:', e);
    if (uiModule && uiModule.showToast) uiModule.showToast('Action failed');
  }
}

function _onKeydown(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); _move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _move(-1); }
  else if (e.key === 'Tab') { e.preventDefault(); _move(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0) _execute(activeIdx); else if (flat.length) _execute(0); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  else if (e.key === 'Home') { e.preventDefault(); _setActive(0); }
  else if (e.key === 'End') { e.preventDefault(); _setActive(flat.length - 1); }
}

// ── Public API ─────────────────────────────────────────────────────────

export function open() {
  _ensureOverlay();
  if (!staticItems) staticItems = _buildStaticItems();
  lastTrigger = document.activeElement;
  visible = true;
  overlay.classList.remove('hidden');
  input.value = '';
  render();
  // Focus after paint so the caret lands reliably across browsers.
  requestAnimationFrame(() => { input.focus(); input.select(); });

  // Refresh async sources in the background; re-render when they arrive if the
  // user has started typing (so newly-loaded items become searchable).
  Promise.allSettled([_loadMemory(), _loadContacts(), _loadDocs()]).then(() => {
    if (visible && input.value.trim()) render();
  });
}

export function close() {
  if (!visible) return;
  visible = false;
  if (overlay) overlay.classList.add('hidden');
  flat = [];
  activeIdx = -1;
  if (lastTrigger && document.contains(lastTrigger) && typeof lastTrigger.focus === 'function') {
    try { lastTrigger.focus({ preventScroll: true }); } catch (_) {}
  }
  lastTrigger = null;
}

export function isOpen() { return visible; }

export function toggle() { visible ? close() : open(); }

export function init(apiBase) {
  API_BASE = apiBase || '';
  // Mirror the established window._slashAutocomplete / _ghostAutocomplete
  // pattern so other modules (keyboard shortcuts) can reach the palette
  // without a hard import.
  window._commandPalette = { open, close, isOpen, toggle };
}

const commandPalette = { init, open, close, isOpen, toggle };
export default commandPalette;
