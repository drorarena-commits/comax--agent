import { openBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const logger = new RunLogger('pace-check');
const { context, page, human } = await openBrowser({ logger });

await page.setContent(`<!doctype html><meta charset="utf-8">
<body style="font:16px sans-serif;padding:40px" dir="rtl">
<h2>בדיקת קצב</h2>
<input id="a" style="font-size:18px;padding:8px;width:300px">
<button id="b" style="font-size:18px;padding:10px;margin-top:20px">שמור</button>
<div id="out"></div>
<script>b.onclick=()=>out.textContent='נלחץ: '+a.value</script>
</body>`);

const t = [];
const mark = () => t.push(Date.now());

mark();
await human.type('#a', 'לקוח בדיקה', { label: 'שם לקוח' });
mark();
await human.click('#b', { label: 'כפתור שמור' });
mark();
await human.think('reading result');
mark();

console.log('\nתוצאה:', await page.locator('#out').textContent());
console.log('\nפערים בין פעולות (שניות):');
for (let i = 1; i < t.length; i++) {
  const gap = (t[i] - t[i - 1]) / 1000;
  console.log(`  ${i}: ${gap.toFixed(2)}s  ${gap >= 2 ? 'OK' : 'TOO FAST'}`);
}
await context.close();
logger.done();
