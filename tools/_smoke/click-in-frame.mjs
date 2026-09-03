/**
 * Clicks one control inside a NAMED frame, then snapshots.
 *
 *   node tools/_smoke/click-in-frame.mjs "Kabala_OshU" "#goLines" osh-3-lines
 *
 * Why this exists next to click-in-program.mjs: that tool picks the program
 * frame with the most elements, which is fine while one program is open. In
 * a146 the list (Kabala_OshV, ~100 elements) stays open behind the header
 * (Kabala_OshU, ~40), so "the busiest frame" is the wrong frame and the click
 * lands on the list. Here the frame is named, not guessed.
 *
 * The frame pattern is matched against the PATH only — a Max2000 query string
 * carries DocNo, Mode and FromFrame, and matching against it makes an exact
 * pattern behave like a fuzzy one.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { framePath } from '../../src/navigate.js';
import { inspectPage, digest } from '../../src/inspect.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../../src/config.js';

const [pattern, selector, saveAs] = process.argv.slice(2);
if (!pattern || !selector) {
  console.log('שימוש:  node tools/_smoke/click-in-frame.mjs "<regex של ה-frame>" "<selector>" [שם-צילום]');
  process.exit(1);
}

const logger = new RunLogger('click-in-frame');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח. תריץ קודם:  npm run open'); process.exit(1); }
const { page, human } = s;

const re = new RegExp(pattern, 'i');
const frame = page.frames().find((f) => re.test(framePath(f.url())));
if (!frame) {
  console.log(`אין frame שמתאים ל-/${pattern}/. פתוחים:`);
  for (const f of page.frames()) console.log(`  ${(f.name() || '(anon)').padEnd(12)} ${framePath(f.url())}`);
  process.exit(1);
}
console.log(`frame: ${frame.name() || '(anon)'}  ${framePath(frame.url())}`);

const before = new Set(page.frames().map((f) => f.name() + framePath(f.url())));

await human.click(selector, { scope: frame, label: selector });
await human.settle('after click');
await human.think('screen settling');

const opened = page.frames().filter((f) => !before.has(f.name() + framePath(f.url())));
console.log(opened.length
  ? `\nframes חדשים:\n${opened.map((f) => `  ${(f.name() || '(anon)').padEnd(12)} ${framePath(f.url())}`).join('\n')}`
  : '\nלא נפתח frame חדש.');

const snap = await inspectPage(page);
if (saveAs) {
  const base = resolve(ROOT, 'knowledge/screens', saveAs);
  writeFileSync(`${base}.json`, JSON.stringify(snap, null, 2), 'utf8');
  writeFileSync(`${base}.txt`, digest(snap), 'utf8');
  console.log(`→ ${base}.json`);
}
await logger.shot(page, saveAs || 'after-click');
await s.browser.close().catch(() => {});
logger.done();
