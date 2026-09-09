/**
 * Runs the a162 attendance report for one month.
 *
 *   node tools/_smoke/a162-run.mjs 08/2026
 *
 * The month field #DMA is sticky between runs — it opens on whatever month was
 * produced last, and a stale month yields a complete, correct-looking report
 * for the wrong period. So the month is written explicitly, read back off the
 * screen, and compared before #OK is ever clicked.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const want = process.argv[2];
if (!/^\d{2}\/\d{4}$/.test(want || '')) {
  console.log('שימוש: node tools/_smoke/a162-run.mjs MM/YYYY');
  process.exit(1);
}

const logger = new RunLogger('a162-run');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = s;

const prog = () => page.frames().find((f) => (f.url() || '').includes('Hr_WorkTeken_HtmlP.aspx'));
if (!prog()) { console.log('a162 לא פתוח. תריץ:  npm run open-program -- a162'); process.exit(1); }

const before = await prog().evaluate(() => document.getElementById('DMA')?.value);
logger.step('read', `#DMA לפני: ${before}`);

// The month lives in the "שונות" tab. The tabs only show and hide, so the field
// exists either way — but human.type needs it visible.
await human.click('#Shonot', { scope: prog(), label: 'לשונית שונות' });
await human.think('tab switch');
await human.type('#DMA', want, { scope: prog(), label: `חודש = ${want}` });

const after = await prog().evaluate(() => document.getElementById('DMA')?.value);
logger.step('verify', `#DMA אחרי: ${after}`);
if (after !== want) {
  console.log(`\n⛔ החודש לא נתפס: ביקשנו ${want}, במסך ${after}. עוצר לפני ההרצה.`);
  await s.browser.close().catch(() => {});
  process.exit(1);
}
console.log(`\n✓ החודש אומת במסך: ${after}`);

await human.click('#OK', { scope: prog(), label: 'אישור — הרצת הדוח' });
await human.settle('report running');
await human.think('report');

const ctrl = page.frames().find((f) => (f.url() || '').includes('Rpt_DafHtml_G'));
const pages = ctrl ? await ctrl.evaluate(() => (typeof MaxPages !== 'undefined' ? MaxPages : null)) : null;
console.log(`עמודים בדוח: ${pages}  (= מספר העובדים)`);
await logger.shot(page, 'report');
await s.browser.close().catch(() => {});
logger.done();
