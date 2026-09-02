import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const term = process.argv[2] ?? '';
const logger = new RunLogger('list-items');
const s = await attachBrowser({ logger });
const { page, human } = s;
const fr = page.frames().find(f => /Doc612LinesU/.test(f.url()));

await fr.locator('#Prt').click();
await page.keyboard.press('Control+A');
await page.keyboard.press('Delete');
if (term) await human.type('#Prt', term, { scope: fr, label: 'חיפוש', clear: false });
await human.click('#CcomboButPrt', { scope: fr, label: 'בורר פריט' });
await human.settle('picker');

const pf = page.frames().find(f => /Select_G/.test(f.url()));
const rows = pf ? await pf.evaluate(() =>
  [...document.querySelectorAll('tr')].map(tr => [...tr.cells].map(c => (c.innerText||'').trim())).filter(r => r.some(Boolean))) : [];
console.log(`\nחיפוש "${term}" → ${rows.length} תוצאות:`);
rows.forEach((r,i)=>console.log(`  ${String(i+1).padStart(2)}. ${r[0]}`));
await s.browser.close().catch(()=>{});
logger.done();
