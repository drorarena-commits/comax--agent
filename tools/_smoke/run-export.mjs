import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { readdirSync, statSync } from 'node:fs';

const DL = 'runs/downloads';
const before = new Set(readdirSync(DL));
const logger = new RunLogger('run-export');
const s = await attachBrowser({ logger });
const { page, human } = s;

page.context().on('page', (p) => logger.step('popup', p.url().slice(0, 80)));
page.context().on('download', (d) => {
  logger.step('download', d.suggestedFilename());
  d.saveAs(`${DL}/${d.suggestedFilename()}`).catch((e) => logger.step('download', `שמירה נכשלה: ${e.message}`));
});

const fr = page.frames().find((f) => /Lk_ExcelP/i.test(f.url()));
if (!fr) { console.log('מסך הייצוא לא פתוח'); process.exit(1); }
await human.click('#OK', { scope: fr, label: 'החץ הירוק — הרצת הייצוא' });

console.log('מחכה...');
let found = null;
for (let i = 0; i < 40 && !found; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  try {
    found = readdirSync(DL).find((f) => !before.has(f) && !f.endsWith('.crdownload'));
  } catch { /* dir busy */ }
}
console.log(found ? `\nירד: ${found}  (${(statSync(`${DL}/${found}`).size / 1024).toFixed(0)} KB)` : '\nלא ירד קובץ');
logger.done();
process.exit(0);
