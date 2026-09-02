/**
 * Per-warehouse stock, merged from one export per warehouse.
 *
 * Comax cannot export stock for several warehouses in one usable file — the
 * matrix report produces exactly that but its download never completes. What
 * does work (Dror's find) is the items export with `מחסן מלאי` set from and to
 * the same warehouse: run it once per warehouse and merge the results here.
 *
 * Cost columns are stripped into a separate internal file, never into the
 * public one: a price the customer must not see has no business sitting in the
 * object a document is built from.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { parseExport, parseDelimited } from './parse.js';
import { CATALOG_DIR } from './search.js';

const STOCK_FILE = resolve(CATALOG_DIR, 'stock.json');
const COST_FILE = resolve(CATALOG_DIR, 'items.internal.json');

const COL = {
  code: 'פריט',
  name: 'שם פריט',
  stock: 'מלאי',
  price1: 'מחיר מחירון 1',
  cost: 'מחיר עלות לפי ספק',
};

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function load(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}

/**
 * Folds one warehouse's export into the stock catalog.
 *
 * `warehouse` is the Comax code (1 ראשי, 3 רמת גן, 13 ספורט ומור, 15 מכולה
 * וינגייט, 16 WIX). Re-running the same warehouse replaces its column rather
 * than adding to it, so a refresh is safe to repeat.
 */
export function addWarehouse({ file, warehouse, label = null, delimiter = null }) {
  const { headers, rows } = delimiter ? parseDelimited(file, delimiter) : parseExport(file);

  const missing = [COL.code, COL.stock].filter((h) => !headers.includes(h));
  if (missing.length) {
    throw new Error(
      `בקובץ ${file} חסרות עמודות: ${missing.join(', ')}\nהעמודות שנמצאו: ${headers.join(' | ')}`,
    );
  }

  mkdirSync(CATALOG_DIR, { recursive: true });
  const stock = load(STOCK_FILE, { warehouses: {}, items: {} });
  const cost = load(COST_FILE, { builtAt: null, items: {} });

  stock.warehouses[warehouse] = { label, source: file, builtAt: new Date().toISOString() };

  let counted = 0;
  let withStock = 0;
  for (const r of rows) {
    const code = (r[COL.code] ?? '').trim();
    if (!code) continue;
    counted += 1;

    const qty = num(r[COL.stock]);
    const entry = (stock.items[code] ??= { name: r[COL.name] ?? '', by: {} });
    if (r[COL.name]) entry.name = r[COL.name];
    entry.by[warehouse] = qty;
    if (qty > 0) withStock += 1;

    // Cost never enters the public catalog — see the iron rule in the plan.
    const c = r[COL.cost];
    if (c != null && c !== '') cost.items[code] = { costBySupplier: num(c) };
  }

  for (const entry of Object.values(stock.items)) {
    entry.total = Object.values(entry.by).reduce((a, b) => a + b, 0);
  }
  stock.builtAt = new Date().toISOString();
  cost.builtAt = new Date().toISOString();

  writeFileSync(STOCK_FILE, JSON.stringify(stock), 'utf8');
  if (Object.keys(cost.items).length) writeFileSync(COST_FILE, JSON.stringify(cost), 'utf8');

  return {
    warehouse,
    rows: counted,
    withStock,
    warehousesSoFar: Object.keys(stock.warehouses),
    costRecords: Object.keys(cost.items).length,
  };
}

/** Stock for one item across every warehouse loaded so far. */
export function stockOf(code) {
  const stock = load(STOCK_FILE, null);
  if (!stock) throw new Error('קטלוג המלאי לא נבנה עדיין.');
  return stock.items[String(code)] ?? null;
}

/** Which warehouses hold this item, best first. Empty ones are dropped. */
export function whereIs(code) {
  const item = stockOf(code);
  if (!item) return [];
  const stock = load(STOCK_FILE, null);
  return Object.entries(item.by)
    .filter(([, qty]) => qty > 0)
    .map(([w, qty]) => ({ warehouse: w, label: stock.warehouses[w]?.label ?? w, qty }))
    .sort((a, b) => b.qty - a.qty);
}

export { STOCK_FILE, COST_FILE };
