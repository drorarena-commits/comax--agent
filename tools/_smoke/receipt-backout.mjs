/**
 * Leave a receipt without filing it.
 *
 * `#Cancel`, never `#OK` — on this document the header's own `#OK` is very
 * probably the commit, because there is no lines screen to advance to.
 *
 * Two ways of finding the screen, on purpose. `KabalaNU.asp` is what UPDATE mode
 * opened on 7010013, and it is tried first. But ADD mode has never been seen: if
 * it opens something else, matching only that one name would fail to find the
 * document and leave an empty receipt sitting open — the exact outcome this tool
 * exists to prevent. So the fallback is "any `Kupa/Kab/` frame with a `#Cancel`",
 * and if even that misses, it says so instead of reporting success.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const logger = new RunLogger('receipt-backout');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const path = (f) => f.url().split('?')[0];
const isReceipt = (f) => /KabalaNU\.aspx?$/i.test(path(f));
const isReceiptArea = (f) => /\/Kupa\/Kab\//i.test(path(f));

/** The known screen first, then anything in the receipt folder that can cancel. */
const findFrame = async () => {
  const known = page.frames().find(isReceipt);
  if (known) return { frame: known, how: 'KabalaNU' };

  for (const f of page.frames().filter(isReceiptArea)) {
    const has = await f.locator('#Cancel').count().catch(() => 0);
    if (has) return { frame: f, how: path(f).split('/').pop() };
  }
  return {};
};

const { frame, how } = await findFrame();

if (!frame) {
  console.log('לא נמצא מסך קבלה פתוח — אין ממה לצאת.');
} else {
  if (how !== 'KabalaNU') {
    console.log(`⚠️ מצב ADD פתח מסך אחר: ${how} (לא KabalaNU). יוצא דרכו.`);
  }
  await human.click('#Cancel', { scope: frame, label: 'ביטול (יציאה בלי לקלוט)' });
  await human.settle('cancelled');

  // Success is the frame going away, not the click landing.
  const gone = !page.frames().some((f) => path(f) === path(frame));
  console.log(gone
    ? '✅ הכותרת נסגרה בלי קליטה'
    : '⚠️ המסך עדיין פתוח — הקבלה לא נסגרה.\n'
      + '   אל תסגור את החלון. הכפתורים במסך: #Cancel · #DoExit. לעולם לא #OK.');
}

await logger.shot(page, 'after-backout');
await s.browser.close().catch(() => {});
logger.done();
