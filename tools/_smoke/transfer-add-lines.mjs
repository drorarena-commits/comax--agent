/**
 * Adds lines to the transfer that is open on the lines screen, runs every gate
 * `finalize` has, and STOPS.
 *
 * Files nothing and moves no stock. This is the run that proved Doc470LinesU:
 * `#OkNew` in a lower-case k, `#Prt`/`#Cmt` as on the sales documents, and a
 * grid whose `#OK` ("קליטת תעודת העברה") only appears once a line exists.
 *
 *   node tools/_smoke/transfer-add-lines.mjs ['{"items":[{"code":"…","qty":6}]}' | path.json]
 *
 * **There is deliberately no `--confirm` here.** This script's first act is to
 * add lines, so a confirm flag on it would re-run `addLines` against a document
 * that already has them — which is exactly what happened on 4700239: "file it"
 * pressed #newRec and started line 5. Filing lives in `transfer-file.mjs`.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { readFileSync } from 'node:fs';
import * as transfer from '../../src/documents/agents/transfer/index.js';
import * as engine from '../../src/documents/engine.js';

const arg = process.argv[2];
const input = !arg ? {} : JSON.parse(arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8'));

const ITEMS = input.items ?? [
  { code: '3468337082118', qty: 1, note: 'Ultra Swipe MR 110 EMERALD/CYBER/LIME' },
];

const logger = new RunLogger('transfer-add-lines');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger, dryRun: true };
const { page, human } = ctx;

const grid = engine.linesFrame(ctx, transfer.profile);
if (!grid) { console.log('מסך השורות של תעודת ההעברה לא פתוח (Doc470LinesV).'); process.exit(1); }

const stores = await transfer.readStores(ctx);
console.log(`\n  ${await transfer.readDocNumber(ctx)}: ממחסן ${stores.from} (${stores.fromCode}) → למחסן ${stores.to} (${stores.toCode})`);

// The line dialog opens by itself after the header is committed. If an earlier
// step closed it, reopen it from the grid rather than failing.
if (!page.frames().some((f) => transfer.profile.frames.lineForm.test(f.url()))) {
  logger.step('lines', 'דיאלוג השורה לא פתוח — פותח דרך #newRec ברשת');
  await human.click('#newRec', { scope: grid, label: 'הוספת שורה' });
  await human.settle('line dialog');
}

for (const i of ITEMS) logger.step('planned', `${i.code}  ${i.note ?? ''}  ×${i.qty}${i.price != null ? `  @${i.price}` : ''}${i.discount != null ? `  -${i.discount}%` : ''}`);
const lines = await transfer.addLines(ctx, ITEMS);

console.log('\n  השורות שנכנסו למסמך:');
for (const [i, l] of lines.entries()) {
  console.log(`    ${i + 1}. ${l.item ?? '?'}  ×${l.qty ?? '?'}  @${l.price ?? '?'}  = ${l.amount ?? '?'}`);
}
logger.save('lines.json', lines);

// The grid's #OK is the one that files. It is not rendered on an empty grid, so
// its appearance is itself the proof that the line landed.
const okReady = await grid.locator('#OK').count();
console.log(`\n  #OK ברשת (קליטת תעודת העברה): ${okReady ? 'קיים' : 'לא קיים'}`);

const res = await transfer.finalize(ctx, {
  confirm: false,
  items: ITEMS,
  allowShort: !!input.allowShort,
  expect: { storeFrom: stores.from, storeTo: stores.to },
});

console.log('\n  סיכום התעודה:');
console.log(`    כיוון         ממחסן ${res.stores.from} → למחסן ${res.stores.to}`);
console.log(`    סה"כ כמות     ${res.totals.quantity}`);
console.log(`    סה"כ סכום     ${res.totals.total}`);
console.log(`    מלאי מקור     ${res.stock.covered ? res.stock.lines.map((l) => `${l.code}: מבקש ${l.want}, יש ${l.have}`).join(' · ') : 'לא מכוסה בייצוא המקומי'}`);
console.log('\n  לא נקלט ושום מלאי לא זז. לקליטה: node tools/_smoke/transfer-file.mjs\n');

await s.browser.close().catch(() => {});
logger.done();
