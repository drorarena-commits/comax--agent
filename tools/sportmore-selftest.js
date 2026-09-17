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
import { basename, resolve } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { ROOT } from '../src/config.js';
import { loadItemCard } from '../src/sportmore/item-card.js';
import { loadCodes } from '../src/sportmore/classify.js';
import { planBatch } from '../src/sportmore/plan.js';
import { buildSetupFile, SETUP_PARENT_COLUMNS, SETUP_CHILD_COLUMNS } from '../src/sportmore/build-setup.js';
import { childSku, parentSku, selfBarcode as selfBarcodeOf, sizeForSportMore, SIZE_ALIASES } from '../src/sportmore/arena-invoice.js';
import { WAREHOUSES } from '../src/sportmore/build-intake.js';
import { priceFromCost } from '../src/sportmore/pricing.js';
import { verifyAgainstCard } from '../src/sportmore/build-intake.js';

const FW26 = resolve(ROOT, 'sportmore/reference/template-parent-child.xlsx');
const INTAKE_EXPECTED = resolve(ROOT, 'sportmore/reference/expected/intake-fw26.xlsx');
// Lives under reference/, not in/, because in/ is gitignored and the suite has
// to run on both machines.
const ARENA_FIXTURE = resolve(ROOT, 'sportmore/reference/expected/arena-invoice-2026-05-28.xlsx');

/**
 * ⛔ **הכרטיס המוצהר נעול בכוונה. אל תעדכן אותו לחדש ביותר.**
 *
 * הכרטיס: `item-card-2026-08-25.xlsx`, מאלינה.
 *
 * תוכנו נבדק מול תוכן ידוע (למשל הברקוד `2060000`), ולכן כל החלפה שלו שוברת
 * בדיקות תוכן. עדכניות הכרטיס בהרצה האמיתית נמדדת בנפרד — בקבוצה 11 ובבחירת
 * החדש ביותר ב-`loadItemCard()`. **אין שום סיבה לגעת בו.**
 *
 * אם סשן עתידי רואה כרטיס חדש יותר בתיקייה וחושב שהוא "עוזר" כשהוא מעדכן את
 * השורה הזאת — זו בדיוק הטעות. הבדיקות לא נכשלות כי הכרטיס ישן; הן נכשלות כי
 * הוחלף הקלט שהן נבנו מולו. (החלטת דרור, 16/09/2026.)
 *
 * ⚠️ הרגרסיה נעולה על כרטיס מוצהר, ולא על "החדש ביותר".
 *
 * נמדד 16/09/2026: כרטיס טרי נחת בתיקייה באמצע עבודה, `loadItemCard()` בחר בו
 * בשקט, ושלוש בדיקות בקבוצה 8 נפלו — לא בגלל הקוד אלא בגלל שהברקוד
 * המקודד-עצמית `2060000` ("דוגמאות ארנה") נמחק אצלם. בדיקה שתוצאתה משתנה כי
 * קובץ נחת בתיקייה אינה בדיקת רגרסיה.
 *
 * הכיסוי לפורמט החדש לא אבד — הוא עבר לקבוצה 11, שקוראת **כל** כרטיס שנמצא
 * בתיקייה ומצליבה ביניהם. כך הרגרסיה יציבה והפורמט עדיין נבדק.
 */
const PINNED_CARD = resolve(ROOT, 'sportmore/reference/item-card-2026-08-25.xlsx');
if (!existsSync(PINNED_CARD)) {
  // ⛔ ההודעה נוקבת בשם. הכרטיס המוצהר הוא היחיד מבין כרטיסי הפריט שנשמר בגיט
  // (ראה .gitignore), בדיוק כדי שהרגרסיה תרוץ גם במחשב השני. "לא נמצא קובץ"
  // בלי שם היה שולח לחפש את הכרטיס הלא נכון.
  console.error('\nחסר הכרטיס שהרגרסיה נעולה עליו: ' + basename(PINNED_CARD) + '\n'
    + 'הוא היחיד מבין כרטיסי הפריט שנשמר בגיט, ובלעדיו אי אפשר להריץ את הבדיקה.\n'
    + 'למשוך אותו: git checkout -- sportmore/reference/\n');
  process.exit(1);
}
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
 * This is an assumption *of the fixture*; the pipeline never guesses — it reads
 * `Style code` / `Color code` whole, and verifies them against the split of
 * `SKU/Article number` (group 13).
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

const card = await loadItemCard(PINNED_CARD);
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

/* 7 — customised products: no barcode from Arena.
 *
 * The three federation-cap rows below mirror the ISRAEL FEDERATION CAPS order:
 * a style and colour, a size of OS, and no EAN at all. Everything here is about
 * refusing to invent an identifier by accident. */
console.log('\n7. מוצרים קוסטומייז — בלי ברקוד מארנה');
{
  const { loadProfile } = await import('../src/sportmore/classify.js');
  const { selfBarcode, parentSku: pSku } = await import('../src/sportmore/arena-invoice.js');

  const caps = ['014520', '014521', '014522'].map((style, i) => ({
    row: 100 + i,
    ean: '',
    hasBarcode: false,
    articleNumber: style + '_100_OS',
    articleDesc: 'ISRAEL FEDERATION CAP ' + (i + 1),
    style,
    colorCode: '100',
    size: 'OS',
    styleDesc: 'ISRAEL FEDERATION CAP ' + (i + 1),
    qty: [300, 200, 200][i],
    price: 3.5,
    listPrice: 0,
    season: '',
    invoiceNo: '1200003911',
    date: new Date(Date.UTC(2026, 7, 26)),
    backbone: [],
    fiber: '',
  }));
  const capInvoice = { file: 'caps-test', rows: caps, problems: [], headers: {} };

  const blocked = planBatch({ invoice: capInvoice, card, codes });
  check('בלי --self-barcode כל השורות חסומות', blocked.counts.blocked === 3,
    'blocked=' + blocked.counts.blocked);
  check('הסיבה מפנה לדגל', /self-barcode/.test(blocked.blocked[0]?.why || ''),
    blocked.blocked[0]?.why || '');

  const allowed = planBatch({ invoice: capInvoice, card, codes, selfBarcodes: true });
  check('עם הדגל אף שורה לא חסומה', allowed.counts.blocked === 0, String(allowed.counts.blocked));
  check('שלוש שורות מסומנות כמקודדות-עצמית', allowed.counts.selfCoded === 3,
    String(allowed.counts.selfCoded));
  check('הברקוד הוא המקט הבן בלי AR',
    allowed.rows.every((r) => r.barcode === selfBarcode(r.row) && r.barcode === pSku(r.row).slice(2) + '00OS'),
    allowed.rows.map((r) => r.barcode).join(' '));

  // Every one of the four fields must be refused, or the profile is pointless.
  check('בלי פרופיל הסיווג מסרב על כל האבות',
    allowed.needsDecision.length === allowed.counts.newParents,
    allowed.needsDecision.length + '/' + allowed.counts.newParents);

  const profile = loadProfile(codes, 'caps');
  const withProfile = planBatch({ invoice: capInvoice, card, codes, selfBarcodes: true, profile });
  check('עם --profile caps אף אב לא מסורב', withProfile.needsDecision.length === 0,
    withProfile.needsDecision.map((p) => p.sku).join(' '));
  const first = withProfile.parents[0]?.classification;
  check('הפרופיל מילא את ארבעת השדות',
    first?.family.value === '00610' && first?.sizeScale.value === '74'
      && first?.division.value === '14' && first?.gender.value === '30',
    [first?.family.value, first?.sizeScale.value, first?.division.value, first?.gender.value].join('/'));
  check('הפרופיל מסביר את עצמו', /פרופיל/.test(first?.family.why || ''), first?.family.why || '');

  // An override on the same style has to beat the profile.
  const over = planBatch({
    invoice: capInvoice, card, codes, selfBarcodes: true, profile,
    // classify() takes overrides through planBatch's classify call, so exercise
    // the precedence directly.
  });
  const { classify, learnFromInvoice } = await import('../src/sportmore/classify.js');
  const c2 = classify(caps[0], card, learnFromInvoice(card, caps), { '014520': { family: '00613' } }, profile);
  check('overrides גובר על פרופיל', c2.family.value === '00613', c2.family.value + ' — ' + c2.family.why);
  check('ושאר השדות עדיין מהפרופיל', c2.sizeScale.value === '74', c2.sizeScale.value);
}

/* 8 — a self-coded barcode that already exists must stop the batch.
 *
 * `2060000` is one of only two genuinely self-coded children in the card: its
 * barcode is its own code. A row of style `20`, colour `60`, size `0` derives
 * exactly that string, which is the collision we are guarding against — the cap
 * was already set up, possibly with a real EAN, and setting it up again under an
 * invented code would give Priority two items for one product. */
console.log('');
console.log('8. התנגשות — ברקוד מקודד-עצמית שכבר קיים');
{
  const target = card.byBarcode.get('2060000');
  check('הפריט המקודד-עצמית קיים בכרטיס', !!target, target?.sku || 'לא נמצא');

  const row = {
    row: 1, ean: '', hasBarcode: false, articleNumber: '20_60_0',
    style: '20', colorCode: '60', size: '0', styleDesc: 'התנגשות בדיקה',
    qty: 1, price: 1, backbone: [],
  };
  check('השורה אכן גוזרת 2060000', selfBarcodeOf(row) === '2060000', selfBarcodeOf(row));

  const plan = planBatch({ invoice: { file: 'collision', rows: [row], problems: [], headers: {} }, card, codes, selfBarcodes: true });
  const r = plan.rows[0];
  check('השורה חסומה, לא נדרסת', r.status === 'blocked', r.status);
  check('הסיבה מזכירה את ההתנגשות', /כבר קיים/.test(r.why), r.why);
  check('היא לא נכנסת לקובץ ההקמה', plan.children.length === 0 && plan.parents.length === 0,
    plan.parents.length + ' אבות, ' + plan.children.length + ' בנים');
}
/* קובץ הקליטה — מצב ב׳ רץ עד הסוף בפעם אחת (החלטת דרור, 15/09/2026).
 *
 * הבקרה אצלם אנושית: מי שמקים מאשר, ורק אז מריצים רכש. לכן שורה שטרם בכרטיס
 * אך נמצאת בקובץ ההקמה **נכתבת ומסומנת באדום** במקום לעצור את המנה — אבל שורה
 * חסומה עדיין עוצרת הכל, כי איש לא יקים אותה. שתי ההתנהגויות נבדקות כאן, כי
 * שער שהוחלף בשער אחר צריך להוכיח את שניהם. */
console.log('');
console.log('9. קובץ הקליטה — אדום מול חסום');
{
  const rows = [
    { status: 'exists', row: { row: 1 }, barcode: '111' },
    { status: 'newChild', row: { row: 2 }, barcode: '222' },
    { status: 'newBoth', row: { row: 3 }, barcode: '333' },
    { status: 'blocked', row: { row: 4 }, barcode: '444', why: 'אב אחר' },
  ];
  const v = verifyAgainstCard(rows);
  check('שורה שבכרטיס — רגילה', v.ready.length === 1, String(v.ready.length));
  check('newChild ו-newBoth נכנסות כאדומות', v.pending.length === 2, String(v.pending.length));
  check('חסומה אינה נכנסת לאדומות', !v.pending.some((p) => p.status === 'blocked'), 'לא');
  check('חסומה מזוהה בנפרד', v.blocked.length === 1, String(v.blocked.length));

  const clean = verifyAgainstCard(rows.filter((r) => r.status !== 'blocked'));
  check('בלי חסומות אין מה שיעצור', clean.blocked.length === 0, '0');
  check('ואז כל השורות נכתבות', clean.ready.length + clean.pending.length === 3, '3');
}
/* סבב השאלות — מה שדרור רואה כשהסיווג מסרב (15/09/2026).
 *
 * הסירוב עצמו נבדק למעלה; כאן נבדק מה נשאל בעקבותיו. שלוש התנהגויות שאי אפשר
 * לראות מתוך הקוד לבדו: שמספר אחד הוא שדה אחד ולא אב אחד, ששני צבעים של אותו
 * דגם נשאלים פעם אחת כי התשובה נכתבת לפי דגם, ושפיצול קולות מגיע עם המועמדים
 * ולא רק עם "לא הוכרע". */
console.log('');
console.log('10. סבב השאלות — מיספור, איחוד, ומועמדים');
{
  const { classify, learnFromInvoice } = await import('../src/sportmore/classify.js');
  const { buildQuestions, renderQuestions } = await import('../src/sportmore/questions.js');

  const caps = ['014520', '014521'].map((style, i) => ({
    row: 200 + i, ean: '', hasBarcode: false, articleNumber: style + '_100_OS',
    articleDesc: 'CAP ' + style, style, colorCode: '100', size: 'OS',
    styleDesc: 'CAP ' + style, qty: 1, price: 3.5, listPrice: 0, season: '',
    invoiceNo: 'Q-TEST', date: new Date(Date.UTC(2026, 7, 26)), backbone: [], fiber: '',
  }));
  const plan = planBatch({
    invoice: { file: 'questions-test', rows: caps, problems: [], headers: {} },
    card, codes, selfBarcodes: true,
  });
  const qs = buildQuestions(plan);

  check('שני אבות × ארבעה שדות = שמונה שאלות', qs.length === 8, String(qs.length));
  check('המיספור רץ ברציפות מאחת', qs.every((q, i) => q.n === i + 1), qs.map((q) => q.n).join(','));
  check('כל שאלה היא שדה אחד', new Set(qs.map((q) => q.field)).size === 4,
    qs.map((q) => q.field).join(' '));
  check('בלי אות — אין מועמדים להציע',
    qs.every((q) => q.info.reason === 'no-signal' && (q.info.candidates || []).length === 0),
    qs.map((q) => q.info.reason).join(' '));

  // טבלת הקודים מודפסת פעם אחת לשדה ולא מתחת לכל שאלה — שמונה שאלות היו
  // מייצרות שמונה עותקים, וזו כבר לא רשימה שבוחרים ממנה בטלפון.
  const printed = renderQuestions(qs, codes).join('\n');
  const familyRows = printed.split('\n').filter((l) => l.includes('כובעי שחייה ארנה')).length;
  check('טבלת הקודים מופיעה פעם אחת לשדה', familyRows === 1, String(familyRows));

  // פיצול קולות: חמישה אבות לאותו דגם, שלושה למשפחה אחת ושניים לאחרת.
  const parents = new Map();
  const base = { sizeScale: '74', division: '12', gender: '30' };
  for (let i = 0; i < 5; i++) {
    const sku = 'AR9900010' + i;
    parents.set(sku, { sku, ...base, family: i < 3 ? '00616' : '00617' });
  }
  const splitRow = { ...caps[0], style: '990001', colorCode: '90', articleNumber: '990001_90_OS' };
  const c = classify(splitRow, { parents, byBarcode: new Map() }, learnFromInvoice(card, []), {});
  check('משפחה חלוקה נשארת מסורבת', c.family.value === null, String(c.family.value));
  check('והסיבה היא פיצול, לא היעדר אות', c.family.reason === 'split', String(c.family.reason));
  check('המועמדים חוזרים עם ספירת הקולות',
    c.family.candidates?.[0]?.value === '00616' && c.family.candidates[0].n === 3
      && c.family.candidates[1]?.value === '00617' && c.family.candidates[1].n === 2,
    (c.family.candidates || []).map((x) => x.value + '×' + x.n).join(' '));
  check('שאר השדות הוכרעו פה אחד', c.sizeScale.value === '74' && c.gender.value === '30',
    c.sizeScale.value + '/' + c.gender.value);

  // שני צבעים של אותו דגם שמסרבים אותו סירוב הם שאלה אחת: התשובה נכתבת
  // ל-overrides.json לפי קוד דגם, ולכן מענה על אחד עונה על שניהם.
  const twin = (sku) => ({
    sku, row: splitRow, unresolved: ['family'],
    classification: { family: c.family },
  });
  const merged = buildQuestions({ needsDecision: [twin('AR990001900'), twin('AR990001550')] });
  check('שני צבעים של אותו דגם נשאלים פעם אחת', merged.length === 1, String(merged.length));
  check('ושני האבות מוצגים בשאלה', merged[0]?.skus.length === 2, (merged[0]?.skus || []).join(' '));
}
/* כל כרטיס שנמצא בתיקייה — נקרא, ממופה, ומוצלב מול האחרים.
 *
 * זו הקבוצה שמכסה את הפורמט, אחרי שהרגרסיה ננעלה על כרטיס מוצהר. היא נולדה
 * מכרטיס 16/09, שהגיע ממייצא אחר ושבר את הקריאה בשתי דרכים נפרדות:
 *
 *   ה-XML נושא קידומת namespace — `<x:workbook><x:sheets>` במקום `<workbook>` —
 *   ו-ExcelJS החזיר "Cannot read properties of undefined (reading 'sheets')".
 *   הקובץ תקין לגמרי; הקורא הוא שלא ידע לפתוח אותו.
 *
 *   ו**העמודות זזו**: מתוך 22 השדות עשרים במיקום אחר. זה הכשל המסוכן מהשניים,
 *   כי הוא לא נראה ככשל — הקריאה מצליחה ומחזירה 3,369 שורות, כשהתיאור מכיל
 *   מחיר והברקוד מכיל קוד דגם.
 *
 * ההצלבה היא ההוכחה: ברקוד הוא המזהה ששני הצדדים מסכימים עליו, ולכן פריט
 * שמופיע בשני כרטיסים חייב להחזיר את אותו אב ואת אותו סיווג — גם אם הכרטיסים
 * נכתבו במייצאים שונים ובסדר עמודות שונה. מיפוי שגוי באחד מהם היה מייצר אלפי
 * הפרשים מיד.
 */
console.log('');
console.log('11. כל הכרטיסים בתיקייה — קריאה, מיפוי, והצלבה');
{
  const { readdirSync } = await import('node:fs');
  const { ITEM_CARD_HEADERS, REFERENCE_DIR } = await import('../src/sportmore/item-card.js');

  const files = readdirSync(REFERENCE_DIR)
    .filter((f) => /^item-card-.*\.xlsx$/i.test(f))
    .sort();
  check('יש לפחות כרטיס אחד', files.length >= 1, files.join(' · '));

  const loaded = [];
  const total = Object.keys(ITEM_CARD_HEADERS).length;
  for (const f of files) {
    let c = null;
    try {
      c = await loadItemCard(resolve(REFERENCE_DIR, f), { quiet: true });
    } catch (e) {
      check(f + ' נקרא', false, e.message.split('\n')[0]);
      continue;
    }
    loaded.push({ f, c });
    check(f + ' נקרא', true, c.rows + ' שורות · ' + c.parents.size + ' אבות');
    check('  כל ' + total + ' העמודות מופו לפי כותרת', Object.keys(c.columns).length === total,
      Object.keys(c.columns).length + '/' + total);
    // מיפוי שגוי מייצר ערכים שנראים סבירים בשדה הלא נכון, ולכן נבדקת גם
    // אינווריאנטה מבנית שהכרטיס עצמו מצהיר עליה: אצל אב, עמודת הברקוד חוזרת על
    // המק"ט. אם `barcode` או `sku` הצביעו לעמודה שגויה, השוויון הזה נשבר מיד.
    const barcodeEqSku = [...c.parents.values()].filter((p) => p.barcode === p.sku).length;
    check('  אצל כל אב הברקוד חוזר על המק"ט', barcodeEqSku === c.parents.size,
      barcodeEqSku + '/' + c.parents.size);
    // בן שאביו נמחק אינו באג בקוד ואינו עילה להכשיל — הוא מצב של הקובץ שלהם,
    // ושווה שייאמר בקול.
    const orphans = [...c.byBarcode.values()].filter((x) => !x.isParent && x.parent && !c.parents.has(x.parent));
    if (orphans.length) {
      console.log('      ⚠  ' + orphans.length + ' בנים בלי אב בכרטיס: '
        + [...new Set(orphans.map((o) => o.parent))].join(' · '));
    }
  }

  // ההצלבה עצמה — רק כשיש שני כרטיסים ומעלה.
  for (let i = 1; i < loaded.length; i++) {
    const a = loaded[i - 1], b = loaded[i];
    const shared = [...a.c.byBarcode.keys()].filter((k) => b.c.byBarcode.has(k));
    check(a.f + ' ↔ ' + b.f + ': ברקודים משותפים', shared.length > 0, String(shared.length));
    const FIELDS = ['sku', 'parent', 'isParent', 'family', 'sizeScale', 'division', 'gender', 'size'];
    const mismatch = [];
    for (const k of shared) {
      const x = a.c.byBarcode.get(k), y = b.c.byBarcode.get(k);
      for (const f of FIELDS) {
        if (String(x[f]) !== String(y[f])) mismatch.push(k + ' ' + f + ': "' + x[f] + '" מול "' + y[f] + '"');
      }
    }
    check('  אותו ברקוד מחזיר אותו מידע בשני הכרטיסים', mismatch.length === 0,
      mismatch.length ? mismatch.length + ' הפרשים' : shared.length + ' ברקודים × ' + FIELDS.length + ' שדות');
    mismatch.slice(0, 6).forEach((d) => console.log('        ' + d));
  }
  if (loaded.length < 2) {
    console.log('      (כרטיס אחד בלבד — אין מה להצליב. ההצלבה תרוץ כשיגיע הבא.)');
  }
}
/* קריאת קומקס בסוכן הזה — חריגה מוצהרת, ותנאיה נאכפים כאן ולא רק בהערה.
 *
 * `sportmore-items` הוא מפעל אקסלים לפריוריטי, וקריאת קומקס אינה שלו. הקוד החלופי
 * של בן אינו בכרטיס ואי אפשר לגזור אותו משדות שלמים (נמדד 16/09/2026), ולכן
 * נשארה קריאה אחת — לתצוגה בלבד. דרור קבע שלושה תנאים, ושניים מהם ניתנים לאכיפה:
 * שהיא אינה משפיעה על שום החלטה, ושהיא אינה חוסמת. בלי הבדיקה הזאת, סשן עתידי
 * שיראה ש"כבר קוראים קומקס כאן" יכול להשתמש בזה לצורך אחר בלי שאיש יבחין. */
console.log('');
console.log('12. קריאת קומקס — תצוגה בלבד, לא חוסמת, בלי ערכים נגזרים');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const display = await import('../src/sportmore/item-display.js');

  // תנאי 1 — תצוגה בלבד: אף מודול שמקבל החלטות אינו מייבא את קובץ התצוגה.
  const SRC = resolve(ROOT, 'src/sportmore');
  const importers = readdirSync(SRC)
    .filter((f) => f.endsWith('.js') && f !== 'item-display.js')
    .filter((f) => /item-display/.test(readFileSync(resolve(SRC, f), 'utf8')));
  check('אף מודול ב-src/sportmore אינו מייבא את item-display', importers.length === 0,
    importers.join(' · ') || 'רק tools/sportmore.js, להדפסה');
  const readsComax = readdirSync(SRC)
    .filter((f) => f.endsWith('.js') && f !== 'item-display.js')
    .filter((f) => /catalog\/local-stock|פריטים-מלא/.test(readFileSync(resolve(SRC, f), 'utf8')));
  check('ואף מודול אחר ב-src/sportmore אינו קורא את קטלוג קומקס', readsComax.length === 0,
    readsComax.join(' · ') || 'הקריאה היחידה יושבת בקובץ התצוגה');

  // תנאי 2 — לא חוסמת: קטלוג שלא קיים מחזיר "חסר" והודעה אחת, ואינו זורק.
  let threw = null;
  try {
    await display.loadComaxAltCodes({ dir: resolve(ROOT, 'sportmore/out/.no-such-catalog'), fresh: true });
  } catch (e) {
    threw = e.message;
  }
  check('קטלוג חסר אינו זורק', threw === null, threw || 'ממשיך');
  check('...ומפיק הודעה אחת שההעשרה לא זמינה', /לא זמינה/.test(display.enrichmentNotice() || ''),
    display.enrichmentNotice() || '(אין הודעה)');
  const row = { styleDesc: 'TEST PANT', colorDesc: '550-BLACK-WHITE' };
  const kid = display.childFromInvoice(row, { sku: 'AR00000155000M', barcode: '3468335803258' });
  check('...והחלופי מוצג "חסר"', display.childLine(kid).includes('חלופי חסר'), display.childLine(kid));
  check('...בזמן שהצבע ממשיך להגיע מהחשבונית', display.childLine(kid).includes('צבע 550-BLACK-WHITE'));

  // בלי ערכים נגזרים: לאב חדש אין שדה חלופי שלם — ולכן "חסר", לא "המק"ט בלי AR".
  const parent = display.parentFromInvoice({ style: '990077', colorCode: '500', styleDesc: 'NEW' }, 'AR990077500');
  check('לאב חדש אין חלופי נגזר', parent.altSku === null, display.parentLine(parent));

  // הצבע משדה הצבע של החשבונית ולא משם הפריט של קומקס.
  const colourSource = readFileSync(resolve(SRC, 'item-display.js'), 'utf8');
  check('תיאור הצבע אינו נקרא מ"שם פריט באנגלית"',
    !/indexOf\('שם פריט באנגלית'\)/.test(colourSource), 'colorDesc = row.colorDesc');

  // וחמשת המקומות שמונים פריטים אינם מדפיסים ברקוד גולמי.
  const cli = readFileSync(resolve(ROOT, 'tools/sportmore.js'), 'utf8');
  const rawBarcode = cli.split('\n').filter((l) => /\.ean\s*\+\s*'/.test(l) && !l.trim().startsWith('//'));
  check('אף שורת פריט ב-CLI אינה מדפיסה ברקוד גולמי', rawBarcode.length === 0,
    rawBarcode.map((l) => l.trim().slice(0, 50)).join(' | ') || 'כולן עוברות דרך showChild / parentLine');

  // מחזירים את המטמון למצב אמיתי, כדי שלא יזלוג לקבוצות שאחרי.
  await display.loadComaxAltCodes({ fresh: true });
}

/* 13 — העמודות השלמות הן המקור, והפיצול הוא אימות בלבד (החלטת דרור, 16/09/2026).
 *
 * שורה שבה Style/Color/Size אינם זהים לפיצול של SKU/Article number — או שעמודה
 * שלמה ריקה בזמן שבמק"ט יש ערך — אינה נכנסת לאף קובץ. היא יוצאת מ-rows כבר
 * בקורא, ולכן planBatch, קובץ ההקמה, הדוח וקובץ הקליטה לא רואים אותה בכלל. */
console.log('\n13. חשבונית — עמודה שלמה מול פיצול המק"ט');
{
  const { readArenaInvoice } = await import('../src/sportmore/arena-invoice.js');
  mkdirSync(TMP, { recursive: true });
  const file = resolve(TMP, 'mismatch-invoice.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['EAN/UPC', 'SKU/Article number', 'Style code', 'Color code', 'Size', 'Billed Quantity', 'Net unit price']);
  ws.addRow(['3468330000011', '004761_500_M', '004761', '500', 'M', 2, 10]);   // תואם
  ws.addRow(['3468330000028', '004761_500_L', '004761', '550', 'L', 3, 10]);   // צבע לא תואם
  ws.addRow(['3468330000035', '004761_500_XL', '004761', '500', '', 1, 10]);   // מידה ריקה בעמודה
  ws.addRow(['3468330000042', '000022_100_S', '22', '100', 'S', 1, 10]);       // אפסים מובילים — לא מנורמל
  ws.addRow(['', '', '014520', '100', 'OS', 300, 3.5]);                        // בלי מק"ט — לא מאומת
  await wb.xlsx.writeFile(file);

  const inv = await readArenaInvoice(file);
  check('רק השורה התואמת והשורה בלי מק"ט נקראו', inv.rows.length === 2,
    inv.rows.map((r) => r.articleNumber).join(' '));
  check('שלוש אי-התאמות נרשמו', inv.mismatches.length === 3,
    inv.mismatches.map((m) => 'שורה ' + m.row).join(' '));
  const color = inv.mismatches.find((m) => m.row === 3)?.fields[0];
  check('אי-ההתאמה מחזיקה את שני הערכים', color?.name === 'Color code' && color.whole === '550' && color.split === '500',
    JSON.stringify(color));
  check('עמודה שלמה ריקה היא אי-התאמה, לא נפילה לפיצול',
    inv.mismatches.some((m) => m.row === 4 && m.fields.some((f) => f.name === 'Size' && f.whole === '')));
  check('22 מול 000022 אינו מנורמל להסכמה', inv.mismatches.some((m) => m.row === 5));
  check('שורה בלי מק"ט נספרת כלא-מאומתת', inv.unverified === 1 && inv.rows.some((r) => r.style === '014520' && r.verified === false),
    'unverified=' + inv.unverified);

  const plan = planBatch({ invoice: inv, card, codes, selfBarcodes: true });
  const bad = new Set(inv.mismatches.map((m) => m.articleNumber));
  check('אף שורה שלא תואמת אינה מגיעה ל-plan — ולכן לא לקובץ ההקמה, לדוח או לקליטה',
    plan.rows.every((r) => !bad.has(r.row.articleNumber)) && plan.rows.length === 2,
    plan.rows.length + ' שורות בתוכנית');

  // קובץ עם מק"ט ארוז בלבד אינו מקור — אין לו עמודות שלמות.
  const onlyArt = new ExcelJS.Workbook();
  const ws2 = onlyArt.addWorksheet('Sheet1');
  ws2.addRow(['SKU/Article number', 'Billed Quantity', 'Net unit price']);
  ws2.addRow(['004761_500_M', 1, 10]);
  const file2 = resolve(TMP, 'article-only.xlsx');
  await onlyArt.xlsx.writeFile(file2);
  let refused = '';
  try { await readArenaInvoice(file2); } catch (e) { refused = e.message; }
  check('קובץ בלי Style code + Color code מסורב', /Style code/.test(refused), refused.split('\n')[0]);
}
console.log('\n14. מידה — שפת ארנה מול שפת ספורט אנד מור, ושער הסרגל');
{
  // ארנה כותבת TU, ספורט אנד מור כותבים OS. נמדד 17/09/2026: TU אינו קיים
  // באף אחד מ-2,645 הבנים בכרטיס, ו-OS קיים ב-46 — כולם תחת סרגל 74.
  check('TU מומר ל-OS', sizeForSportMore('TU') === 'OS', 'TU -> ' + sizeForSportMore('TU'));
  check('...וגם באותיות קטנות', sizeForSportMore('tu') === 'OS');
  check('מידה מוכרת עוברת כמו שהיא', sizeForSportMore('L') === 'L' && sizeForSportMore('2XL') === '2XL');
  check('מידה שלא נמדדה אינה מנוחשת', sizeForSportMore('ZZ9') === 'ZZ9', 'ZZ9 -> ' + sizeForSportMore('ZZ9'));
  check('טבלת ההמרה מחזיקה רק את הזוג שנמדד', Object.keys(SIZE_ALIASES).length === 1,
    JSON.stringify(SIZE_ALIASES));

  // TU אינו קיים בכרטיס — זו העובדה שכל הקבוצה הזאת עומדת עליה.
  let tu = 0, os = 0;
  for (const [, k] of card.byBarcode) {
    if (k.isParent) continue;
    const z = String(k.size ?? '').trim().toUpperCase();
    if (z === 'TU') tu++; else if (z === 'OS') os++;
  }
  check('TU אינו מופיע באף בן בכרטיס', tu === 0, 'TU=' + tu + ' OS=' + os);

  // השער: מידה שאינה בסרגל שנבחר עוצרת את הכתיבה.
  const row = (size) => ({
    row: 2, ean: '3468337311263', hasBarcode: true, articleNumber: '007449_888_' + size,
    style: '007449', colorCode: '888', size, sizeArena: size,
    styleDesc: 'MOULDED ISR FED', colorDesc: '888-BLUE LOGO',
    qty: 1, price: 3.76, backbone: [], verified: true,
  });
  const runWith = (size) => planBatch({
    invoice: { rows: [row(size)], mismatches: [], unverified: 0 },
    card, codes,
  });

  const ok = runWith('OS');
  check('מידה שקיימת בסרגל עוברת', ok.sizeProblems.length === 0, ok.sizeProblems.length + ' בעיות');

  const badTu = runWith('TU');
  check('TU שלא הומר נעצר בשער', badTu.sizeProblems.length === 1, badTu.sizeProblems.length + ' בעיות');
  check('...והשער אומר אילו מידות כן קיימות בסרגל',
    badTu.sizeProblems[0]?.known?.includes('OS') && !badTu.sizeProblems[0].known.includes('TU'),
    (badTu.sizeProblems[0]?.known ?? []).join(','));
  check('...ונוקב בסרגל שנבחר', String(badTu.sizeProblems[0]?.scale) === '74',
    'סרגל ' + badTu.sizeProblems[0]?.scale);

  const invented = runWith('ZZ9');
  check('מידה מומצאת נעצרת גם היא', invented.sizeProblems.length === 1);
}

console.log('\n15. ספק — שני קודים לפי מחסן, לא אחד');
{
  // נמדד בתבנית של זיוה עצמה: שורה 2 ספק 3100310055 מול מחסן SHIP,
  // שורה 5 ספק 3100310062 מול מחסן DROR. אלה שני הקודים היחידים בקובץ.
  const t = codes.constants.supplierByWarehouse ?? {};
  check('קיימת טבלת ספק לפי מחסן', !!t.SHIP && !!t.DROR, JSON.stringify(t));
  check('SHIP -> 3100310055', t.SHIP === '3100310055', String(t.SHIP));
  check('DROR -> 3100310062', t.DROR === '3100310062', String(t.DROR));
  check('שני המחסנים אינם חולקים קוד', t.SHIP !== t.DROR);
  check('לכל מחסן מוכר יש קוד', WAREHOUSES.every((w) => !!t[w]), WAREHOUSES.join(','));

  // ⛔ הקבוע הישן היה הבאג: קובץ ל-DROR יצא עם הספק של האונייה.
  check('הקבוע הישן `supplier` הוסר', codes.constants.supplier === undefined,
    'supplier=' + codes.constants.supplier);

  // ספק מועדף בכרטיס הפריט הוא תכונה של הפריט — לא יעד המשלוח.
  check('ספק מועדף נפרד וקיים', codes.constants.supplierPreferred === '3100310055',
    String(codes.constants.supplierPreferred));
}

console.log('\n16. מספר חשבונית — DocumentNo, לא Bill. Doc.');
{
  const { intakeCells } = await import('../src/sportmore/build-intake.js');
  const { readArenaInvoice } = await import('../src/sportmore/arena-invoice.js');

  const inv = await readArenaInvoice(ARENA_FIXTURE);
  const r0 = inv.rows[0];
  check('שלושת המספרים נקראים כשדות נפרדים',
    'documentNo' in r0 && 'billDoc' in r0 && 'salesDoc' in r0,
    `doc=${r0.documentNo || '(ריק)'} bill=${r0.billDoc} sales=${r0.salesDoc}`);

  // ⚠️ הייצוא של 28/05 משאיר DocumentNo ריק ב-114/114 השורות, והמספר בסגנון
  // 1200… יושב ב-Sales Doc. אותו דוח, הרצות שונות.
  check('בייצוא של 28/05 DocumentNo ריק בכל השורות',
    inv.rows.every((r) => !String(r.documentNo ?? '').trim()),
    inv.rows.filter((r) => String(r.documentNo ?? '').trim()).length + ' שורות עם ערך');

  const plan = planBatch({ invoice: inv, card, codes, selfBarcodes: true });
  const usable = plan.rows.filter((x) => x.status !== 'blocked');

  // ⛔ ולכן הוא מסרב — ולא נופל חזרה ל-Bill. Doc.
  let refused = '';
  try { intakeCells({ planRows: usable, warehouse: 'DROR', codes }); }
  catch (e) { refused = e.message; }
  check('DocumentNo ריק — סירוב ולא נפילה ל-Bill. Doc.', /DocumentNo/.test(refused),
    refused.split('\n')[0] || '⛔ לא סירב');
  check('...והסירוב נוקב בשלושת המועמדים',
    /Bill\. Doc\./.test(refused) && /Sales Doc\./.test(refused));

  // והמקרה החיובי: שורה עם DocumentNo
  const withDoc = usable.slice(0, 3).map((x) => ({
    ...x, row: { ...x.row, documentNo: '1200003911', billDoc: '91439982', salesDoc: '1201022577' },
  }));
  if (withDoc.length) {
    const { cells } = intakeCells({ planRows: withDoc, warehouse: 'DROR', codes });
    check('עמודה 1 נושאת את DocumentNo', cells.every((c) => String(c[1]) === '1200003911'),
      String(cells[0]?.[1]));
    check('...ולא את Bill. Doc.', cells.every((c) => String(c[1]) !== '91439982'));
    check('...ולא את Sales Doc.', cells.every((c) => String(c[1]) !== '1201022577'));
  }
}

rmSync(TMP, { recursive: true, force: true });
console.log('\n' + (failures ? failures + ' בדיקות נכשלו' : 'הכל עבר') + '\n');
process.exit(failures ? 1 : 0);
