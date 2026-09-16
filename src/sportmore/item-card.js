/**
 * The Sport & More item card — the only source of truth for "does this already
 * exist". Nothing here touches Comax; Sport & More run Priority, we have no
 * access to it, and the single channel between us is the Excel they email over.
 *
 * The card is one flat `DataSheet` holding parents and children in the same
 * 196-column table. What separates them is a single column:
 *
 *   פריט מרכז? = Y   → a parent (מוצר אב).  מק"ט is `AR` + style + color,
 *                      the ברקוד column repeats that code, and סרגל מידות is set.
 *   פריט מרכז? empty → a child (מוצר בן).  פריט מרכז/דגם points at the parent,
 *                      ברקוד is the real EAN13, צבע is always `00` and מידה
 *                      carries the size.
 *
 * The child's own מק"ט is built by Priority and must never be reconstructed
 * here: 1,546 of the 2,636 children in the 25.8.26 card do not follow
 * parent+color+size. Children are therefore matched by **barcode**, which is the
 * one identifier both sides of the exchange agree on.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ROOT } from '../config.js';

export const REFERENCE_DIR = resolve(ROOT, 'sportmore/reference');

/**
 * השדות שהקורא צריך, לפי **טקסט הכותרת** ולא לפי מיקום.
 *
 * ⚠️ המיקומים אינם יציבים. עד 16/09/2026 המיפוי היה אותיות קבועות — `תאור` ב-B,
 * `ברקוד` ב-C — וזה עבד כל עוד הכרטיס הגיע מאותו מייצא. הכרטיס של 16/09 הגיע
 * ממייצא אחר, ומתוך 22 השדות **עשרים זזו**: `תאור` ל-D, `ברקוד` ל-E,
 * `פריט מרכז/דגם` מ-W ל-C, `סרגל מידות` מ-AA ל-O. רק `מק"ט` ו-`פריט מרכז?`
 * נשארו במקומם.
 *
 * וזה לא היה נראה כמו תקלה: הקריאה הייתה מצליחה ומחזירה 3,370 שורות, כשהתיאור
 * מכיל מחיר והברקוד מכיל קוד דגם. כרטיס הפריט הוא המקור היחיד ל"מה כבר קיים",
 * ולכן קריאה בעמודות הלא נכונות הייתה מקימה מחדש פריטים שכבר קיימים.
 *
 * זו בדיוק המסקנה ש-`arena-invoice.js` הגיע אליה לפניו, מאותה סיבה.
 *
 * **ולמה זה יקרה שוב:** סידור העמודות בדוח בפריוריטי **נשמר לכל משתמש בנפרד**.
 * הכרטיס של 25/08 הגיע מאלינה ושל 16/09 מרויטל, וההבדל בפורמט הקובץ עצמו מלמד
 * שהן גם מייצאות דרך מנגנון שונה. כלומר המיפוי לפי כותרת אינו הוראת שעה לקובץ
 * אחד חריג — **כל נציגה חדשה אצלם תייצר סידור חדש**, ובלי המיפוי הזה כל החלפה
 * כזאת הייתה קריאה שקטה בעמודות הלא נכונות.
 */
const HEADERS = {
  sku: 'מק"ט',
  desc: 'תאור',
  barcode: 'ברקוד',
  status: 'סטטוס',
  family: 'משפחת מוצר/קוד מיון',
  familyName: 'תאור משפחה',
  isParent: 'פריט מרכז?',
  parent: 'פריט מרכז/דגם',
  supplier: 'ספק מועדף',
  sizeScale: 'סרגל מידות',
  sizeScaleName: 'שם סרגל מידות',
  model: 'דגם1',
  color: 'צבע2',
  size: 'מידה3',
  supplierSku: 'פריט מקביל',
  division: 'דיויזן12',
  divisionName: 'תאור פרמטר 12 למוצר',
  gender: 'מגדר13',
  genderName: 'תאור פרמטר 13 למוצר',
  season: 'עונה/שנה14',
  sport: 'ספורט ענף17',
  department: 'במחסן מחלקה19',
};

/** בלי אלה אי אפשר לענות על "מה כבר קיים", ולכן היעדרם הוא סירוב ולא אזהרה. */
const REQUIRED = ['sku', 'barcode', 'isParent', 'parent'];

const SPREADSHEETML_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** Cell text, flattened. ExcelJS hands back objects for rich text and formulas. */
function text(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v).trim();
}

/**
 * פותח את חוברת העבודה, גם כשה-XML שלה נושא קידומת namespace.
 *
 * ExcelJS מצפה ל-`<workbook>` ו-`<sheets>` בלי קידומת. המייצא של הכרטיס מ-16/09
 * (חתימה של ClosedXML/EPPlus ודומיהם) כותב `<x:workbook><x:sheets>` עם
 * `xmlns:x` — קובץ חוקי לגמרי, ש-ExcelJS מחזיר עליו
 * `Cannot read properties of undefined (reading 'sheets')`.
 *
 * הפתרון הוא **להמיר את ה-XML לפני הקריאה**, ולא לעקוף את ExcelJS: הקידומת
 * שמוסרת היא רק זו שקשורה ל-namespace של spreadsheetml, ו-`r:` של הקשרים נשאר
 * במקומו — בלעדיו אבד הקישור בין הגיליון לחוברת.
 *
 * ⛔ אין כאן ניסיון-וטעייה: המקרה **מזוהה** לפי ה-namespace ורק אז מומר, כדי
 * שכישלון אמיתי ייראה ככישלון ולא ייבלע בניסיון שני.
 *
 * `sharedStrings.xml` ו-`docProps/` חסרים באותו קובץ. זו אינה אנומליה — מייצא
 * שאינו Excel כותב מחרוזות inline (`t="inlineStr"`) ולא טבלת מחרוזות משותפת —
 * ו-ExcelJS מטפל בשניהם לבד ברגע שה-namespace נפתר.
 */
async function openSheet(file) {
  const wb = new ExcelJS.Workbook();
  try {
    const zip = await JSZip.loadAsync(readFileSync(file));
    let rewritten = 0;
    for (const path of Object.keys(zip.files)) {
      if (!path.endsWith('.xml')) continue;
      const xml = await zip.file(path).async('string');
      const m = new RegExp(`xmlns:([A-Za-z0-9_]+)="${SPREADSHEETML_MAIN}"`).exec(xml);
      if (!m) continue;
      const p = m[1];
      zip.file(path, xml
        .split(`<${p}:`).join('<')
        .split(`</${p}:`).join('</')
        .split(`xmlns:${p}="${SPREADSHEETML_MAIN}"`).join(`xmlns="${SPREADSHEETML_MAIN}"`));
      rewritten++;
    }
    if (rewritten) await wb.xlsx.load(await zip.generateAsync({ type: 'nodebuffer' }));
    else await wb.xlsx.readFile(file);
  } catch (e) {
    // ⛔ ההודעה נוקבת בקובץ. "Cannot read properties of undefined" אינו אומר
    // איזה קובץ נכשל, וכשהקורא בוחר לבד את החדש ביותר זו בדיוק השאלה.
    throw new Error(`נכשלה קריאת "${basename(file)}": ${e.message.split('\n')[0]}`);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`"${basename(file)}" נפתח אבל אין בו אף גיליון.`);
  return ws;
}

/** שורת הכותרת ⇐ מספר עמודה לכל שדה. כותרת חסרה היא סירוב, לא ניחוש. */
function mapColumns(ws, file) {
  const byHeader = new Map();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, n) => {
    const t = text(cell);
    if (t && !byHeader.has(t)) byHeader.set(t, n);
  });

  const idx = {};
  const missing = [];
  for (const [field, header] of Object.entries(HEADERS)) {
    const n = byHeader.get(header);
    if (n) idx[field] = n;
    else if (REQUIRED.includes(field)) missing.push(`${field} ("${header}")`);
  }
  if (missing.length) {
    throw new Error(
      `ב-"${basename(file)}" חסרות כותרות חובה: ${missing.join(' · ')}.\n` +
        'הכותרות נקראות לפי טקסט ולא לפי מיקום, כי המיקומים משתנים בין מייצאים.\n' +
        'אם ספורט אנד מור שינו את שם הכותרת — לעדכן את HEADERS ב-src/sportmore/item-card.js.'
    );
  }
  return idx;
}

/**
 * The newest `item-card-*.xlsx` in sportmore/reference/, or an explicit path.
 *
 * ⚠️ הבחירה "החדש ביותר" נעשית בשקט, ולכן **כל קובץ שנוחת בתיקייה הזאת משנה
 * התנהגות בלי שאף אחד יידע**. נמדד 16/09/2026: הורדה של כרטיס טרי בסשן מקביל
 * הפילה את `npm run sm-test` מיד, והשגיאה שיצאה לא הזכירה שום שם קובץ. לכן
 * הבחירה נכתבת ל-stderr — שורה אחת, עם מספר המועמדים.
 */
export function resolveItemCard(explicit, { quiet = false } = {}) {
  if (explicit) {
    const p = resolve(ROOT, explicit);
    if (!existsSync(p)) throw new Error(`כרטיס הפריט לא נמצא: ${explicit}`);
    return p;
  }
  if (!existsSync(REFERENCE_DIR)) throw new Error(`אין תיקיית ${REFERENCE_DIR}`);
  const files = readdirSync(REFERENCE_DIR)
    .filter((f) => /^item-card-.*\.xlsx$/i.test(f))
    .map((f) => resolve(REFERENCE_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files.length) {
    throw new Error(
      'אין כרטיס פריט ב-sportmore/reference/.\n' +
        'צריך קובץ בשם item-card-<תאריך>.xlsx — זה הקובץ שספורט אנד מור שולחים,\n' +
        'והוא המקור היחיד ל"מה כבר קיים". בלעדיו אין בדיקת קיום ואין הקמה.'
    );
  }
  // מתריע רק כשהייתה כאן **בחירה**. עם כרטיס אחד אין מה לגלות, ועם שניים
  // ומעלה זו בדיוק הנקודה שבה קובץ שנחת בתיקייה משנה התנהגות בשקט.
  if (!quiet && files.length > 1) {
    console.error(`⚠  ${files.length} כרטיסי פריט בתיקייה — נבחר ${basename(files[0])} (החדש ביותר).`);
  }
  return files[0];
}

/**
 * Load the card into two indexes: parents by מק"ט, children by barcode.
 *
 * Both keys are upper-cased and stripped of whitespace. One parent in the
 * 25.8.26 card is written `*AR010810509` with a leading asterisk — a one-off
 * typo, not a convention (1 row out of 3,380) — so a leading `*` is trimmed on
 * both the key and the `parent` back-reference, or that parent's six children
 * would look orphaned.
 */
export async function loadItemCard(explicit, { quiet = false } = {}) {
  const file = resolveItemCard(explicit, { quiet });
  const ws = await openSheet(file);
  const IDX = mapColumns(ws, file);
  // שדה לא-חובה שהמייצא הבא ישמיט פשוט יחזור ריק, במקום להפיל את הקריאה.
  const get = (row, n) => (n ? text(row.getCell(n)) : '');

  const parents = new Map();
  const byBarcode = new Map();
  const childrenOfParent = new Map();
  let rows = 0;

  ws.eachRow((row, n) => {
    if (n === 1) return;
    const sku = norm(get(row, IDX.sku));
    if (!sku) return;
    rows++;
    const rec = {
      sku,
      desc: get(row, IDX.desc),
      barcode: norm(get(row, IDX.barcode)),
      status: get(row, IDX.status),
      family: get(row, IDX.family),
      familyName: get(row, IDX.familyName),
      isParent: get(row, IDX.isParent).toUpperCase() === 'Y',
      parent: norm(get(row, IDX.parent)),
      sizeScale: get(row, IDX.sizeScale),
      sizeScaleName: get(row, IDX.sizeScaleName),
      color: get(row, IDX.color),
      size: get(row, IDX.size),
      supplierSku: get(row, IDX.supplierSku),
      division: get(row, IDX.division),
      gender: get(row, IDX.gender),
      season: get(row, IDX.season),
      sport: get(row, IDX.sport),
      department: get(row, IDX.department),
      row: n,
    };
    if (rec.isParent) {
      parents.set(sku, rec);
    } else if (rec.parent) {
      if (!childrenOfParent.has(rec.parent)) childrenOfParent.set(rec.parent, []);
      childrenOfParent.get(rec.parent).push(rec);
    }
    if (rec.barcode) byBarcode.set(rec.barcode, rec);
  });

  // אב שנגזר מהבנים שלו ואין לו שורה משלו בכרטיס.
  //
  // ⛔ **אינו נספר כקיים.** הפיתוי הוא לומר "יש לו שישה בנים, ברור שהוא קיים
  // והייצוא פספס שורה" — וזו מסקנה, לא נתון. נמדד 16/09/2026: ששת הבנים של
  // AR010810509 התייתמו כי אצלם **מחקו** את שורת האב, שהייתה כתובה
  // `*AR010810509` עם כוכבית, במקום לתקן אותה. כלומר בדיוק ההפך: ייתכן שהאב
  // אצלם אינו תקין ולא הוקם מחדש.
  //
  // שתי מסקנות אפשריות מאותו נתון ⇒ הסוכן מציג את הנתון ואינו בוחר מסקנה.
  // האב נגזר, נרשם כשאלה פתוחה, וההרצה ממשיכה.
  const orphanParents = new Map();
  for (const kid of byBarcode.values()) {
    if (kid.isParent || !kid.parent || parents.has(kid.parent)) continue;
    if (!orphanParents.has(kid.parent)) orphanParents.set(kid.parent, []);
    orphanParents.get(kid.parent).push(kid);
  }

  const age = cardAgeDays(file);
  return { file, rows, parents, byBarcode, childrenOfParent, orphanParents, ageDays: age, columns: IDX };
}

/** Trim, upper-case, and drop the stray leading `*` seen on one parent. */
export function norm(s) {
  return String(s ?? '').trim().replace(/^\*/, '').toUpperCase();
}

/**
 * How stale the card is, in days.
 *
 * Taken from the `item-card-YYYY-MM-DD` in the filename, not from mtime: copying
 * the file between the two machines resets mtime, which would make a card from
 * May look like it arrived today. mtime is only the fallback for a card whose
 * name carries no date.
 *
 * ⚠️ מספר, לא שיפוט. **כלל ה-30 יום ירד** (16/09/2026): הוא היה ניחוש, ומה
 * שמיישן כרטיס הוא אירוע ולא זמן — ראה `src/sportmore/card-status.js`.
 */
export function cardAgeDays(file) {
  const name = basename(file);
  const m = /item-card-([0-9]{4})-([0-9]{2})-([0-9]{2})/i.exec(name);
  const when = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : statSync(file).mtimeMs;
  return Math.max(0, Math.floor((Date.now() - when) / 86_400_000));
}

export { HEADERS as ITEM_CARD_HEADERS };
