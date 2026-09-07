/**
 * בונה את דוח ההכרעה ואת קובץ היבוא של **מחיר עלות**.
 *
 *   npm run cost-file                                   הדוח לעיון
 *   npm run cost-file -- --import                        שני קבצי היבוא
 *   npm run cost-file -- --decisions <קובץ שהוכרע>       + דריסות ידניות
 *   npm run cost-file -- --pilot 5                       5 שורות לפיילוט
 *   npm run cost-file -- --verify <ייצוא-אימות.csv>      אחרי הקליטה
 *
 * ⛔ **קריאה בלבד. לא נוגע בקומקס.** זה בכוונה: דרור עוצר את הזרימה כאן,
 * לפני שנפתח דפדפן בכלל, כדי לראות את ההפרשים המודגשים. רק אחר כך מתחיל
 * שלב המיפוי.
 *
 * **שתי הרצות, שני קבצים** (`RUNS` ב-`build-cost.js`): מחירון הספק מקבל את
 * **הממוצע המשוקלל**, ומחיר קניה אחרונה מקבל את **הרכישה האחרונה**. ההבדל
 * נוגע ל-25 פריטים בלבד, אבל באחד מהם הוא 37.42 מול 64.50.
 *
 * שלושת הגיליונות בדוח:
 *   "מחיר סותר" — ברקוד שנקנה בכמה מחירים. לעיון, ולא חוסם: המשוקלל חל גם
 *                 עליהם. מילוי `המחיר שנבחר` דורס נקודתית דרך `--decisions`.
 *                 לצדו: האם האחרון הוא הזול או היקר, והמשוקלל.
 *   "פערי עלות" — מה שכבר יושב בקומקס מול מה שבקובץ, ממוין לפי הפער היחסי
 *                 יורד ומודגש מ-5% ומעלה.
 *   "סיכום"     — כל מספר שהכלי מדד, כדי שההחלטה תישען על אותם נתונים.
 *
 * הפירוט המלא של המלכודות: `src/items/build-cost.js`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { ROOT } from '../src/config.js';
import { writeXlsxSheets } from './xlsx-write.js';
import { sheetNames, readSheet, numericCells, toCsv } from './xlsx.js';
import {
  buildCost, shortDate, discountGate, savedDiscountGate, rangeGate, COST_HEADERS, RUNS,
} from '../src/items/build-cost.js';

const SOURCE = 'data/exports/פירוט תעודות_מחיר מחירון_ברקודים - רכישות דרור ספורט אנד מור.xlsx';
const REVIEW = 'data/exports/עלות-719-להכרעה.xlsx';
const PILOT = 'data/exports/עלות-פיילוט';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const path = (p) => (isAbsolute(p) ? p : resolve(ROOT, p));

const src = path(arg('--source') ?? SOURCE);
const decisionsFile = arg('--decisions');
const pilotN = Number(arg('--pilot') ?? 0);
const verifyFile = arg('--verify');
const buildImport = process.argv.includes('--import') || Boolean(decisionsFile);

// ── מספרים נקראים בעברית מימין לשמאל; העמודות בגיליון נכתבות משמאל לימין ────
const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '' : String(n));

const { items, conflicts, diffs, notInComax, duplicated, stats } = buildCost({ file: src });

// ── מסירה א׳: הדוח להכרעה ───────────────────────────────────────────────────

/** רוחב הבלוק "תאריך · כמות · מחיר" נקבע לפי הברקוד עם הכי הרבה רכישות. */
const maxBuys = conflicts.reduce((m, c) => Math.max(m, c.buys.length), 0);

function conflictSheet() {
  const head = ['ברקוד', 'מק"ט חלופי', 'שם פריט', 'המחיר שנבחר (ריק = משוקלל)'];
  for (let i = 1; i <= maxBuys; i++) head.push(`תאריך ${i}`, `כמות ${i}`, `מחיר ${i}`);
  head.push('אחרון', 'האחרון הוא', 'הזול', 'היקר', 'ממוצע משוקלל', 'סה"כ יחידות', 'העלות בקומקס');

  const rows = conflicts.map((c) => {
    const r = [c.barcode, c.alt, c.name, ''];
    for (let i = 0; i < maxBuys; i++) {
      const b = c.buys[i];
      r.push(b ? shortDate(b.date) : '', b ? fmt(b.qty) : '', b ? fmt(b.cost) : '');
    }
    r.push(fmt(c.last), c.lastIs, fmt(c.min), fmt(c.max), fmt(c.weighted), fmt(c.totalQty), fmt(c.currentNet));
    return r;
  });
  // כל השורות צהובות: הגיליון כולו הוא רשימת החלטות, והצבע אומר "לא למלא לבד".
  return { name: 'מחיר סותר', rows: [head, ...rows], highlight: new Set(rows.map((_, i) => i)) };
}

function diffSheet() {
  const head = ['ברקוד', 'מק"ט חלופי', 'שם פריט', 'עלות נוכחית', 'עלות חדשה (משוקלל)', 'מחיר אחרון',
    'הפרש ₪', 'הפרש %', 'כיוון', 'דגל', 'תאריך אחרון', 'סה"כ יחידות', 'מחירון 1'];
  const flag = (p) => (Math.abs(p) > 20 ? '⚠⚠ מעל 20%' : Math.abs(p) > 5 ? '⚠ 5-20%' : '');
  const rows = diffs.map((d) => [
    d.barcode, d.alt, d.name, fmt(d.currentNet), fmt(d.chosen), fmt(d.last),
    fmt(d.deltaShekel), fmt(d.deltaPct), d.deltaPct > 0 ? 'עלייה' : 'ירידה', flag(d.deltaPct),
    shortDate(d.buys[d.buys.length - 1].date), fmt(d.totalQty), fmt(d.price1),
  ]);
  const highlight = new Set(diffs.map((d, i) => (Math.abs(d.deltaPct) > 5 ? i : -1)).filter((i) => i >= 0));
  return { name: 'פערי עלות', rows: [head, ...rows], highlight };
}

function summarySheet() {
  const s = stats;
  const rows = [
    ['מקור', src.replace(ROOT + '\\', '').replace(ROOT + '/', '')],
    ['גיליון', s.sheet],
    ['שורות בקובץ', s.sourceRows],
    ['שורות שנפסלו (ברקוד שאינו 13 ספרות)', s.droppedRows],
    ['ברקודים ייחודיים', s.barcodes],
    ['קיימים בקומקס', s.inComax],
    ['לא קיימים בקומקס — יוצאים מהיבוא', s.notInComax],
    ['ברקוד כפול בקטלוג', s.duplicated],
    ['כבר נושאים מחיר עלות', s.withExistingCost],
    ['מהם שונים מהקובץ', s.diffs],
    ['— מעל 20%', s.over20],
    ['— בין 5% ל-20%', s.between5and20],
    ['— בין 1% ל-5%', s.between1and5],
    ['— עד 1%', s.upTo1],
    ['— עלייה', s.up],
    ['— ירידה', s.down],
    ['ברקודים עם מחיר סותר', s.conflicts],
    ['— האחרון הוא היקר', s.lastIsMax],
    ['— האחרון הוא הזול', s.lastIsMin],
    ['שורות בקטלוג המקומי', s.catalogRows],
    ['', ''],
    ['הערך שנכנס לקומקס', 'הממוצע המשוקלל לפי הכמות הכוללת — הכרעת דרור 07/09/2026'],
    ['החריגים', 'גיליון "מחיר סותר" הוא לעיון — המשוקלל חל גם עליהם. מילוי התא דורס נקודתית'],
  ];
  return { name: 'סיכום', rows: [['מדד', 'ערך'], ...rows] };
}

// ── מסירה ב׳: קריאת ההכרעות ובניית קובץ היבוא ───────────────────────────────

/**
 * קורא את גיליון "מחיר סותר" מהקובץ שדרור החזיר.
 * ⛔ נופל על שורה שלא הוכרעה, על ערך שאינו מספר חיובי, ועל מחיר שלא נצפה
 *    לאותו ברקוד — טעות הקלדה בעמודת ההחלטה היא בדיוק הכשל שנראה כמו הצלחה.
 */
function readDecisions(file) {
  const f = path(file);
  if (!existsSync(f)) { console.error(`⛔ קובץ ההכרעות לא נמצא: ${f}`); process.exit(1); }
  const sheet = sheetNames(f).find((s) => s.name === 'מחיר סותר');
  if (!sheet) { console.error('⛔ אין בקובץ גיליון בשם "מחיר סותר".'); process.exit(1); }
  const rows = readSheet(f, sheet.path);
  const head = rows[0];
  const iB = head.indexOf('ברקוד');
  const iP = head.findIndex((h) => String(h).startsWith('המחיר שנבחר'));
  if (iB < 0 || iP < 0) { console.error('⛔ חסרה עמודת "ברקוד" או "המחיר שנבחר".'); process.exit(1); }

  const seen = new Map(conflicts.map((c) => [c.barcode, c]));
  const chosen = new Map();
  const invalid = [];
  const unseen = [];

  for (const r of rows.slice(1)) {
    const b = String(r[iB] ?? '').trim();
    if (!b) continue;
    const raw = String(r[iP] ?? '').trim();
    // תא ריק אינו שגיאה: ברירת המחדל היא הממוצע המשוקלל, ו-`--decisions` הוא
    // דריסה נקודתית של מי שדרור בחר להכריע עליו ידנית.
    if (!raw) continue;
    const v = Number(raw.replace(/^\s*חדש\s*/, ''));
    if (!Number.isFinite(v) || v <= 0) { invalid.push(`${b} → "${raw}"`); continue; }
    const c = seen.get(b);
    const isNew = /^\s*חדש/.test(raw);
    if (c && !isNew && !c.buys.some((x) => Math.abs(x.cost - v) < 0.005)) {
      unseen.push(`${b} → ${v} (נצפו: ${[...new Set(c.buys.map((x) => x.cost))].join(', ')})`);
      continue;
    }
    chosen.set(b, v);
  }

  const problems = [];
  if (invalid.length) problems.push(`${invalid.length} ערכים שאינם מספר חיובי: ${invalid.slice(0, 5).join(' · ')}`);
  if (unseen.length) {
    problems.push(`${unseen.length} מחירים שלא נצפו לאותו ברקוד: ${unseen.slice(0, 5).join(' · ')}`);
    problems.push('   כדי לקבוע מחיר שלישי במכוון — לכתוב "חדש 42.50" בתא.');
  }
  if (problems.length) { console.error('⛔ ' + problems.join('\n⛔ ')); process.exit(1); }
  return chosen;
}

/** בונה את שורות היבוא לפי השדה שההרצה מבקשת. ראה `RUNS` ב-`build-cost.js`. */
function importRows(field, chosen = new Map(), limit = 0) {
  let list = items;
  if (limit) {
    // פיילוט: 2 עם עלות זהה · 2 עם פער גדול · 1 בלי עלות בכלל — כדי שהתשובה
    // "לאיזה שדה זה נחת" תהיה חד-משמעית בכל אחד משלושת המצבים.
    const same = items.filter((i) => i.currentNet !== null && Math.abs(i.last - i.currentNet) <= 0.0001);
    const big = diffs.filter((d) => Math.abs(d.deltaPct) > 20);
    const none = items.filter((i) => i.currentNet === null);
    list = [...same.slice(0, 2), ...big.slice(0, 2), ...none.slice(0, 1)].slice(0, limit);
  }
  // `--decisions` הוא דריסה ידנית נקודתית, לא תנאי — והיא גוברת על שני השדות.
  const rows = list.map((i) => [i.barcode, String(chosen.get(i.barcode) ?? i[field])]);
  return { list, rows };
}

function writeImport(rows, base) {
  const xlsx = path(`${base}.xlsx`);
  const csv = path(`${base}.csv`);
  writeXlsxSheets(xlsx, [{ name: 'עלות', rows: [COST_HEADERS, ...rows] }]);
  writeFileSync(csv, toCsv([COST_HEADERS, ...rows]));

  // שער סוג התא: ברקוד שנכתב כמספר מוצג `3.46834E+12` וכל צרכן שקורא את
  // המוצג ולא את הערך מקבל את זה. `xlsx-write` כבר מגן, והשער מאמת.
  const sheet = sheetNames(xlsx)[0];
  const numeric = numericCells(xlsx, sheet.path, [0]);
  if (numeric.length) {
    console.error(`⛔ ${numeric.length} ברקודים נכתבו כתא מספרי — הערך ישתנה. לא ממשיכים.`);
    process.exit(1);
  }
  const back = readSheet(xlsx, sheet.path);
  if (back.length - 1 !== rows.length) {
    console.error(`⛔ נכתבו ${back.length - 1} שורות מול ${rows.length} שהורכבו.`);
    process.exit(1);
  }
  return { xlsx, csv, rows: back.length - 1 };
}

// ── האימות שאחרי הקליטה ─────────────────────────────────────────────────────

function verify(file) {
  const f = path(file);
  if (!existsSync(f)) { console.error(`⛔ קובץ האימות לא נמצא: ${f}`); process.exit(1); }
  const text = readFileSync(f, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  const iB = head.findIndex((h) => h.includes('ברקוד'));
  const iSup = head.findIndex((h) => h.includes('עלות לפי ספק'));
  const iNet = head.findIndex((h) => h.includes('עלות נטו'));
  if (iB < 0 || iNet < 0) { console.error('⛔ לא נמצאו עמודות ברקוד/עלות נטו בקובץ האימות.'); process.exit(1); }

  const got = new Map();
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    got.set(String(c[iB] ?? '').trim(), { net: Number(c[iNet]), sup: iSup >= 0 ? Number(c[iSup]) : null });
  }
  let found = 0, netOk = 0, supEq = 0, missing = [];
  for (const i of items) {
    const g = got.get(i.barcode);
    if (!g) { missing.push(i.barcode); continue; }
    found++;
    if (Math.abs(g.net - i.last) < 0.005) netOk++;
    if (g.sup !== null && Math.abs(g.sup - g.net) < 0.005) supEq++;
  }
  console.log('\nאימות אחרי הקליטה:');
  console.log(`  ברקודים שנמצאו בייצוא   : ${found}/${items.length}`);
  console.log(`  מחיר עלות נטו == הקובץ  : ${netOk}/${items.length}${netOk === items.length ? ' ✅' : ' ⛔'}`);
  console.log(`  עלות לפי ספק == נטו     : ${supEq}/${found}`);
  console.log(`  שורות בייצוא            : ${got.size}  (לפני היבוא: ${stats.catalogRows})`);
  if (got.size > stats.catalogRows) console.error('  ⛔ מספר הפריטים עלה — נוצרו פריטים חדשים. SwHkPrt לא תפס.');
  if (missing.length) console.error(`  ⛔ ${missing.length} ברקודים לא נמצאו: ${missing.slice(0, 5).join(', ')}`);
}

// ── ההרצה ───────────────────────────────────────────────────────────────────

console.log(`מקור: ${src}`);
console.log(`גיליון "${stats.sheet}" — ${stats.sourceRows} שורות, ${stats.droppedRows} נפסלו (ברקוד שאינו 13 ספרות)\n`);
console.log(`ברקודים ייחודיים        : ${stats.barcodes}`);
console.log(`קיימים בקומקס           : ${stats.inComax}`);
console.log(`לא קיימים — יוצאים      : ${stats.notInComax}${notInComax.length ? '  ' + notInComax.map((n) => n.barcode).join(' ') : ''}`);
console.log(`כבר נושאים מחיר עלות    : ${stats.withExistingCost}, מהם שונים: ${stats.diffs}`);
console.log(`  מעל 20%: ${stats.over20} · 5-20%: ${stats.between5and20} · 1-5%: ${stats.between1and5} · עד 1%: ${stats.upTo1}`);
console.log(`  עלייה: ${stats.up} · ירידה: ${stats.down}`);
console.log(`ברקודים עם מחיר סותר    : ${stats.conflicts}  (האחרון הוא היקר ב-${stats.lastIsMax}, הזול ב-${stats.lastIsMin})`);

// השערים החוסמים, לפני שכותבים משהו.
const disc = discountGate(items);
if (disc.length) {
  console.error(`\n⛔ ${disc.length} שורות רכישה נושאות הנחה שלא הופחתה מהמחיר: ${disc.slice(0, 5).map((d) => `${d.barcode} (${d.discount}%)`).join(' · ')}`);
  console.error('   מחיר עם הנחה שלא הופחתה הוא עלות שגויה בשקט. לתקן במקור.');
  process.exit(1);
}
console.log('\nשערים:');
console.log('  אין הנחה שלא הופחתה ✅');

const saved = savedDiscountGate(items);
console.log(saved.length
  ? `  ⚠ ${saved.length} פריטים נושאים בקומקס הנחת קניה שמורה (לפי ספק ≠ נטו): ${saved.slice(0, 5).map((s) => s.barcode).join(' ')}\n     כתיבה לשדה "לפי ספק" תייצר להם נטו אחר. לאמת בפיילוט לפני ההרצה המלאה.`
  : '  אף פריט אינו נושא הנחת קניה שמורה בקומקס ✅');

const range = rangeGate(items);
console.log(range.length
  ? `  ⚠ ${range.length} פריטים שהעלות שלהם חורגת מול מחירון 1: ${range.slice(0, 5).map((r) => `${r.barcode} (${r.last} מול ${r.price1})`).join(' · ')}`
  : '  כל העלויות סבירות מול מחירון 1 ✅');

if (duplicated.length) {
  console.error(`  ⛔ ${duplicated.length} ברקודים מופיעים יותר מפעם אחת בקטלוג: ${duplicated.slice(0, 5).map((d) => d.barcode).join(' ')}`);
  process.exit(1);
}
console.log('  אין ברקוד כפול בקטלוג ✅');

if (verifyFile) { verify(verifyFile); process.exit(0); }

if (buildImport || pilotN) {
  const chosen = decisionsFile ? readDecisions(decisionsFile) : new Map();
  if (decisionsFile) console.log(`\nדריסות ידניות מהקובץ שהוכרע: ${chosen.size}`);

  for (const [key, run] of Object.entries(RUNS)) {
    const base = pilotN ? `${PILOT}-${run.file}-${pilotN}` : `data/exports/${run.file}`;
    const { list, rows } = importRows(run.field, chosen, pilotN);
    console.log(`\n── ${run.label} ──  הערך: ${run.field === 'weighted' ? 'ממוצע משוקלל לפי הכמות' : 'הרכישה האחרונה'}`);
    if (pilotN) {
      for (const i of list) {
        console.log(`  ${i.barcode}  ${i.alt}  בקומקס: ${i.currentNet ?? '—'} ⇐ ${i[run.field]}`);
      }
    }
    const out = writeImport(rows, base);
    console.log(`  נכתב: ${out.xlsx}`);
    console.log(`  נכתב: ${out.csv}`);
    console.log(`  ${out.rows} שורות × 2 עמודות, ברקוד כטקסט ✅`);
  }

  // ⚠️ הערך שונה בין שתי ההרצות רק ב-25 פריטים — אבל בהם הוא שונה מהותית.
  const split = items.filter((i) => Math.abs(i.last - i.weighted) > 0.005);
  console.log(`\n${split.length} פריטים מקבלים ערך שונה בשתי ההרצות. הגדול שבהם:`);
  for (const i of [...split].sort((a, b) => Math.abs(b.last - b.weighted) - Math.abs(a.last - a.weighted)).slice(0, 3)) {
    console.log(`  ${i.barcode}  ${i.alt}  מחירון ספק: ${i.weighted}  ·  קניה אחרונה: ${i.last}`);
  }
  process.exit(0);
}

// ⛔ לא לדרוס דוח קיים בתוצאה ריקה — הדגם מ-`items-import-file.js`.
if (!items.length && existsSync(path(REVIEW))) {
  console.error(`\n⛔ אין שורות לכתוב, והקובץ ${REVIEW} כבר קיים — לא דורסים אותו.`);
  process.exit(1);
}

const dest = path(REVIEW);
writeXlsxSheets(dest, [conflictSheet(), diffSheet(), summarySheet()]);
console.log('\nאימות קריאה חוזרת:');
for (const s of sheetNames(dest)) {
  const rows = readSheet(dest, s.path);
  console.log(`  ${s.name}: ${rows.length - 1} שורות × ${rows[0].length} עמודות`);
}
console.log(`\nנכתב: ${dest}`);
console.log('\nהדוח לעיון בלבד — הערך שייכנס לקומקס הוא הממוצע המשוקלל, גם לחריגים.');
console.log('לבניית קובץ היבוא:  npm run cost-file -- --import');
console.log('לדריסה ידנית של חריג: למלא את "המחיר שנבחר" ואז --decisions <הקובץ>');
