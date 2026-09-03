/**
 * Clicks one control inside the program frame that is currently on top, then
 * reports what changed. Used while learning a screen.
 *
 *   node tools/_smoke/click-in-program.mjs "הוספה (Alt+v)" [snapshot-name]
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { activeFrames } from '../../src/navigate.js';
import { inspectPage, digest } from '../../src/inspect.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../../src/config.js';

const label = process.argv[2];
const saveAs = process.argv[3] || null;

const logger = new RunLogger('click-in-program');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

// The busiest frame whose name looks like a program slot (f0, f1, ...).
const active = await activeFrames(page);
const prog = active.find((f) => /^f\d+$/.test(f.name)) ?? active[0];
// A window that is open but has no program in it used to die here on
// `prog.name` with a TypeError, which reads like a bug in the tool rather than
// like "you forgot to open the program" — which is what it always is.
if (!prog) {
  console.log('אין תוכנית פתוחה בחלון. תריץ קודם:  npm run open-program -- <קיצור>');
  process.exit(1);
}
console.log(`frame התוכנית: ${prog.name} (${prog.elements} אלמנטים)\n`);
const frame = page.frames().find((fr) => (fr.name() || '(anon)') === prog.name);

// Max2000 toolbar buttons are icons whose label lives in `title`, so pass an id
// selector (#newRec) rather than matching on text.
const selector = label.startsWith('#') || label.includes('[') ? label : `button[title*=${JSON.stringify(label)}]`;
await human.click(selector, { scope: frame, label });
await human.settle('after click');
await human.think('form settling');

const snap = await inspectPage(page);
const text = digest(snap);
if (saveAs) {
  const base = resolve(ROOT, 'knowledge/screens', saveAs);
  writeFileSync(`${base}.json`, JSON.stringify(snap, null, 2), 'utf8');
  writeFileSync(`${base}.txt`, text, 'utf8');
  console.log(`→ ${base}.json`);
}
await logger.shot(page, saveAs || 'after-click');
await s.browser.close().catch(() => {});
logger.done();
