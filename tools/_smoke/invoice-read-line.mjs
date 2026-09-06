/**
 * קריאת שורה מחשבונית שפתוחה על המסך — בלי לשנות ובלי לקלוט.
 *
 * Opens the row, reads every field the line dialog holds, and leaves through
 * `#Cancel`. Nothing is typed, so `#Cancel` discards nothing.
 *
 * ⛔ It never presses `#OK` — not the grid's (that files the invoice) and not
 * the dialog's (no reason to save a line we did not change).
 *
 * Written 06/09/2026 to answer one question on a real document: does `#Remark`
 * actually **persist** after the line is saved? The write is verified in the
 * field before the save click, but that is the mechanism, not the outcome —
 * and on Doc612 this field is known to swallow the first write.
 *
 *   node tools/_smoke/invoice-read-line.mjs 3468335830650
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import * as engine from '../../src/documents/engine.js';
import { profile } from '../../src/documents/agents/invoice/index.js';

const match = process.argv[2];
if (!match) {
  console.log('שימוש: node tools/_smoke/invoice-read-line.mjs <קוד הפריט כפי שהוא ברשת>');
  process.exit(1);
}

const logger = new RunLogger('invoice-read-line');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger, dryRun: true };

const grid = engine.linesFrame(ctx, profile);
if (!grid) { console.log('מסך השורות של החשבונית לא פתוח.'); process.exit(1); }

const { cell } = await engine.findLineRow(ctx, profile, match);
await ctx.human.doubleClick(cell, { scope: grid, label: `פתיחת שורה ${match} לקריאה` });
await ctx.human.settle('line dialog opening');

const frame = ctx.page.frames().find((f) => profile.frames.lineForm.test(f.url()));
if (!frame) { console.log('דיאלוג השורה לא נפתח.'); process.exit(1); }

const L = profile.line;
const read = async (sel) => (sel ? frame.locator(sel).inputValue().catch(() => null) : null);
const line = {
  פריט: await read(L.item),
  כמות: await read(L.qty),
  מחיר: await read(L.price),
  הנחה: await read(L.discount),
  הערה: await read(L.remark),
  סכום: await read(L.amount),
};

console.log('\n  השורה כפי שהיא שמורה בקומקס:\n');
for (const [k, v] of Object.entries(line)) console.log(`    ${k.padEnd(6)} ${v ?? '(ריק)'}`);
console.log('');

logger.save('line.json', line);
await logger.shot(ctx.page, 'line-read');

// Out without saving. Never #OK.
await ctx.human.click('#Cancel', { scope: frame, label: 'יציאה מהשורה בלי לשמור' });
await ctx.human.settle('line closed');

logger.done();

// Disconnect without touching Chrome — the window stays open for the next tool.
// Without this the process keeps the CDP connection alive and never exits.
process.exit(0);
