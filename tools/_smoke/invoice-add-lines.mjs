/**
 * Adds the four goggle lines to the tax invoice that is open on the lines
 * screen, then reads the totals and the VAT regime and STOPS.
 *
 * Files nothing. The blue tick (#OKNew) saves a line and reopens the dialog for
 * the next item; the green tick (#OK) is used only on the last line, which is
 * exactly how `engine.addLine` picks between them.
 *
 * Items are identified by the plain barcode SKU — not the מק"ט חלופי.
 *
 *   node tools/_smoke/invoice-add-lines.mjs ['{"items":[…]}' | path.json]
 *
 * `price` may be left out of an item: Comax fills #Mhr from the header's price
 * list and the read-back reports what it actually used. That is safer than
 * typing a number guessed from the catalogue export, which carries מחירון 1 —
 * a different price list than the one the document is written on.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import * as invoice from '../../src/documents/agents/invoice/index.js';
import * as engine from '../../src/documents/engine.js';
import { readFileSync } from 'node:fs';

const arg = process.argv[2];
const input = !arg ? {} : JSON.parse(arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8'));
const ITEMS = input.items ?? [];
if (!ITEMS.length) { console.log('אין פריטים. העבר {"items":[{code,qty,discount}]}'); process.exit(1); }

const logger = new RunLogger('invoice-add-lines');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger, dryRun: true };
const { page, human } = ctx;

const grid = engine.linesFrame(ctx, invoice.profile);
if (!grid) { console.log('מסך השורות של החשבונית לא פתוח (Doc650LinesV).'); process.exit(1); }

// The line dialog opens by itself after the header is committed. If a previous
// step closed it, reopen it from the grid rather than failing.
if (!page.frames().some((f) => invoice.profile.frames.lineForm.test(f.url()))) {
  logger.step('lines', 'דיאלוג השורה לא פתוח — פותח דרך #newRec ברשת');
  await human.click('#newRec', { scope: grid, label: 'הוספת שורה' });
  await human.settle('line dialog');
}

for (const i of ITEMS) logger.step('planned', `${i.code}  ${i.note ?? ''}  ×${i.qty}  @${i.price ?? 'מחירון'}  -${i.discount ?? 0}%`);

const lines = await invoice.addLines(ctx, ITEMS);

console.log('\n  השורות שנקלטו למסמך:');
for (const [i, l] of lines.entries()) {
  console.log(`    ${i + 1}. ${l.item ?? '?'}  ×${l.qty ?? '?'}  @${l.price ?? '?'}  -${l.discount ?? '?'}%  = ${l.amount ?? '?'}`);
}
logger.save('lines.json', lines);

// confirm:false — runs every gate, reports the regime, files nothing.
const res = await invoice.finalize(ctx, { confirm: false, lines });

console.log('\n  סיכום המסמך:');
console.log(`    מחירון        ${res.totals.priceList ?? '?'}`);
console.log(`    משטר          שורות ${res.vat.mode === 'included' ? 'כוללות' : 'לפני'} מע"מ (${res.vat.source})`);
console.log(`    סכום שורות    ${res.vat.lineSum}`);
console.log(`    לפני מע"מ     ${res.totals.beforeVat}`);
console.log(`    מע"מ ${res.totals.vatRate ?? '?'}%      ${res.totals.vat}`);
console.log(`    סה"כ          ${res.totals.total}`);
console.log('\n  לא נקלט. המסמך פתוח על המסך.\n');

await s.browser.close().catch(() => {});
logger.done();
