import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { readdirSync, statSync } from 'node:fs';

const wh = process.argv[2];
const DL = 'C:/Users/drora/Downloads';
const before = new Set(readdirSync(DL));

const logger = new RunLogger(`export-wh-${wh}`);
const s = await attachBrowser({ logger });
const { page, human } = s;

const items = page.frames().find((f) => /Erp\/Prt\/PrtV/i.test(f.url()));
if (!items) { console.log('מסך הפריטים לא פתוח'); process.exit(1); }

await human.click('#ExpExl', { scope: items, label: 'יצוא לאקסל' });
await human.settle('export dialog');

const dlg = page.frames().find((f) => /Prt_ExcelP/i.test(f.url()));
if (!dlg) { console.log('דיאלוג הייצוא לא נפתח'); process.exit(1); }

// Same warehouse in both ends of the range limits the export to it.
for (const id of ['Store_MlayM', 'Store_MlayA']) {
  await dlg.locator(`#${id}`).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(wh, { delay: 80 });
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 800));
}
const set = await dlg.evaluate(() => ({
  from: document.getElementById('Store_MlayM')?.value,
  to: document.getElementById('Store_MlayA')?.value,
}));
logger.step('warehouse', `מחסן מלאי ${set.from} עד ${set.to}`);
if (String(set.from) !== wh || String(set.to) !== wh) {
  console.log(`המחסן לא נקבע נכון (${set.from}-${set.to}) — לא מריץ.`);
  process.exit(1);
}

await human.click('#OK', { scope: dlg, label: 'הרצת הייצוא' });
console.log('מחכה לקובץ...');
let found = null;
for (let i = 0; i < 60 && !found; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  try { found = readdirSync(DL).find((f) => !before.has(f) && !f.endsWith('.crdownload')); } catch {}
}
console.log(found ? `\nירד: ${found}  (${(statSync(`${DL}/${found}`).size / 1024).toFixed(0)} KB)` : '\nלא ירד קובץ');
logger.done();
process.exit(0);
