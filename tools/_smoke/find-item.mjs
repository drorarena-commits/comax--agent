import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const term = process.argv[2];
const logger = new RunLogger('find-item');
const s = await attachBrowser({ logger });
const { page, human } = s;
const fr = page.frames().find(f => /Doc612LinesU/.test(f.url()));
if (!fr) { console.log('דיאלוג השורה לא פתוח'); process.exit(1); }

await human.type('#Prt', term, { scope: fr, label: 'פריט' });
await human.press('Enter', { label: 'Enter על פריט' });
await human.think('item lookup');

const pf = page.frames().find(f => /Select_G/.test(f.url()));
const rows = pf ? await pf.evaluate(() =>
  [...document.querySelectorAll('tr')].map(tr => [...tr.cells].map(c => (c.innerText||'').trim())).filter(r => r.some(Boolean))) : [];

console.log(`\n#Prt אחרי Enter = ${JSON.stringify(await fr.locator('#Prt').inputValue())}`);
console.log(`\nהבורר הציע ${rows.length} תוצאות:`);
rows.forEach((r,i)=>console.log(`  ${String(i+1).padStart(2)}. ${r[0]}   [אינדקס ${r[1]??''} | ברקוד ${r[2]??''}]`));
await s.browser.close().catch(()=>{});
logger.done();
