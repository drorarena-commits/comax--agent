import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
const logger = new RunLogger('a162-onS');
const s = await attachBrowser({ logger });
const f = s.page.frames().find((x) => (x.url() || '').includes('ShowDoc_Prog_G'));
if (!f) { console.log('הצופה לא פתוח'); process.exit(1); }
const out = await f.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const ids = ['bSendUsr', 'onS', 'onShMaagar', 'onOpP'];
  return {
    controls: ids.map((id) => { const el = document.getElementById(id);
      return el ? { id, text: el.textContent.trim(), visible: vis(el), onclick: el.getAttribute('onclick') } : { id, missing: true }; }),
    onSend: typeof onSend === 'function' ? onSend.toString().slice(0, 900) : 'n/a',
  };
});
console.log(JSON.stringify(out, null, 1));
await s.browser.close().catch(() => {});
logger.done();
