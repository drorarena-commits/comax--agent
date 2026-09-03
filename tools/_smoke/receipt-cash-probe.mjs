/**
 * Switch an ALREADY OPEN receipt header to מזומן and photograph what changes.
 *
 * Everything known about `KabalaNU.asp` was read with the form on its default —
 * `Sug=2`, כרטיס אשראי — so the whole credit block is mapped and the cash form
 * is not. `Sug_onclick(0)` swaps that block, and **which field holds the cash
 * amount, and whether a קופה must be chosen, is unknown.** Filling a cash
 * receipt before looking is exactly the guessing this project refuses to do.
 *
 *   node tools/_smoke/receipt-cash-probe.mjs
 *
 * Clicks one radio. Fills nothing, presses no #OK, files nothing.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { inspectPage, digest } from '../../src/inspect.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../../src/config.js';

const logger = new RunLogger('receipt-cash-probe');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const header = page.frames().find((f) => /KabalaNU\.aspx?$/i.test(f.url().split('?')[0]));
if (!header) {
  console.log('אין כותרת קבלה פתוחה (KabalaNU.asp).');
  console.log('הרץ קודם: npm run open-program -- a103  ואז #newRec.');
  process.exit(1);
}

const mode = /DocMode=%27?(\w+)/i.exec(header.url())?.[1] ?? '?';
logger.step('header', `KabalaNU — DocMode=${mode}`);
if (!/ADD/i.test(mode)) {
  console.log(`⚠️ הכותרת פתוחה במצב ${mode}, לא ADD. לא נוגע.`);
  process.exit(1);
}

/** Which field holds the amount, before and after — that is the whole question. */
const amounts = async (when) => {
  const seen = [];
  for (const sel of ['#ScmAshrai', '#Scm', '#ScmMezuman', '#ScmKab', '#Mezuman', '#ScmShek']) {
    const n = await header.locator(sel).count().catch(() => 0);
    if (n) seen.push(`${sel}=${JSON.stringify(await header.locator(sel).inputValue().catch(() => null))}`);
  }
  console.log(`  שדות סכום ${when}: ${seen.join('  ') || '(אין)'}`);
};

await amounts('לפני');
await human.click('input[name="Sug"][value="0"]', { scope: header, label: 'סוג תשלום = מזומן' });
await human.settle('cash block');
await amounts('אחרי ');

const snap = await inspectPage(page);
const base = resolve(ROOT, 'knowledge/screens', 'receipt-header-cash');
writeFileSync(`${base}.json`, JSON.stringify(snap, null, 2), 'utf8');
writeFileSync(`${base}.txt`, digest(snap), 'utf8');
console.log(`\n→ ${base}.json`);

await logger.shot(page, 'receipt-header-cash');
await s.browser.close().catch(() => {});
logger.done();
