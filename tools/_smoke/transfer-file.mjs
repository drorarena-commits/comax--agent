/**
 * Files the transfer that is open on the lines screen. IRREVERSIBLE — this is
 * the click that moves stock, in both directions.
 *
 * Separate from `transfer-add-lines.mjs` on purpose, and the same split the
 * invoice uses. Putting a `--confirm` on the add-lines script instead was a
 * trap: it re-runs `addLines`, so "file it" pressed #newRec and started line 5
 * on a document that already had its four. One tool adds, one tool files.
 *
 *   node tools/_smoke/transfer-file.mjs ['{"items":[…]}' | path.json]
 *
 * `items` is only for the source-stock gate — nothing is typed into the
 * document here. A line dialog left open (Comax reopens one after every
 * #OkNew) is cancelled first, because the grid's #OK is the button underneath
 * it. Every gate in `transfer.finalize` runs before anything is clicked; a
 * refusal here clicks nothing.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { readFileSync } from 'node:fs';
import * as transfer from '../../src/documents/agents/transfer/index.js';
import * as engine from '../../src/documents/engine.js';

const arg = process.argv[2];
const input = !arg ? {} : JSON.parse(arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8'));

const logger = new RunLogger('transfer-file');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger, dryRun: false };
const { page, human } = ctx;

const grid = engine.linesFrame(ctx, transfer.profile);
if (!grid) { console.log('מסך השורות של תעודת ההעברה לא פתוח (Doc470LinesV).'); process.exit(1); }

// A half-filled line dialog sits on top of the grid and swallows the click.
// #Cancel discards that line only — the lines already saved are untouched.
const dialog = page.frames().find((f) => transfer.profile.frames.lineForm.test(f.url()));
if (dialog) {
  const pending = await dialog.locator('#Prt').inputValue().catch(() => '');
  logger.step('שורה', `דיאלוג שורה פתוח${pending ? ` ("${pending}")` : ''} — מבטל אותו לפני הקליטה`);
  await human.click('#Cancel', { scope: dialog, label: 'ביטול השורה הפתוחה' });
  await human.settle('line dialog closed');
}

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

const stores = await transfer.readStores(ctx);
const res = await transfer.finalize(ctx, {
  confirm: true,
  items: input.items ?? [],
  allowShort: !!input.allowShort,
  expect: { storeFrom: stores.from, storeTo: stores.to },
});

console.log('\n  ' + (res.filed ? 'תעודת ההעברה נקלטה.' : 'לא נקלטה.'));
console.log(`    תעודה        ${res.totals.docNo}`);
console.log(`    כיוון        ממחסן ${res.stores.from} → למחסן ${res.stores.to}`);
console.log(`    סה"כ כמות    ${res.totals.quantity}`);
console.log(`    סה"כ סכום    ${res.totals.total}\n`);

await logger.shot(page, 'after-filing');
await s.browser.close().catch(() => {});
logger.done();
