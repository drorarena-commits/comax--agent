/**
 * שער המאסטר — לוודא שהדגם והצבע של כל שורת הקמה כבר קיימים בקומקס.
 *
 * בקומקס `דגם` ו`צבע` הם ישויות מאסטר נפרדות מהפריט. פריט שנקלט עם קוד שמעולם
 * לא הוקם — יידחה, או גרוע מזה ייצור ערך יתום שאיש לא יחפש. לכן לפני שנוגעים
 * במסך היבוא, כל קוד בקובץ ההקמה נבדק מול הקטלוג שייצאנו מקומקס.
 *
 * קריאה בלבד. לא נוגע בקומקס.
 *
 * ⚠️ הקריאה מהקטלוג היא **לפי מיקום** (`KCOL`) ולא לפי תווית — בייצוא של קומקס
 *    העמודה שכותרתה `מידה` מחזיקה את הצבע, ו`מותג` מחזיקה את המידה.
 *    אומת על פריט 3468336214763: עמודה 16 = 390 (צבע), עמודה 18 = Os (מידה).
 */
import { KCOL, IMPORT_HEADERS } from './build-import.js';
import { readLedger, pruneLedger } from './master-ledger.js';

const strip = (s) => String(s ?? '').trim().replace(/^0+/, '');

/**
 * אינדקס הערכים שכבר קיימים בקטלוג קומקס.
 * @param {{head:string[], rows:string[][]}} K הקטלוג, כפי ש-`loadCsv` מחזיר
 */
export function masterIndex(K) {
  const models = new Set();
  const colors = new Set();
  const pairs = new Set();
  const modelName = new Map();
  const colorName = new Map();

  for (const r of K.rows) {
    const model = String(r[KCOL.model] ?? '').trim();
    const color = String(r[KCOL.color] ?? '').trim();
    if (model) {
      models.add(model);
      if (!modelName.has(model)) modelName.set(model, String(r[KCOL.modelName] ?? '').trim());
    }
    if (color) {
      colors.add(color);
      // עמודה 17 היא "שם צבע". בקודים הישנים היא זהה לקוד עצמו.
      if (!colorName.has(color)) colorName.set(color, String(r[17] ?? '').trim());
    }
    if (model && color) pairs.add(`${model}|${color}`);
  }

  // ── היומן: מה שהקמנו בקומקס ועוד לא הופיע בייצוא ──────────────────────────
  // ייצוא הפריטים מכיר רק ערכים שבשימוש, וצבע חדש עם 0 פריטים אינו בו. היומן
  // מגשר על החלון שבין ההקמה לייצוא הבא — ראו src/items/master-ledger.js.
  const inExport = { models: new Set(models), colors: new Set(colors) };
  pruneLedger(inExport);                       // מה שכבר בייצוא יורד מהיומן
  const ledger = readLedger();
  const fromLedger = { models: new Set(), colors: new Set() };
  for (const e of ledger.models) if (!models.has(e.code)) { models.add(e.code); fromLedger.models.add(e.code); }
  for (const e of ledger.colors) if (!colors.has(e.code)) { colors.add(e.code); fromLedger.colors.add(e.code); }

  return { models, colors, pairs, modelName, colorName, fromLedger };
}

/**
 * מריץ את השער על שורות ההקמה.
 *
 * `missingColors` הוא **כל מה שצריך להקים** — כולל קוד שיש לו דומה בקומקס
 * (`075` מול `75`). דרור הכריע 07/09/2026 שאלה שתי רשומות שונות ושהחסרות יוקמו.
 * השדה `existsAs` נשאר כ**אזהרה**, לא כפטור: מי שמקים את `075` צריך לדעת ש-`75`
 * יושב שם ונראה כמותו, כדי לא לבחור בו בטעות. `lookalikes` הוא אותה רשימה
 * לצורך הצבעה בגיליון.
 *
 * @param {string[][]} rows שורות ההקמה, בלי הכותרת, בסדר של IMPORT_HEADERS
 * @param {{head:string[], rows:string[][]}} K הקטלוג של קומקס
 */
export function masterGate(rows, K, { parentLen = new Map() } = {}) {
  const idx = masterIndex(K);
  const iModel = IMPORT_HEADERS.indexOf('דגם');
  const iColor = IMPORT_HEADERS.indexOf('צבע');
  const iName = IMPORT_HEADERS.indexOf('שם פריט');
  const iBarcode = IMPORT_HEADERS.indexOf('ברקוד');

  const missModels = new Map();
  const missColors = new Map();
  let affectedRows = 0;

  // מפתח משני: הקוד בלי אפסים מובילים ⇒ הצורה שקיימת בקומקס בפועל.
  const byStrippedColor = new Map();
  for (const c of idx.colors) if (!byStrippedColor.has(strip(c))) byStrippedColor.set(strip(c), c);

  const bump = (map, code, name, existsAs = '') => {
    const e = map.get(code) ?? { code, count: 0, sampleName: name, existsAs };
    e.count += 1;
    map.set(code, e);
    return e;
  };

  for (const r of rows) {
    const model = String(r[iModel] ?? '').trim();
    const color = String(r[iColor] ?? '').trim();
    const name = String(r[iName] ?? '').trim();
    let hit = false;

    if (model && !idx.models.has(model)) {
      const e = bump(missModels, model, name);
      // 💣 דגם חסר שנגזר מקוד באורך חריג הוא כמעט תמיד **חיתוך שגוי, לא דגם
      //    שצריך להקים**. `פריט מרכז/דגם` הוא שרשור בלי מפריד, והקוד חותך
      //    במקום 6 — נכון רק כשהאורך 9. בלי הסימון הזה ההודעה אומרת "דגם
      //    219390 חסר, תקים אותו", ומי שיעזור יקים דגם מומצא. זה הרגע שבו
      //    החוב הופך לנזק. ראו MAP.md, "חיתוך הדגם והצבע".
      const src = parentLen.get(String(r[iBarcode] ?? '').trim());
      if (src && src.len !== 9) {
        e.suspectSplit = true;
        e.parentRaw = src.raw;
        e.parentLen = src.len;
      }
      hit = true;
    }
    if (color && !idx.colors.has(color)) {
      // `existsAs` הוא הדומה שכבר יושב בקומקס — אזהרה למי שמקים, לא פטור.
      bump(missColors, color, name, byStrippedColor.get(strip(color)) ?? '');
      hit = true;
    }
    if (hit) affectedRows += 1;
  }

  const byCode = (a, b) => a.code.localeCompare(b.code);
  const missingColors = [...missColors.values()].sort(byCode);
  const missingModels = [...missModels.values()].sort(byCode);
  return {
    missingModels,
    // הדגמים שכנראה אינם חסרים אלא חתוכים לא נכון — אלה שאין להקים.
    suspectSplit: missingModels.filter((m) => m.suspectSplit),
    missingColors,
    lookalikes: missingColors.filter((c) => c.existsAs),
    affectedRows,
    totalRows: rows.length,
    // מה שהוכר בזכות היומן ולא בזכות הייצוא — כדי שהדיווח יגיד זאת במפורש.
    fromLedger: {
      models: [...idx.fromLedger.models],
      colors: [...idx.fromLedger.colors],
    },
  };
}

/** העמודות של גיליון "מאסטר חסר". */
export const MASTER_HEADERS = ['סוג', 'קוד', 'כמה פריטים', 'דוגמת שם פריט', 'קיים בצורה אחרת'];

/** ממיר את תוצאת השער לשורות הגיליון, ולסט השורות שיש לצבוע. */
export function masterSheet(gate) {
  const rows = [];
  const highlight = new Set();
  for (const m of gate.missingModels) rows.push(['דגם', m.code, m.count, m.sampleName, '']);
  for (const c of gate.missingColors) {
    // צהוב = יש בקומקס קוד דומה. להקים בכל זאת, אבל בעיניים פקוחות.
    if (c.existsAs) highlight.add(rows.length);
    rows.push(['צבע', c.code, c.count, c.sampleName, c.existsAs]);
  }
  return { rows, highlight };
}
