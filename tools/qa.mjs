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
  dark:  { colors: { bg:'#111114', fg:'#e7e7ec', panel:'#17171c', border:'#26262e', red:'#4f46e5' }, font:'sans', density:'comfortable', bgPattern:'none' },
  light: { colors: { bg:'#fbfbfc', fg:'#1b1b1f', panel:'#ffffff', border:'#e5e5ea', red:'#4f46e5' }, font:'sans', density:'comfortable', bgPattern:'none' },
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
        const h = document.getElementById('hamburger-btn') || document.querySelector('.hamburger-btn');
        if (vis(h)) h.click();
      }).catch(() => {});
      await sleep(900);
      await p.evaluate(() => { const l = document.getElementById('app-loader'); if (l) l.remove(); }).catch(() => {});
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
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;}';
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
  const browser = await puppeteer.launch({
    executablePath: BRAVE,
    headless,
    args,
    defaultViewport: { width: 1440, height: 900 },
  });
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
