import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
const logger = new RunLogger('a162-view');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const want = process.argv[2] || 'ShowDoc_Prog_G';
for (const frame of s.page.frames()) {
  if (!(frame.url() || '').includes(want)) continue;
  console.log(`\n=== ${frame.name() || '(anon)'} :: ${frame.url().slice(0, 120)}`);
  const out = await frame.evaluate(() => [...document.querySelectorAll('img,button,input,a,td[onclick],span[onclick],div[onclick]')]
    .map((el) => ({
      tag: el.tagName, id: el.id || undefined, title: el.title || undefined, value: el.value || undefined,
      src: (el.getAttribute('src') || '').split('/').pop() || undefined,
      text: (el.textContent || '').trim().slice(0, 25) || undefined,
      onclick: (el.getAttribute('onclick') || '').slice(0, 120) || undefined,
    })).filter((c) => c.id || c.title || c.onclick || c.src)).catch((e) => `ERR ${e.message}`);
  console.log(JSON.stringify(out, null, 1));
}
await s.browser.close().catch(() => {});
logger.done();
