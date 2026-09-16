/**
 * קובץ ההקמה לשלושת הצבעים החסרים של MOULDED PRO II (דגם 001451).
 *
 *   node tools/moulded-pro-ii-file.js [יעד.xlsx]
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

// הצבעים שבקופסה ואינם בקומקס. מקור: קטלוג ארנה SS27 —
// "001451 - MOULDED PRO II (12 PCS PER INNERBOX) - 100 ASSORTED",
// שבו כל צבע שמסומן [2x] נמצא בקופסה פעמיים. 6 צבעים × 2 = 12. ✓
// 901 FUCHSIA אינו מסומן [2x] — אינו בקופסה, ולכן אינו מוקם.
const NEW = [
  { barcode: '3468336075463', color: '501', en: 'BLACK' },
  { barcode: '3468336075852', color: '701', en: 'NAVY'  },
  { barcode: '3468336075241', color: '721', en: 'ROYAL' },
];

const dest = resolve(ROOT, process.argv[2] ?? 'content/הקמה-moulded-pro-ii.xlsx');
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
const price = Number(at(anchor, 'מחיר מחירון 1'));
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
  cost, price, +(price * WHOLESALE).toFixed(2),
  `הועתק מ-${ANCHOR}`, ANCHOR,
]);

const res = writeXlsx(dest, [IMPORT_HEADERS, ...rows], { sheetName: 'להקמה' });
console.log(`נכתב: ${res?.file ?? dest}`);
console.table(rows.map((r) => Object.fromEntries(IMPORT_HEADERS.map((h, i) => [h, r[i]]))));
