#!/usr/bin/env node
/* Ariadne icon generator.
 *
 * Renders the brand mark (an "Ariadne's thread" labyrinth spiral) to PNGs at the
 * sizes the PWA/apple-touch manifest needs, using the same headless browser the
 * visual-QA harness uses. Run with MODE=preview to dump candidates into qa/ for
 * inspection; run with MODE=final to write the real assets into ../static/icons.
 *
 *   QA_BROWSER=edge MODE=preview node make_icons.mjs
 *   QA_BROWSER=edge MODE=final   node make_icons.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSERS = {
  brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
};
const BROWSER = BROWSERS[process.env.QA_BROWSER || 'edge'] || BROWSERS.edge;
const MODE = process.env.MODE || 'preview';

const INDIGO = '#4f46e5';
const INK = '#111114';

// ── The mark ──────────────────────────────────────────────────────────────
// A single continuous stroke that coils inward — reads as both a coil of
// Ariadne's thread and the path through a (squared) labyrinth, with an open
// corner top-right as the maze entrance and a dot at the centre (journey's end).
// Authored on a 0..32 viewBox; everything else just rescales this.
const SPIRAL_PATH = 'M24 4 L4 4 L4 28 L28 28 L28 10 L12 10 L12 22 L22 22 L22 16 L16 16';

function markInner(color, strokeW = 3) {
  return (
    `<path d='${SPIRAL_PATH}' fill='none' stroke='${color}' stroke-width='${strokeW}' ` +
    `stroke-linecap='round' stroke-linejoin='round'/>` +
    `<circle cx='16' cy='16' r='2.1' fill='${color}'/>`
  );
}

// A full SVG document for a given pixel size.
function svgDoc({ size, color, strokeW, bg = null, pad = 0 }) {
  // pad shrinks the mark inside the tile (for maskable safe-zone). The mark is
  // authored on 0..32; we map it into [pad, 32-pad] via a nested viewBox trick:
  // simplest is to scale the 32-box into an inner square.
  const inner = 32 - pad * 2;
  const scale = inner / 32;
  const bgRect = bg ? `<rect width='32' height='32' rx='${bg.rx ?? 0}' fill='${bg.fill}'/>` : '';
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 32 32'>` +
    bgRect +
    `<g transform='translate(${pad} ${pad}) scale(${scale})'>${markInner(color, strokeW)}</g>` +
    `</svg>`
  );
}

// Targets to render. transparent => omitBackground in the screenshot.
function targets() {
  if (MODE === 'final') {
    const dir = join(HERE, '..', 'static', 'icons');
    return [
      // Installed-app tiles: full-bleed indigo, white mark (high contrast, looks
      // good when the launcher crops it to a circle/squircle).
      { file: join(dir, 'icon-192.png'), size: 192, svg: svgDoc({ size: 192, color: '#fff', strokeW: 3, bg: { fill: INDIGO }, pad: 4 }) },
      { file: join(dir, 'icon-512.png'), size: 512, svg: svgDoc({ size: 512, color: '#fff', strokeW: 3, bg: { fill: INDIGO }, pad: 4 }) },
      // Maskable: extra safe-zone padding so nothing important gets cropped.
      { file: join(dir, 'icon-maskable-512.png'), size: 512, svg: svgDoc({ size: 512, color: '#fff', strokeW: 2.8, bg: { fill: INDIGO }, pad: 7 }) },
      // Notification badge favicon.png (was referenced but missing): indigo mark
      // on transparent so it sits on any notification surface.
      { file: join(dir, '..', 'favicon.png'), size: 192, transparent: true, svg: svgDoc({ size: 192, color: INDIGO, strokeW: 3, pad: 2 }) },
    ];
  }
  // preview
  const dir = join(HERE, 'qa');
  return [
    { file: join(dir, 'mark-tab-32.png'), size: 32, transparent: true, svg: svgDoc({ size: 32, color: INDIGO, strokeW: 3, pad: 1 }) },
    { file: join(dir, 'mark-tab-64.png'), size: 64, transparent: true, svg: svgDoc({ size: 64, color: INDIGO, strokeW: 3, pad: 1 }) },
    { file: join(dir, 'mark-glyph-256.png'), size: 256, transparent: true, svg: svgDoc({ size: 256, color: INDIGO, strokeW: 3, pad: 1 }) },
    { file: join(dir, 'mark-app-256.png'), size: 256, svg: svgDoc({ size: 256, color: '#fff', strokeW: 3, bg: { fill: INDIGO, rx: 7 }, pad: 4 }) },
    { file: join(dir, 'mark-app-dark-256.png'), size: 256, svg: svgDoc({ size: 256, color: INDIGO, strokeW: 3, bg: { fill: INK, rx: 7 }, pad: 4 }) },
    { file: join(dir, 'mark-maskable-256.png'), size: 256, svg: svgDoc({ size: 256, color: '#fff', strokeW: 2.8, bg: { fill: INDIGO }, pad: 7 }) },
  ];
}

async function main() {
  const list = targets();
  mkdirSync(dirname(list[0].file), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--disable-gpu'],
  });
  const page = await browser.newPage();
  for (const t of list) {
    const html = `<!doctype html><html><head><meta charset=utf-8><style>*{margin:0;padding:0}html,body{background:transparent}</style></head><body>${t.svg}</body></html>`;
    await page.setViewport({ width: t.size, height: t.size, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: t.file, omitBackground: !!t.transparent, clip: { x: 0, y: 0, width: t.size, height: t.size } });
    console.log('wrote', t.file);
  }
  await browser.close();
  console.log('done', MODE);
}
main().catch(e => { console.error(e); process.exit(1); });
