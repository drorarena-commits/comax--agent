import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const term = process.argv[2] || 'וינגייט';
const logger = new RunLogger('probe-customer');
const s = await attachBrowser({ logger });
const { page, human } = s;
const f2 = page.frames().find(fr => fr.name() === 'f2');
if (!f2) { console.log('frame f2 לא נמצא — הטופס נסגר?'); process.exit(1); }

await human.type('#IdxLk', term, { scope: f2, label: 'לקוח' });
await human.think('waiting for lookup');

// What appeared? Any new frame, dropdown, or list.
const state = await f2.evaluate(() => ({
  idxLk: document.getElementById('IdxLk')?.value ?? null,
  lists: [...document.querySelectorAll('div,ul,table')]
    .filter(el => { const r = el.getBoundingClientRect();
      return r.width > 80 && r.height > 40 && getComputedStyle(el).position === 'absolute'; })
    .slice(0, 5)
    .map(el => ({ id: el.id || null, cls: (el.className||'').toString().slice(0,40),
                  text: (el.innerText||'').trim().slice(0, 200) })),
}));
console.log('\n#IdxLk =', JSON.stringify(state.idxLk));
console.log('שכבות צפות:', JSON.stringify(state.lists, null, 1));

console.log('\nframes חדשים:');
for (const fr of page.frames()) {
  const u = fr.url();
  if (/Lk|Search|Find|Combo/i.test(u) && fr.name() !== 'f0') console.log('  ', fr.name(), u.replace('https://www.comax.co.il/','').split('?')[0]);
}
await logger.shot(page, 'customer-lookup');
await s.browser.close().catch(()=>{});
logger.done();
