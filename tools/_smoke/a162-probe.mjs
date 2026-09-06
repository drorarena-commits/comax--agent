/**
 * Dumps the a162 program frame: tabs, every input with id/value/checked/options.
 *   node tools/_smoke/a162-probe.mjs
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const logger = new RunLogger('a162-probe');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page } = s;

const frame = page.frames().find((f) => (f.url() || '').includes('Hr_WorkTeken'));
if (!frame) { console.log('לא נמצא frame של a162'); process.exit(1); }

const out = await frame.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  return [...document.querySelectorAll('input,select')].map((el) => ({
    id: el.id, type: el.type, value: el.value,
    checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined,
    options: el.tagName === 'SELECT' ? [...el.options].map((o) => `${o.value}=${o.text.trim()}`) : undefined,
    selected: el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text.trim() : undefined,
    visible: vis(el),
    row: (el.closest('tr')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70),
  }));
});
console.log(JSON.stringify(out, null, 1));
await s.browser.close().catch(() => {});
logger.done();
