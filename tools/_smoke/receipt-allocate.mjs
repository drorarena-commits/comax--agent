/**
 * Confirms — or clears — the invoice allocation on a receipt, using the screen
 * that is ALREADY OPEN.
 *
 *   node tools/_smoke/receipt-allocate.mjs           # report only
 *   node tools/_smoke/receipt-allocate.mjs --ok      # ⚠️ closes the invoices shown
 *   node tools/_smoke/receipt-allocate.mjs --zero    # #ZeroSh — leave it as an open credit
 *
 * Separate from `receipt-drive.mjs` on purpose. That script starts by pressing
 * `#newRec`, so re-running it to confirm an allocation would file a SECOND
 * receipt — which is exactly what nearly happened.
 *
 * The allocation screen is reachable later too, without any of this: on the
 * receipts list, filter to the receipt, select its row, and press "לחשבוניות"
 * (`#ShiuhHesh`). Dror's route, and the reason a closed allocation screen is
 * never a lost cause.
 *
 * ⚠️ Dror's rule: ask "האם לסגור חשבונית מספר X מתאריך Y" and wait for a yes
 * before `--ok`. This prints the rows so that question can be asked precisely.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { profile } from '../../src/documents/agents/receipt/index.js';

const ok = process.argv.includes('--ok');
const zero = process.argv.includes('--zero');

const logger = new RunLogger('receipt-allocate');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const path = (f) => f.url().split('?')[0];
const shell = page.frames().find((f) => /ShiuhIdxV\.aspx?$/i.test(path(f)));
const grid = page.frames().find((f) => /ShiuhIdx_Fr\.aspx?$/i.test(path(f)));
if (!shell || !grid) {
  console.log('מסך השיוך לא פתוח.');
  console.log('לפתוח אותו: ברשימת הקבלות — לסנן לקבלה, לסמן את השורה, וללחוץ "לחשבוניות" (#ShiuhHesh).');
  process.exit(1);
}

/**
 * The balance block is the completeness check: סכום קבלה / שויך / יתרה לשיוך.
 * A receipt is fully allocated when יתרה לשיוך is 0.00, and that is worth
 * reading rather than assuming the grid adds up.
 */
const head = (await shell.innerText('body').catch(() => '')).split('\n').map((l) => l.trim()).filter(Boolean);
const money = (label) => head.find((l) => l.includes(label))?.match(/([\d,]+\.\d{2})/)?.[1] ?? '?';
const totals = { קבלה: money('סכום קבלה'), שויך: money('שוייך'), 'יתרה לשיוך': money('יתרה לשיוך') };
console.log('\n  ' + Object.entries(totals).map(([k, v]) => `${k}: ${v}`).join('   '));

// One row per open invoice. The input is the שיוך column — what this receipt
// pays against that document; the right-hand column is the invoice's own
// יתרה לשיוך.
//
// ⚠️ To allocate you do NOT type here: **click the amount in the יתרה לשיוך
// column** and it jumps across into שיוך (Dror, 03/09/2026).
const lines = (await grid.innerText('body').catch(() => '')).split('\n').map((l) => l.trim()).filter(Boolean);
const rows = [];
for (const el of await grid.locator('input[id^="I"]').all()) {
  const id = await el.getAttribute('id').catch(() => null);
  if (!/^I\d+$/.test(id ?? '')) continue;
  const value = await el.inputValue().catch(() => '');
  rows.push({ id, value, text: lines[Number(id.slice(1))] ?? '' });
}
const picked = rows.filter((r) => r.value);
console.log('\n  שורות שישויכו:');
if (picked.length) for (const r of picked) console.log(`    ${r.id}  ${r.value}  ←  ${r.text}`);
else console.log('    (אף שורה לא מולאה)');
logger.save('allocation.json', { totals, rows });

if (zero) {
  await human.click(profile.allocation.zero, { scope: shell, label: 'איפוס שיוך' });
  await human.settle('zeroed');
  await human.click(profile.allocation.ok, { scope: shell, label: 'אישור (בלי שיוך)' });
  await human.settle('closed');
  console.log('\n  ✅ השיוך אופס. הקבלה נשארת כיתרת זכות.\n');
} else if (ok) {
  if (totals['יתרה לשיוך'] !== '0.00') {
    console.log(`\n  ⚠️ יתרה לשיוך = ${totals['יתרה לשיוך']}, לא 0.00. לא מאשר שיוך חלקי בלי שתאמר במפורש.\n`);
    process.exit(1);
  }
  await human.click(profile.allocation.ok, { scope: shell, label: 'אישור השיוך' });
  await human.settle('allocated');
  const still = page.frames().some((f) => /ShiuhIdxV\.aspx?$/i.test(path(f)));
  console.log(still ? '\n  ⚠️ המסך עדיין פתוח — לבדוק.\n' : '\n  ✅ השיוך אושר.\n');
} else {
  console.log('\n  דיווח בלבד. לאשר: --ok   לאפס: --zero\n');
}

await logger.shot(page, 'allocation');
await s.browser.close().catch(() => {});
logger.done();
