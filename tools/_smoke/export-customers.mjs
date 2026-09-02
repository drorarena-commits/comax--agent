import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { openProgram } from '../../src/navigate.js';
import { readdirSync, statSync } from 'node:fs';

const DL = 'runs/downloads';
const before = new Set(readdirSync(DL));

const logger = new RunLogger('export-customers');
const s = await attachBrowser({ logger });
const { page, human } = s;

// Save downloads through the page's own handler, but do not depend on it:
// the previous attempt lost the file when the context went away mid-save.
page.context().on('download', async (d) => {
  try { await d.saveAs(`${DL}/${d.suggestedFilename()}`); } catch { /* fall back to the profile's own download dir */ }
});

const { frame } = await openProgram({ ...s, logger }, 'a133', { expect: /Lk_ExcelP/i });
await human.click('#OK', { scope: frame, label: 'אישור — הרצת הייצוא' });

console.log('מחכה לקובץ...');
let found = null;
for (let i = 0; i < 30 && !found; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  found = readdirSync(DL).find((f) => !before.has(f) && !f.endsWith('.crdownload'));
}
console.log(found ? `\nירד: ${DL}/${found}  (${(statSync(`${DL}/${found}`).size / 1024).toFixed(0)} KB)` : '\nלא ירד קובץ');
logger.done();
process.exit(0);
