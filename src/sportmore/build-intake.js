/**
 * The intake file — `קובץ טעינת חן זיווה`, sheet `TY96`.
 *
 * This is the last step, and the only one that must not run early: it tells
 * Sport & More to book stock against items that must already exist in their
 * Priority. So the builder re-checks every row against a **fresh** item card
 * and refuses the whole file if even one barcode is missing. A partial intake
 * is worse than none — the missing lines fail quietly on their side.
 *
 * Column 3 carries the full child code (`AR` + style + colour + `00` + size),
 * per Dror. Column 9, the second column also headed מקט, stays empty.
 * Columns 6, 12, 13 and 15 stay empty too.
 *
 * Columns 7, 8 and 14 (מחסן · מספר סניף · תאריך) come pre-filled down all 765
 * rows of the template. Warehouse is overwritten because it is Dror's call per
 * batch; branch and date are overwritten from the invoice so a template that
 * was prepared weeks ago cannot stamp the wrong date on a live load.
 */
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { childSku } from './arena-invoice.js';
import { writeXlsFromTemplate, assertExcelAvailable } from './xls-com.js';

const TEMPLATE = resolve(ROOT, 'sportmore/reference/template-intake-TY96.xls');

export const INTAKE_COLUMNS = {
  invoiceNo: 1,
  supplier: 2,
  sku: 3,          // the full child code
  qty: 4,
  cost: 5,
  customerOrder: 6,   // left empty
  warehouse: 7,
  branch: 8,
  sku2: 9,            // left empty
  size: 10,
  color: 11,
  targetBranch: 12,   // left empty
  details: 13,        // left empty
  date: 14,
  purchaseOrder: 15,  // left empty
};

export const WAREHOUSES = ['SHIP', 'DROR'];

/**
 * הספק תלוי במחסן — שני מספרים, לא אחד.
 *
 * ⛔ נמדד 17/09/2026 בתבנית של זיוה עצמה (`template-intake-TY96.xls`,
 * Last Saved By: Ziva dilmoni). שתי שורות הדוגמה שהיא השאירה בקובץ:
 *
 *     שורה 2   ספק 3100310055   מחסן SHIP
 *     שורה 5   ספק 3100310062   מחסן DROR
 *
 * אלה **שני קודי הספק היחידים בקובץ**, כל אחד פעם אחת, ואומתו ברמת הבייטים:
 * שתי רשומות NUMBER בעמודה 2, מול תא מחסן באותה שורה (SHIP הוא 762 שורות
 * בעמודה 7, DROR שתיים — 4 ו-5).
 *
 * עד כאן הקוד כתב `3100310055` קבוע, כלומר **קובץ ל-DROR יצא עם הספק של
 * האונייה**. זה נכתב בשקט: הקובץ תקין לגמרי, הסחורה נזקפת לחשבון הלא נכון.
 *
 * ⚠️ מחסן בלי קוד ספק הוא סירוב, לא נפילה לברירת מחדל — ברירת מחדל כאן היא
 * בדיוק הבאג שהערך הקבוע יצר.
 */
function supplierFor(codes, warehouse) {
  const table = codes.constants?.supplierByWarehouse ?? {};
  const code = table[warehouse];
  if (!code) {
    throw new Error(
      `אין קוד ספק למחסן ${warehouse}. הידועים: `
      + (Object.entries(table).map(([w, c]) => `${w}=${c}`).join(' · ') || 'אין')
      + '\nהקודים נלקחים מ-sportmore/reference/codes.json (supplierByWarehouse).'
    );
  }
  return code;
}

/** `dd/mm/yy`, the format the template's column 14 is already set to. */
function ddmmyy(d) {
  if (!(d instanceof Date)) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(-2)}`;
}

/**
 * שלוש קטגוריות, לא שתיים — וההבחנה היא כל ההבדל בין מנה שרצה בפעם אחת לבין
 * מנה שנתקעת.
 *
 * הבקרה אצלם **אנושית**: מי שמקים את הפריטים הוא זה שמאשר, ורק אחרי זה מריצים
 * את הרכש. לכן שורה שטרם בכרטיס אך **נמצאת בקובץ ההקמה שיצא באותה מנה** אינה
 * שגיאה — היא פשוט מקדימה את הכרטיס, ומסומנת באדום כדי שהאדם שם יראה אותה.
 *
 * ⛔ אבל שורה `blocked` — ברקוד שאין לו אב, שקיים תחת אב אחר, או שאין לו ברקוד
 * בכלל — **עדיין עוצרת הכל.** היא לא בכרטיס ולא בקובץ ההקמה, כלומר איש לא הקים
 * אותה ואיש לא עומד להקים. קובץ רכש שיוצא איתה נכשל אצלם בשקט, שורה-שורה,
 * וזה הכישלון שהשער הזה נבנה בשבילו מלכתחילה.
 *
 * מקבל את שורות ה-`plan` (ולא שורות חשבונית גולמיות), כי שם כבר נגזר הברקוד
 * הנכון — כולל הברקוד המקודד-עצמית של מוצרי קוסטומייז, שאין לו `ean` משלו.
 */
export function verifyAgainstCard(planRows) {
  const ready = [];
  const pending = [];
  const blocked = [];
  for (const p of planRows) {
    if (p.status === 'exists') ready.push(p);
    else if (p.status === 'newChild' || p.status === 'newBoth') pending.push(p);
    else blocked.push(p);
  }
  return { ready, pending, blocked };
}

/**
 * מספר החשבונית שנכנס לעמודה 1 — `DocumentNo`, ולא `Bill. Doc.`.
 *
 * דרור אישר ב-17/09/2026: זה המספר שלפיו מקימים **חשבונית רכש**. `Bill. Doc.`
 * (`91439982`) הוא מספר פנימי של SAP אצל ארנה ואינו מזוהה אצל ספורט אנד מור.
 *
 * ⛔ **חסר → סירוב, לא נפילה ל-`Bill. Doc.`.** נפילה חזרה הייתה משחזרת בדיוק
 * את הבאג: קובץ תקין למראה, עם מספר חשבונית שזיוה לא מוצאת.
 */
function invoiceNumberFor(row) {
  const n = String(row.documentNo ?? '').trim();
  if (n) return n;
  // ⚠️ ולא כל ייצוא של ארנה ממלא את העמודה הזאת. נמדד על הייצוא של 28/05:
  // `DocumentNo` ריק ב-114/114 השורות, והמספר בסגנון `1200…` יושב דווקא
  // ב-`Sales Doc.` (`1200807413`). אותו דוח, הרצות שונות — בדיוק כמו סדר
  // העמודות. לכן הסירוב **נוקב בשלושת המועמדים**, כדי שהתשובה תהיה מיידית
  // ולא תדרוש לפתוח את הקובץ.
  throw new Error(
    `שורה ${row.row}: חסר DocumentNo — זה מספר החשבונית שקובץ הרכש נבנה לפיו.\n`
    + 'המספרים שכן יש בשורה:\n'
    + `  DocumentNo  = ${row.documentNo || '(ריק)'}   ← זה מה שצריך\n`
    + `  Bill. Doc.  = ${row.billDoc || '(ריק)'}   ← מספר פנימי של ארנה, לא מזוהה אצל ספורט אנד מור\n`
    + `  Sales Doc.  = ${row.salesDoc || '(ריק)'}   ← בייצוא של 28/05 המספר הנכון ישב דווקא כאן\n`
    + 'לשאול את דרור איזה מהם, ולא לנחש — המספר מזהה חשבונית אמיתית אצל זיוה.'
  );
}

/**
 * השורות שייכתבו לקובץ — **בלי לכתוב אותו**, ובלי לדרוש אקסל.
 *
 * הופרד מ-`buildIntakeFile` ב-17/09/2026 כדי שאפשר יהיה להראות לדרור את התוכן
 * המדויק לפני השליחה לזיוה. ⚠️ **וזו הנקודה כולה: אותה פונקציה בדיוק מזינה את
 * התצוגה ואת הקובץ.** תצוגה מקדימה שמחשבת את השורות בעצמה יכולה להראות דבר
 * אחד בזמן שהקובץ נושא אחר — בדיוק הכשל ששורת הסיכום של הספק נפלה בו.
 *
 * ובנוסף: `.xls` ישן נכתב רק דרך COM של אקסל, כלומר רק על ווינדוס. ההפרדה
 * מאפשרת לבדוק את התוכן, ולהריץ עליו רגרסיה, בכל סביבה.
 */
export function intakeCells({ planRows, warehouse, codes }) {
  if (!WAREHOUSES.includes(warehouse)) {
    throw new Error(`מחסן לא מוכר: ${warehouse} — צריך ${WAREHOUSES.join(' או ')}`);
  }

  const { ready, pending, blocked } = verifyAgainstCard(planRows);
  if (blocked.length) {
    const sample = blocked.slice(0, 8).map((b) => `  שורה ${b.row.row}: ${b.row.ean} — ${b.row.articleNumber} — ${b.why}`);
    throw new Error(
      `${blocked.length} מתוך ${planRows.length} שורות חסומות — קובץ הקליטה לא נכתב.\n` +
        'שורה חסומה אינה בכרטיס ואינה בקובץ ההקמה, כלומר איש לא יקים אותה.\n' +
        sample.join('\n') +
        (blocked.length > 8 ? `\n  ...ועוד ${blocked.length - 8}` : '')
    );
  }

  // הסדר נשמר כסדר החשבונית, כדי שמספרי השורות בדוח יתאימו לקובץ.
  const all = [...ready, ...pending].sort((a, b) => (a.row.row ?? 0) - (b.row.row ?? 0));
  const highlightRows = all.map((p, i) => (pending.includes(p) ? i : -1)).filter((i) => i >= 0);

  const C = INTAKE_COLUMNS;
  const supplier = supplierFor(codes, warehouse);
  /**
   * ⚠️ **רק הצד הימני של הגיליון, ועוד התאריך** — הכרעת דרור, 17/09/2026.
   *
   * ממולאות: `מספר חשבונית` · `ספק` · `מקט` · `כמות` · `מחיר עלות` · `תאריך`.
   * כל השאר **מנוקה במפורש**, כולל `מחסן` · `מספר סניף` · `גודל` · `צבע`.
   *
   * ⛔ והניקוי חייב להיות מפורש ולא השמטה: התבנית מגיעה עם `מחסן`, `מספר סניף`
   * ו-`תאריך` **ממולאים מראש עד שורה 765**, ולכן עמודה שלא נכתבת נשארת עם
   * הערך של התבנית. "לא למלא" כאן פירושו לכתוב ריק.
   *
   * ⚠️ **והמחסן לא הולך לאיבוד** — `supplier` נגזר ממנו (`3100310055` לאונייה,
   * `3100310062` לדרור), כך שהיעד עדיין מקודד בשורה.
   *
   * זהו מצב **זמני עד שזיוה תאשר**: היא ביקשה טופס מלא ואנחנו מצמצמים אותו,
   * ולכן מה שחוזר ממנה גובר על השורות האלה.
   */
  const BLANK = '';
  const cells = all.map(({ row }) => ({
    [C.invoiceNo]: invoiceNumberFor(row),
    [C.supplier]: supplier,
    [C.sku]: childSku(row),
    [C.qty]: row.qty,
    [C.cost]: row.price,
    [C.date]: ddmmyy(row.date),
    // מנוקות במפורש — ראה למעלה.
    [C.customerOrder]: BLANK,
    [C.warehouse]: BLANK,
    [C.branch]: BLANK,
    [C.sku2]: BLANK,
    [C.size]: BLANK,
    [C.color]: BLANK,
    [C.targetBranch]: BLANK,
    [C.details]: BLANK,
    [C.purchaseOrder]: BLANK,
  }));

  return { cells, highlightRows, pending, supplier, warehouse };
}

export async function buildIntakeFile({ planRows, warehouse, out, codes }) {
  assertExcelAvailable();

  const { cells, highlightRows, pending } = intakeCells({ planRows, warehouse, codes });
  const file = resolve(ROOT, out);
  writeXlsFromTemplate({
    template: TEMPLATE,
    out: file,
    rows: cells,
    startRow: 2,
    // Barcodes are gone by here, but codes, sizes, branch and colour are all
    // digit strings that Excel would happily turn into numbers and shorten.
    textCols: [C.invoiceNo, C.supplier, C.sku, C.branch, C.size, C.color, C.date],
    highlightRows,
  });
  return {
    file,
    rows: cells.length,
    warehouse,
    // `flagged` חוזר כדי שמי שמריץ יידע מה נכתב אדום **בלי לפתוח את הקובץ** —
    // וכדי שההודעה לספורט אנד מור תוכל לומר את זה במפורש.
    flagged: pending.map((p) => ({
      row: p.row.row,
      ean: p.barcode,
      articleNumber: p.row.articleNumber,
      why: p.why,
    })),
  };
}

export { TEMPLATE as INTAKE_TEMPLATE };
