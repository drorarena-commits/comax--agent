/**
 * בונה את קובץ ההקמה לקומקס משלושת המקורות.
 *
 *   node tools/items-import-file.js [יעד.xlsx]
 *
 * שני גיליונות:
 *   "להקמה"       — פריטים עם סיווג מלא
 *   "דורש החלטה"  — פריטים בלי עוגן סיווג, מקובצים למשפחות, צבועים בצהוב
 *
 * קריאה בלבד. לא נוגע בקומקס.
 */
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { loadSources, buildRows, IMPORT_HEADERS } from '../src/items/build-import.js';
import { writeXlsxSheets } from './xlsx-write.js';
import { sheetNames, readSheet } from './xlsx.js';

const dest = resolve(ROOT, process.argv[2] ?? 'data/exports/הקמה-קומקס-175.xlsx');

const src = loadSources();
const { ready, pending, skipped } = buildRows(src);

console.log(`מקורות:\n  ${Object.values(src.files).join('\n  ')}\n`);
console.log(`מוכנים להקמה : ${ready.length}`);
console.log(`דורשים החלטה : ${pending.length}`);
console.log(`נדחו         : ${skipped.length}`);
for (const [why, n] of Object.entries(skipped.reduce((m, s) => ({ ...m, [s.why]: (m[s.why] ?? 0) + 1 }), {}))) {
  console.log(`    ${why}: ${n}`);
}

const res = writeXlsxSheets(dest, [
  { name: 'להקמה', rows: [IMPORT_HEADERS, ...ready] },
  // כל השורות צהובות: הגיליון כולו הוא רשימת ההחלטות, והצבע מסמן "לא למלא לבד".
  { name: 'דורש החלטה', rows: [IMPORT_HEADERS, ...pending], highlight: new Set(pending.map((_, i) => i)) },
]);

// אימות: לקרוא בחזרה את מה שנכתב, ולספור מול מה שהורכב.
const sheets = sheetNames(dest);
console.log('\nאימות קריאה חוזרת:');
let total = 0;
for (const s of sheets) {
  const rows = readSheet(dest, s.path);
  total += rows.length - 1;
  console.log(`  ${s.name}: ${rows.length - 1} שורות × ${rows[0].length} עמודות`);
}
if (total !== ready.length + pending.length) {
  console.error(`⛔ אי-התאמה: נכתבו ${total} שורות מול ${ready.length + pending.length} שהורכבו.`);
  process.exit(1);
}

// אימות מחיר: סיטונאי הוא בדיוק מחצית הצרכן.
const iC = IMPORT_HEADERS.indexOf('מחיר צרכן');
const iW = IMPORT_HEADERS.indexOf('מחיר סיטונאי');
const bad = [...ready, ...pending].filter((r) => Math.abs(Number(r[iW]) * 2 - Number(r[iC])) > 0.011);
console.log(bad.length ? `⛔ ${bad.length} שורות שבהן הסיטונאי אינו 50%` : '  סיטונאי == 50% מהצרכן בכל השורות ✅');

// אימות ייחודיות ברקוד.
const codes = [...ready, ...pending].map((r) => r[0]);
const dup = codes.length - new Set(codes).size;
console.log(dup ? `⛔ ${dup} ברקודים כפולים` : '  אפס ברקודים כפולים ✅');

// אימות התיקונים: שם נקי ממידה, וצבע בן שלוש ספרות.
const iN = IMPORT_HEADERS.indexOf('שם פריט');
const iS = IMPORT_HEADERS.indexOf('מידה');
const iCol = IMPORT_HEADERS.indexOf('צבע');
const iEng = IMPORT_HEADERS.indexOf('שם פריט באנגלית');
const all = [...ready, ...pending];
const withSize = all.filter((r) => String(r[iS]) && String(r[iN]).toUpperCase().startsWith(String(r[iS]).toUpperCase()));
console.log(withSize.length ? `⛔ ${withSize.length} שמות שעדיין מתחילים במידה` : '  אף שם פריט אינו מתחיל במידה ✅');
const badColor = all.filter((r) => !/^\d{3}$/.test(String(r[iCol])));
console.log(badColor.length
  ? `⚠ ${badColor.length} ערכי צבע שאינם 3 ספרות: ${[...new Set(badColor.map((r) => r[iCol]))].slice(0, 8).join(', ')}`
  : '  כל ערכי הצבע באורך 3 ✅');
const withColorName = all.filter((r) => String(r[iEng]).trim()).length;
console.log(`  תיאור צבע מולא: ${withColorName}/${all.length}  (מתוך ${src.colors.files.length} קטלוגי ארנה)`);

console.log(`\nנכתב: ${dest}`);
