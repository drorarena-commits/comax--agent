/**
 * Completes a קליטת חשבונית whose confirmation dialog is already on screen.
 *
 * The invoice was left at Doc650CloseU with copies=0, which Comax rejects
 * ("חובת הדפסה לפחות עותק אחד !"). This sets the copy count the profile asks
 * for and presses אישור, then checks the dialog actually went away.
 *
 *   node tools/_smoke/invoice-close-dialog.mjs
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { profile } from '../../src/documents/agents/invoice/index.js';
import { readTotals } from '../../src/document-totals.js';

const logger = new RunLogger('invoice-close-dialog');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const dlgRe = /Doc650CloseU/i;
const dlg = page.frames().find((f) => dlgRe.test(f.url()));
if (!dlg) { console.log('דיאלוג הקליטה לא פתוח.'); process.exit(1); }

// Never press print for real: the suppression is what makes a copy count safe.
const suppressed = await dlg.evaluate(() => /suppressed/.test(String(window.print)));
if (!suppressed) {
  console.log('⛔ window.print לא מנוטרל — עותק אחד יפתח את chrome://print ויתקע את הסוכן. עוצר.');
  process.exit(1);
}

const copies = String(profile.printCopies ?? 1);
await human.select('#PrintCopies', copies, { scope: dlg, label: `עותקים = ${copies}` });
await human.click('#OK', { scope: dlg, label: 'אישור קליטת חשבונית' });
await human.settle('filed');

const still = page.frames().find((f) => dlgRe.test(f.url()));
if (still) {
  const err = await page.evaluate(() => document.body?.innerText?.match(/[^\n]*!\s*$/m)?.[0] ?? null).catch(() => null);
  console.log(`\n  ⛔ הדיאלוג עדיין פתוח — לא נקלט.${err ? `\n  קומקס: ${err.trim()}` : ''}\n`);
  await logger.shot(page, 'still-open');
  process.exit(1);
}

const grid = page.frames().find((f) => profile.frames.linesGrid.test(f.url()));
const totals = grid ? await readTotals(grid).catch(() => null) : null;

console.log('\n  ✅ החשבונית נקלטה — הדיאלוג נסגר.');
if (totals) console.log(`    לפני מע"מ ${totals.beforeVat} · מע"מ ${totals.vat} · סה"כ ${totals.total}`);
await logger.shot(page, 'after-filing');
await s.browser.close().catch(() => {});
logger.done();
