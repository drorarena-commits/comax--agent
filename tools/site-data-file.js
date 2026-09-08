/**
 * בונה את קובץ היבוא של **"נתוני אתר לפריט"** (סוג יבוא 3) — הקובץ שמבטל את
 * הסימון **"לא להציג"**, שבלעדיו פריט בקומקס פשוט לא מסונכרן עם אתר ארנה.
 *
 *   node tools/site-data-file.js <קובץ יעד> <מק"ט> [מק"ט...]
 *   node tools/site-data-file.js                       # ברירת מחדל: 10 פריטי הכובעים
 *
 * ⚠️ **ארבע עמודות בדיוק, וזה מה שדרור הכתיב** (08/09/2026):
 *
 * | עמודה | שדה בקומקס | תוכן |
 * |---|---|---|
 * | A | `פריט(קוד)` (`chk0`) | המק"ט |
 * | B | `דרוג תצוגה` (`chk1`) | **ריקה** |
 * | C | `ברקוד` (`chk2`) | הברקוד — אצלנו זהה למק"ט ב-13,283 מ-13,316 |
 * | D | `לא להציג פריט` (`chk4`) | **`0`** — ריק ו-0 שקולים בשדה הזה |
 *
 * ⛔ **`chk3` הוא "פריט בקרור(0/1)" ויושב בין ברקוד ל"לא להציג".** מי שינחש
 * שהמיפוי רציף ויכתוב `chk3` ידרוס שדה אחר לגמרי. המזהים נמדדו ב-`probe`
 * ויושבים ב-`knowledge/screens/items-import-type3.json`.
 */
import { resolve } from 'node:path';
import { writeXlsx } from './xlsx-write.js';
import { ROOT } from '../src/config.js';

/** 10 הכובעים שהוקמו ב-08/09/2026 לאתר — 8 צבעי 91662 ושני צבעי 123456. */
const DEFAULT_CODES = [
  '91662015', '91662035', '91662051', '91662055', '91662065',
  '91662071', '91662075', '91662103', '123456100', '123456800',
];

export const SITE_FILE_HEADERS = ['פריט(קוד)', 'דרוג תצוגה', 'ברקוד', 'לא להציג פריט'];

/** @param {string[]} codes @returns {(string)[][]} כותרות + שורות */
export function buildSiteRows(codes) {
  return [SITE_FILE_HEADERS, ...codes.map((c) => [c, '', c, '0'])];
}

const [, , dest = 'data/exports/נתוני-אתר-פריטים.xlsx', ...codes] = process.argv;
const list = codes.length ? codes : DEFAULT_CODES;
const file = resolve(ROOT, dest);
const rows = buildSiteRows(list);
writeXlsx(file, rows);

console.log(`\n  ${file}`);
console.log(`  ${list.length} שורות · ${SITE_FILE_HEADERS.length} עמודות`);
console.log(`  ${SITE_FILE_HEADERS.join(' | ')}`);
for (const r of rows.slice(1)) console.log(`  ${r.map((c) => (c === '' ? '(ריק)' : c)).join(' | ')}`);
console.log('');
