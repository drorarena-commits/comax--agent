/**
 * שני קבצים ל-MOULDED PRO II (דגם 001451):
 *
 *   1. הקמה      — שלושת צבעי הקופסה שאינם בקומקס (501 · 701 · 721)
 *   2. עדכון מחיר — `--partial` על ארבעת הפריטים הקיימים, ל-69 ₪
 *
 *   node tools/moulded-pro-ii-file.js
 *
 * למה כלי נפרד ולא `npm run items-file`: זו מנה ממוקדת של שלושה ברקודים
 * ידועים מראש, לא סריקה של כל הפער בין ארנה לקומקס. הסיווג, המחיר והספק
 * **מועתקים מהאחים הקיימים של אותו דגם בקומקס** ולא מהקטלוג — שלושת
 * הפריטים החדשים חייבים לשבת בדיוק כמו 101/401/505, אחרת אותו מוצר באתר
 * יישבר לשני סיווגים.
 *
 * קריאה בלבד. לא נוגע בקומקס.
 */
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { comaxCatalog, KCOL, IMPORT_HEADERS } from '../src/items/build-import.js';
import { writeXlsx } from './xlsx-write.js';

const MODEL = '001451';
const ANCHOR = '3468336076187'; // 101 WHITE — האח שממנו מעתיקים את הסיווג
const WHOLESALE = 0.5;          // מחיר סיטונאי = 50% מהצרכן (knowledge/items-setup.md)

// הכרעת דרור 16/09/2026: **כל הדגם** עולה ל-69 ₪ — החדשים והקיימים כאחד,
// והדגם הזה בלבד. לכן המחיר **אינו** מועתק מהאח, בשונה מהסיווג: אח שנשאר
// על 49.90 היה מייצר דגם עם שני מחירים באותו מוצר באתר.
const PRICE = 69;

// ארבעת הקיימים, כולל המיקס. המיקס נשאר בקומקס ועדיין נסרק בקופה על כל
// מכירה בחנות — מחיר ישן עליו הוא מחיר שגוי בקופה, לא פרט טכני.
const EXISTING = ['3468336076187', '3468336076019', '3468336075500', '3468336076545'];

// הצבעים שבקופסה ואינם בקומקס. מקור: קטלוג ארנה SS27 —
// "001451 - MOULDED PRO II (12 PCS PER INNERBOX) - 100 ASSORTED",
// שבו כל צבע שמסומן [2x] נמצא בקופסה פעמיים. 6 צבעים × 2 = 12. ✓
// 901 FUCHSIA אינו מסומן [2x] — אינו בקופסה, ולכן אינו מוקם.
const NEW = [
  { barcode: '3468336075463', color: '501', en: 'BLACK' },
  { barcode: '3468336075852', color: '701', en: 'NAVY'  },
  { barcode: '3468336075241', color: '721', en: 'ROYAL' },
];

const dest  = resolve(ROOT, 'content/הקמה-moulded-pro-ii.xlsx');
const dest2 = resolve(ROOT, 'content/מחיר-moulded-pro-ii-69.xlsx');
const K = comaxCatalog();
const at = (row, name) => row[K.head.indexOf(name)];

const anchor = K.rows.find((r) => String(r[KCOL.barcode]).trim() === ANCHOR);
if (!anchor) throw new Error(`האח ${ANCHOR} לא נמצא בקטלוג — אין ממה להעתיק סיווג.`);

// ⛔ ברקוד שכבר קיים בקומקס לא מוקם שוב — הקמה כפולה אינה נמחקת בקליק.
const existing = new Set(K.rows.map((r) => String(r[KCOL.barcode]).trim()));
const dup = NEW.filter((n) => existing.has(n.barcode));
if (dup.length) throw new Error(`כבר קיימים בקומקס: ${dup.map((d) => d.barcode).join(', ')}`);

// ⚠️ תוויות העמודות בייצוא מוסטות: "מידה" מחזיקה את הצבע ו"מותג" את המידה.
// לכן המידה נקראת דרך KCOL ולא לפי שם העמודה.
const cost  = Number(at(anchor, 'מחיר עלות לפי ספק'));
const size  = anchor[KCOL.size];

const rows = NEW.map((n) => [
  n.barcode, n.barcode, `AR${MODEL}${n.color}000`,
  `MOULDED PRO II ${n.en}`, n.en,
  MODEL, n.color, size,
  at(anchor, 'מחלקה'), at(anchor, 'שם מחלקה'),
  at(anchor, 'קבוצה'), at(anchor, 'שם קבוצה'),
  at(anchor, 'קבוצת משנה'), at(anchor, 'שם קבוצת משנה'),
  at(anchor, 'ספק'), at(anchor, 'שם ספק'), at(anchor, 'שם נוסף 2'),
  cost, PRICE, +(PRICE * WHOLESALE).toFixed(2),
  `הועתק מ-${ANCHOR}`, ANCHOR,
]);

writeXlsx(dest, [IMPORT_HEADERS, ...rows], { sheetName: 'להקמה' });
console.log(`הקמה → ${dest}`);
console.table(rows.map((r) => Object.fromEntries(IMPORT_HEADERS.map((h, i) => [h, r[i]]))));

// ---- קובץ עדכון המחיר ------------------------------------------------------
//
// ⚠️ **רק `מחיר צרכן`, ובכוונה.** `--partial` כותב אך ורק את העמודות שקיימות
// בקובץ, ולכן כל עמודה מיותרת כאן היא שדה שנדרס בפריט חי. `מחיר מחירון 2`
// (סיטונאי) **ריק היום בכל ארבעת הפריטים**, והוספתו כאן הייתה יוצרת ערך חדש
// שדרור לא ביקש — שינוי מחיר לסיטונאים שאיש לא היה רואה.
const PARTIAL_HEADERS = ['מק"ט', 'ברקוד', 'מחיר צרכן'];
const priceRows = EXISTING.map((b) => {
  const row = K.rows.find((r) => String(r[KCOL.barcode]).trim() === b);
  if (!row) throw new Error(`${b} לא נמצא בקטלוג — אין מה לעדכן.`);
  return [b, b, PRICE];
});
writeXlsx(dest2, [PARTIAL_HEADERS, ...priceRows], { sheetName: 'מחיר' });
console.log(`\nעדכון מחיר → ${dest2}`);
for (const b of EXISTING) {
  const row = K.rows.find((r) => String(r[KCOL.barcode]).trim() === b);
  console.log(`  ${b}  ${String(at(row, 'שם פריט')).padEnd(28)} ${at(row, 'מחיר מחירון 1')} ₪ → ${PRICE} ₪`);
}
