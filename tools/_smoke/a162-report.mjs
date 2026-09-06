/** Reads every page of the open a162 report and prints its text. */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
const logger = new RunLogger('a162-report');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctrl = () => s.page.frames().find((f) => (f.url() || '').includes('Rpt_DafHtml_G'));
const body = () => s.page.frames().find((f) => (f.url() || '').includes('ReadFile_HtmlP'));
if (!ctrl()) { console.log('לא נמצא frame הדוח'); process.exit(1); }
const max = await ctrl().evaluate(() => (typeof MaxPages !== 'undefined' ? MaxPages : 1));
console.log(`סה"כ דפים: ${max}\n`);
for (let p = 1; p <= max; p++) {
  if (p > 1) {
    await ctrl().evaluate(() => document.getElementById('Next').click());
    await s.page.waitForTimeout(3000);
  }
  const b = body();
  const t = b ? await b.evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()) : '(אין frame תוכן)';
  const cur = await ctrl().evaluate(() => document.getElementById('MyPageV')?.value);
  console.log(`════════ דף ${cur} / ${max} ════════`);
  console.log(t);
  console.log('');
}
await s.browser.close().catch(() => {});
logger.done();
