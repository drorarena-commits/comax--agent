import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
const logger = new RunLogger('a162-envelope');
const s = await attachBrowser({ logger });
const f = s.page.frames().find((x) => (x.url() || '').includes('SendSpoolToEmail_PDF'));
if (!f) { console.log('המעטפה לא פתוחה'); process.exit(1); }
const out = await f.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  return [...document.querySelectorAll('input,select,textarea')].map((el) => ({
    id: el.id, type: el.type, value: el.value,
    options: el.tagName === 'SELECT' ? [...el.options].map((o) => `${o.value}=${o.text.trim()}`).slice(0, 8) : undefined,
    visible: vis(el),
    row: (el.closest('tr')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  }));
});
console.log(JSON.stringify(out, null, 1));
await s.browser.close().catch(() => {});
logger.done();
