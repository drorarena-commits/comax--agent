import { attachBrowser } from '../../src/browser.js';

const barcode = process.argv[2];
const session = await attachBrowser();
if (!session) { console.error('אין חלון פתוח'); process.exit(1); }
const { page, human, browser } = session;

const frame = page.frames().find(f => /Erp\/Prt\/PrtV\.aspx/i.test(f.url()));
if (!frame) { console.error('לא נמצא frame של פריטים'); process.exit(1); }

await human.type('#wBk', barcode, { scope: frame, label: 'ברקוד' });
await human.press('Enter', { label: 'Enter על ברקוד' });
await human.think('barcode lookup');

const rows = await frame.evaluate(() => {
  const out = [];
  for (const tr of document.querySelectorAll('tr')) {
    const cells = [...(tr.cells || [])].map(c => (c.innerText || '').trim());
    if (cells.some(Boolean)) out.push(cells);
  }
  return out;
});
console.log(JSON.stringify(rows, null, 2));

await browser.close().catch(() => {});
