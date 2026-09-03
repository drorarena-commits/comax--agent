/**
 * Opens a receipt's invoice-allocation screen and LEAVES IT OPEN — the step
 * `shiuh-verify.mjs` deliberately does not do (it always closes with
 * `#Cancel`, because it exists to check what already stuck, not to start a
 * new allocation).
 *
 *   node tools/_smoke/shiuh-open.mjs 6810060
 *
 * Read-only in the sense that nothing is confirmed here — it only selects the
 * row and presses "לחשבוניות" (`#ShiuhHesh`). Follow with `shiuh-pick.mjs` to
 * fill the שיוך column, then `receipt-allocate.mjs --ok` to confirm.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { profile } from '../../src/documents/agents/osh-receipt/index.js';

const docNo = process.argv[2];
if (!docNo) { console.log('שימוש: node tools/_smoke/shiuh-open.mjs <מספר קבלה>'); process.exit(1); }

const logger = new RunLogger('shiuh-open');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const path = (f) => f.url().split('?')[0];
const list = page.frames().find((f) => profile.frames.list.test(path(f)));
if (!list) { console.log('רשימת הקבלות לא פתוחה.'); process.exit(1); }

for (const sel of [profile.list.findCustomer, profile.list.findAmount, profile.list.dateFrom, profile.list.dateTo]) {
  await list.locator(sel).fill('').catch(() => {});
}
await human.type(profile.list.findDocNo, docNo, { scope: list, label: `סינון לקבלה ${docNo}`, clear: true });
await list.locator(profile.list.findDocNo).press('Enter').catch(() => {});
await human.settle('filtered');

const cell = list.locator(`td:has-text("${docNo}")`).first();
await cell.click().catch(() => {});
await human.settle('row selected');

await human.click(profile.list.allocateToInvoices, { scope: list, label: 'לחשבוניות (#ShiuhHesh)' });
await human.settle('allocation opened');

const shell = page.frames().find((f) => /ShiuhIdxV\.aspx?$/i.test(path(f)));
console.log(shell ? '\n  ✅ מסך השיוך פתוח.\n' : '\n  ⚠️ מסך השיוך לא נפתח.\n');

await logger.shot(page, 'opened');
await s.browser.close().catch(() => {});
logger.done();
