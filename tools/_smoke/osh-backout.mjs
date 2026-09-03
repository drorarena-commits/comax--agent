/**
 * Leaves a קבלה לעו"ש that osh-drive.mjs filled but did not file.
 *
 *   node tools/_smoke/osh-backout.mjs
 *
 * `#Cancel` on `Kabala_OshU.aspx` — never `#OK`, which here opens the filing
 * dialog. Proven twice on 03/09/2026: the frame goes to Blank_Screen.htm and
 * the list is unchanged.
 *
 * ⚠️ The header frame can take a few seconds to go away after the click, and
 * `receipt-backout` once announced "the screen is still open" about a screen
 * that had already closed. So this re-reads the frame list after settling and
 * reports what it actually sees, rather than what it expected to see.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { framePath } from '../../src/navigate.js';
import { profile } from '../../src/documents/agents/osh-receipt/index.js';

const logger = new RunLogger('osh-backout');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח.'); process.exit(1); }
const { page, human } = s;

const headerFrame = () => page.frames().find((f) => profile.frames.header.test(framePath(f.url())));

const header = headerFrame();
if (!header) {
  console.log('אין כותרת פתוחה — אין ממה לצאת.');
  await s.browser.close().catch(() => {});
  process.exit(0);
}

await human.click(profile.headerScreen.cancel, { scope: header, label: 'ביטול (יציאה בלי לקלוט)' });
await human.settle('cancelled');
await human.think('frame tearing down');

const still = headerFrame();
console.log(still
  ? `\n  ⚠️ הכותרת עדיין פתוחה: ${framePath(still.url())}\n     לבדוק מול הצילום לפני שמסיקים שנשארה קבלה פתוחה.\n`
  : '\n  ✅ יצאנו בלי לקלוט. הכותרת נסגרה.\n');

await logger.shot(page, 'after-backout');
await s.browser.close().catch(() => {});
logger.done();
