/**
 * מאחד את דוח המלאי המלא (stock-full.json) עם קטלוג הפריטים.
 *
 *   npm run merge-full
 *
 * Same join as tools/merge-stock.js, but over the full sweep rather than a
 * single truncated report. Movements are not replayed here: the sweep is itself
 * the fresh snapshot, so anything logged before it is already reflected.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';

const src = resolve(ROOT, 'data/exports/stock-full.json');
if (!existsSync(src)) { console.error('אין stock-full.json — הרץ קודם npm run full-stock'); process.exit(1); }
const { warehouses, items, builtAt } = JSON.parse(readFileSync(src, 'utf8'));

const catFile = resolve(ROOT, 'data/catalog/items.json');
const catalog = existsSync(catFile)
  ? new Map(JSON.parse(readFileSync(catFile, 'utf8')).records.map((r) => [String(r.code), r]))
  : new Map();

const HEAD = [
  'מק"ט חלופי', 'תיאור פריט', 'דגם', 'צבע', 'מידה', 'מחלקה',
  'מחיר מכירה', 'מחירון 1', 'סה"כ מלאי', ...warehouses,
  'קוד דגם', 'קבוצה', 'פריט', 'ברקוד',
];
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const lines = [HEAD.map(q).join(',')];
let matched = 0;

for (const row of items) {
  const [code, name, price, total, ...perWh] = row;
  const c = catalog.get(code);
  if (c) matched += 1;
  lines.push([
    c?.altCode ?? '', name || c?.name || '', c?.model ?? '', c?.colorCode ?? '', c?.size ?? '',
    c?.department ?? '', price, c?.price1 ?? '', total, ...warehouses.map((_, i) => perWh[i] ?? ''),
    c?.modelCode ?? '', c?.group ?? '', code, c?.barcode ?? '',
  ].map(q).join(','));
}

const outDir = resolve(ROOT, 'content');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const date = builtAt.slice(0, 10);
const out = resolve(outDir, `מלאי-מלא-${date}.csv`);
writeFileSync(out, '\ufeff' + lines.join('\r\n'), 'utf8');

console.log(`מחסנים: ${warehouses.join(' · ')}`);
console.log(`פריטים: ${items.length} | הוצלבו מול הקטלוג: ${matched}`);
console.log(`נשמר: ${out}`);
