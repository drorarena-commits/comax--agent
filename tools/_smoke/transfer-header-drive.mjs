/**
 * Fills the transfer header that is ALREADY OPEN (Doc470U), commits it and
 * snapshots the lines screens. Written to learn Doc470Lines* through a real
 * document, and kept as the way to walk a transfer up to its lines by hand.
 *
 * Deliberately does not press #newRec: a draft is already open from the
 * `npm run open-program -- a111` + #newRec that got here, and starting another
 * would strand it.
 *
 *   node tools/_smoke/transfer-header-drive.mjs ['{"storeFrom":"…","storeTo":"…","details":"…"}' | path.json]
 *
 * Stops at the lines screen. Adds no lines and files nothing.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { inspectPage, digest } from '../../src/inspect.js';
import { fillLookup, dismissPopups } from '../../src/navigate.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../../src/config.js';

// Hebrew values do not survive a shell single-quoted argument on every console,
// so a path to a JSON file is accepted alongside inline JSON.
const arg = process.argv[2];
const input = !arg ? {} : JSON.parse(arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8'));

const FROM = input.storeFrom ?? 'ראשי';
const TO = input.storeTo ?? 'מחסן קבוצות';
const DETAILS = input.details ?? 'מיפוי סוכן - לא לקליטה';

const logger = new RunLogger('transfer-header-drive');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger };
const { page, human } = ctx;

const header = page.frames().find((f) => /Doc470U\.aspx?/i.test(f.url()));
if (!header) {
  console.log('אין כותרת תעודת העברה פתוחה (Doc470U). הרץ קודם: npm run open-program -- a111  ואז #newRec.');
  process.exit(1);
}
logger.step('header', header.url().replace(/\?.*/, '').split('/').pop());

await fillLookup(ctx, { frame: header, field: '#Store', value: FROM, what: 'ממחסן' });
await fillLookup(ctx, { frame: header, field: '#Store1', value: TO, what: 'למחסן' });
await human.type('#Pratim', DETAILS, { scope: header, label: 'פרטים' });
await dismissPopups(ctx);

const read = async (sel) => header.locator(sel).inputValue().catch(() => null);
const state = {
  מסמך: await header.locator('#DocId').innerText().catch(() => null),
  תאריך: await read('#DateDoc'),
  ממחסן: await read('#Store'),
  למחסן: await read('#Store1'),
  פרטים: await read('#Pratim'),
  אסמכתא: await read('#Ref'),
};
logger.save('header-filled.json', state);
console.log('\n  הכותרת אחרי מילוי:');
for (const [k, v] of Object.entries(state)) console.log(`    ${k.padEnd(8)} ${v ?? '(ריק)'}`);
await logger.shot(page, 'header-filled');

if (!state.ממחסן || !state.למחסן) {
  console.log('\n  ⛔ אחד המחסנים ריק — לא מאשר כותרת.');
  process.exit(1);
}
if (state.ממחסן === state.למחסן) {
  console.log('\n  ⛔ ממחסן == למחסן — לא מאשר כותרת.');
  process.exit(1);
}
console.log(`\n  ${state.ממחסן} → ${state.למחסן} ✓ — מאשר כותרת (זה רק מתקדם לשורות, לא קולט).`);

await human.click('#OK', { scope: header, label: 'אישור הכותרת' });
await human.settle('transfer created');
await dismissPopups(ctx);

await logger.shot(page, 'lines-screen');

// Only on request: the mapping snapshot in knowledge/screens is a record of the
// screen, and a real customer's document would overwrite it with their data.
if (input.snapshot) {
  const snap = await inspectPage(page);
  const base = resolve(ROOT, 'knowledge/screens', 'transfer-lines');
  writeFileSync(`${base}.json`, JSON.stringify(snap, null, 2), 'utf8');
  writeFileSync(`${base}.txt`, digest(snap), 'utf8');
  console.log(`\n  → ${base}.json`);

  for (const f of snap.frames) {
    if (!/Doc470/i.test(f.url || '') || /Doc470[VU]\.asp/i.test(f.url || '')) continue;
    console.log(`\n  FRAME ${f.url.replace(/\?.*/, '').split('/').pop()} (${f.elementCount})`);
    console.log('    ' + f.elements.filter((e) => e.id).map((e) => e.id).join(', '));
  }
}

console.log('\n  עוצר כאן. לא נוספו שורות ושום דבר לא נקלט.\n');
await s.browser.close().catch(() => {});
logger.done();
