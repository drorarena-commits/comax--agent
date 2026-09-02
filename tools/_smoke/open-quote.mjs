import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { openProgram } from '../../src/navigate.js';

const docNo = process.argv[2];
const logger = new RunLogger('open-quote');
const s = await attachBrowser({ logger });
const { page, human } = s;

const { frame } = await openProgram({ ...s, logger }, 'a164', { expect: /Doc612V\.asp/i });

await human.type('#wFindDocNo', docNo, { scope: frame, label: 'מספר הצעה' });
await human.click('#Find', { scope: frame, label: 'חיתוכים' });
await human.settle('filtered');

const rows = await frame.evaluate(() =>
  [...document.querySelectorAll('tr')]
    .map(tr => [...tr.cells].map(c => (c.innerText||'').trim()))
    .filter(r => r.some(Boolean) && r.length > 3).slice(0, 6));
console.log('\nשורות אחרי הסינון:');
rows.forEach((r,i)=>console.log(`  ${i}. ${r.join(' | ')}`));

await logger.shot(page, 'filtered');
await s.browser.close().catch(()=>{});
logger.done();
