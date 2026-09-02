/**
 * מאחד את דוח מטריצת המחסנים עם קטלוג הפריטים לדוח אחד.
 *
 *   npm run merge -- data/exports/מטריצת-מחסנים-2026-09-01.html
 *
 * The matrix report answers "how much of this item is in each warehouse", but
 * it carries only the item code, name and price. Everything a person actually
 * looks for — model, colour, size, barcode, department — lives in the item
 * catalog under data/catalog/items.json. They join cleanly on the item code, so
 * this puts them side by side and writes one CSV into content/.
 *
 * CSV rather than .xlsx: Comax's own exports are HTML pretending to be Excel,
 * and a real CSV with a BOM opens correctly in Excel in Hebrew, which those do
 * not always do.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { ROOT } from '../src/config.js';

const file = process.argv[2];
if (!file) {
  console.error('שימוש: npm run merge -- <קובץ הדוח>');
  process.exit(1);
}
const src = resolve(ROOT, file);
if (!existsSync(src)) { console.error(`לא נמצא: ${src}`); process.exit(1); }

/** Cells of one <tr> match, tags stripped, empties kept so columns stay aligned. */
const cellsOf = (rowMatch) =>
  [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((m) => m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim());

const html = readFileSync(src, 'utf8');
const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

// The warehouse names sit in one header row and the word "מלאי" repeats under
// each of them in the next. Find the row that names them rather than assuming
// a fixed index — Comax pads the top of the report with title rows.
let warehouses = null;
for (const r of rows.slice(0, 8)) {
  const c = cellsOf(r);
  const i = c.findIndex((x) => x.includes("סה'") || x === 'סה"כ');
  if (i >= 0) { warehouses = c.slice(i + 1).filter(Boolean); break; }
}
if (!warehouses?.length) { console.error('לא זוהו עמודות מחסנים בדוח.'); process.exit(1); }
console.log(`מחסנים בדוח: ${warehouses.join(' · ')}`);

// Data rows: item code, name, price, total, then one stock number per warehouse.
const stock = [];
for (const r of rows) {
  const c = cellsOf(r);
  if (c.length < 4 + warehouses.length) continue;
  if (!/^\d+$/.test(c[0])) continue;
  stock.push({
    code: c[0],
    name: c[1],
    price: c[2],
    total: c[3],
    perWarehouse: warehouses.map((_, i) => c[4 + i] ?? ''),
  });
}
console.log(`שורות מלאי: ${stock.length}`);

/**
 * Apply one movement to the in-memory rows.
 *
 * The two kinds behave differently and conflating them corrupts the totals:
 *   - a **transfer** takes stock out of `from` and puts it into `to`. The
 *     company still owns it, so the סה"כ column does not change.
 *   - an **invoice** (or any sale) takes stock out of `from` and it leaves the
 *     business. The סה"כ column must come down with it.
 *
 * A movement with a `from` and no `to` is therefore treated as going out, and
 * the total is adjusted by the net of what entered and left.
 */
function applyMovement(m) {
  const row = stock.find((s) => s.code === String(m.code));
  if (!row) { console.log(`  ! ${m.code} לא בדוח — התנועה לא הוחלה`); return; }
  const n = (v) => { const x = parseFloat(String(v).replace(/,/g, '')); return isNaN(x) ? 0 : x; };
  const from = m.from ? warehouses.indexOf(m.from) : -1;
  const to = m.to ? warehouses.indexOf(m.to) : -1;

  if (m.from && from < 0) console.log(`  ! ${m.from} אינו בדוח — הצד היוצא לא עודכן`);
  if (m.to && to < 0) console.log(`  ! ${m.to} אינו בדוח — הצד הנכנס לא עודכן`);

  if (from >= 0) row.perWarehouse[from] = String(n(row.perWarehouse[from]) - m.qty);
  if (to >= 0) row.perWarehouse[to] = String(n(row.perWarehouse[to]) + m.qty);

  // Net change to what the company holds: a transfer nets to zero, a sale does
  // not. Warehouses outside the report are still counted here — the stock left
  // the business either way.
  const net = (m.to ? m.qty : 0) - (m.from ? m.qty : 0);
  if (net !== 0) row.total = String(n(row.total) + net);

  const arrow = m.to ? `${m.from ?? '?'} → ${m.to}` : `${m.from} → יצא`;
  console.log(`  ✓ ${m.qty} × ${m.name ?? m.code}: ${arrow}  [${m.type ?? 'תנועה'} ${m.doc}]`);
}
/**
 * Stock we have moved ourselves since the report was pulled.
 *
 * The report is a snapshot of what Comax said at one moment, and it is left
 * untouched — editing it would falsify the record. But the moment the agent
 * commits a transfer document, that snapshot is wrong, and a merged view built
 * straight from it quietly reports stock in a warehouse it has already left.
 * So every movement is appended to data/movements.jsonl and replayed here.
 *
 * Only movements later than the snapshot are applied; anything earlier is
 * already reflected in the report itself.
 */
function movementsSince(when) {
  const file = resolve(ROOT, 'data/movements.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((m) => new Date(m.at) > when);
}

const snapshotAt = statSync(src).mtime;
const moves = movementsSince(snapshotAt);
if (moves.length) {
  console.log(`\nתנועות אחרי צילום הדוח (${snapshotAt.toLocaleString('he-IL')}): ${moves.length}`);
  moves.forEach(applyMovement);
}

const catalogFile = resolve(ROOT, 'data/catalog/items.json');
const catalog = existsSync(catalogFile)
  ? new Map(JSON.parse(readFileSync(catalogFile, 'utf8')).records.map((r) => [String(r.code), r]))
  : new Map();
console.log(`קטלוג: ${catalog.size} פריטים`);

// The alternate SKU leads, because that is the identifier that means something
// to a person here: it is built from model + colour + size (1326413001LG), so
// it names the product on sight. The item code and barcode (192006314264) are
// opaque and go to the end, kept only for anything downstream that needs them.
const HEAD = [
  'מק"ט חלופי', 'תיאור פריט', 'דגם', 'צבע', 'מידה', 'מחלקה',
  'מחיר מכירה', 'מחירון 1', 'סה"כ מלאי', ...warehouses,
  'קוד דגם', 'קבוצה', 'פריט', 'ברקוד',
];

// Excel decides a CSV's encoding from the BOM; without it Hebrew arrives as
// mojibake. Quote everything — item names contain commas and quotes.
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const lines = [HEAD.map(q).join(',')];
let matched = 0;
for (const s of stock) {
  const c = catalog.get(s.code);
  if (c) matched += 1;
  lines.push([
    c?.altCode ?? '', s.name || c?.name || '', c?.model ?? '', c?.colorCode ?? '', c?.size ?? '',
    c?.department ?? '', s.price, c?.price1 ?? '', s.total, ...s.perWarehouse,
    c?.modelCode ?? '', c?.group ?? '', s.code, c?.barcode ?? '',
  ].map(q).join(','));
}

const outDir = resolve(ROOT, 'content');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, basename(src).replace(/\.html?$/i, '') + '-מאוחד.csv');
writeFileSync(out, '﻿' + lines.join('\r\n'), 'utf8');

console.log(`\nהוצלבו ${matched} מתוך ${stock.length} פריטים מול הקטלוג.`);
if (matched < stock.length) {
  console.log(`${stock.length - matched} פריטים לא נמצאו בקטלוג — הם עדיין בדוח, בלי דגם/צבע/מידה.`);
}
console.log(`\nנשמר: ${out}`);
