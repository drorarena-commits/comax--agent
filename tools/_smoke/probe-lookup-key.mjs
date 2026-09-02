import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const key = process.argv[2] || 'Tab';
const logger = new RunLogger('probe-lookup-key');
const s = await attachBrowser({ logger });
const { page, human } = s;
const f2 = page.frames().find(fr => fr.name() === 'f2');

await f2.locator('#IdxLk').click();
await human.press(key, { label: `${key} על שדה הלקוח` });
await human.think('waiting for lookup');

const snapshot = async () => {
  const out = [];
  for (const fr of page.frames()) {
    try {
      const n = await fr.evaluate(() => [...document.querySelectorAll('td,tr,option')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width>0 && r.height>0; }).length);
      if (n > 5) out.push({ name: fr.name()||'(anon)', url: fr.url().replace('https://www.comax.co.il/','').split('?')[0], n });
    } catch {}
  }
  return out;
};
console.log('\nframes עם תוכן:');
(await snapshot()).forEach(f => console.log(`  ${f.name.padEnd(22)} ${String(f.n).padStart(4)}  ${f.url}`));
console.log('\n#IdxLk =', JSON.stringify(await f2.locator('#IdxLk').inputValue()));
await logger.shot(page, `after-${key}`);
await s.browser.close().catch(()=>{});
logger.done();
