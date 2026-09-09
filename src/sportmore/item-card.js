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
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

export const REFERENCE_DIR = resolve(ROOT, 'sportmore/reference');

/** Column letters in the card, by the header text they carry. */
const COL = {
  sku: 'A',
  desc: 'B',
  barcode: 'C',
  status: 'E',
  family: 'R',
  familyName: 'S',
  isParent: 'V',
  parent: 'W',
  parentDesc: 'X',
  supplier: 'Y',
  sizeScale: 'AA',
  sizeScaleName: 'AC',
  model: 'BG',
  color: 'BH',
  size: 'BI',
  supplierSku: 'BJ',
  division: 'BS',
  divisionName: 'BT',
  gender: 'BU',
  genderName: 'BV',
  season: 'BW',
  sport: 'CC',
  department: 'CG',
};

/** `AA` → 27. ExcelJS gives us row.getCell(number), not letters. */
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const IDX = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, colIndex(v)]));

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

/** The newest `item-card-*.xlsx` in sportmore/reference/, or an explicit path. */
export function resolveItemCard(explicit) {
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
export async function loadItemCard(explicit) {
  const file = resolveItemCard(explicit);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  const parents = new Map();
  const byBarcode = new Map();
  const childrenOfParent = new Map();
  let rows = 0;

  ws.eachRow((row, n) => {
    if (n === 1) return;
    const sku = norm(text(row.getCell(IDX.sku)));
    if (!sku) return;
    rows++;
    const rec = {
      sku,
      desc: text(row.getCell(IDX.desc)),
      barcode: norm(text(row.getCell(IDX.barcode))),
      status: text(row.getCell(IDX.status)),
      family: text(row.getCell(IDX.family)),
      familyName: text(row.getCell(IDX.familyName)),
      isParent: text(row.getCell(IDX.isParent)).toUpperCase() === 'Y',
      parent: norm(text(row.getCell(IDX.parent))),
      sizeScale: text(row.getCell(IDX.sizeScale)),
      sizeScaleName: text(row.getCell(IDX.sizeScaleName)),
      color: text(row.getCell(IDX.color)),
      size: text(row.getCell(IDX.size)),
      supplierSku: text(row.getCell(IDX.supplierSku)),
      division: text(row.getCell(IDX.division)),
      gender: text(row.getCell(IDX.gender)),
      season: text(row.getCell(IDX.season)),
      sport: text(row.getCell(IDX.sport)),
      department: text(row.getCell(IDX.department)),
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

  const age = cardAgeDays(file);
  return { file, rows, parents, byBarcode, childrenOfParent, ageDays: age };
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
 */
export function cardAgeDays(file) {
  const name = file.split(String.fromCharCode(92)).pop().split('/').pop();
  const m = /item-card-([0-9]{4})-([0-9]{2})-([0-9]{2})/i.exec(name);
  const when = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : statSync(file).mtimeMs;
  return Math.max(0, Math.floor((Date.now() - when) / 86_400_000));
}

export { IDX as ITEM_CARD_COLUMNS };
