#!/usr/bin/env node
/* Visual QA driver — drives the installed Brave (puppeteer-core) against the
 * live app (LOCALHOST_BYPASS) and screenshots key screens in dark + light.
 *
 * Light/dark is set the way the real app does it: a saved theme whose `colors`
 * are written to :root as inline vars (the color-mix-derived tokens recompute
 * from there). The app never uses a `.light` class.
 *
 * Env:
 *   QA_THEME=dark|light   run a single theme
 *   QA_SCENARIO=name      run a scenario (default: shell)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'qa');
mkdirSync(OUT, { recursive: true });

const BROWSERS = {
  brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
};
const BRAVE = BROWSERS[process.env.QA_BROWSER || 'brave'] || BROWSERS.brave;
const BASE = process.env.QA_BASE || 'http://127.0.0.1:7077/';
const SCENARIO = process.env.QA_SCENARIO || 'shell';

const THEMES = {
  dark:  { name:'ariadne',  colors: { bg:'#111114', fg:'#e7e7ec', panel:'#17171c', border:'#26262e', red:'#4f46e5' }, font:'sans', density:'comfortable', bgPattern:'none' },
  light: { name:'daylight', colors: { bg:'#fbfbfc', fg:'#1b1b1f', panel:'#ffffff', border:'#e5e5ea', red:'#4f46e5' }, font:'sans', density:'comfortable', bgPattern:'none' },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);

async function getSessionCookie() {
  const res = await fetch(new URL('/api/auth/login', BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.QA_USER || 'qa',
      password: process.env.QA_PASS || 'qa-visual-QA-12345',
    }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/^([^=]+)=([^;]+)/);
  if (!m) throw new Error('no session cookie: ' + res.status + ' ' + setCookie);
  return { name: m[1], value: m[2] };
}

// Scenarios: each is a list of {name, fn?} steps run AFTER the shell is ready.
// fn(page) may click/open things; the screenshot is taken after.
// Click the first VISIBLE element matching any selector, or (for text) a
// visible element whose trimmed own-text equals the label. el.click() on a
// hidden element (e.g. the icon rail while the sidebar is expanded) is a no-op,
// so visibility matters.
async function closeAll(page) {
  await page.evaluate(() => {
    const vis = (el) => el && el.offsetParent !== null && el.getClientRects().length > 0;
    // Dismiss first-run onboarding tooltips so they stop overlapping panels.
    [...document.querySelectorAll('button')].forEach(b => { const t = (b.textContent || '').trim(); if (vis(b) && (t === 'Got it' || t === 'OK')) b.click(); });
    // Close any open windows/modals (draggable panels don't close on Escape).
    [...document.querySelectorAll('.close-btn')].forEach(b => { if (vis(b)) b.click(); });
  }).catch(() => {});
  await sleep(450);
}

async function open(page, target) {
  await closeAll(page);
  const clicked = await page.evaluate((t) => {
    const vis = (el) => el && el.offsetParent !== null && el.getClientRects().length > 0;
    if (t.sel) { for (const s of t.sel.split(',')) { const el = document.querySelector(s.trim()); if (vis(el)) { el.click(); return s; } } }
    if (t.text) {
      const els = [...document.querySelectorAll('button, a, .nav-item, [role="button"], li, span, div')];
      const cands = els.filter(e => vis(e) && (e.textContent || '').trim() === t.text);
      cands.sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight));
      if (cands[0]) { cands[0].click(); return 'text:' + t.text; }
    }
    return null;
  }, target).catch(() => null);
  log('    open', JSON.stringify(target), '->', clicked || 'NOT FOUND');
  await sleep(1200);
  await page.evaluate(() => { const l = document.getElementById('app-loader'); if (l) l.remove(); }).catch(() => {});
}
const step = (name, target) => ({ name, fn: (p) => open(p, target) });

const SCENARIOS = {
  shell: [{ name: 'shell' }],
  // Collapse the sidebar so the mini icon-rail is shown, to verify icon contrast.
  rail: [
    { name: 'rail', fn: async (p) => {
      await p.evaluate(() => {
        const vis = (el) => el && el.offsetParent !== null && el.getClientRects().length > 0;
        const h = document.getElementById('sidebar-toggle-btn') || document.querySelector('.sidebar-hamburger')
          || document.getElementById('hamburger-btn') || document.querySelector('.hamburger-btn');
        if (vis(h)) h.click();
      }).catch(() => {});
      await sleep(900);
      await p.evaluate(() => { const l = document.getElementById('app-loader'); if (l) l.remove(); }).catch(() => {});
      const sw = await p.evaluate(() => {
        const read = (sel) => { const s = document.querySelector(sel + ' svg'); return s ? getComputedStyle(s).strokeWidth : null; };
        return { search: read('#rail-search-btn'), newchat: read('#rail-new-session'),
                 cookbook: read('#rail-cookbook'), calendar: read('#rail-calendar'),
                 hamburger: read('#sidebar-toggle-btn') };
      }).catch(e => ({ err: e.message }));
      log('  rail-stroke', JSON.stringify(sw));
    } },
  ],
  screens: [
    { name: 'shell' },
    step('settings', { sel: '#user-bar-settings, #rail-settings' }),
    step('theme', { text: 'Theme', sel: '#rail-theme' }),
    step('calendar', { text: 'Calendar', sel: '#rail-calendar' }),
    step('notes', { text: 'Notes', sel: '#rail-notes' }),
    step('tasks', { text: 'Tasks', sel: '#rail-tasks' }),
    step('gallery', { text: 'Gallery', sel: '#rail-gallery' }),
    step('brain', { text: 'Brain', sel: '#rail-memory' }),
    step('library', { text: 'Library', sel: '#rail-archive' }),
    step('email', { text: 'Email', sel: '#rail-email' }),
    step('compare', { text: 'Compare', sel: '#rail-compare' }),
    step('cookbook', { text: 'Cookbook', sel: '#rail-cookbook' }),
    step('research', { text: 'Deep Research', sel: '#rail-research' }),
    step('modelpicker', { sel: '#model-picker-btn' }),
  ],
  // Phase 5 — open 3 tool windows so they stack, then verify the focus layer:
  // the open-windows switcher lists all three, the front window is active and
  // the rest are dimmed (logged numerically since same-size windows occlude),
  // switcher-focus raises an earlier window, and Esc closes the front one.
  windows: [
    { name: 'windows-stack', fn: async (p) => {
      await closeAll(p);
      const clickTool = async (sel, text) => {
        await p.evaluate((s, t) => {
          const vis = (el) => el && el.offsetParent !== null && el.getClientRects().length > 0;
          const direct = document.querySelector(s);
          if (vis(direct)) { direct.click(); return; }
          const els = [...document.querySelectorAll('button, a, .nav-item, [role="button"], li, span, div')];
          const c = els.filter(e => vis(e) && (e.textContent || '').trim() === t)
                       .sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight));
          if (c[0]) c[0].click();
        }, sel, text).catch(() => {});
        await sleep(1000);
        await p.evaluate(() => { const l = document.getElementById('app-loader'); if (l) l.remove(); }).catch(() => {});
      };
      log('  open calendar'); await clickTool('#rail-calendar', 'Calendar');
      log('  open tasks');    await clickTool('#rail-tasks', 'Tasks');
      log('  open gallery');  await clickTool('#rail-gallery', 'Gallery');
      log('  opened all'); await sleep(700);
      const info = await p.evaluate(() => {
        const sel = 'body > .modal, body > .research-overlay, body > .notes-pane-backdrop';
        const open = [...document.querySelectorAll(sel)].filter(e => {
          const c = getComputedStyle(e);
          return !e.classList.contains('hidden') && !e.classList.contains('modal-minimized')
            && c.display !== 'none' && c.visibility !== 'hidden';
        });
        const sw = document.getElementById('ax-window-switcher');
        return {
          open: open.map(w => {
            const mc = w.querySelector('.modal-content') || w;
            return { id: w.id || w.className.split(' ')[0], role: w.getAttribute('role'),
                     active: w.classList.contains('ax-win-active'),
                     inactive: w.classList.contains('ax-win-inactive'),
                     opacity: getComputedStyle(mc).opacity };
          }),
          switcher: sw ? { shown: getComputedStyle(sw).display !== 'none',
                           items: sw.querySelectorAll('.ax-window-switcher-item').length } : null,
        };
      }).catch(e => ({ err: e.message }));
      log('  windows', JSON.stringify(info));
    } },
    { name: 'windows-focus-earliest', fn: async (p) => {
      await p.evaluate(() => {
        const it = document.querySelector('#ax-window-switcher .ax-window-switcher-focus');
        if (it) it.click();
      }).catch(() => {});
      await sleep(600);
    } },
    { name: 'windows-after-esc', fn: async (p) => {
      const before = await p.evaluate(() => {
        const sel = 'body > .modal, body > .research-overlay, body > .notes-pane-backdrop';
        const cnt = () => [...document.querySelectorAll(sel)].filter(e => {
          const c = getComputedStyle(e);
          return !e.classList.contains('hidden') && !e.classList.contains('modal-minimized')
            && c.display !== 'none' && c.visibility !== 'hidden';
        }).length;
        window.__escProbe = { cap: 0, bub: 0 };
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__escProbe.cap++; }, true);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__escProbe.bub++; }, false);
        return cnt();
      }).catch(() => -1);
      const cnt = () => p.evaluate(() => {
        const sel = 'body > .modal, body > .research-overlay, body > .notes-pane-backdrop';
        return [...document.querySelectorAll(sel)].filter(e => {
          const c = getComputedStyle(e);
          return !e.classList.contains('hidden') && !e.classList.contains('modal-minimized')
            && c.display !== 'none' && c.visibility !== 'hidden';
        }).length;
      }).catch(() => -1);
      await p.keyboard.press('Escape').catch(() => {});  // 1st: field has focus → absorbed, no cascade
      await sleep(450);
      const mid = await cnt();
      await p.keyboard.press('Escape').catch(() => {});  // 2nd: closes just the front window
      await sleep(450);
      log('  esc-probe', JSON.stringify({ before, afterFirst: mid, afterSecond: await cnt() }));
      await sleep(200);
    } },
  ],
  confirm: [
    { name: 'confirm-default', fn: async (p) => {
      await p.keyboard.press('Escape').catch(() => {});
      await sleep(300);
      await p.evaluate(() => { window.styledConfirm('Apply these changes to your workspace?', { confirmText: 'Apply' }); }).catch(() => {});
      await sleep(600);
    } },
    { name: 'confirm-danger', fn: async (p) => {
      await p.keyboard.press('Escape').catch(() => {});
      await sleep(300);
      await p.evaluate(() => { window.styledConfirm('Delete this conversation? This action cannot be undone.', { confirmText: 'Delete', danger: true }); }).catch(() => {});
      await sleep(600);
    } },
  ],
  // Phase 6 — render the skeleton-list into a visible panel so its layout +
  // contrast can be checked in both themes (real list skeletons only flash for
  // a moment during cold loads, which the post-settle capture misses).
  skeleton: [
    { name: 'skeleton', fn: async (p) => {
      await p.evaluate(() => {
        document.querySelectorAll('.modal, .research-overlay, .notes-pane-backdrop, #qa-skel').forEach(e => { try { e.remove(); } catch {} });
        const rows = Array.from({ length: 5 }, () =>
          '<div class="ax-skeleton-row"><div class="ax-skeleton ax-skeleton-line-title"></div><div class="ax-skeleton ax-skeleton-line-sub"></div></div>').join('');
        const box = document.createElement('div');
        box.id = 'qa-skel';
        box.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);width:520px;max-width:90vw;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;z-index:99999;box-shadow:0 12px 40px rgba(0,0,0,0.4)';
        box.innerHTML = '<div style="font-size:13px;font-weight:600;color:var(--fg);margin-bottom:8px">Loading list (skeleton)</div><div class="ax-skeleton-list">' + rows + '</div>';
        document.body.appendChild(box);
      }).catch(() => {});
      await sleep(400);
    } },
  ],
  // Phase 7 — open Tasks and inject a representative row (Run + Pause/Resume
  // pills) so the new single-primary hierarchy is visible: Run should render as
  // a filled accent button while its status-pill peers stay quiet/tinted. Logs
  // the computed Run background to confirm it's a solid fill, not a tinted mix.
  tasksrun: [
    { name: 'tasksrun', fn: async (p) => {
      await p.evaluate(() => {
        const vis = (el) => el && el.offsetParent !== null && el.getClientRects().length > 0;
        const direct = document.querySelector('#rail-tasks');
        if (vis(direct)) { direct.click(); return; }
        const els = [...document.querySelectorAll('button, a, .nav-item, [role="button"], li, span, div')];
        const c = els.filter(e => vis(e) && (e.textContent || '').trim() === 'Tasks')
                     .sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight));
        if (c[0]) c[0].click();
      }).catch(() => {});
      await sleep(900);
      const info = await p.evaluate(() => {
        const list = document.getElementById('tasks-list') || document.querySelector('.tasks-modal-content .memory-list, .tasks-modal-content .modal-body');
        if (!list) return { err: 'no tasks list' };
        const row = document.createElement('div');
        row.className = 'task-card memory-item';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px';
        row.innerHTML =
          '<span class="memory-item-title" style="flex:1">Sample scheduled task</span>' +
          '<span class="task-status-badge task-state-badge task-active-badge">Active</span>' +
          '<button class="task-status-badge task-run-now-badge task-card-run-btn"><span>Run</span></button>';
        list.prepend(row);
        const runBtn = row.querySelector('.task-run-now-badge');
        const cs = getComputedStyle(runBtn);
        return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor };
      }).catch(e => ({ err: e.message }));
      log('  run-badge', JSON.stringify(info));
      await sleep(300);
    } },
  ],
  // Phase 9 — run with QA_VIEWPORT=mobile. Reveals the skip link via Tab, opens
  // Tasks to confirm it becomes a full-screen sheet, and probes the shared
  // #toast live-region role/aria-live for success vs error.
  a11y: [
    { name: 'skiplink', fn: async (p) => {
      await closeAll(p);
      await p.evaluate(() => { document.body.focus(); window.scrollTo(0, 0); }).catch(() => {});
      const sk = await p.evaluate(() => {
        const a = document.querySelector('.skip-link');
        if (!a) return { err: 'no skip-link' };
        const hiddenTop = Math.round(a.getBoundingClientRect().top);
        a.focus();
        const r = a.getBoundingClientRect();
        return { focused: document.activeElement === a, hiddenTop, focusedTop: Math.round(r.top),
                 target: a.getAttribute('href'), text: a.textContent.trim() };
      }).catch(e => ({ err: e.message }));
      log('  skip-link', JSON.stringify(sk));
    } },
    { name: 'sheet-tasks', fn: async (p) => {
      await p.evaluate(() => {
        const vis = (el) => el && el.offsetParent !== null && el.getClientRects().length > 0;
        const direct = document.querySelector('#rail-tasks');
        if (vis(direct)) { direct.click(); return; }
        const els = [...document.querySelectorAll('button, a, [role="button"], li, span, div')];
        const c = els.filter(e => vis(e) && (e.textContent || '').trim() === 'Tasks')
                     .sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight));
        if (c[0]) c[0].click();
      }).catch(() => {});
      await sleep(900);
      const sheet = await p.evaluate(() => {
        const mc = document.querySelector('#tasks-modal .modal-content');
        if (!mc) return { err: 'no tasks sheet' };
        const r = mc.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
      }).catch(e => ({ err: e.message }));
      log('  tasks-sheet', JSON.stringify(sheet));
    } },
    { name: 'toast-live', fn: async (p) => {
      const probe = await p.evaluate(() => {
        const t = document.getElementById('toast');
        const fns = window.uiModule || window;
        const read = () => ({ role: t.getAttribute('role'), live: t.getAttribute('aria-live') });
        const out = {};
        try { (fns.showToast || window.showToast)?.('Saved'); out.success = read(); } catch (e) { out.successErr = e.message; }
        try { (fns.showError || window.showError)?.('Something failed'); out.error = read(); } catch (e) { out.errorErr = e.message; }
        return out;
      }).catch(e => ({ err: e.message }));
      log('  toast-live', JSON.stringify(probe));
      await sleep(200);
    } },
  ],
  // Phase 10 — the elevated model-picker trigger. Capture the resting composer
  // (empty chip should be accent-tinted), then open the picker and confirm the
  // chip reflects the open state via aria-expanded.
  picker: [
    { name: 'composer', fn: async (p) => {
      await closeAll(p);
      const rest = await p.evaluate(() => {
        const b = document.getElementById('model-picker-btn');
        if (!b) return { err: 'no picker btn' };
        const cs = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return { empty: b.classList.contains('model-picker-empty'), expanded: b.getAttribute('aria-expanded'),
                 h: Math.round(r.height), border: cs.borderColor, bg: cs.backgroundColor };
      }).catch(e => ({ err: e.message }));
      log('  picker-rest', JSON.stringify(rest));
    } },
    { name: 'picker-open', fn: async (p) => {
      await p.evaluate(() => { const b = document.getElementById('model-picker-btn'); if (b) b.click(); }).catch(() => {});
      await sleep(500);
      const open = await p.evaluate(() => {
        const b = document.getElementById('model-picker-btn');
        const m = document.getElementById('model-picker-menu');
        const labels = [...document.querySelectorAll('#model-picker-list .mp-section-label')].map(e => e.textContent.trim());
        return { expanded: b ? b.getAttribute('aria-expanded') : null,
                 menuOpen: m ? !m.classList.contains('hidden') : null, sections: labels };
      }).catch(e => ({ err: e.message }));
      log('  picker-open', JSON.stringify(open));
    } },
  ],
};

const CREDS = { username: process.env.QA_USER || 'qa', password: process.env.QA_PASS || 'qa-visual-QA-12345' };

async function bootPage(browser, cfg, cookie) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(25000);
  page.on('framenavigated', f => { if (f === page.mainFrame()) log('  NAV', f.url()); });
  await page.bringToFront().catch(() => {});
  // Suppress the boot overlay from the very first paint so it never creates a
  // position:fixed compositing layer (Brave headless otherwise freezes the
  // capture on that layer and never rasterizes the main document).
  await page.evaluateOnNewDocument(() => {
    const css = '#app-loader{display:none!important}';
    const inject = () => { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
    inject();
  }).catch(() => {});
  log('  setCookie'); await page.setCookie({ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/' }).catch(() => {});
  // Land on the (stable, unauthenticated) /login page first.
  log('  goto-login'); await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(e => log('  goto-login err', e.message));
  await page.waitForFunction(() => location.pathname === '/login' || document.querySelector('#message, .chat-input-bar'), { timeout: 12000 }).catch(() => {});
  await sleep(600);
  // Log in IN-BROWSER so the HttpOnly session cookie lands in this context,
  // then seed the theme. This stops the /login ⇄ / redirect loop.
  log('  login'); await page.evaluate(async (creds) => {
    try { await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds), credentials: 'include' }); } catch {}
  }, CREDS).catch(e => log('  login err', e.message));
  await page.evaluate((t) => {
    try { localStorage.setItem('odysseus-theme', JSON.stringify(t)); localStorage.setItem('odysseus-ui-scale', '100'); localStorage.setItem('odysseus-welcome-seen', '1'); } catch {}
  }, cfg).catch(() => {});
  log('  goto-app'); await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(e => log('  goto-app err', e.message));
  log('  waitbar'); await page.waitForSelector('#message, .chat-input-bar', { timeout: 15000 }).catch(e => log('  waitbar err', e.message));
  // Confirm we're settled on the app (not bouncing to /login).
  await page.waitForFunction(() => location.pathname === '/' && !document.getElementById('app-loader'), { timeout: 12000 }).catch(() => {});
  log('  settle'); await sleep(parseInt(process.env.QA_SETTLE || '2500', 10));
  log('  cleanup'); await page.evaluate(() => {
    // Remove the boot overlay and any animated background canvases, and stop
    // all CSS animations/transitions so the headless compositor captures a
    // stable, current frame (Brave headless otherwise grabs a stale surface).
    ['app-loader', 'loader-wave'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
    document.querySelectorAll('#synapse-canvas,#rain-canvas,#constellations-canvas,#perlin-flow-canvas,#petals-canvas,#sparkles-canvas,#embers-canvas').forEach(c => c.remove());
    const s = document.createElement('style');
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}';
    document.head.appendChild(s);
  }).catch(e => log('  cleanup err', e.message));
  // Force two animation frames so layout/paint flush before capture.
  log('  raf'); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
  await sleep(400);
  if (process.env.QA_ELT) {
    const dump = await page.evaluate(() => {
      const pick = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { sel: el.id ? '#' + el.id : el.tagName + '.' + (el.className || '').toString().split(' ')[0], opacity: cs.opacity, visibility: cs.visibility, display: cs.display, filter: cs.filter, transform: cs.transform, color: cs.color, bg: cs.backgroundColor, font: cs.fontFamily.slice(0, 30) }; };
      const sb = document.querySelector('.sidebar, #sidebar');
      const navItem = document.querySelector('.sidebar a, .sidebar button, .nav-item');
      const chain = []; let n = sb; while (n && n !== document.documentElement) { chain.push(pick(n)); n = n.parentElement; }
      chain.push(pick(document.documentElement));
      return { fontsReady: document.fonts ? document.fonts.status : 'n/a', loadedFonts: document.fonts ? document.fonts.size : 0, navItemText: navItem ? navItem.innerText : null, navItem: pick(navItem), chain };
    }).catch(e => ({ err: e.message }));
    writeFileSync(join(OUT, '_styledump.json'), JSON.stringify(dump, null, 2));
    log('  styledump written');
  }
  return page;
}

async function run() {
  setTimeout(() => { console.error('hard-exit timeout'); process.exit(2); }, 90000).unref();
  const headless = process.env.QA_HEADLESS === 'old' ? true : (process.env.QA_HEADLESS === 'shell' ? 'shell' : 'new');
  const args = ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'];
  if (!process.env.QA_GPU) args.push('--disable-gpu');
  log('launch', 'headless=' + headless, 'gpu=' + (process.env.QA_GPU ? 'on' : 'off'));
  const mobile = process.env.QA_VIEWPORT === 'mobile';
  const browser = await puppeteer.launch({
    executablePath: BRAVE,
    headless,
    args,
    defaultViewport: mobile
      ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
      : { width: 1440, height: 900 },
  });
  if (mobile) log('viewport', 'mobile 390x844');
  const cookie = await getSessionCookie();
  const only = process.env.QA_THEME;
  const steps = SCENARIOS[SCENARIO] || SCENARIOS.shell;

  for (const [theme, cfg] of Object.entries(THEMES)) {
    if (only && theme !== only) continue;
    log(theme, 'boot');
    const page = await bootPage(browser, cfg, cookie);
    for (const step of steps) {
      if (step.fn) { try { await step.fn(page); } catch (e) { log('step', step.name, 'err', e.message); } }
      await sleep(step.fn ? 700 : 0);
      const file = join(OUT, `${step.name}-${theme}.png`);
      await page.bringToFront().catch(() => {});
      await page.screenshot({ path: file, captureBeyondViewport: false });
      log('shot', `${step.name}-${theme}`);
    }
    await page.close().catch(() => {});
  }
  await browser.close().catch(() => {});
  log('done');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
