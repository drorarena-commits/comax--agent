/**
 * מחיל את ייצוא מטריצת המחסנים על הייצוא המלא, וכותב מלאי-מלא חדש.
 *
 *   npm run apply-matrix              תצוגה מקדימה — לא כותב כלום
 *   npm run apply-matrix -- --write   כותב content/מלאי-מלא-<תאריך>.csv
 *
 * The rule, stated by Dror: an item that appears in the matrix takes the
 * matrix's numbers, whole. An item that does not appear keeps whatever it has
 * now — including the zeros and the negatives, which are not noise: `משלוח` at
 * -529 is a real balance, and quietly "correcting" it to 0 would hide it.
 *
 * The matrix is filtered to מלאי מעל 0, so absence from it means `≤0 in the
 * warehouses that report covered` — never `0 everywhere`. That is exactly why
 * the untouched rows are left alone rather than zeroed.
 *
 * Nothing is overwritten: the old מלאי-מלא stays on disk under its own date,
 * and the readers pick the newest by mtime.
 */
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeCsv, parseCsv, loadNamed, loadMatrix, newest, CONTENT_DIR } from '../src/catalog/local-stock.js';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const force = argv.includes('--force');
const dateArg = (argv.find((a) => /^--date=/.test(a)) ?? '').split('=')[1] ?? null;

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const n = (v) => Number(v).toLocaleString('he-IL');

/**
 * The date the matrix reflects.
 *
 * Read out of the filename when it says so ("... 2.9.26"), because mtime is the
 * moment the file was copied here, not the moment the report was run — and the
 * date is what the next person uses to decide whether to trust the number.
 */
function matrixDate(file) {
  if (dateArg) return { date: dateArg, from: '--date' };
  const base = file.split(/[\\/]/).pop();
  const iso = base.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, from: 'שם הקובץ' };
  const dmy = base.match(/(?<!\d)(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})(?!\d)/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return { date: `${y}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`, from: 'שם הקובץ' };
  }
  return { date: new Date(statSync(file).mtimeMs).toISOString().slice(0, 10), from: 'תאריך השינוי של הקובץ' };
}

/* ── load both sides ───────────────────────────────────────────────────── */

const baseFile = newest(/^מלאי-מלא-.*\.csv$/);
if (!baseFile) {
  console.error(`\nאין ב-${CONTENT_DIR} קובץ מלאי-מלא-*.csv להחיל עליו.\n`);
  process.exit(1);
}
const named = loadNamed(baseFile);
const matrix = loadMatrix(undefined, { reference: named });
if (!matrix) {
  console.error(`\nאין ב-${CONTENT_DIR} ייצוא מטריצת מחסנים.\n`);
  process.exit(1);
}

// A warehouse in the matrix that the base has no column for cannot be placed.
// Refusing is the only honest move: writing it anywhere else is a wrong number
// under a right-looking heading.
const stray = matrix.warehouses.filter((w) => !named.warehouses.includes(w));
if (stray.length) {
  console.error(
    `\nבמטריצה יש מחסנים שאין להם עמודה בייצוא המלא: ${stray.join(' · ')}\n` +
    `  הייצוא המלא מכיל: ${named.warehouses.join(' · ')}\n` +
    '  צריך ייצוא מלא חדש שמכסה את אותם מחסנים — לא ממציאים עמודה.\n',
  );
  process.exit(1);
}
// The reverse is allowed and handled: a warehouse the matrix did not cover keeps
// its current value, and the total is rebuilt from all the columns together.
const uncovered = named.warehouses.filter((w) => !matrix.warehouses.includes(w));

/* ── rewrite the rows ──────────────────────────────────────────────────── */

const rows = parseCsv(decodeCsv(baseFile));
const head = rows[0];
const first = head.indexOf('סה"כ מלאי') + 1;
const iTotal = head.indexOf('סה"כ מלאי');
const iCode = head.indexOf('פריט');
const colOf = Object.fromEntries(named.warehouses.map((w, i) => [w, first + i]));

let updated = 0;
let untouched = 0;
const delta = Object.fromEntries(named.warehouses.map((w) => [w, 0]));
const seen = new Set();
const changes = [];

for (const r of rows.slice(1)) {
  const code = (r[iCode] ?? '').trim();
  const m = code && matrix.items.get(code);
  if (!m) { untouched += 1; continue; }
  seen.add(code);

  let total = 0;
  for (const w of named.warehouses) {
    const before = num(r[colOf[w]]);
    const after = uncovered.includes(w) ? before : (m.per[w] ?? 0);
    total += after;
    delta[w] += after - before;
    // Comax writes an empty cell for zero and the readers treat it as 0 — keep
    // that convention so the file stays diffable against the one before it.
    r[colOf[w]] = after === 0 ? '' : String(after);
  }
  const wasTotal = num(r[iTotal]);
  r[iTotal] = total === 0 ? '' : String(total);
  if (total !== wasTotal) changes.push({ code, was: wasTotal, now: total });
  updated += 1;
}

// Every matrix row must have landed somewhere. One that did not is an item the
// full export has never heard of — a real gap, not a rounding detail.
const orphans = [...matrix.items.keys()].filter((c) => !seen.has(c));

/* ── report, then write ────────────────────────────────────────────────── */

const { date, from } = matrixDate(matrix.file);
const short = (f) => f.split(/[\\/]/).pop();
const out = resolve(CONTENT_DIR, `מלאי-מלא-${date}.csv`);

console.log(`\nבסיס:    ${short(baseFile)}   (${n(rows.length - 1)} פריטים)`);
console.log(`מטריצה:  ${short(matrix.file)}   (${n(matrix.items.size)} פריטים${matrix.calibrated ? ', עמודות זוהו בהצלבה' : ''})`);
console.log(`מחסנים:  ${matrix.warehouses.join(' · ')}`);
if (uncovered.length) console.log(`לא במטריצה — נשמרים כמו שהם: ${uncovered.join(' · ')}`);
console.log(`\nעודכנו לפי הדוח החדש: ${n(updated)}   ·   נשארו כמו שהם: ${n(untouched)}`);
if (changes.length) console.log(`מתוך המעודכנים, ${n(changes.length)} שינו סה"כ.`);
if (orphans.length) {
  console.log(`\nאזהרה — ${n(orphans.length)} פריטים במטריצה לא קיימים בייצוא המלא ולא נכתבו:`);
  console.log(`  ${orphans.slice(0, 10).join(' · ')}${orphans.length > 10 ? ' ...' : ''}`);
}

console.log('\nשינוי נטו ביחידות:');
for (const w of named.warehouses) {
  const d = delta[w];
  console.log(`  ${w.padEnd(22)} ${d > 0 ? '+' : ''}${n(d)}`);
}

if (!write) {
  console.log(`\nתצוגה מקדימה בלבד. לכתוב:\n  npm run apply-matrix -- --write\n→ ${short(out)}  (תאריך לפי ${from})\n`);
  process.exit(0);
}
if (out === baseFile) {
  console.error(`\nהיעד הוא קובץ הבסיס עצמו (${short(out)}) — לא כותב על מה שאני קורא ממנו.\n  להעביר --date=YYYY-MM-DD.\n`);
  process.exit(1);
}
if (existsSync(out) && !force) {
  console.error(`\n${short(out)} כבר קיים. --force כדי להחליף.\n`);
  process.exit(1);
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
writeFileSync(out, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n', 'utf8');
console.log(`\nנכתב: ${out}   (תאריך לפי ${from})`);
console.log('הקובץ הקודם נשאר במקומו — הקוראים בוחרים את החדש לפי תאריך השינוי.\n');
