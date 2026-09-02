/**
 * מרכיב דוח מלאי מלא על כל הקטלוג, בכמה הרצות.
 *
 *   npm run full-stock              כל המנות
 *   npm run full-stock -- --from 3  ממשיך ממנה 3 (אחרי הפסקה)
 *
 * The matrix report stops at 1500 item rows. That limit is on rows, not on
 * warehouses — running two warehouses instead of five returned exactly the same
 * 1500 — so the only way to cover a 13,107-item catalog is to bound the item
 * range on each run and concatenate.
 *
 * Ranges come from data/item-ranges.json, built from the catalog's own sorted
 * codes so each chunk stays under the ceiling. The report sorts numerically
 * (1, 10, 11, 93, 1111 …), not as text, so the ranges are cut that way too.
 *
 * Each chunk is a separate `stock-matrix` run: roughly two and a half minutes,
 * so a full sweep is around half an hour. Chunks are written to
 * data/exports/chunks/ and only merged at the end, so an interrupted sweep can
 * resume with --from instead of starting over.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

const ranges = JSON.parse(readFileSync(resolve(ROOT, 'data/item-ranges.json'), 'utf8'));
const args = process.argv.slice(2);
const startAt = Number(args[args.indexOf('--from') + 1]) || 1;
const chunkDir = resolve(ROOT, 'data/exports/chunks');
if (!existsSync(chunkDir)) mkdirSync(chunkDir, { recursive: true });

console.log(`${ranges.length} מנות, מתחיל ממנה ${startAt}. הערכה: ${((ranges.length - startAt + 1) * 2.6).toFixed(0)} דקות.\n`);

for (let i = startAt - 1; i < ranges.length; i++) {
  const r = ranges[i];
  const n = i + 1;
  const dest = resolve(chunkDir, `chunk-${String(n).padStart(2, '0')}.html`);
  if (existsSync(dest)) { console.log(`מנה ${n}/${ranges.length}: כבר קיימת — מדלג`); continue; }

  console.log(`מנה ${n}/${ranges.length}: ${r.from} → ${r.to} (${r.n} פריטים)`);
  const input = JSON.stringify({ excel: false, itemFrom: r.from, itemTo: r.to });
  const res = spawnSync('node', ['tools/run.js', 'stock-matrix', '--json', input],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const out = (res.stdout ?? '') + (res.stderr ?? '');
  const saved = /data[\\/]exports[\\/](מטריצת-מחסנים-[\d-]+\.html)/.exec(out)?.[1];
  const rows = /(\d+) שורות/.exec(out)?.[1];

  if (res.status !== 0 || !saved) {
    console.log(`  ✗ נכשלה. ${out.split('\n').filter((l) => /error|שגיאה/i.test(l)).slice(0, 2).join(' ')}`);
    console.log(`  להמשך אחרי תיקון: npm run full-stock -- --from ${n}\n`);
    process.exit(1);
  }

  // The task writes one file per date; move it aside so the next chunk does not
  // overwrite it.
  const produced = resolve(ROOT, 'data/exports', saved);
  const { renameSync } = await import('node:fs');
  renameSync(produced, dest);
  console.log(`  ✓ ${rows ?? '?'} שורות → ${dest.replace(ROOT, '.')}\n`);
}

// ---- merge -----------------------------------------------------------
const cellsOf = (m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
  .map((x) => x[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim());

const files = readdirSync(chunkDir).filter((f) => f.endsWith('.html')).sort();
const seen = new Map();
let warehouses = null;

for (const f of files) {
  const html = readFileSync(resolve(chunkDir, f), 'utf8');
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (!warehouses) {
    for (const r of rows.slice(0, 8)) {
      const c = cellsOf(r);
      const i = c.findIndex((x) => x.includes("סה'") || x === 'סה"כ');
      if (i >= 0) { warehouses = c.slice(i + 1).filter(Boolean); break; }
    }
  }
  let n = 0;
  for (const r of rows) {
    const c = cellsOf(r);
    if (c.length < 4 + (warehouses?.length ?? 0) || !/^\d+$/.test(c[0])) continue;
    // Ranges are cut on catalog codes, but the report decides for itself which
    // items it returns; overlaps at the seams are normal. Keyed by code, last
    // one wins — they carry the same figures either way.
    seen.set(c[0], c);
    n += 1;
  }
  console.log(`${f}: ${n} שורות`);
}

const out = { warehouses, builtAt: new Date().toISOString(), items: [...seen.values()] };
const dest = resolve(ROOT, 'data/exports', 'stock-full.json');
writeFileSync(dest, JSON.stringify(out), 'utf8');

console.log(`\nמחסנים: ${warehouses?.join(' · ')}`);
console.log(`סה"כ פריטים ייחודיים: ${seen.size}`);
console.log(`נשמר: ${dest}`);
