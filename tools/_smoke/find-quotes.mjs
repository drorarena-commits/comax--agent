import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { openProgram, closePrograms, listPrograms } from '../../src/navigate.js';
import { ensureLoggedIn } from '../../src/session.js';
import { touch } from '../../src/activity.js';

const needle = process.argv[2] || 'הרצליה';
touch('find-quotes');
const logger = new RunLogger('find-quotes');
const s = await attachBrowser({ logger });
if (!s) { console.error('אין חלון'); process.exit(1); }
const ctx = { ...s, logger };
await ensureLoggedIn(ctx);

console.log('\n=== תוכניות בעבודה לפני ===');
const before = await listPrograms(s.page);
console.log(before.length ? before.map(r=>`${r.index}. ${r.name}`).join('\n') : '  (הפאנל לא פתוח / אין)');
await closePrograms(ctx).catch(e=>console.log('close err', e.message));

const { frame: list } = await openProgram(ctx, 'a164', {
  expect: /Doc612V\.asp/i,
  program: 'Erp/Mehirot/Doc612/AzaaMhr/Doc612V.asp?SwVO=0&SwLk=1',
});
console.log('list frame:', list.url());

// clear filters then apply customer-name filter (Enter, never #Find)
await s.human.type('#wFindLkNm', needle, { scope: list, label: `סינון לקוח ${needle}` });
await s.human.press('Enter', { label: 'החלת הסינון' });
await s.human.think('filter applied');

const grid = await list.evaluate(() => {
  const txt = c => (c.innerText||'').replace(/\s+/g,' ').trim();
  const tables=[...document.querySelectorAll('table')];
  for (const t of tables){
    const rows=[...t.rows].map(tr=>[...tr.cells].map(txt));
    const hi=rows.findIndex(r=>r.includes('שם לקוח'));
    if(hi<0) continue;
    return { head: rows[hi], rows: rows.slice(hi+1).filter(r=>r.some(Boolean)) };
  }
  return {head:[],rows:[]};
});
console.log('\n=== HEAD ===\n', grid.head.join(' | '));
console.log('=== ROWS (' + grid.rows.length + ') ===');
grid.rows.forEach((r,i)=>console.log(` ${i}. ${r.join(' | ')}`));
await logger.shot(s.page, 'quote-list');
await s.browser.close().catch(()=>{});
logger.done();
