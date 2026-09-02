/**
 * Files the tax invoice that is open on the lines screen. IRREVERSIBLE — this
 * is the click that moves stock.
 *
 * Runs every gate in `invoice.finalize` first; a refusal here clicks nothing.
 * Logs the grid's actual buttons before acting, because the mapping snapshot of
 * an empty grid showed no `#OK` at all and that has to be settled on a grid
 * that actually has lines.
 *
 *   node tools/_smoke/invoice-file.mjs
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import * as invoice from '../../src/documents/agents/invoice/index.js';
import * as engine from '../../src/documents/engine.js';

const logger = new RunLogger('invoice-file');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger, dryRun: false };

const grid = engine.linesFrame(ctx, invoice.profile);
if (!grid) { console.log('מסך השורות לא פתוח.'); process.exit(1); }

const buttons = await grid.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('img[id],button[id],input[type=button][id]')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    out.push(`${el.id}${el.title ? ` "${el.title}"` : ''}`);
  }
  return out;
});
logger.step('grid', `כפתורים גלויים ברשת: ${buttons.join(', ')}`);

const res = await invoice.finalize(ctx, { confirm: true, lines: [] });

console.log('\n  ' + (res.filed ? 'החשבונית נקלטה.' : 'לא נקלטה.'));
console.log(`    מחירון     ${res.totals.priceList}`);
console.log(`    משטר       שורות ${res.vat.mode === 'included' ? 'כוללות' : 'לפני'} מע"מ (${res.vat.source})`);
console.log(`    שורות      ${res.vat.lineSum}`);
console.log(`    לפני מע"מ  ${res.totals.beforeVat}`);
console.log(`    מע"מ ${res.totals.vatRate}%   ${res.totals.vat}`);
console.log(`    סה"כ       ${res.totals.total}\n`);

await logger.shot(ctx.page, 'after-filing');
await s.browser.close().catch(() => {});
logger.done();
