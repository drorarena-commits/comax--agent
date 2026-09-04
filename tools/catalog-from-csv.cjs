/**
 * בונה את `data/catalog/items.json` מייצוא המלאי שב-`content/`.
 *
 *   node tools/catalog-from-csv.cjs [קובץ]        ברירת מחדל: החדש ב-content/
 *
 * למה זה קיים: `src/catalog/build.js` מצפה לייצוא **HTML** של קומקס
 * (`parse.js` מחפש שורות `<tr>`), ולכן בנייה מחייבת ייצוא טרי — כחצי שעה
 * שתופסת את המושב היחיד. אבל הייצוא ש-`content/` כבר מחזיק הוא CSV אמיתי,
 * הוא **נשמר ב-git**, ויש בו בדיוק את מה שחסר: `מק"ט חלופי` ו-`ברקוד`.
 *
 * כלומר הקטלוג ניתן לשחזור בכל מחשב, בשניות, בלי לגעת בקומקס — וזה מה שהופך
 * את כלל 5 לבר-קיום גם במחשב חדש.
 *
 * ⚠️ הקובץ הזה נותן זיהוי (מק"ט/דגם/צבע/שם) ומחיר מחירון. הוא **לא** תחליף
 * לקטלוג המלא לשאלות מלאי — לזה יש את `content/` עצמו ואת `comax-stock`.
 */
const fs = require('fs');
const path = require('path');

/** CSV עם ציטוטים: פסיק בתוך מרכאות אינו מפריד, ו-"" הוא מרכאה בתוך שדה. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * שמות העמודות בייצוא הזה שונים מאלה שב-SCHEMAS של build.js — `מק"ט חלופי`
 * במקום `קוד חלופי`, `תיאור פריט` במקום `שם פריט`. כל שדה מקבל רשימת מועמדים,
 * והראשון שנמצא מנצח.
 */
const FIELDS = {
  code: ['פריט'],
  barcode: ['ברקוד'],
  altCode: ['מק"ט חלופי', 'קוד חלופי'],
  name: ['תיאור פריט', 'שם פריט'],
  modelCode: ['קוד דגם'],
  model: ['דגם', 'שם דגם'],
  colorCode: ['צבע', 'שם צבע'],
  size: ['מידה', 'שם מידה'],
  department: ['מחלקה', 'שם מחלקה'],
  group: ['קבוצה', 'שם קבוצה'],
  price1: ['מחירון 1', 'מחיר מחירון 1'],
  salePrice: ['מחיר מכירה'],
  stock: ['סה"כ מלאי', 'יתרת מלאי'],
};

const src =
  process.argv[2] ||
  fs.readdirSync('content')
    .filter((f) => /^מלאי-מלא.*\.csv$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join('content', f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((x) => path.join('content', x.f))[0];

if (!src || !fs.existsSync(src)) {
  console.error('לא נמצא קובץ מלאי ב-content/. ציין נתיב במפורש.');
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''));
if (rows.length < 2) { console.error('הקובץ ריק או לא נקרא.'); process.exit(1); }

const head = rows[0].map((h) => h.trim());
const idx = {};
const missing = [];
for (const [key, names] of Object.entries(FIELDS)) {
  const i = names.map((n) => head.indexOf(n)).find((x) => x >= 0);
  if (i === undefined) missing.push(`${key} (${names.join(' / ')})`);
  else idx[key] = i;
}
if (idx.code === undefined || idx.barcode === undefined || idx.altCode === undefined) {
  console.error('חסרות עמודות חובה:', missing.join(' · '));
  console.error('כותרות שנמצאו:', head.join(' | '));
  process.exit(1);
}
if (missing.length) console.log('עמודות שלא נמצאו (לא חוסמות):', missing.join(' · '));

const num = (s) => {
  const v = Number(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};

const records = [];
const seen = new Set();
for (const r of rows.slice(1)) {
  const code = (r[idx.code] ?? '').trim();
  const barcode = (r[idx.barcode] ?? '').trim();
  if (!code && !barcode) continue;
  const key = code || barcode;
  if (seen.has(key)) continue;
  seen.add(key);
  const rec = { code, barcode };
  for (const k of ['altCode', 'name', 'modelCode', 'model', 'colorCode', 'size', 'department', 'group']) {
    if (idx[k] !== undefined) rec[k] = (r[idx[k]] ?? '').trim();
  }
  for (const k of ['price1', 'salePrice', 'stock']) {
    if (idx[k] !== undefined) rec[k] = num(r[idx[k]]);
  }
  records.push(rec);
}

const withAlt = records.filter((r) => r.altCode).length;
const out = path.join('data', 'catalog', 'items.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ source: src, builtAt: new Date().toISOString(), records }, null, 0), 'utf8');

console.log(`מקור : ${src}`);
console.log(`נכתב : ${out}`);
console.log(`רשומות: ${records.length} · עם מק"ט חלופי: ${withAlt} (${Math.round((withAlt / records.length) * 100)}%)`);
