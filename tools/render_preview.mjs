#!/usr/bin/env node
/* Render the component preview harness full-page in dark + daylight, for review.
 *   QA_BROWSER=edge node render_preview.mjs
 * Writes tools/qa/preview-dark.png and tools/qa/preview-daylight.png.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSERS = {
  brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
};
const BROWSER = BROWSERS[process.env.QA_BROWSER || 'edge'] || BROWSERS.edge;
const FILE = pathToFileURL(join(HERE, 'components_preview.html')).href;
const OUT = join(HERE, 'qa');

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--disable-gpu', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1160, height: 1000, deviceScaleFactor: 1 });
  for (const theme of ['dark', 'daylight']) {
    await page.goto(`${FILE}?theme=${theme}`, { waitUntil: 'load' });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = join(OUT, `preview-${theme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log('wrote', file);
  }
  await browser.close();
  console.log('done');
}
main().catch(e => { console.error(e); process.exit(1); });
