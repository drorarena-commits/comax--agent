/**
 * ממיר את דוח מטריצת המחסנים מה-HTML שקומקס מחזיר ל-CSV ש-apply-matrix קורא.
 *
 *   node tools/matrix-html-to-csv.js [קובץ.html] [יעד.csv]
 *
 * למה זה קיים: מסלול ה**אקסל** של המטריצה שבור מצד קומקס — `Spooler_Exl_EXE`
 * עונה "בעיה בהפעלה ראשונית" גם לדוח שנגמר על סשן חי, וזה מתועד ב-
 * `src/tasks/stock-matrix.js`. המסלול שעובד הוא `--json '{"excel":false}'`,
 * שמוריד את הדוח כ-HTML דרך הצופה. אבל `loadMatrix` מצפה ל-CSV, ולכן בלי
 * הממיר הזה הדוח יורד בהצלחה ואז נתקע בלי שאף אחד יכול לקרוא אותו.
 *
 * שלוש מלכודות במבנה שקומקס מחזיר, וכולן שקטות:
 *   - **שורת הכותרת אינה הראשונה.** tr[0] ריק, tr[1] הוא פס שמות המחסנים,
 *     ורק tr[2] מחזיק את `פריט`. מאתרים לפי תוכן, לא לפי אינדקס.
 *   - **שמות המחסנים יושבים בפס נפרד** מעל הכותרת, בזמן שהכותרת עצמה חוזרת
 *     `מלאי` שש פעמים. בלי חיבור השניים אין דרך לדעת איזו עמודה היא ראשי.
 *   - **יש trs שהם קוד JS ולא נתונים** (`"+TxtXmlSikum+"`), והם נראים כמו
 *     שורות תקינות לכל parser.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { ROOT } from '../src/config.js';

const CELL = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
const ROW = /<tr[^>]*>[\s\S]*?<\/tr>/gi;

const clean = (h) => h
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/''/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

const cellsOf = (tr) => [...tr.matchAll(CELL)].map((m) => clean(m[1]));
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function convert(srcFile, destFile) {
  const txt = readFileSync(srcFile, 'utf8');
  const trs = txt.match(ROW) ?? [];
  if (!trs.length) throw new Error(`לא נמצאו שורות טבלה ב-${srcFile}.`);

  // שורת הכותרת — לפי תוכן. בלי זה כל שינוי בפריסה מזיז את האינדקס בשקט.
  const headIdx = trs.findIndex((tr) => {
    const c = cellsOf(tr);
    return c[0] === 'פריט' && c[1] === 'שם פריט';
  });
  if (headIdx < 0) throw new Error('לא נמצאה שורת כותרת עם "פריט" ו"שם פריט" — הפורמט השתנה?');
  const head = cellsOf(trs[headIdx]);

  // פס שמות המחסנים — השורה שמעליה שמחזיקה סה"כ ואחריו שם מחסן לכל עמודה.
  const band = cellsOf(trs[headIdx - 1]).filter(Boolean);
  const stockCols = head.filter((h) => h === 'מלאי').length;
  const names = band.slice(-stockCols);
  if (names.length !== stockCols) {
    throw new Error(`פס המחסנים (${band.length}) לא תואם למספר עמודות המלאי (${stockCols}).`);
  }

  // loadMatrix דורש head[1]==='פריט' ו-head[2]==='שם פריט', כלומר עמודה מובילה.
  // ושמות המחסנים נכתבים **במפורש** — עמודה ראשונה בבלוק היא הסיכום ושמה `מלאי`,
  // והשאר בשמן. כותרת אנונימית מאלצת את `loadMatrix` לכייל מול ייצוא ישן, וזה
  // נשבר בדיוק על המחסן שזז הכי הרבה (WIX) — כלומר על המחסן שהאתר מוכר ממנו.
  const outHead = ['#', ...head.slice(0, head.length - stockCols), 'מלאי', ...names.slice(1)];
  const lines = [outHead.map(q).join(',')];

  let n = 0;
  let skipped = 0;
  for (const tr of trs.slice(headIdx + 1)) {
    // trs שהם קוד JS — לא נתונים, וזה השקט שבהם שמסוכן.
    if (/TxtXml|contentWindow|\+"/.test(tr)) { skipped += 1; continue; }
    const c = cellsOf(tr);
    if (c.length < head.length - 1 || !/^\d/.test(c[0] ?? '')) { skipped += 1; continue; }
    n += 1;
    lines.push([n, ...c].map(q).join(','));
  }
  if (!n) throw new Error('אף שורת נתונים לא זוהתה.');

  writeFileSync(destFile, `﻿${lines.join('\r\n')}\r\n`, 'utf8');
  return { rows: n, skipped, warehouses: names, dest: destFile };
}

const argv = process.argv.slice(2);
if (basename(process.argv[1] ?? '') === 'matrix-html-to-csv.js') {
  const src = resolve(ROOT, argv[0] ?? 'data/exports/מטריצת-מחסנים.html');
  const dest = resolve(ROOT, argv[1] ?? src.replace(/\.html$/i, '.csv').replace(/data[\\/]exports/, 'content'));
  const r = convert(src, dest);
  console.log(`הומר: ${r.rows} שורות · דולגו ${r.skipped}`);
  console.log(`מחסנים: ${r.warehouses.join(' · ')}`);
  console.log(`נכתב: ${r.dest}`);
}
