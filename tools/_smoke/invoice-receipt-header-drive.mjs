/**
 * Fills the חשבונית מס/קבלה header that is ALREADY OPEN (Doc652U), commits it,
 * and stops at the lines screen. Written to map Doc652Lines* through a real
 * draft, because a132 has never been driven.
 *
 * Deliberately does not press #newRec: a draft is already open from the
 * `npm run open-program -- a132` + #newRec that got here, and starting another
 * would strand it. Same reason as transfer-header-drive.mjs.
 *
 *   node tools/_smoke/invoice-receipt-header-drive.mjs ['{"customer":"…"}' | path.json]
 *
 * Stops at the lines screen. Adds no lines and FILES NOTHING.
 *
 * ⚠️ Why this file exists at all: `profile.mapped.header` is false, so
 * `engine.startNew`/`addLine` and `registry.assertReady` all throw before the
 * first click — the brake that this run exists to remove. The override below is
 * local to the mapping instrument; `index.js` keeps `mapped: false` until the
 * flow has run end to end, per comax-ops.md.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { inspectPage, digest } from '../../src/inspect.js';
import { profile as real } from '../../src/documents/agents/invoice-receipt/index.js';
import * as engine from '../../src/documents/engine.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../../src/config.js';

// The mapping override — local, never written back to index.js.
const profile = { ...real, mapped: { list: true, header: true, lines: true } };

// Hebrew values do not survive a shell single-quoted argument on every console,
// so a path to a JSON file is accepted alongside inline JSON.
const arg = process.argv[2];
const given = !arg ? {} : JSON.parse(arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8'));

const INPUT = {
  customer: '429028',
  details: 'מיפוי סוכן - לא לקליטה',
  ...given,
};

const logger = new RunLogger('invoice-receipt-header-drive');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger };
const { page } = ctx;

const header = page.frames().find((f) => profile.frames.header.test(f.url()));
if (!header) {
  console.log('אין כותרת חשבונית מס/קבלה פתוחה (Doc652U).');
  console.log('הרץ קודם: npm run open-program -- a132  ואז #newRec.');
  process.exit(1);
}
logger.step('header', header.url().replace(/\?.*/, '').split('/').pop());

// #DocId vs #DocNo is a guess inherited from Doc650 and has never been read.
// Report both before anything else, so the profile can be corrected from fact.
for (const sel of ['#DocId', '#DocNo']) {
  const txt = await header.locator(sel).innerText().catch(() => null);
  const val = await header.locator(sel).inputValue().catch(() => null);
  console.log(`  ${sel.padEnd(8)} text=${JSON.stringify(txt)} value=${JSON.stringify(val)}`);
}

await engine.fillHeader(ctx, profile, header, INPUT);
const read = await engine.readHeader(profile, header);
logger.save('header-filled.json', read);
console.log('\n  הכותרת אחרי מילוי:');
for (const [k, v] of Object.entries(read)) console.log(`    ${k.padEnd(8)} ${v ?? '(ריק)'}`);
await logger.shot(page, 'header-filled');

if (!read.לקוח) {
  console.log('\n  ⛔ שדה הלקוח ריק — לא מאשר כותרת.');
  process.exit(1);
}
console.log(`\n  לקוח ${read.לקוח} · מחירון ${read.מחירון || '(ריק)'} · מחסן ${read.מחסן || '(ריק)'}`);
console.log('  מאשר כותרת — זה רק מתקדם לשורות, לא קולט.');

// engine.commitHeader re-checks the frame against the header pattern first.
// That guard is the safety property here: aimed at a lines frame it would file.
await engine.commitHeader(ctx, profile, header);
await logger.shot(page, 'lines-screen');

if (INPUT.snapshot) {
  const snap = await inspectPage(page);
  const base = resolve(ROOT, 'knowledge/screens', INPUT.snapshot === true ? 'invoice-receipt-lines' : INPUT.snapshot);
  writeFileSync(`${base}.json`, JSON.stringify(snap, null, 2), 'utf8');
  writeFileSync(`${base}.txt`, digest(snap), 'utf8');
  console.log(`\n  → ${base}.json`);

  for (const f of snap.frames) {
    if (!/Doc652/i.test(f.url || '') || /Doc652[VU]\.asp/i.test(f.url || '')) continue;
    console.log(`\n  FRAME ${f.url.replace(/\?.*/, '').split('/').pop()} (${f.elementCount})`);
    console.log('    ' + f.elements.filter((e) => e.id).map((e) => e.id).join(', '));
  }
}

console.log(`\n  מספר המסמך: ${await engine.readDocNumber(ctx, profile) ?? '(לא נקרא)'}`);
console.log('  עוצר כאן. לא נוספו שורות ושום דבר לא נקלט.\n');
await s.browser.close().catch(() => {});
logger.done();
