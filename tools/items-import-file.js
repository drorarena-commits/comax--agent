/**
 * בונה את קובץ ההקמה לקומקס משלושת המקורות.
 *
 *   node tools/items-import-file.js [יעד.xlsx]
 *
 * שלושה גיליונות:
 *   "להקמה"       — פריטים עם סיווג מלא
 *   "דורש החלטה"  — פריטים בלי עוגן סיווג, מקובצים למשפחות, צבועים בצהוב
 *   "מאסטר חסר"   — דגמים וצבעים שצריך להקים בקומקס לפני היבוא
 *
 * קריאה בלבד. לא נוגע בקומקס.
 */
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { loadSources, buildRows, IMPORT_HEADERS } from '../src/items/build-import.js';
import { masterGate, masterSheet, MASTER_HEADERS } from '../src/items/master-gate.js';
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

// שער המאסטר — דגם וצבע הם ישויות נפרדות בקומקס, וחייבים להתקיים לפני היבוא.
const gate = masterGate([...ready, ...pending], src.K);
const master = masterSheet(gate);

const ITEM_SHEETS = ['להקמה', 'דורש החלטה'];
const res = writeXlsxSheets(dest, [
  { name: 'להקמה', rows: [IMPORT_HEADERS, ...ready] },
  // כל השורות צהובות: הגיליון כולו הוא רשימת ההחלטות, והצבע מסמן "לא למלא לבד".
  { name: 'דורש החלטה', rows: [IMPORT_HEADERS, ...pending], highlight: new Set(pending.map((_, i) => i)) },
  // הצהוב כאן מסמן את הקודים שקיימים בקומקס בצורה אחרת — הכרעה, לא הקמה.
  { name: 'מאסטר חסר', rows: [MASTER_HEADERS, ...master.rows], highlight: master.highlight },
]);

// אימות: לקרוא בחזרה את מה שנכתב, ולספור מול מה שהורכב.
const sheets = sheetNames(dest);
console.log('\nאימות קריאה חוזרת:');
let total = 0;
for (const s of sheets) {
  const rows = readSheet(dest, s.path);
  if (ITEM_SHEETS.includes(s.name)) total += rows.length - 1;
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
// אימות הצבע: לא צורה — **זהות למקור**. הריפוד בוטל (הכרעת דרור 07/09/2026),
// והשער מוודא שאף טרנספורמציה לא הופעלה בדרך מהקוד של ספורט אנד מור לקובץ.
// המקור הוא **`פריט מרכז/דגם`** של ספורט אנד מור, לא הקוד החלופי: הקוד החלופי
// הוא המק"ט שלהם (דגם+צבע+מידה) והחיתוך בו נופל על ספרות אחרות לגמרי.
const sB = src.S.head.indexOf('ברקוד');
const sPM = src.S.head.indexOf('פריט מרכז/דגם');
const srcColor = new Map(src.S.rows.map((r) => [
  String(r[sB]).trim(), String(r[sPM] ?? '').replace(/^AR/, '').slice(6, 9),
]));
const iB = IMPORT_HEADERS.indexOf('ברקוד');
const empty = all.filter((r) => !String(r[iCol] ?? '').trim());
const moved = all.filter((r) => {
  const raw = srcColor.get(String(r[iB]));
  return raw && String(r[iCol]) !== raw;
});
console.log(empty.length ? `⛔ ${empty.length} שורות בלי צבע` : '  לכל שורה יש צבע ✅');
console.log(moved.length
  ? `⛔ ${moved.length} ערכי צבע שאינם זהים למקור: ${[...new Set(moved.map((r) => r[iCol]))].slice(0, 8).join(', ')}`
  : '  הצבע זהה למקור בכל השורות — בלי ריפוד ✅');
const withColorName = all.filter((r) => String(r[iEng]).trim()).length;
console.log(`  תיאור צבע מולא: ${withColorName}/${all.length}  (מתוך ${src.colors.files.length} קטלוגי ארנה)`);

console.log(`\nנכתב: ${dest}`);

// ── שער המאסטר ──────────────────────────────────────────────────────────────
// חוסם, בניגוד לשערים שמעליו: פריט שנקלט עם דגם או צבע שלא הוקמו יוצר ערך יתום
// בקומקס, ונזק כזה קשה לנקות אחרי הקליטה. עדיף להיכשל כאן.
const line = (label, list) => console.log(
  `  ${label}: ${list.length}${list.length ? '  ' + list.map((e) => `${e.code}(${e.count})`).join(' ') : ''}`,
);
console.log('\nשער המאסטר — מול הקטלוג של קומקס:');
line('דגמים להקמה', gate.missingModels);
line('צבעים להקמה', gate.missingColors);
if (gate.lookalikes.length) {
  console.log(`  ⚠ מהם, יש בקומקס קוד דומה: ${gate.lookalikes.map((u) => `${u.code}~${u.existsAs}`).join(' ')}`
    + '  — רשומות נפרדות. להקים, ולא לבחור בדומה.');
}
const led = [...gate.fromLedger.models, ...gate.fromLedger.colors];
if (led.length) {
  console.log(`  מוכרים לפי יומן ההקמה (טרם בייצוא): ${led.join(' ')}`);
}
console.log(`  שורות שנוגעות בערך חסר: ${gate.affectedRows}/${gate.totalRows}`);

if (gate.affectedRows) {
  console.error('\n⛔ אי אפשר לייבא: יש דגמים או צבעים שלא קיימים בקומקס — צריך להקים אותם קודם.');
  console.error('   הרשימה המלאה בגיליון "מאסטר חסר". שורה צהובה = יש בקומקס קוד דומה, לא זהה.');
  process.exit(1);
}
console.log('  כל הדגמים והצבעים קיימים בקומקס ✅');
