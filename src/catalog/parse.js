/**
 * Parser for Comax "export to Excel" files.
 *
 * These are NOT spreadsheets. Comax writes an HTML table, encodes it UTF-16LE,
 * and names it `.xls`. The embedded meta tag even claims windows-1255, which is
 * wrong — the bytes are UTF-16LE (BOM `FF FE`). A real xlsx library chokes on
 * them; a table parser handles them in one pass and with no dependency.
 */
import { readFileSync } from 'node:fs';

const CELL = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
const ROW = /<tr[^>]*>[\s\S]*?<\/tr>/gi;

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
};

function clean(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decode the file, honouring the BOM Comax actually writes. */
export function decode(file) {
  const buf = readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.swap16().toString('utf16le');
  // Fall back to windows-1255 as the meta tag claims, then to utf8.
  try {
    return new TextDecoder('windows-1255').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/**
 * Reads a delimited export (tab, `^` or comma) into `{ headers, rows }`.
 *
 * Comax's customers export offers a plain delimited file, which is far easier
 * to trust than its HTML-in-`.xls`: no markup, no BOM games, and it is a third
 * of the size. The encoding is windows-1255, matching what the file declares.
 */
export function parseDelimited(file, delimiter = '\t') {
  const text = decode(file);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error(`הקובץ ${file} ריק.`);

  const headers = lines[0].split(delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const row = {};
    headers.forEach((h, i) => { if (h) row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
  return { headers, rows, source: file };
}

/**
 * Reads one export into `{ headers, rows }`, where each row is an object keyed
 * by the Hebrew column heading.
 */
export function parseExport(file) {
  const html = decode(file);
  const trs = html.match(ROW) ?? [];
  if (!trs.length) throw new Error(`לא נמצאו שורות טבלה ב-${file} — הפורמט השתנה?`);

  const cellsOf = (tr) => [...tr.matchAll(CELL)].map((m) => clean(m[1]));
  const headers = cellsOf(trs[0]);

  const rows = [];
  for (const tr of trs.slice(1)) {
    const cells = cellsOf(tr);
    if (!cells.some(Boolean)) continue;
    const row = {};
    headers.forEach((h, i) => { if (h) row[h] = cells[i] ?? ''; });
    rows.push(row);
  }
  return { headers, rows, source: file };
}
