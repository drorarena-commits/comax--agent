/**
 * Confirms a filed document exists, by filtering the list on its own number.
 *
 * Not a scan of the first page: `Doc470V` sorts by document number descending
 * and an older `601xxxx` series sits in the same list, so every `470xxxx` is
 * pushed off the first page and a freshly filed transfer looks missing. The
 * same shape of mistake is possible on any of these lists — filter, never scan.
 *
 *   node tools/_smoke/verify-doc.mjs '<frame regex>' '<field>' '<number>'
 *   node tools/_smoke/verify-doc.mjs 'Doc470V\.asp'  '#wFindDocNo' 4700240
 *   node tools/_smoke/verify-doc.mjs 'Doc650V\.aspx' '#wFindDocNo' 6500085
 *
 * Read-only: it types into a filter box and reads the grid. Files nothing.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';

const [pattern, field, number] = process.argv.slice(2);
if (!pattern || !field || !number) {
  console.log("שימוש: node tools/_smoke/verify-doc.mjs '<frame regex>' '<field>' '<number>'");
  process.exit(1);
}

const logger = new RunLogger('verify-doc');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const { page, human } = { ...s, logger };

const frame = page.frames().find((f) => new RegExp(pattern, 'i').test(f.url()));
if (!frame) { console.log(`לא נמצא frame שמתאים ל-${pattern}`); process.exit(1); }
logger.step('frame', frame.url().replace(/\?.*/, '').split('/').pop());

await human.type(field, String(number), { scope: frame, label: 'מספר מסמך' });
await frame.locator(field).press('Enter');
await human.settle('filtered');

const rows = await frame.evaluate(() => {
  const out = [];
  for (const tr of document.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()).filter(Boolean);
    if (cells.length > 3) out.push(cells.join(' | '));
  }
  return out.slice(0, 12);
});

console.log(`\n  ${field} = ${number}:`);
for (const r of rows) console.log(`    ${r}`);

const found = rows.some((r) => r.includes(String(number)));
console.log(found ? `\n  ✅ ${number} קיים ברשימה.\n` : `\n  ⛔ ${number} לא נמצא ברשימה.\n`);

await logger.shot(page, 'verified');
await s.browser.close().catch(() => {});
logger.done(found ? 'ok' : 'failed');
process.exit(found ? 0 : 1);
