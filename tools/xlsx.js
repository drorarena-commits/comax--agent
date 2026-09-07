/**
 * קורא קובץ xlsx מקומי והופך כל גיליון ל-CSV ב-UTF-8.
 *
 *   node tools/xlsx.js <קובץ.xlsx> [תיקיית-יעד]
 *   node tools/xlsx.js <קובץ.xlsx> --list        רק שמות הגיליונות והמידות
 *
 * Why this exists rather than a library: the project depends on playwright-core
 * and nothing else, and an xlsx is just a zip of XML. `unzip -p` streams one
 * member at a time, so a 29 MB workbook never has to be held whole.
 *
 * Two things this handles that a naive regex pass gets wrong:
 *   - **Missing cells.** Excel omits empty cells entirely, so `<c r="C2">`
 *     after `<c r="A2">` means B2 is empty — not that C is the second column.
 *     Every cell is placed by its own column letter, never by its position.
 *   - **Both string flavours.** `t="inlineStr"` keeps the text in `<is><t>`,
 *     `t="s"` points into sharedStrings.xml, and a plain `<v>` is a number.
 *     A workbook can mix all three.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const unzip = (file, member) =>
  execFileSync('unzip', ['-p', file, member], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&'); // last, or an escaped &amp;lt; would double-decode

/** "AB" -> 27 (1-based), so a cell always lands in its real column. */
const colOf = (ref) => {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

export function sheetNames(file) {
  const wb = unzip(file, 'xl/workbook.xml');
  const rels = unzip(file, 'xl/_rels/workbook.xml.rels');
  const relMap = new Map(
    [...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
      .map((m) => [m[1], m[2].replace(/^\/?xl\//, '')]),
  );
  const dims = new Map(
    [...wb.matchAll(/<definedName[^>]*localSheetId="(\d+)"[^>]*>([^<]*)<\/definedName>/g)]
      .map((m) => [Number(m[1]), unescapeXml(m[2])]),
  );
  return [...wb.matchAll(/<sheet\b[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"[^>]*\/>/g)]
    .map((m, i) => ({
      index: i + 1,
      name: unescapeXml(m[1]),
      path: `xl/${relMap.get(m[2]) ?? `worksheets/sheet${i + 1}.xml`}`,
      range: dims.get(i) ?? null,
    }));
}

function sharedStrings(file) {
  try {
    const xml = unzip(file, 'xl/sharedStrings.xml');
    return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(''));
  } catch {
    return []; // inline-string workbooks have no sharedStrings part
  }
}

/** One sheet as an array of rows, each row an array of strings. */
export function readSheet(file, path, shared = sharedStrings(file)) {
  const xml = unzip(file, path);
  const rows = [];
  let width = 0;

  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1];
      const body = cm[2];
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join('');
      } else if (type === 's') {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]);
        value = shared[i] ?? '';
      } else {
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }
      const col = colOf(ref);
      cells[col - 1] = value; // by column letter — holes stay holes
    }
    for (let i = 0; i < cells.length; i++) cells[i] ??= '';
    width = Math.max(width, cells.length);
    rows.push(cells);
  }

  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}

const esc = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows) => `﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`;

// ---- CLI ------------------------------------------------------------------
// `file://C:/...` vs `file:///C:/...` — comparing the strings directly silently
// skips the CLI on Windows, so compare the resolved paths instead.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [file, arg2] = process.argv.slice(2);
  if (!file) { console.error('שימוש: node tools/xlsx.js <קובץ.xlsx> [תיקיית-יעד|--list]'); process.exit(1); }

  const sheets = sheetNames(file);
  if (arg2 === '--list') {
    for (const s of sheets) console.log(`${s.index}. ${s.name}  ${s.range ?? ''}`);
    process.exit(0);
  }

  const outDir = arg2 ?? resolve('data/exports', basename(file, '.xlsx'));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const shared = sharedStrings(file);

  for (const s of sheets) {
    const rows = readSheet(file, s.path, shared);
    const safe = s.name.replace(/[\\/:*?"<>|]/g, '-').trim();
    const dest = resolve(outDir, `${safe}.csv`);
    writeFileSync(dest, toCsv(rows), 'utf8');
    console.log(`${s.name}: ${rows.length} שורות × ${rows[0]?.length ?? 0} עמודות → ${dest}`);
  }
}
