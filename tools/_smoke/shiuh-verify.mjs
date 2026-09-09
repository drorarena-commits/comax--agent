/**
 * Reopens a receipt's invoice-allocation screen and reports what stuck.
 *
 *   node tools/_smoke/shiuh-verify.mjs 6810059
 *
 * Read-only: it opens the screen, reads the balance block and the rows, and
 * closes it again with `#Cancel`. Reopening loses nothing — proven on 6810057
 * — which is what makes this safe to run after an allocation to check it
 * actually reached the server rather than merely leaving the screen.
 *
 * The route is Dror's: on the receipts list, click the row to select it, then
 * press "לחשבוניות" (`#ShiuhHesh`).
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { profile } from '../../src/documents/agents/osh-receipt/index.js';

const docNo = process.argv[2];
if (!docNo) { console.log('שימוש: node tools/_smoke/shiuh-verify.mjs <מספר קבלה>'); process.exit(1); }

const logger = new RunLogger('shiuh-verify');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const path = (f) => f.url().split('?')[0];
const list = page.frames().find((f) => profile.frames.list.test(path(f)));
if (!list) { console.log('רשימת הקבלות לא פתוחה.'); process.exit(1); }

// The filters are cumulative — clearing first is what keeps a miss meaning
// "not there" rather than "filtered out by something set earlier".
for (const sel of [profile.list.findCustomer, profile.list.findAmount, profile.list.dateFrom, profile.list.dateTo]) {
  await list.locator(sel).fill('').catch(() => {});
}
await human.type(profile.list.findDocNo, docNo, { scope: list, label: `סינון לקבלה ${docNo}`, clear: true });
await list.locator(profile.list.findDocNo).press('Enter').catch(() => {});
await human.settle('filtered');

// Selecting the row is what arms #ShiuhHesh — it acts on the current row.
const cell = list.locator(`td:has-text("${docNo}")`).first();
await cell.click().catch(() => {});
await human.settle('row selected');

await human.click(profile.list.allocateToInvoices, { scope: list, label: 'לחשבוניות (#ShiuhHesh)' });
await human.settle('allocation reopened');

const shell = page.frames().find((f) => /ShiuhIdxV\.aspx?$/i.test(path(f)));
const grid = page.frames().find((f) => /ShiuhIdx_Fr\.aspx?$/i.test(path(f)));
if (!shell) { console.log('\n  מסך השיוך לא נפתח.\n'); process.exit(1); }

const head = (await shell.innerText('body').catch(() => '')).split('\n').map((l) => l.trim()).filter(Boolean);
const money = (label) => head.find((l) => l.includes(label))?.match(/([\d,]+\.\d{2})/)?.[1] ?? '?';
const totals = { 'סכום קבלה': money('סכום קבלה'), שויך: money('שוייך'), 'יתרה לשיוך': money('יתרה לשיוך') };
console.log('\n  ' + Object.entries(totals).map(([k, v]) => `${k}: ${v}`).join('   '));

const rows = [];
if (grid) {
  const lines = (await grid.innerText('body').catch(() => '')).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const el of await grid.locator('input[id^="I"]').all()) {
    const id = await el.getAttribute('id').catch(() => null);
    if (!/^I\d+$/.test(id ?? '')) continue;
    rows.push({ id, value: await el.inputValue().catch(() => ''), text: lines[Number(id.slice(1))] ?? '' });
  }
}
console.log('\n  שורות פתוחות מול הלקוח:');
if (rows.length) for (const r of rows) console.log(`    ${r.id}  "${r.value}"  ←  ${r.text}`);
else console.log('    (אין — כל החשבוניות סגורות)');

logger.save('verify.json', { docNo, totals, rows });
await logger.shot(page, 'reopened');

// Leave nothing on screen: a shell over the list swallows the next click.
await human.click(profile.allocation.cancel, { scope: shell, label: 'סגירה בלי לשנות' });
await human.settle('closed');

await s.browser.close().catch(() => {});
logger.done();
