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
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { parentSku } from './arena-invoice.js';

const TEMPLATE = resolve(ROOT, 'sportmore/reference/template-parent-child.xlsx');

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
    set(P.supplier, Number(k.supplier));
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
    // Barcodes are 13 digits — as a number Excel shows 3.46834E+12 and the
    // other side loses the item. Text, always.
    r.getCell(C.barcode).value = String(row.ean);
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
