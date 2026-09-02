/**
 * Maps whatever screen is currently open in the agent's Chrome window.
 *
 *   npm run snapshot -- <name>
 *
 * Writes knowledge/screens/<name>.json (the machine-readable recipe),
 * knowledge/screens/<name>.txt (the readable digest) and a screenshot.
 * Requires `npm run open` to be running in another terminal.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attachBrowser } from '../src/browser.js';
import { inspectPage, digest } from '../src/inspect.js';
import { ROOT } from '../src/config.js';

const name = (process.argv[2] || 'screen').replace(/[^\w֐-׿-]/g, '-');

const session = await attachBrowser();
if (!session) {
  console.error('לא נמצא חלון סוכן פתוח. תריץ קודם בטרמינל נפרד:  npm run open');
  process.exit(1);
}

const { page, browser } = session;

const snap = await inspectPage(page);
const text = digest(snap);

const base = resolve(ROOT, 'knowledge/screens', name);
writeFileSync(`${base}.json`, JSON.stringify(snap, null, 2), 'utf8');
writeFileSync(`${base}.txt`, text, 'utf8');
await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});

console.log(text);
console.log(`\n→ ${base}.json`);
console.log(`→ ${base}.txt`);
console.log(`→ ${base}.png`);

await browser.close().catch(() => {}); // detaches CDP only; the window stays open
