/**
 * Leave the receipt header without filing it.
 *
 * `#Cancel` on `KabalaNU.asp`, never `#OK` — on this document the header's own
 * `#OK` is the commit, unlike every other document here where it only advances.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const logger = new RunLogger('receipt-backout');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const hdr = page.frames().find((f) => /KabalaNU\.aspx?/i.test(f.url().split('?')[0]));
if (!hdr) { console.log('מסך הכותרת לא פתוח — אין ממה לצאת'); }
else {
  await human.click('#Cancel', { scope: hdr, label: 'ביטול (יציאה בלי לקלוט)' });
  await human.settle('cancelled');
  const still = page.frames().some((f) => /KabalaNU\.aspx?/i.test(f.url().split('?')[0]));
  console.log(still ? '⚠️ הכותרת עדיין פתוחה' : '✅ הכותרת נסגרה בלי קליטה');
}
await logger.shot(page, 'after-backout');
await s.browser.close().catch(() => {});
logger.done();
