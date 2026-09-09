/**
 * Regression for the Sport & More pipeline, run against real batches.
 *
 *   npm run sm-test
 *
 * The FW26 batch is the fixture: we have both what went in (barcodes, costs and
 * sizes, recoverable from the setup file itself) and what came out — the setup
 * file Dror actually sent. Rebuilding the second from the first and diffing cell
 * by cell is the only check that catches a column drifting one to the left.
 *
 * Those parents already live in the item card — they were set up in August — so
 * the card is cloned with the six *new-in-that-batch* SKUs removed. The other
 * four stay, because in the real batch they were existing models gaining a size,
 * and that is the case worth reproducing.
 *
 * The comparison distinguishes two kinds of column, and the distinction is the
 * point of the whole test:
 *
 *   derived   — constants and fields copied straight off the invoice. These must
 *               match exactly. A mismatch here is a bug.
 *   classified — משפחה · סרגל · דויזן · מגדר. These must match *or be refused*.
 *               A wrong non-null value is a failure; an honest refusal is not,
 *               because for a model Sport & More have never carried there is
 *               genuinely nothing in the card to derive it from.
 */
import ExcelJS from 'exceljs';
import { resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { ROOT } from '../src/config.js';
import { loadItemCard } from '../src/sportmore/item-card.js';
import { loadCodes } from '../src/sportmore/classify.js';
import { planBatch } from '../src/sportmore/plan.js';
import { buildSetupFile, SETUP_PARENT_COLUMNS, SETUP_CHILD_COLUMNS } from '../src/sportmore/build-setup.js';
import { childSku, parentSku } from '../src/sportmore/arena-invoice.js';
import { priceFromCost } from '../src/sportmore/pricing.js';

const FW26 = resolve(ROOT, 'sportmore/reference/template-parent-child.xlsx');
const INTAKE_EXPECTED = resolve(ROOT, 'sportmore/reference/expected/intake-fw26.xlsx');
// Lives under reference/, not in/, because in/ is gitignored and the suite has
// to run on both machines.
const ARENA_FIXTURE = resolve(ROOT, 'sportmore/reference/expected/arena-invoice-2026-05-28.xlsx');
const TMP = resolve(ROOT, 'sportmore/out/.selftest');

const P = SETUP_PARENT_COLUMNS;
const CLASSIFIED = [P.family, P.sizeScale, P.division, P.gender];
const DERIVED = Object.values(P).filter((c) => !CLASSIFIED.includes(c));

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  v ' : '  X ') + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

const text = (c) => {
  const v = c?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    return String(v.text ?? v.result ?? '');
  }
  return String(v).trim();
};

const same = (x, y) => x === y || (x !== '' && y !== '' && Number(x) === Number(y));

/**
 * Reconstruct the Arena invoice that produced the FW26 batch.
 *
 * `מקט ספק` on the parent sheet is style+colour with no separator. Arena style
 * codes are six characters and the colour is whatever follows — two digits or
 * three, both occur (`005875`+`50`, `007964`+`100`). Splitting on the last three
 * instead would silently produce a different parent for every two-digit colour.
 * This is an assumption *of the fixture*; the pipeline never guesses, it gets
 * the split free from `SKU/Article number`.
 *
 * Children whose parent is not on the parent sheet are kept — the real file has
 * eleven, sizes added to models Sport & More already carried. Their style,
 * colour and cost come from the card.
 */
async function fw26Invoice(card) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FW26);
  const [wp, wc] = wb.worksheets;

  const onSheet = new Map();
  wp.eachRow((r, n) => {
    if (n === 1) return;
    const sku = text(r.getCell(P.sku));
    if (!sku) return;
    const supplierSku = text(r.getCell(P.supplierSku));
    onSheet.set(sku, {
      style: supplierSku.slice(0, 6),
      colorCode: supplierSku.slice(6),
      styleDesc: text(r.getCell(P.desc)),
      price: Number(text(r.getCell(P.costEur))),
    });
  });

  const rows = [];
  wc.eachRow((r, n) => {
    if (n === 1) return;
    const parent = text(r.getCell(SETUP_CHILD_COLUMNS.parent));
    let p = onSheet.get(parent);
    if (!p) {
      const known = card.parents.get(parent);
      if (!known) return;
      const supplierSku = known.supplierSku || parent.replace(/^AR/, '');
      // Existing models: cost is not in the fixture, so give them a plausible
      // one. They are never set up again, so it is never compared.
      p = { style: supplierSku.slice(0, 6), colorCode: supplierSku.slice(6), styleDesc: known.desc, price: 9.99 };
    }
    rows.push({
      row: n,
      ean: text(r.getCell(SETUP_CHILD_COLUMNS.barcode)),
      articleNumber: `${p.style}_${p.colorCode}_${text(r.getCell(SETUP_CHILD_COLUMNS.size))}`,
      articleDesc: p.styleDesc,
      style: p.style,
      colorCode: p.colorCode,
      size: text(r.getCell(SETUP_CHILD_COLUMNS.size)),
      styleDesc: p.styleDesc,
      qty: 1,
      price: p.price,
      listPrice: 0,
      season: '',
      invoiceNo: 'FW26TEST',
      date: new Date(Date.UTC(2026, 7, 24)),
      backbone: [],
      fiber: '',
    });
  });

  return { file: FW26, rows, problems: [], headers: {}, newParents: [...onSheet.keys()] };
}

/**
 * The card as it stood *before* the batch: the parents it created removed, and
 * every barcode on its children sheet removed too. Without the second half the
 * eleven sizes added to existing models still look present, and the newChild
 * path — the most common one in real batches — never gets exercised.
 */
function cardBefore(card, parentSkus, barcodes) {
  const parents = new Map(card.parents);
  const byBarcode = new Map(card.byBarcode);
  for (const sku of parentSkus) parents.delete(sku);
  for (const ean of barcodes) byBarcode.delete(String(ean));
  return { ...card, parents, byBarcode };
}

const index = (ws, keyCol, cols) => {
  const m = new Map();
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const key = text(r.getCell(keyCol));
    if (!key) return;
    m.set(key, Object.fromEntries(cols.map((c) => [c, text(r.getCell(c))])));
  });
  return m;
};

/* ── run ───────────────────────────────────────────────────────────────── */

console.log('\nבדיקת רגרסיה — ספורט אנד מור\n');

const card = await loadItemCard();
const codes = loadCodes();
const invoice = await fw26Invoice(card);

console.log('מנת FW26 — ' + invoice.rows.length + ' שורות, '
  + new Set(invoice.rows.map(parentSku)).size + ' אבות, מתוכם '
  + invoice.newParents.length + ' הוקמו במנה');

/* 1 */
console.log('\n1. בדיקת קיום — המנה כולה אמורה להימצא בכרטיס');
{
  const plan = planBatch({ invoice, card, codes });
  check('כל השורות מזוהות כקיימות', plan.counts.exists === invoice.rows.length,
    plan.counts.exists + '/' + invoice.rows.length);
  check('אין שורות חסומות', plan.counts.blocked === 0, String(plan.counts.blocked));
}

/* 2 */
console.log('\n2. בדיקת קיום — ברקודים מומצאים');
{
  const fake = {
    ...invoice,
    rows: invoice.rows.slice(0, 5).map((r, i) => ({ ...r, ean: '999000000' + String(i).padStart(4, '0') })),
  };
  const plan = planBatch({ invoice: fake, card, codes });
  check('חמישה ברקודים מומצאים = חמישה בנים חדשים', plan.counts.newChild === 5,
    'newChild=' + plan.counts.newChild + ' exists=' + plan.counts.exists);
  check('אף אחד מהם לא סווג כקיים', plan.counts.exists === 0, String(plan.counts.exists));
}

/* 3 */
console.log('\n3. רגרסיה — שחזור קובץ ההקמה של FW26');
{
  const trimmed = cardBefore(card, invoice.newParents, invoice.rows.map((r) => r.ean));
  const plan = planBatch({ invoice, card: trimmed, codes, rounding: 'int' });

  check('האבות שהוקמו במנה זוהו כחדשים', plan.counts.newParents === invoice.newParents.length,
    plan.counts.newParents + '/' + invoice.newParents.length);
  check('הבנים של אבות קיימים זוהו כבן חדש', plan.counts.newChild > 0,
    'newChild=' + plan.counts.newChild);

  mkdirSync(TMP, { recursive: true });
  const out = resolve(TMP, 'fw26.xlsx');
  await buildSetupFile({ parents: plan.parents, children: plan.children, seasonYear: 'FW26', codes, out });

  const mine = new ExcelJS.Workbook();
  await mine.xlsx.readFile(out);
  const theirs = new ExcelJS.Workbook();
  await theirs.xlsx.readFile(FW26);

  const PCOLS = Object.values(P);
  const a = index(mine.worksheets[0], P.sku, PCOLS);
  const b = index(theirs.worksheets[0], P.sku, PCOLS);
  check('אותו מספר אבות', a.size === b.size, a.size + ' מול ' + b.size);

  const byField = Object.fromEntries(Object.entries(P).map(([k, v]) => [v, k]));
  const wrong = [];        // derived — always a bug
  const misclassified = []; // classified but not matching — an accuracy miss
  const refused = [];       // classified and honestly left blank
  for (const [sku, theirRow] of b) {
    const mineRow = a.get(sku);
    if (!mineRow) { wrong.push(sku + ': חסר אצלי'); continue; }
    for (const col of DERIVED) {
      if (!same(mineRow[col], theirRow[col])) {
        wrong.push(sku + ' ' + byField[col] + ' (' + col + '): שלי "' + mineRow[col] + '" שלהם "' + theirRow[col] + '"');
      }
    }
    for (const col of CLASSIFIED) {
      if (same(mineRow[col], theirRow[col])) continue;
      if (mineRow[col] === '') refused.push(sku + ' ' + byField[col] + ' (צריך ' + theirRow[col] + ')');
      else misclassified.push(sku + ' ' + byField[col] + ': שלי "' + mineRow[col] + '" שלהם "' + theirRow[col] + '"');
    }
  }
  check('כל השדות הנגזרים זהים (' + DERIVED.length + ' עמודות)', wrong.length === 0);
  wrong.slice(0, 12).forEach((d) => console.log('        ' + d));
  check('שדות סיווג — אף פעם לא ערך שגוי', misclassified.length === 0,
    refused.length ? refused.length + ' סורבו ביושר' : 'כולם נגזרו');
  misclassified.slice(0, 10).forEach((d) => console.log('        שגוי: ' + d));
  refused.slice(0, 10).forEach((d) => console.log('        סורב: ' + d));

  const CCOLS = Object.values(SETUP_CHILD_COLUMNS);
  const ca = index(mine.worksheets[1], SETUP_CHILD_COLUMNS.barcode, CCOLS);
  const cb = index(theirs.worksheets[1], SETUP_CHILD_COLUMNS.barcode, CCOLS);
  // One child in the real FW26 file — 3468337311270 — points at parent
  // AR007450100, which has no parent row in that file and does not exist in
  // today's item card either. The fixture cannot reconstruct a row whose parent
  // is unknown on both sides, so it is reported, not counted as a failure. It
  // is worth knowing about: that child was sent for setup with no parent.
  const orphans = [...cb.keys()].filter((ean) => !ca.has(ean));
  check('כל הבנים שניתן היה לשחזר נוצרו', ca.size + orphans.length === cb.size,
    ca.size + ' + ' + orphans.length + ' חריגים מול ' + cb.size);
  if (orphans.length) {
    for (const ean of orphans) {
      const parent = cb.get(ean)[SETUP_CHILD_COLUMNS.parent];
      console.log('        חריגה בקובץ המקורי: ' + ean + ' תלוי באב ' + parent
        + ' — אין לו שורת אב בקובץ' + (card.parents.has(parent) ? '' : ' והוא לא קיים בכרטיס'));
    }
  }
  const cdiffs = [];
  for (const [ean, theirRow] of cb) {
    const mineRow = ca.get(ean);
    if (!mineRow) continue;
    for (const col of CCOLS) {
      if (!same(mineRow[col], theirRow[col])) {
        cdiffs.push(ean + ' עמודה ' + col + ': שלי "' + mineRow[col] + '" שלהם "' + theirRow[col] + '"');
      }
    }
  }
  check('כל הבנים זהים', cdiffs.length === 0);
  cdiffs.slice(0, 12).forEach((d) => console.log('        ' + d));
}

/* 4 */
console.log('\n4. רגרסיה — מקט הבן מול קובץ הקליטה הידני');
{
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(INTAKE_EXPECTED);
  const ws = wb.worksheets[0];
  const expected = new Map();
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const sku = text(r.getCell(1));
    const ean = text(r.getCell(3));
    if (sku && ean) expected.set(ean, sku.toUpperCase());
  });

  const mine = new Map(invoice.rows.map((r) => [String(r.ean), childSku(r)]));
  let compared = 0;
  const bad = [];
  for (const [ean, want] of expected) {
    const got = mine.get(ean);
    if (!got) continue;
    compared++;
    if (got !== want) bad.push(ean + ': שלי ' + got + ' ידני ' + want);
  }
  check('הושוו ' + compared + ' מקטים מול הקובץ הידני', compared >= 9, String(compared));
  check('כל המקטים זהים', bad.length === 0);
  bad.slice(0, 10).forEach((d) => console.log('        ' + d));
}

/* 5 — classifier accuracy, measured against the card's own answers.
 *
 * The FW26 fixture cannot do this: its Backbone columns are empty, so the
 * classifier correctly refuses everything and there is nothing to score. The
 * 28.5 invoice carries full Backbone, and every one of its parents is already
 * classified in the card — so removing one and asking for it back is a real
 * question with a known answer.
 */
console.log('\n5. דיוק הסיווג — חשבונית 28.5 מול התשובות שבכרטיס');
{
  const { readArenaInvoice } = await import('../src/sportmore/arena-invoice.js');
  const { classify, learnFromInvoice, CLASSIFIED_FIELDS } = await import('../src/sportmore/classify.js');
  const inv = await readArenaInvoice(ARENA_FIXTURE);
  const learned = learnFromInvoice(card, inv.rows);

  const seen = new Set();
  const score = { right: 0, wrong: 0, refused: 0 };
  const misses = [];
  for (const row of inv.rows) {
    const sku = parentSku(row);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const truth = card.parents.get(sku);
    if (!truth) continue;
    const trimmed = cardBefore(card, [sku], []);
    const c = classify(row, trimmed, learned, {});
    for (const f of CLASSIFIED_FIELDS) {
      const got = c[f].value;
      const want = truth[f];
      if (got === null || got === undefined) score.refused++;
      else if (String(got) === String(want)) score.right++;
      else { score.wrong++; misses.push(sku + ' ' + f + ': ' + got + ' במקום ' + want); }
    }
  }
  const answered = score.right + score.wrong;
  const pct = answered ? Math.round((score.right / answered) * 100) : 0;
  check('הסיווג עונה נכון ברוב המכריע', pct >= 90,
    score.right + ' נכון · ' + score.wrong + ' שגוי · ' + score.refused + ' סורב  (' + pct + '% מהתשובות)');
  misses.slice(0, 8).forEach((d) => console.log('        ' + d));
}

/* 6 */
console.log('\n6. תמחור');
{
  const cases = [[4.11, 82, 41], [10.02, 200, 100], [16.03, 321, 160.5], [15.71, 314, 157], [13.36, 267, 133.5]];
  const bad = cases.filter(([c, b, w]) => {
    const p = priceFromCost(c, 'int');
    return p.base !== b || p.wholesale !== w;
  });
  check('מצב int משחזר את מחירי FW26', bad.length === 0, bad.map((b) => b[0]).join(' '));
  check('מחירון 1 הוא בדיוק חצי מהבסיס', cases.every(([c]) => {
    const p = priceFromCost(c, 'x99');
    return Math.abs(p.wholesale * 2 - p.base) < 1e-9;
  }));
  check('x99 מסתיים תמיד ב-9.9', cases.every(([c]) => String(priceFromCost(c, 'x99').base).endsWith('9.9')));
  check('עלות אפס לא מייצרת מחיר', priceFromCost(0, 'x99') === null);
}

rmSync(TMP, { recursive: true, force: true });
console.log('\n' + (failures ? failures + ' בדיקות נכשלו' : 'הכל עבר') + '\n');
process.exit(failures ? 1 : 0);
