/**
 * Adds ONE line to the חשבונית מס/קבלה that is open on the lines grid, reads
 * the totals, and then dumps the grid's own #OK handler source.
 *
 * That last part is the point of the tool. On Doc650 and Doc470 the grid's #OK
 * opens a *frame* dialog and filing happens on a second click — a stop a human
 * can cancel at. For Doc652 that is unverified, and it matters more here than
 * anywhere else: browser.js:16 accepts every native dialog unconditionally, so
 * if Doc652 gates filing behind a `confirm()` the agent answers yes before a
 * human reads it, and the document files. Reading the handler is how that is
 * settled BEFORE the click rather than after it.
 *
 *   node tools/_smoke/invoice-receipt-add-line.mjs ['{"items":[…]}' | path.json]
 *
 * Uses the LINE DIALOG's #OK only (scoped to Doc652LinesU). Never touches the
 * grid's #OK. FILES NOTHING.
 *
 * Items go in by plain barcode SKU — not the מק"ט חלופי.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { profile as real } from '../../src/documents/agents/invoice-receipt/index.js';
import * as engine from '../../src/documents/engine.js';
import { readFileSync } from 'node:fs';

// Local mapping override — index.js keeps mapped:false until the flow has run
// end to end. See the note in invoice-receipt-header-drive.mjs.
const profile = { ...real, mapped: { list: true, header: true, lines: true } };

const arg = process.argv[2];
const input = !arg ? {} : JSON.parse(arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8'));
const ITEMS = input.items ?? [];
if (!ITEMS.length) { console.log('אין פריטים. העבר {"items":[{code,qty}]}'); process.exit(1); }

const logger = new RunLogger('invoice-receipt-add-line');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger, dryRun: true };
const { page, human } = ctx;

const grid = engine.linesFrame(ctx, profile);
if (!grid) { console.log('מסך השורות של חשבונית מס/קבלה לא פתוח (Doc652LinesV).'); process.exit(1); }
logger.step('grid', grid.url().replace(/\?.*/, '').split('/').pop());

if (!page.frames().some((f) => profile.frames.lineForm.test(f.url()))) {
  logger.step('lines', 'דיאלוג השורה לא פתוח — פותח דרך #newRec ברשת');
  await human.click('#newRec', { scope: grid, label: 'הוספת שורה' });
  await human.settle('line dialog');
}

// engine.addLine scopes every click to profile.frames.lineForm, so its #OK is
// the dialog's, not the grid's.
const lines = [];
for (const [i, item] of ITEMS.entries()) {
  lines.push(await engine.addLine(ctx, profile, item, { index: i + 1, last: i === ITEMS.length - 1 }));
}

console.log('\n  השורות במסמך:');
for (const [i, l] of lines.entries()) {
  console.log(`    ${i + 1}. ${l.item ?? '?'}  ×${l.qty ?? '?'}  @${l.price ?? '?'}  -${l.discount ?? '?'}%  = ${l.amount ?? '?'}`);
}
logger.save('lines.json', lines);

const totals = await engine.readTotals(ctx, profile);
console.log('\n  סיכום המסמך:');
console.log(`    לפני מע"מ  ${totals.beforeVat ?? '?'}`);
console.log(`    מע"מ       ${totals.vat ?? '?'}`);
console.log(`    סה"כ       ${totals.total ?? '?'}`);
logger.save('totals.json', totals);

// ── The gate reading ────────────────────────────────────────────────────────
// Every visible control on the grid, with its FULL onclick (doc-buttons.mjs
// truncates at 90 chars, and the answer is usually past that), plus the source
// of any global function the handler names.
const probe = await grid.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const els = [...document.querySelectorAll('img,input[type=button],input[type=submit],button,a,[onclick]')]
    .filter(vis)
    .map((e) => ({
      tag: e.tagName,
      id: e.id || '',
      title: e.title || e.alt || '',
      src: (e.src || '').split('/').pop(),
      onclick: e.getAttribute('onclick') || '',
    }));

  const ok = els.find((e) => e.id === 'OK') ?? null;
  const handlers = {};
  if (ok?.onclick) {
    // Every bare identifier the handler calls, resolved against the frame's
    // globals. This is what says whether #OK opens a screen or submits.
    for (const m of ok.onclick.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[1];
      if (handlers[name]) continue;
      try {
        const fn = window[name];
        if (typeof fn === 'function') handlers[name] = String(fn).slice(0, 1200);
      } catch { /* cross-origin or shadowed — skip */ }
    }
  }
  return { els, ok, handlers, printSuppressed: /suppressed|noop/i.test(String(window.print)) };
});

console.log('\n  ── הרשת: כל הפקדים ──');
for (const e of probe.els) {
  console.log(`  ${e.tag.padEnd(6)} #${e.id.padEnd(14)} ${(e.title || '').padEnd(26)} ${e.src.padEnd(16)} ${e.onclick.slice(0, 60)}`);
}

console.log('\n  ── #OK ברשת ──');
if (!probe.ok) {
  console.log('  אין #OK גלוי ברשת. (על Doc650 הרשת הריקה גם היא בלי #OK — זה ממצא, לא תקלה.)');
} else {
  console.log(`  title:   ${JSON.stringify(probe.ok.title)}`);
  console.log(`  onclick: ${probe.ok.onclick}`);
  for (const [name, src] of Object.entries(probe.handlers)) {
    console.log(`\n  --- ${name}() ---\n${src.split('\n').map((l) => '    ' + l).join('\n')}`);
  }
  const all = Object.values(probe.handlers).join('\n') + probe.ok.onclick;
  console.log('\n  ── שערים ──');
  console.log(`  G1 תווית "קליטת חשבונית":  ${/קליטת/.test(probe.ok.title) ? '✓' : '✗ ' + JSON.stringify(probe.ok.title)}`);
  console.log(`  G2 פותח מסך (window.open / *.asp):  ${/window\.open|showModalDialog|\.asp/i.test(all) ? '✓' : '✗ לא נמצא — לא ללחוץ'}`);
  console.log(`  G3 אין confirm( בדרך:  ${/\bconfirm\s*\(/.test(all) ? '✗ יש confirm — browser.js מאשר אותו אוטומטית, אין עצירה' : '✓'}`);
}
console.log(`  G4 window.print מנוטרל:  ${probe.printSuppressed ? '✓' : '✗'}`);
logger.save('grid-probe.json', probe);

console.log(`\n  מספר המסמך: ${await engine.readDocNumber(ctx, profile) ?? '(לא נקרא)'}`);
console.log('  לא נקלט. המסמך פתוח על המסך.\n');
await s.browser.close().catch(() => {});
logger.done();
