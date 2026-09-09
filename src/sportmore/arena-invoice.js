/**
 * The Arena Italia invoice / pro-forma — a SAP export, and the input to
 * everything downstream.
 *
 * Columns are found **by header text, never by position**. The two exports we
 * have disagree on order: `חשבוניות אחרונות ארנה איטליה 28.5.26` opens with
 * "Shipping Point" and carries EAN/UPC in column W, while `ארנה - הזמנות
 * 28.05.26` opens with EAN/UPC in column A. Same report, different runs, and a
 * positional reader would silently pair barcodes with prices.
 *
 * Two facts about these files decide the shape of the rest of the pipeline:
 *
 *   `SKU/Article number` is `style_color_size` — `2A253_75_75`. Splitting it is
 *   how the parent code is derived, and it is more reliable than the separate
 *   Style/Color/Size columns because it is what Arena's own system keys on.
 *
 *   `Season` is **empty** in every export we have seen. The season on a setup
 *   file (FW26 / SS26) is Dror's, supplied per batch — it is never guessed.
 */
import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

/** Header text → field. Matched case-insensitively on a squashed string. */
const HEADERS = {
  'ean/upc': 'ean',
  'sku/article number': 'articleNumber',
  'sku/article description': 'articleDesc',
  'style code': 'style',
  'style description': 'styleDesc',
  'color code': 'colorCode',
  'color description': 'colorDesc',
  size: 'size',
  'billed quantity': 'qty',
  'net unit price': 'price',
  'zp00 - unit price list': 'listPrice',
  season: 'season',
  collection: 'collection',
  'bill. doc.': 'invoiceNo',
  'billing date': 'date',
  'billing type': 'billingType',
  'backbone level 1': 'bb1',
  'backbone level 2': 'bb2',
  'backbone level 3': 'bb3',
  'backbone level 4': 'bb4',
  'backbone level 5': 'bb5',
  'fiber composition': 'fiber',
  supplier: 'supplier',
};

const squash = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function text(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    return '';
  }
  return String(v).trim();
}

/** Excel serial date → `dd/mm/yy`, which is what the intake template expects. */
export function excelDate(v) {
  if (v instanceof Date) return v;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000);
}

/**
 * Split `2A253_75_75` into its three parts.
 *
 * Sizes themselves contain no underscore, but style codes never do either, so
 * the split is exactly on the first two separators. A row whose article number
 * does not split into three is returned unsplit and flagged — it is not
 * guessed at, because a wrong split produces a plausible-looking parent code
 * that would be set up in Priority under the wrong model.
 */
export function splitArticle(articleNumber) {
  const parts = String(articleNumber ?? '').trim().split('_');
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [style, color, size] = parts;
  return { style, color, size };
}

/** Read an Arena export into normalised rows. */
export async function readArenaInvoice(path) {
  const file = resolve(ROOT, path);
  if (!existsSync(file)) throw new Error(`קובץ החשבונית לא נמצא: ${path}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  const map = {};
  ws.getRow(1).eachCell((cell, col) => {
    const field = HEADERS[squash(text(cell))];
    if (field && map[field] === undefined) map[field] = col;
  });

  // An identifier can arrive either way: the SAP export packs it into
  // `SKU/Article number`, while a sheet built by hand for an invoice that came
  // as a PDF names Style / Color / Size in their own columns. EAN is not
  // required at all — a customised order has none, and such a row carries
  // `hasBarcode: false` for the planner to rule on rather than being rejected
  // here as unparseable.
  const hasArticle = !!map.articleNumber;
  const hasParts = !!map.style && !!map.colorCode;
  const missing = ['qty', 'price'].filter((f) => !map[f]);
  if (!hasArticle && !hasParts) missing.push('SKU/Article number (או Style code + Color code)');
  if (missing.length) {
    throw new Error(
      `הקובץ לא נראה כמו חשבונית של ארנה — חסרות עמודות: ${missing.join(', ')}\n` +
        `הכותרות שנמצאו: ${ws.getRow(1).values.filter(Boolean).slice(0, 12).join(' | ')}`
    );
  }

  const rows = [];
  const problems = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (f) => (map[f] ? text(row.getCell(map[f])) : '');
    const articleNumber = get('articleNumber');
    const split = splitArticle(articleNumber);
    const style = split?.style || get('style');
    const colorCode = split?.color || get('colorCode');
    const size = split?.size || get('size');
    if (!articleNumber && !(style && colorCode)) return;

    const ean = String(get('ean')).trim();
    const r = {
      row: n,
      ean,
      hasBarcode: !!ean,
      articleNumber: articleNumber || [style, colorCode, size].filter(Boolean).join('_'),
      articleDesc: get('articleDesc'),
      style,
      colorCode,
      size,
      styleDesc: get('styleDesc'),
      colorDesc: get('colorDesc'),
      qty: Number(get('qty')) || 0,
      price: Number(get('price')) || 0,
      listPrice: Number(get('listPrice')) || 0,
      season: get('season'),
      invoiceNo: get('invoiceNo'),
      date: excelDate(map.date ? row.getCell(map.date).value : null),
      billingType: get('billingType'),
      backbone: [get('bb1'), get('bb2'), get('bb3'), get('bb4'), get('bb5')].filter(Boolean),
      fiber: get('fiber'),
    };
    if (!split && !(style && colorCode)) {
      problems.push({ row: n, articleNumber, why: 'מק"ט ארנה לא מתפצל ל-דגם_צבע_מידה, ואין עמודות נפרדות' });
    }
    rows.push(r);
  });

  return { file, rows, problems, headers: map };
}

/** `AR` + style + color. The parent code, exactly as Sport & More write it. */
export function parentSku(row) {
  if (!row.style || !row.colorCode) return null;
  return `AR${row.style}${row.colorCode}`.toUpperCase();
}

/**
 * `AR` + style + color + `00` + size — the full child code, used only by the
 * intake file. The `00` is Sport & More's dummy colour slot: they never open a
 * real colour, so every child in their system carries `00` while the actual
 * colour lives inside the code itself.
 */
export function childSku(row) {
  const parent = parentSku(row);
  if (!parent || !row.size) return null;
  return `${parent}00${row.size}`.toUpperCase();
}

/**
 * The barcode for a customised item, which Arena ships without one: the full
 * child code with the `AR` stripped off.
 *
 * This is a convention we are establishing, not one we found. All but two of
 * the 2,636 children in the 25.8.26 card carry a real 13-digit EAN, and that
 * includes every customised cap already set up — MOULDED EMEK ISR, MOULDED
 * RISHON ISR, FLAT SILICONE HERZLIYA ISR and three more, all on Arena`s 346833
 * prefix. Arena does issue barcodes for these; they just are not printed on the
 * invoice. So a self-coded barcode is a stand-in, and if Arena later issues the
 * real EAN the same cap exists twice in Priority. That is why it is never
 * silent: it takes an explicit flag, it is marked in the report, and a code
 * that already exists in the card stops the batch.
 */
export function selfBarcode(row) {
  const child = childSku(row);
  return child ? child.slice(2) : null;
}
