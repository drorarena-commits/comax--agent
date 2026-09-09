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

/** `dd/mm/yy`, the format the template's column 14 is already set to. */
function ddmmyy(d) {
  if (!(d instanceof Date)) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(-2)}`;
}

/**
 * Verify every invoice row exists as a child in the card.
 * Returns `{ ready, missing }` — `missing` non-empty means do not write.
 */
export function verifyAgainstCard(rows, card) {
  const ready = [];
  const missing = [];
  for (const row of rows) {
    const child = card.byBarcode.get(String(row.ean).trim());
    if (!child || child.isParent) {
      missing.push({ row, why: 'הברקוד לא קיים בכרטיס הפריט כמוצר בן' });
      continue;
    }
    ready.push({ row, child });
  }
  return { ready, missing };
}

export async function buildIntakeFile({ rows, card, warehouse, out, codes }) {
  if (!WAREHOUSES.includes(warehouse)) {
    throw new Error(`מחסן לא מוכר: ${warehouse} — צריך ${WAREHOUSES.join(' או ')}`);
  }
  assertExcelAvailable();

  const { ready, missing } = verifyAgainstCard(rows, card);
  if (missing.length) {
    const sample = missing.slice(0, 8).map((m) => `  שורה ${m.row.row}: ${m.row.ean} — ${m.row.articleNumber}`);
    throw new Error(
      `${missing.length} מתוך ${rows.length} שורות לא נמצאו בכרטיס הפריט — קובץ הקליטה לא נכתב.\n` +
        'הקליטה רצה רק אחרי שספורט אנד מור הקימו הכל ושלחו כרטיס פריט מעודכן.\n' +
        sample.join('\n') +
        (missing.length > 8 ? `\n  ...ועוד ${missing.length - 8}` : '')
    );
  }

  const C = INTAKE_COLUMNS;
  const k = codes.constants;
  const cells = ready.map(({ row }) => ({
    [C.invoiceNo]: row.invoiceNo || '',
    [C.supplier]: k.supplier,
    [C.sku]: childSku(row),
    [C.qty]: row.qty,
    [C.cost]: row.price,
    [C.warehouse]: warehouse,
    [C.branch]: k.branch,
    [C.size]: String(row.size).toUpperCase(),
    [C.color]: k.color,
    [C.date]: ddmmyy(row.date),
  }));

  const file = resolve(ROOT, out);
  writeXlsFromTemplate({
    template: TEMPLATE,
    out: file,
    rows: cells,
    startRow: 2,
    // Barcodes are gone by here, but codes, sizes, branch and colour are all
    // digit strings that Excel would happily turn into numbers and shorten.
    textCols: [C.invoiceNo, C.supplier, C.sku, C.branch, C.size, C.color, C.date],
  });
  return { file, rows: cells.length, warehouse };
}

export { TEMPLATE as INTAKE_TEMPLATE };
