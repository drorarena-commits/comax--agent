/**
 * Fills the שיוך column from the יתרה לשיוך column, on the allocation screen
 * that is ALREADY OPEN — and stops there.
 *
 *   node tools/_smoke/shiuh-pick.mjs          # every row
 *   node tools/_smoke/shiuh-pick.mjs I0 I2    # only these rows
 *
 * ⚠️ Never presses `#OK`. Confirming the allocation is `receipt-allocate.mjs
 * --ok`, and it belongs to a separate, explicitly approved step: it closes real
 * invoices in the customer's ledger.
 *
 * The mechanic, read off the DOM on 03/09/2026 (receipt 6810059):
 *
 *   שיוך:        <input id="I0" onblur="parent.setItra(scmShiuh());">
 *   יתרה לשיוך:  <span id="itr0" onclick="onItra('6,136.00','I0',1)">6,136.00 ח</span>
 *
 * So you do not type the amount — clicking `#itr<n>` runs `onItra`, which
 * writes it into `#I<n>`. The balance block only catches up on blur, which is
 * why focus is moved off before it is read back.
 *
 * ⚠️ The grid frame is `ShiuhIdx_Fr.asp` — the old Max2000 root — while its
 * shell is `ShiuhIdxV.aspx` under NET_2022. A pattern that insists on the `x`
 * finds the shell and misses the grid.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const only = process.argv.slice(2).filter((a) => /^I\d+$/.test(a));

const logger = new RunLogger('shiuh-pick');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const path = (f) => f.url().split('?')[0];
const shell = page.frames().find((f) => /ShiuhIdxV\.aspx?$/i.test(path(f)));
const grid = page.frames().find((f) => /ShiuhIdx_Fr\.aspx?$/i.test(path(f)));
if (!shell || !grid) {
  console.log('מסך השיוך לא פתוח.');
  console.log('לפתוח: ברשימת הקבלות — לסמן את שורת הקבלה וללחוץ "לחשבוניות" (#ShiuhHesh).');
  process.exit(1);
}

const balance = async () => {
  const head = (await shell.innerText('body').catch(() => '')).split('\n').map((l) => l.trim()).filter(Boolean);
  const money = (label) => head.find((l) => l.includes(label))?.match(/([\d,]+\.\d{2})/)?.[1] ?? '?';
  return { 'סכום קבלה': money('סכום קבלה'), שויך: money('שוייך'), 'יתרה לשיוך': money('יתרה לשיוך') };
};
const show = (label, b) => console.log(`  ${label} ` + Object.entries(b).map(([k, v]) => `${k}: ${v}`).join('   '));

console.log('');
show('לפני: ', await balance());

const ids = [];
for (const el of await grid.locator('input[id^="I"]').all()) {
  const id = await el.getAttribute('id').catch(() => null);
  if (/^I\d+$/.test(id ?? '') && (!only.length || only.includes(id))) ids.push(id);
}
if (!ids.length) { console.log('\n  אין שורות מתאימות.\n'); process.exit(1); }

for (const id of ids) {
  const n = id.slice(1);
  await human.click(`#itr${n}`, { scope: grid, label: `יתרה לשיוך של שורה ${id}` });
  // setItra runs on blur, so the balance block is stale until focus moves off.
  await grid.locator(`#${id}`).evaluate((el) => el.blur()).catch(() => {});
  await human.settle(`${id} picked`);
  const v = await grid.locator(`#${id}`).inputValue().catch(() => '');
  console.log(`    ${id} = "${v}"`);
}

const after = await balance();
show('אחרי:', after);
logger.save('picked.json', { rows: ids, balance: after });

console.log(
  after['יתרה לשיוך'] === '0.00'
    ? '\n  ✅ יתרה לשיוך = 0.00. לאשר: node tools/_smoke/receipt-allocate.mjs --ok\n'
    : `\n  ⚠️ יתרה לשיוך = ${after['יתרה לשיוך']} — לא 0.00. שיוך חלקי לא מאושר בלי אמירה מפורשת.\n`,
);

await logger.shot(page, 'picked');
await s.browser.close().catch(() => {});
logger.done();
