/**
 * מרכיב את שורות ההקמה לקומקס מתוך שלושת המקורות.
 *
 * קריאה בלבד — לא נוגע בקומקס, רק בקבצים שעל הדיסק.
 *
 * כללי המיפוי, כפי שדרור מסר ואומתו על הנתונים (07/09/2026):
 *
 *   פריט = ברקוד            ה-EAN. 13,098 מתוך 13,107 בקטלוג הקיים כבר כאלה.
 *   קוד חלופי               המק"ט של ספורט אנד מור **כפי שהוא**. החלטה של דרור:
 *                           הוא זהה לקוד החלופי הקיים רק ב-40%, ובכל זאת עדיף
 *                           להתיישר לפיהם מאשר להמציא פורמט שלישי.
 *   דגם                     מספר הדגם בלבד, בלי צבע. == Style של ארנה ב-98%.
 *   צבע                     מספר הצבע האמיתי. == Colorway של ארנה ב-100%.
 *   שם פריט באנגלית         **תיאור הצבע** — לא שם המוצר.
 *
 * ⚠️ בייצוא הפריטים מקומקס **תוויות העמודות מוסטות**: מה שכתוב בו `מידה` מחזיק
 * את הצבע, ומה שכתוב בו `מותג` מחזיק את המידה. לכן העמודות כאן נקראות לפי
 * מיקום מאומת ולא לפי הכותרת — `KCOL` למטה.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { sheetNames, readSheet } from '../../tools/xlsx.js';

// ---- קריאת CSV -------------------------------------------------------------
function parseLine(l) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) {
      if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function loadCsv(file) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = text.split('\r\n').filter(Boolean).map(parseLine);
  return { head: rows[0], rows: rows.slice(1) };
}

/** הקובץ העדכני ביותר ב-content/ שמתאים לתבנית. */
function newestContent(re) {
  const dir = resolve(ROOT, 'content');
  const hit = readdirSync(dir).filter((f) => re.test(f))
    .map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
  if (!hit) throw new Error(`לא נמצא קובץ שמתאים ל-${re} בתיקיית content/`);
  return resolve(dir, hit.f);
}

// ---- מיקומי עמודות בייצוא של קומקס, מאומתים על הנתונים ---------------------
export const KCOL = {
  internal: 0, item: 1, name: 2, alt: 3, english: 4, barcode: 5,
  depCode: 6, depName: 7, grpCode: 8, grpName: 9, subCode: 10, subName: 11,
  supCode: 12, supName: 13, model: 14, modelName: 15,
  color: 16,   // הכותרת אומרת "מידה" — התוכן הוא הצבע (100% מול Colorway)
  size: 18,    // הכותרת אומרת "מותג" — התוכן הוא המידה
  price1: 31, costSupplier: 33, costNet: 34,
};

/** תאריך סידורי של אקסל → Date */
export const serialDate = (v) => {
  const n = Number(String(v ?? '').trim());
  return n > 1000 ? new Date(Date.UTC(1899, 11, 30) + n * 86400000) : null;
};

const normName = (s) => String(s ?? '').toUpperCase()
  .replace(/^[\d\-/]+/, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * מסיר את קידומת המידה משם הפריט.
 *
 * ספורט אנד מור מדביקים את המידה לתחילת השם בלי רווח — `28POWERSKIN…`,
 * `34LTPOWERSKIN…`, `OSCOBRA…`. אצל דרור השם נקי וחוזר זהה על כל המידות.
 *
 * ההסרה היא של **ערך המידה עצמו**, ולא regex על ספרות: מידה `OS` ו-`34LT` אינן
 * ספרות בלבד, ו-`replace(/^\d+/)` היה משאיר `LT` ו-`OS` תלויים בתחילת השם.
 */
export function cleanName(name, size) {
  let s = String(name ?? '').trim();
  const sz = String(size ?? '').trim();
  if (sz && s.toUpperCase().startsWith(sz.toUpperCase())) s = s.slice(sz.length);
  return s.replace(/^[\s\-–]+/, '').trim();
}

/**
 * ריפוד ל-3 ספרות — **רק לצורך התאמה מול קטלוג ארנה**, ב-`colorIndex.lookup`.
 *
 * ⛔ אסור שייגע בערך שנכתב לקובץ ההקמה. הכרעת דרור 07/09/2026: הצבע נכתב כפי
 *    שהוא מגיע מהמקור. מסד הצבעים של קומקס מחזיק `75` ו-`075` כשתי רשומות
 *    נפרדות, וריפוד עיוור היה מחבר פריט לצבע הלא נכון.
 */
export const padColor = (c) => {
  const s = String(c ?? '').trim();
  return /^\d{1,2}$/.test(s) ? s.padStart(3, '0') : s;
};

/**
 * כל קטלוגי ארנה איטליה שיושבים על הדיסק, מכל העונות.
 *
 * מזוהים לפי התוכן ולא לפי שם הקובץ — כל CSV שיש בכותרת שלו גם `EAN` וגם
 * `Colorway Description` הוא קטלוג ארנה. כך קטלוג של עונה נוספת שיומר ב-
 * `tools/xlsx.js` נכנס לתמונה בלי לגעת בקוד.
 */
export function arenaCatalogs(dir = resolve(ROOT, 'data/exports')) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 2) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = resolve(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!e.name.toLowerCase().endsWith('.csv')) continue;
      try {
        const head = readFileSync(p, 'utf8').slice(0, 4000).split('\r\n')[0];
        if (head.includes('EAN') && head.includes('Colorway Description')) out.push(p);
      } catch { /* קובץ שאי אפשר לקרוא אינו קטלוג */ }
    }
  };
  walk(dir, 0);
  return out;
}

/**
 * תיאור הצבע, בשני מפתחות: לפי EAN, וכגיבוי לפי `דגם+צבע`.
 *
 * הגיבוי הוא מה שמאפשר לקטלוג של עונה אחת למלא פריטים של עונה אחרת — אותו
 * צירוף דגם+צבע שומר על אותו תיאור בין עונות, גם כשה-EAN שונה.
 */
export function colorIndex(files = arenaCatalogs()) {
  const byEan = new Map(), byStyleColor = new Map();
  for (const f of files) {
    const A = loadCsv(f);
    const i = (n) => A.head.indexOf(n);
    const [ean, cwd, st, cw] = [i('EAN'), i('Colorway Description'), i('Style'), i('Colorway')];
    for (const r of A.rows) {
      const desc = String(r[cwd] ?? '').trim();
      if (!desc) continue;
      const e = String(r[ean] ?? '').trim();
      if (e && !byEan.has(e)) byEan.set(e, desc);
      const k = `${String(r[st] ?? '').trim()}|${padColor(r[cw])}`;
      if (!byStyleColor.has(k)) byStyleColor.set(k, desc);
    }
  }
  return {
    files,
    lookup: (barcode, style, color) =>
      byEan.get(String(barcode).trim())
      ?? byStyleColor.get(`${style}|${padColor(color)}`)
      ?? '',
    size: { byEan: byEan.size, byStyleColor: byStyleColor.size },
  };
}

// ---- טעינת המקורות ---------------------------------------------------------
export function loadSources({
  comax = newestContent(/^פריטים-מלא-.*\.csv$/),
  samCard = resolve(ROOT, 'data/exports/SAM/DataSheet.csv'),
  arena = resolve(ROOT, 'data/exports/SS27/1. ארנה איטליה.csv'),
  prices = resolve(ROOT, 'data/exports/175-פריטים-להקמה-מחירים-סופיים.xlsx'),
} = {}) {
  const K = loadCsv(comax);
  const S = loadCsv(samCard);
  const A = loadCsv(arena);
  const colors = colorIndex();

  const sh = sheetNames(prices)[0];
  const priceRows = readSheet(prices, sh.path);
  const pHead = priceRows[0];
  const pi = (n) => pHead.indexOf(n);
  const priceOf = new Map(priceRows.slice(1).map((r) => [String(r[pi('ברקוד')]).trim(), {
    consumer: Number(r[pi('מחיר צרכן')]),
    wholesale: Number(r[pi('מחיר סיטונאי')]),
    source: r[pi('מקור המחיר')],
    cost: Number(r[pi('העלות שלי')]),
    fob: Number(r[pi('FOB EUR')]),
  }]));

  return { K, S, A, colors, priceOf, files: { comax, samCard, arena, prices } };
}

/**
 * ספק — קבוע לפריטי ארנה.
 *
 * עד 2025 הם הוקמו תחת MGS (121001), שהוא המפיץ הקודם. מ-2026 כל 198 פריטי
 * הארנה החדשים בקטלוג רשומים תחת ספורט אנד מור, וזה הכלל של דרור. לכן הספק
 * **נכפה** ולא מועתק מהדגם — פריט חדש שיירש MGS מאח ישן היה נרשם על המפיץ הלא
 * נכון בלי שאיש ישים לב.
 */
export const ARENA_SUPPLIER = { code: '121012', name: 'ספורט אנד מור' };

/**
 * סיווג למשפחות שאין להן אף אח בקטלוג — הוסק מהנתונים ואומת מול שלושה מקורות.
 * המפתח הוא תחילית שם הפריט אצל ספורט אנד מור, בלי קידומת המידה.
 *
 * שתי הכרעות שדרשו יותר מספירה:
 *   - `ARENA HYDROSOFT PLUS` — ספורט אנד מור שייכו אותו למשפחת "כובעי שחייה",
 *     אבל ארנה איטליה מסווגת אותו `Equipment / Footwear` וסרגל המידות שלו הוא
 *     "יורו. 19<42", כלומר מידות נעליים. זה **כפכף**, והסיווג שלהם שגוי.
 *   - `L3D SOFT LION` — יש בקטלוג בדיוק פריט אחד מאותה סדרה,
 *     `L3D SOFT ISR FLAG WHITE L`, והוא יושב תחת כובעי ים.
 */
export const FAMILY_RULES = [
  { match: /^(OS)?MOULDED |^FLAT SILICONE |^L3D SOFT /, cls: ['210', 'ציוד', '2007', 'כובעי ים', '20032', 'יוניסקס'], why: 'כובעי ים' },
  { match: /HYDROSOFT/,        cls: ['210', 'ציוד', '2011', 'כפכפים', '20032', 'יוניסקס'], why: 'כפכפים (Footwear אצל ארנה)' },
  { match: /JAMMER/,           cls: ['202', 'גברים', '2001', 'בגדי ים', '20015', 'טיץ שחייה'], why: 'טיץ שחייה — 98% מהמקרים' },
  { match: /LOW WAIST SHORT/,  cls: ['202', 'גברים', '2001', 'בגדי ים', '20021', 'מכנסונים'], why: 'מכנסונים — 91% מהמקרים' },
  { match: /POWERSKIN .*OB$/,  cls: ['201', 'נשים', '2001', 'בגדי ים', '20012', 'אוברול / חליפות'], why: 'אוברול/חליפות — 100% מהמקרים' },
];

/** מחזיר סיווג לפי משפחה, או null. */
export function familyRule(description) {
  const name = String(description ?? '').replace(/^[\d\-/]+/, '').trim().toUpperCase();
  const hit = FAMILY_RULES.find((r) => r.match.test(name));
  if (!hit) return null;
  const [depCode, depName, grpCode, grpName, subCode, subName] = hit.cls;
  return { via: `הוסק מהנתונים — ${hit.why}`, depCode, depName, grpCode, grpName, subCode, subName, fromItem: '' };
}

// ---- סיווג: מדגם זהה, ואם אין — משם דומה, ואם אין — null -------------------
export function classifier(K) {
  const byModel = new Map();
  for (const r of K.rows) {
    const m = String(r[KCOL.model] ?? '').trim();
    if (m && !byModel.has(m)) byModel.set(m, r);
  }
  const named = K.rows.map((r) => ({
    key: normName(`${r[KCOL.name]} ${r[KCOL.english]}`), row: r,
  }));

  const pack = (r, via) => ({
    via,
    depCode: r[KCOL.depCode], depName: r[KCOL.depName],
    grpCode: r[KCOL.grpCode], grpName: r[KCOL.grpName],
    subCode: r[KCOL.subCode], subName: r[KCOL.subName],
    supCode: r[KCOL.supCode], supName: r[KCOL.supName],
    fromItem: r[KCOL.barcode],
  });

  return function classify(model, description) {
    const m = byModel.get(model) ?? byModel.get(String(model).replace(/^0+/, ''));
    if (m) return pack(m, 'דגם זהה');

    let core = normName(description);
    let hit = named.find((x) => core && x.key.includes(core));
    if (!hit && core.length > 16) {
      core = core.slice(0, 16);
      hit = named.find((x) => x.key.includes(core));
    }
    // לא מנחשים. פריט בלי עוגן חוזר null ויוצא לגיליון "דורש החלטה".
    return hit ? pack(hit.row, 'שם דומה') : null;
  };
}

// ---- הרכבת השורות ----------------------------------------------------------
export const IMPORT_HEADERS = [
  'מק"ט', 'ברקוד', 'קוד חלופי', 'שם פריט', 'שם פריט באנגלית',
  'דגם', 'צבע', 'מידה',
  'מחלקה', 'שם מחלקה', 'קבוצה', 'שם קבוצה', 'קבוצת משנה', 'שם קבוצת משנה',
  'ספק', 'שם ספק', 'עונה',
  'מחיר עלות', 'מחיר צרכן', 'מחיר סיטונאי',
  'מקור הסיווג', 'הועתק מפריט',
];

/**
 * @returns {{ready: any[][], pending: any[][], skipped: any[]}}
 *   `ready`   — שורות עם סיווג מלא
 *   `pending` — שורות בלי עוגן סיווג, לקבלת החלטה
 *   `skipped` — ברקודים שכבר קיימים בקומקס או שאין להם מחיר מאושר
 */
export function buildRows(src = loadSources()) {
  const { K, S, priceOf } = src;
  const si = (n) => S.head.indexOf(n);
  const B = si('ברקוד'), ST = si('סטטוס'), D = si('תאור'), MK = si('מק"ט');
  const PM = si('פריט מרכז/דגם'), SZ = si('מידה3'), SE = si('עונה/שנה14');
  const CREATED = 97; // "תאריך הקמה" — מיקום, כי השם מופיע פעמיים בקובץ שלהם

  const existing = new Set(K.rows.map((r) => String(r[KCOL.barcode]).trim()));
  const classify = classifier(K);


  const ready = [], pending = [], skipped = [];

  for (const r of S.rows) {
    const barcode = String(r[B]).trim();
    if (!/^\d{13}$/.test(barcode)) continue;          // מוצרי אב — לא מוצרי בן
    if (String(r[ST]).trim() !== 'פעיל') continue;
    const created = serialDate(r[CREATED]);
    if (!created || created < new Date(Date.UTC(2026, 0, 1))) continue;

    // שער 1 — פריט שכבר קיים בקומקס לא מוקם שוב.
    if (existing.has(barcode)) { skipped.push({ barcode, why: 'כבר קיים בקומקס' }); continue; }

    // שער 2 — מחיר לא מנוחש.
    const p = priceOf.get(barcode);
    if (!p || !(p.consumer > 0)) { skipped.push({ barcode, why: 'אין מחיר מאושר' }); continue; }

    const priority = String(r[MK]).trim();            // הקוד החלופי, כפי שהוא אצלם
    const parent = String(r[PM] ?? '').replace(/^AR/, '');
    const model = parent.slice(0, 6);
    const color = parent.slice(6, 9);
    const cls = classify(model, r[D]) ?? familyRule(r[D]);

    const row = [
      barcode, barcode, priority, cleanName(r[D], r[SZ]), src.colors.lookup(barcode, model, color),
      model, color, r[SZ],   // הצבע כפי שהוא מגיע מהמקור — בלי ריפוד
      cls?.depCode ?? '', cls?.depName ?? '',
      cls?.grpCode ?? '', cls?.grpName ?? '',
      cls?.subCode ?? '', cls?.subName ?? '',
      ARENA_SUPPLIER.code, ARENA_SUPPLIER.name,
      r[SE],
      p.cost || '', p.consumer, p.wholesale,
      cls?.via ?? 'ללא עוגן', cls?.fromItem ?? '',
    ];
    (cls ? ready : pending).push(row);
  }

  return { ready, pending, skipped };
}
