/**
 * Fills the tax-invoice header that is ALREADY OPEN, then commits it and maps
 * the lines screen. Used once, to learn Doc650Lines* through a real document.
 *
 * Deliberately does not press #newRec: a draft is already open from the mapping
 * click, and starting another would strand it.
 *
 *   node tools/_smoke/invoice-header-drive.mjs
 *
 * Stops at the lines screen. Adds no lines and files nothing.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { inspectPage, digest } from '../../src/inspect.js';
import { profile } from '../../src/documents/agents/invoice/index.js';
import * as engine from '../../src/documents/engine.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../../src/config.js';

const INPUT = {
  customer: '429028',
  store: 'ראשי',
  priceList: 'מחירון קבוצות',
  details: 'משקפות',
};

const logger = new RunLogger('invoice-header-drive');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger };
const { page } = ctx;

const header = page.frames().find((f) => profile.frames.header.test(f.url()));
if (!header) {
  console.log('אין כותרת חשבונית פתוחה (Doc650U). הרץ קודם open-program + #newRec.');
  process.exit(1);
}
logger.step('header', header.url().replace(/\?.*/, '').split('/').pop());

await engine.fillHeader(ctx, profile, header, INPUT);
const read = await engine.readHeader(profile, header);
logger.save('header-filled.json', read);
console.log('\n  הכותרת אחרי מילוי:');
for (const [k, v] of Object.entries(read)) console.log(`    ${k.padEnd(8)} ${v ?? '(ריק)'}`);
await logger.shot(page, 'header-filled');

const mhr = (read.מחירון ?? '').trim();
if (!mhr.includes(profile.forcePriceList)) {
  console.log(`\n  ⛔ המחירון הוא "${mhr || '(ריק)'}" ולא "${profile.forcePriceList}" — לא מאשר כותרת.`);
  process.exit(1);
}
console.log(`\n  מחירון ${mhr} ✓ — מאשר כותרת (זה רק מתקדם לשורות, לא קולט).`);

await engine.commitHeader(ctx, profile, header);

const snap = await inspectPage(page);
const base = resolve(ROOT, 'knowledge/screens', 'invoice-lines');
writeFileSync(`${base}.json`, JSON.stringify(snap, null, 2), 'utf8');
writeFileSync(`${base}.txt`, digest(snap), 'utf8');
console.log(`\n  → ${base}.json`);
await logger.shot(page, 'lines-screen');

for (const f of snap.frames) {
  if (!/Doc650Lines/i.test(f.url || '')) continue;
  console.log(`\n  FRAME ${f.url.replace(/\?.*/, '').split('/').pop()} (${f.elementCount})`);
  console.log('    ' + f.elements.filter((e) => e.id).map((e) => e.id).join(', '));
}

console.log(`\n  מספר המסמך: ${await engine.readDocNumber(ctx, profile) ?? '(לא נקרא)'}`);
console.log('  עוצר כאן. לא נוספו שורות ושום דבר לא נקלט.\n');
await s.browser.close().catch(() => {});
logger.done();
