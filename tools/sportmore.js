/**
 * ספורט אנד מור — הקמות וקליטה. CLI.
 *
 *   npm run sm -- card
 *   npm run sm -- plan   --invoice <file> --season FW26 [--round x99|int] [--confirm]
 *   npm run sm -- intake --invoice <file> --warehouse SHIP|DROR [--confirm]
 *
 * Nothing here touches Comax. Sport & More run Priority, we have no access to
 * it, and the only channel between us is the Excel each side emails the other.
 *
 * No `--confirm`, no file — the same rule every writing task in this project
 * follows.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { loadItemCard } from '../src/sportmore/item-card.js';
import { readArenaInvoice, childSku } from '../src/sportmore/arena-invoice.js';
import { loadCodes } from '../src/sportmore/classify.js';
import { planBatch } from '../src/sportmore/plan.js';
import { buildSetupFile } from '../src/sportmore/build-setup.js';
import { buildIntakeFile, WAREHOUSES } from '../src/sportmore/build-intake.js';
import { buildReport } from '../src/sportmore/report.js';
import { ROUNDING } from '../src/sportmore/pricing.js';

const OUT_DIR = resolve(ROOT, 'sportmore/out');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const pad = (s, n) => String(s ?? '').padEnd(n);
const money = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
const today = () => new Date().toISOString().slice(0, 10);
const base = (f) => String(f).split(/[\\/]/).pop();

function die(msg) {
  console.error('\n' + msg + '\n');
  process.exit(1);
}

const [cmd = 'help', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

if (cmd === 'help' || args.help) {
  console.log([
    '',
    'ספורט אנד מור — הקמות וקליטה',
    '',
    '  npm run sm -- card',
    '      מה יש בכרטיס הפריט האחרון וכמה הוא ישן',
    '',
    '  npm run sm -- plan --invoice <קובץ> --season FW26 [--round x99|int] [--confirm]',
    '      קורא חשבונית מארנה, בודק מה כבר קיים, ומכין דוח + קובץ הקמות.',
    '      בלי --confirm לא נכתב שום קובץ.',
    '',
    '  npm run sm -- intake --invoice <קובץ> --warehouse SHIP|DROR [--confirm]',
    '      קובץ קליטת חשבוניות. רץ רק אחרי שספורט אנד מור הקימו הכל',
    '      ושלחו כרטיס פריט מעודכן — כל שורה נבדקת מולו.',
    '',
    '  --item-card <קובץ>   כרטיס פריט מפורש.',
    '                        ברירת המחדל: החדש ביותר ב-sportmore/reference/',
    '',
  ].join('\n'));
  process.exit(0);
}

if (cmd === 'card') {
  const card = await loadItemCard(args['item-card']);
  console.log('\nכרטיס פריט: ' + base(card.file));
  console.log('  גיל: ' + card.ageDays + ' ימים' + (card.ageDays > 30 ? '   ⚠  ישן — לבקש כרטיס מעודכן' : ''));
  console.log('  שורות: ' + card.rows + '   ·   אבות: ' + card.parents.size + '   ·   ברקודים: ' + card.byBarcode.size + '\n');
  process.exit(0);
}

if (cmd !== 'plan' && cmd !== 'intake') die('פקודה לא מוכרת: ' + cmd + '   (card / plan / intake)');
if (!args.invoice) die('חסר --invoice <קובץ חשבונית של ארנה>');

const card = await loadItemCard(args['item-card']);
const invoice = await readArenaInvoice(args.invoice);
const codes = loadCodes();

console.log('\nחשבונית:    ' + base(invoice.file) + '   —   ' + invoice.rows.length + ' שורות');
console.log('כרטיס פריט: ' + base(card.file) + '   —   ' + card.parents.size + ' אבות, בן ' + card.ageDays + ' ימים');
if (card.ageDays > 30) {
  console.log('            ⚠  הכרטיס ישן מ-30 יום. "לא קיים" ממנו הוא ניחוש.');
}
if (invoice.problems.length) {
  console.log('\n⚠  ' + invoice.problems.length + ' שורות בעייתיות בחשבונית:');
  for (const p of invoice.problems.slice(0, 5)) {
    console.log('      שורה ' + p.row + ': ' + p.articleNumber + ' — ' + p.why);
  }
}

/* ── plan ──────────────────────────────────────────────────────────────── */

if (cmd === 'plan') {
  const rounding = args.round || 'x99';
  if (!ROUNDING[rounding]) die('--round חייב להיות x99 או int, לא ' + rounding);

  const plan = planBatch({ invoice, card, codes, rounding });
  const c = plan.counts;

  console.log('\nמה יש כאן');
  console.log('  קיים כבר:        ' + c.exists);
  console.log('  בן חדש:          ' + c.newChild);
  console.log('  אב + בן חדשים:   ' + c.newBoth);
  console.log('  חסום:            ' + c.blocked);
  console.log('  אבות להקמה:      ' + c.newParents);

  if (plan.blocked.length) {
    console.log('\n⛔ שורות חסומות — לא ייכנסו לקובץ ההקמה:');
    for (const b of plan.blocked.slice(0, 10)) {
      console.log('      שורה ' + b.row.row + '  ' + b.row.ean + '  ' + b.row.articleNumber);
      console.log('         ' + b.why);
    }
  }

  if (plan.parents.length) {
    if (!args.season) {
      die('חסר --season (למשל FW26). ארנה משאירה את העמודה הזאת ריקה בייצוא, אז היא שלך.');
    }
    console.log('\nאבות חדשים — סיווג ומחיר   (עיגול: ' + rounding + ')\n');
    console.log('  ' + pad('מקט אב', 15) + pad('משפחה', 8) + pad('סרגל', 8) + pad('דויזן', 7)
      + pad('מגדר', 7) + pad('עלות €', 9) + pad('בסיס', 9) + pad('מחירון 1', 10) + 'תיאור');
    console.log('  ' + '-'.repeat(112));
    for (const p of plan.parents) {
      const k = p.classification;
      const mark = (f) => (k[f].value === null || k[f].value === undefined ? '!!' : k[f].value)
        + (k[f].confidence === 'medium' ? '?' : '');
      console.log('  ' + pad(p.sku, 15) + pad(mark('family'), 8) + pad(mark('sizeScale'), 8)
        + pad(mark('division'), 7) + pad(mark('gender'), 7)
        + pad(money(p.price?.costEur), 9) + pad(money(p.price?.base), 9) + pad(money(p.price?.wholesale), 10)
        + String(p.row.styleDesc || p.row.articleDesc).slice(0, 40));
    }
    console.log('\n  !! = לא הוכרע   ·   ? = רוב, לא פה אחד   ·   מחירון 3 = מחיר הבסיס');
  }

  if (plan.needsDecision.length) {
    console.log('\n⛔ ' + plan.needsDecision.length + ' אבות בלי סיווג מלא — קובץ ההקמה לא ייכתב:');
    for (const p of plan.needsDecision) {
      console.log('\n   ' + p.sku + '  ' + (p.row.styleDesc || ''));
      for (const f of p.unresolved) console.log('      ' + f + ': ' + p.classification[f].why);
    }
    console.log('\n   להשלים ב-sportmore/reference/codes.json, או להגיד לי מה הערך.');
  }

  if (!args.confirm) {
    console.log('\nלא נכתב שום קובץ. להוסיף --confirm כדי לכתוב את הדוח ואת קובץ ההקמה.\n');
    process.exit(0);
  }
  if (plan.needsDecision.length) die('לא נכתב קובץ הקמה — יש אבות בלי סיווג מלא (ראה למעלה).');

  mkdirSync(OUT_DIR, { recursive: true });
  const report = await buildReport({
    plan, invoice, card,
    out: resolve(OUT_DIR, 'דוח קיום ' + today() + '.xlsx'),
  });
  console.log('\n✓ דוח קיום:   ' + base(report.file));

  if (plan.parents.length || plan.children.length) {
    const setup = await buildSetupFile({
      parents: plan.parents,
      children: plan.children,
      seasonYear: args.season,
      codes,
      out: resolve(OUT_DIR, 'הקמה ארנה ' + args.season + ' ' + today() + ' - מוצרי אב ובנים.xlsx'),
    });
    console.log('✓ קובץ הקמה:  ' + base(setup.file) + '   (' + setup.parents + ' אבות, ' + setup.children + ' בנים)');
  } else {
    console.log('  אין אבות או בנים חדשים — לא נוצר קובץ הקמה.');
  }
  console.log('\nהקבצים ב-sportmore/out/. הקליטה רצה רק אחרי שהם הקימו ושלחו כרטיס פריט מעודכן.\n');
  process.exit(0);
}

/* ── intake ────────────────────────────────────────────────────────────── */

if (cmd === 'intake') {
  const warehouse = args.warehouse;
  if (!warehouse || !WAREHOUSES.includes(warehouse)) {
    die('חסר --warehouse. צריך ' + WAREHOUSES.join(' או ') + ' — זו החלטה שלך בכל מנה, אין ברירת מחדל.');
  }

  const plan = planBatch({ invoice, card, codes });
  const notReady = plan.rows.filter((r) => r.status !== 'exists');
  console.log('\nאימות מול כרטיס הפריט');
  console.log('  נמצאו:      ' + plan.counts.exists + ' מתוך ' + plan.counts.total);
  console.log('  לא נמצאו:   ' + notReady.length);

  if (notReady.length) {
    console.log('\n⛔ קובץ הקליטה לא ייכתב — יש שורות שעוד לא הוקמו:');
    for (const r of notReady.slice(0, 12)) {
      console.log('      שורה ' + r.row.row + '  ' + r.row.ean + '  ' + r.row.articleNumber + '  —  ' + r.why);
    }
    if (notReady.length > 12) console.log('      ...ועוד ' + (notReady.length - 12));
    console.log('\n   להריץ קודם plan, לשלוח הקמות, ולבקש כרטיס פריט מעודכן.\n');
    process.exit(1);
  }

  console.log('\n  מחסן: ' + warehouse + '   ·   סניף: ' + codes.constants.branch
    + '   ·   ספק: ' + codes.constants.supplier);
  const sample = invoice.rows[0];
  console.log('  דוגמה: ' + sample.ean + '  ' + sample.articleNumber + '  →  ' + childSku(sample));

  if (!args.confirm) {
    console.log('\nלא נכתב שום קובץ. להוסיף --confirm כדי לכתוב את קובץ הקליטה.\n');
    process.exit(0);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const res = await buildIntakeFile({
    rows: invoice.rows,
    card,
    warehouse,
    codes,
    out: resolve(OUT_DIR, 'קליטת חשבוניות ' + today() + ' ' + warehouse + '.xls'),
  });
  console.log('\n✓ קובץ קליטה: ' + base(res.file) + '   (' + res.rows + ' שורות, מחסן ' + res.warehouse + ')\n');
  process.exit(0);
}
