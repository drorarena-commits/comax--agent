/**
 * The setup file sent to Sport & More — `הקמה ארנה <עונה> <תאריך> - מוצרי אב ובנים`.
 *
 * Built by **filling a copy of the template**, never by composing a new
 * workbook. The header row carries trailing spaces, embedded newlines and one
 * genuinely empty column (S), the sheet is right-to-left with a frozen header,
 * and the sheet names themselves are part of what the other side keys on.
 * Reproducing all that by hand is a standing invitation to a silent mismatch;
 * copying the template cannot drift.
 *
 * Column letters below are the template's, verified against the FW26 batch.
 * Note W is the currency and V the EUR cost — they are not adjacent to the
 * other price fields, and swapping them is an easy mistake to make from memory.
 */
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { parentSku, selfBarcode } from './arena-invoice.js';

const TEMPLATE = resolve(ROOT, 'sportmore/reference/template-parent-child.xlsx');
const THEME = resolve(ROOT, 'sportmore/reference/theme1.xml');

/**
 * ⛔ **התבנית חסרת `theme1.xml`, ו-exceljs מצהירה עליו בכל מקרה.**
 *
 * נמדד 17/09/2026, כשדרור פתח את הקובץ ואקסל שאל אם לשחזר אותו. הסיבה אינה
 * בתוכן: הפלט מצהיר על `xl/theme/theme1.xml` **בשני מקומות** —
 * `workbook.xml.rels` ו-`[Content_Types].xml` — ו**הקובץ עצמו אינו בתוך
 * ה-ZIP**. הפניה תלויה באוויר היא בדיוק מה שמדליק את דיאלוג התיקון.
 *
 * למה דווקא כאן: התבנית נשמרה בלי `theme1.xml` ובלי להצהיר עליו, ולכן היא
 * עצמה תקינה. exceljs כותבת את ההצהרה תמיד, אבל את החלק עצמו רק אם הוא נטען —
 * ומתבנית בלי theme לא נטען דבר. ⚠️ **וזה נגע בכל קובץ הקמה שהופק אי פעם**,
 * כולל מנת FW26; פשוט אף אחד לא אמר שאקסל שאל.
 *
 * ⚠️ ולא מוחקים את ההצהרה במקום להשלים את החלק: exceljs מוסיפה גם `theme="1"`
 * בתוך `styles.xml` (בתבנית אין), ולכן מחיקה הייתה משאירה סגנונות שמפנים
 * ל-theme שאינו קיים — החלפת תקלה גלויה בתקלה שקטה.
 */
function withTheme(wb) {
  if (!wb._themes || !wb._themes.theme1) {
    wb._themes = { ...(wb._themes ?? {}), theme1: readFileSync(THEME, 'utf8') };
  }
  return wb;
}

/** Parent sheet, by column letter. */
const P = {
  family: 'A',
  supplier: 'B',
  supplierSku: 'C',
  sku: 'D',
  desc: 'E',
  desc2: 'F',
  color: 'G',
  brand: 'H',
  division: 'I',
  gender: 'J',
  seasonYear: 'K',
  season: 'L',
  sport: 'N',
  department: 'P',
  sizeScale: 'R',
  basePrice: 'T',
  costEur: 'V',
  currency: 'W',
  elital: 'Y',
  wholesale: 'Z',
  chain: 'AB',
};

/** Child sheet: קוד דגם · צבע · מידה · ברקוד. */
const C = { parent: 'A', color: 'B', size: 'C', barcode: 'D' };

/** Wipe every row below the header, keeping the header and the sheet settings. */
function clearBody(ws) {
  for (let n = ws.rowCount; n >= 2; n--) ws.spliceRows(n, 1);
}

/**
 * @param {object[]} parents  `{ row, classification, price }` — one per new parent
 * @param {object[]} children `{ row }` — one per new child
 * @param {object} opts       `{ seasonYear, codes, out }`
 */
export async function buildSetupFile({ parents, children, seasonYear, codes, out }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  withTheme(wb);
  const [wsParents, wsChildren] = wb.worksheets;
  clearBody(wsParents);
  clearBody(wsChildren);

  const k = codes.constants;
  const season = String(seasonYear).slice(0, 2).toUpperCase();

  parents.forEach(({ row, classification, price }, i) => {
    const r = wsParents.getRow(i + 2);
    const set = (col, v) => {
      if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return;
      r.getCell(col).value = v;
    };
    set(P.family, classification.family.value);
    // ⚠️ `supplierPreferred` ולא `supplierByWarehouse`: זה **ספק מועדף בכרטיס
    // הפריט**, תכונה של הפריט עצמו. זוג הקודים SHIP/DROR הוא יעד המשלוח
    // ושייך לקובץ הרכש בלבד. פריט אחד, ספק מועדף אחד — גם אם הוא יגיע פעם
    // לאונייה ופעם לדרור. (3100310055, כפי שיצא במנת FW26.)
    set(P.supplier, Number(k.supplierPreferred));
    set(P.supplierSku, `${row.style}${row.colorCode}`);
    set(P.sku, parentSku(row));
    set(P.desc, row.styleDesc || row.articleDesc);
    set(P.desc2, row.styleDesc || row.articleDesc);
    set(P.color, k.color);
    set(P.brand, Number(k.brand));
    set(P.division, numberish(classification.division.value));
    set(P.gender, numberish(classification.gender.value));
    set(P.seasonYear, seasonYear);
    set(P.season, season);
    set(P.sport, k.sport);
    set(P.department, k.department);
    set(P.sizeScale, numberish(classification.sizeScale.value));
    set(P.basePrice, price.base);
    set(P.costEur, price.costEur);
    set(P.currency, k.currency);
    set(P.elital, k.elital);
    set(P.wholesale, price.wholesale);
    set(P.chain, price.chain);
    r.commit();
  });

  children.forEach(({ row }, i) => {
    const r = wsChildren.getRow(i + 2);
    r.getCell(C.parent).value = parentSku(row);
    r.getCell(C.color).value = k.color;
    r.getCell(C.size).value = String(row.size).toUpperCase();
    // A customised row has no barcode of its own; the planner has already ruled
    // that a derived one is allowed and checked it does not collide.
    // Either way it goes in as text: as a number Excel renders a 13-digit EAN
    // as 3.46834E+12 and the other side loses the item.
    const real = String(row.ean ?? '').trim();
    r.getCell(C.barcode).value = (row.hasBarcode ?? !!real) ? real : String(selfBarcode(row));
    r.getCell(C.barcode).numFmt = '@';
    r.commit();
  });

  const file = resolve(ROOT, out);
  await wb.xlsx.writeFile(file);
  return { file, parents: parents.length, children: children.length };
}

/** Size scales are a mix — `74`, `27`, but also `APP-AD` and `EURO`. */
function numberish(v) {
  if (v === null || v === undefined || v === '') return null;
  return /^\d+$/.test(String(v)) ? Number(v) : String(v);
}

export { P as SETUP_PARENT_COLUMNS, C as SETUP_CHILD_COLUMNS, TEMPLATE as SETUP_TEMPLATE };
