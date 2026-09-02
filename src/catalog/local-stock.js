/**
 * Stock answered from the exports sitting in `content/` — never from a fresh
 * report in Comax (Dror's rule). Two kinds of file live there and they are not
 * interchangeable:
 *
 *   מלאי-מלא-<date>.csv        — written by tools/merge-full.js. UTF-8, quoted,
 *                                 and its warehouse columns are *named*. It is
 *                                 the only file that carries identity: מק"ט
 *                                 חלופי, דגם, צבע, מידה, מחלקה, מחיר.
 *   מטריצת מחסנים ... .csv      — a raw "מטריצת מחסנים" export straight out of
 *                                 Comax. Fresher, but windows-1255, CR-only
 *                                 line endings, and — the trap — every
 *                                 warehouse column is headed just "מלאי".
 *
 * That headerless matrix is why this module exists. Nothing inside the file
 * says which column is which warehouse, and the order is *not* the order in
 * config/comax.config.json: the 2.9.26 export came out ראשי · רמת גן · מכולה
 * וינגייט · WIX · ספורט & מור רמלה, while the config sends 1 · 15 · 3 · 13 · 16.
 * Whoever ran the report chose the slots. So the columns are never assumed —
 * they are calibrated against the named export on every load, and a calibration
 * that does not come out clean refuses rather than guesses. Reading "ספורט &
 * מור רמלה" off a column that is really "ראשי" is not an error anyone would
 * catch by eye.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

export const CONTENT_DIR = resolve(ROOT, 'content');

const NAMED_RE = /^מלאי-מלא-.*\.csv$/;
const MATRIX_RE = /^מטריצ.*\.csv$/;

/* ── reading ───────────────────────────────────────────────────────────── */

/**
 * Decode a `content/` CSV without trusting its extension.
 *
 * The two files disagree on everything: one is UTF-8 with a BOM, the other is
 * windows-1255 with no marker at all. Guessing wrong turns every Hebrew name
 * into mojibake that still parses, so UTF-8 is tried in fatal mode and only a
 * genuine decode failure falls through to 1255.
 */
export function decodeCsv(file) {
  const buf = readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8').slice(1);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1255').decode(buf);
  }
}

/**
 * Minimal RFC-4180 reader. Splits on CR, LF *and* bare CR: the matrix export
 * ends its lines with CR only, which `split(/\r?\n/)` reads as one enormous row.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endRow = () => { row.push(cell); rows.push(row); row = []; cell = ''; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') { endRow(); if (text[i + 1] === '\n') i++; }
    else if (c === '\n') endRow();
    else cell += c;
  }
  if (cell || row.length) endRow();
  return rows.filter((r) => r.some((v) => v !== ''));
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Newest file in `content/` matching a pattern, by mtime. */
export function newest(re) {
  if (!existsSync(CONTENT_DIR)) return null;
  const hit = readdirSync(CONTENT_DIR)
    .filter((f) => re.test(f))
    .map((f) => ({ f, t: statSync(resolve(CONTENT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
  return hit ? resolve(CONTENT_DIR, hit.f) : null;
}

/* ── the named export: identity plus a balance ─────────────────────────── */

/**
 * `מלאי-מלא-<date>.csv` → warehouses in column order, and one record per item.
 *
 * Its warehouse block is delimited by two fixed headings — everything between
 * `סה"כ מלאי` and `קוד דגם` is a warehouse — which is how the column count
 * stays correct when a warehouse is added or dropped.
 */
export function loadNamed(file = newest(NAMED_RE)) {
  if (!file) return null;
  const rows = parseCsv(decodeCsv(file));
  const head = rows[0] ?? [];
  const first = head.indexOf('סה"כ מלאי') + 1;
  const last = head.indexOf('קוד דגם');
  if (first <= 0 || last <= first) {
    throw new Error(
      `לא זיהיתי את עמודות המחסנים ב-${file}.\n  הכותרות: ${head.join(' | ')}`,
    );
  }
  const warehouses = head.slice(first, last);
  const at = (name) => head.indexOf(name);
  const cols = {
    altCode: at('מק"ט חלופי'), name: at('תיאור פריט'), model: at('דגם'),
    color: at('צבע'), size: at('מידה'), department: at('מחלקה'),
    salePrice: at('מחיר מכירה'), price1: at('מחירון 1'), total: at('סה"כ מלאי'),
    modelCode: at('קוד דגם'), group: at('קבוצה'), code: at('פריט'), barcode: at('ברקוד'),
  };

  const items = new Map();
  for (const r of rows.slice(1)) {
    const code = (r[cols.code] ?? '').trim();
    if (!code) continue;
    const per = {};
    warehouses.forEach((w, i) => { per[w] = num(r[first + i]); });
    items.set(code, {
      code,
      altCode: (r[cols.altCode] ?? '').trim(),
      name: (r[cols.name] ?? '').trim(),
      model: (r[cols.model] ?? '').trim(),
      modelCode: (r[cols.modelCode] ?? '').trim(),
      color: (r[cols.color] ?? '').trim(),
      size: (r[cols.size] ?? '').trim(),
      department: (r[cols.department] ?? '').trim(),
      group: (r[cols.group] ?? '').trim(),
      barcode: (r[cols.barcode] ?? '').trim(),
      salePrice: (r[cols.salePrice] ?? '').trim(),
      price1: (r[cols.price1] ?? '').trim(),
      total: num(r[cols.total]),
      per,
    });
  }
  return { file, warehouses, items };
}

/* ── the matrix export: fresher numbers, anonymous columns ─────────────── */

/**
 * `מטריצת מחסנים ... .csv` → `{ warehouses, items }`, columns resolved.
 *
 * Two things here are deliberate. The name is taken as *everything between* the
 * second field and the last six, because item names are unquoted in this export
 * and one containing a comma would otherwise shift every warehouse one place to
 * the left — silently. And the first numeric column is verified to equal the sum
 * of the rest before anything else is believed about the layout.
 */
export function loadMatrix(file = newest(MATRIX_RE), { reference = null } = {}) {
  if (!file) return null;
  const rows = parseCsv(decodeCsv(file));
  const head = rows[0] ?? [];

  // Trailing block of stock columns: total first, then one per warehouse.
  let width = 0;
  while (width < head.length && /^(מלאי|יתרת מלאי)$/.test(head[head.length - 1 - width])) width++;
  const labelled = head.slice(head.length - width + 1).some((h) => !/^(מלאי|יתרת מלאי)$/.test(h));
  if (width < 2) {
    throw new Error(
      `לא זיהיתי עמודות מלאי ב-${file}.\n  הכותרות: ${head.join(' | ')}`,
    );
  }
  if (head[1] !== 'פריט' || head[2] !== 'שם פריט') {
    throw new Error(
      `מבנה לא מוכר ב-${file} — ציפיתי ל"פריט" ו"שם פריט".\n  הכותרות: ${head.join(' | ')}`,
    );
  }

  const raw = [];
  for (const r of rows.slice(1)) {
    if (r.length < width + 3) continue;
    const code = (r[1] ?? '').trim();
    if (!code) continue;
    const nums = r.slice(r.length - width).map(num);
    const [total, ...per] = nums;
    const sum = per.reduce((a, b) => a + b, 0);
    if (total !== sum) {
      throw new Error(
        `ב-${file} השורה של פריט ${code} לא מסתדרת: סה"כ ${total} מול סכום המחסנים ${sum}.\n` +
        '  אם המבנה השתנה, לא מנחשים — לייצא מחדש או לתקן את הקורא.',
      );
    }
    raw.push({ code, name: r.slice(2, r.length - width).join(',').trim(), total, per });
  }
  if (!raw.length) throw new Error(`אין שורות ב-${file}.`);

  const warehouses = labelled
    ? head.slice(head.length - width + 1)
    : calibrate(raw, reference ?? loadNamed(), file);

  const items = new Map();
  for (const r of raw) {
    const map = {};
    warehouses.forEach((w, i) => { map[w] = r.per[i] ?? 0; });
    items.set(r.code, { code: r.code, name: r.name, total: r.total, per: map });
  }
  return { file, warehouses, items, calibrated: !labelled };
}

/**
 * Name the anonymous columns by matching them against the named export.
 *
 * Only rows where the named export holds a *positive* balance vote: zeros agree
 * with every column and would hand the answer to whichever warehouse is emptiest.
 * A column is accepted only on a clear, unique winner — 80% of the votes it saw,
 * and no two columns claiming the same warehouse.
 */
function calibrate(raw, named, file) {
  if (!named) {
    throw new Error(
      `${file} לא נושא שמות מחסנים בכותרת, ואין ב-content/ קובץ מלאי-מלא-*.csv להצליב מולו.\n` +
      '  בלי הצלבה אני לא יודע איזו עמודה זה איזה מחסן — ולא מנחש.',
    );
  }
  const width = raw[0].per.length;
  const votes = named.warehouses.map(() => new Array(width).fill(0));
  const seen = named.warehouses.map(() => 0);

  for (const r of raw) {
    const ref = named.items.get(r.code);
    if (!ref) continue;
    named.warehouses.forEach((w, wi) => {
      const v = ref.per[w];
      if (!(v > 0)) return;
      seen[wi] += 1;
      for (let ci = 0; ci < width; ci++) if (r.per[ci] === v) votes[wi][ci] += 1;
    });
  }

  const cols = new Array(width).fill(null);
  const weak = [];
  named.warehouses.forEach((w, wi) => {
    if (!seen[wi]) { weak.push(`${w}: אין אף פריט עם יתרה חיובית להצליב`); return; }
    const scored = votes[wi].map((n, ci) => ({ ci, n })).sort((a, b) => b.n - a.n);
    const best = scored[0];
    const ratio = best.n / seen[wi];
    if (ratio < 0.8 || best.n === scored[1]?.n) {
      weak.push(`${w}: העמודה הכי מתאימה (#${best.ci + 1}) מסבירה רק ${Math.round(ratio * 100)}% מ-${seen[wi]} פריטים`);
      return;
    }
    if (cols[best.ci]) { weak.push(`${w} ו-${cols[best.ci]} נופלים שניהם על עמודה #${best.ci + 1}`); return; }
    cols[best.ci] = w;
  });

  const unresolved = cols.map((w, i) => (w ? null : `#${i + 1}`)).filter(Boolean);
  if (unresolved.length) {
    throw new Error(
      `לא הצלחתי לזהות את עמודות המחסנים ב-${file} — נשארו ${unresolved.join(', ')}.\n` +
      `  ${weak.join('\n  ')}\n` +
      `  הוצלב מול ${named.file.split(/[\\/]/).pop()}. אם הייצוא כולל מחסן שאין בו — צריך ייצוא מלא חדש.`,
    );
  }
  return cols;
}

/* ── the merged view ───────────────────────────────────────────────────── */

let cache = null;

/**
 * The stock picture as `content/` has it: freshest balances, full identity.
 *
 * The matrix is the newer number and the named export is the only one that
 * knows what an item *is*, so the two are merged rather than ranked. Where they
 * disagree the matrix wins and `named.per` is kept alongside, because a gap
 * between the two is usually the real answer to "מתי זה נמדד".
 *
 * The one thing this view will not do is invent a zero. An item missing from
 * the matrix is missing because the report was filtered to מלאי מעל 0 — that is
 * `≤ 0 in the warehouses the report covered`, not `0 everywhere`.
 */
export function stock({ reload = false } = {}) {
  if (cache && !reload) return cache;

  const named = loadNamed();
  const matrix = (() => {
    try { return loadMatrix(undefined, { reference: named }); }
    catch (e) { return { error: e.message }; }
  })();

  if (!named && (!matrix || matrix.error)) {
    throw new Error(`אין ייצוא מלאי ב-${CONTENT_DIR}.`);
  }

  const live = matrix && !matrix.error ? matrix : null;
  const warehouses = live?.warehouses ?? named?.warehouses ?? [];
  const items = new Map();

  const put = (code, patch) => {
    const cur = items.get(code) ?? { code };
    items.set(code, { ...cur, ...patch });
  };

  for (const [code, r] of named?.items ?? []) {
    put(code, { ...r, per: live ? null : r.per, total: live ? null : r.total, namedPer: r.per, namedTotal: r.total });
  }
  for (const [code, r] of live?.items ?? []) {
    const known = items.get(code);
    put(code, { per: r.per, total: r.total, name: known?.name || r.name });
  }
  // Items only the named export knows about keep its (older) numbers.
  for (const r of items.values()) {
    if (r.per == null) { r.per = r.namedPer ?? {}; r.total = r.namedTotal ?? 0; r.stale = true; }
  }

  cache = {
    warehouses,
    items,
    source: {
      named: named?.file ?? null,
      matrix: live?.file ?? null,
      matrixError: matrix?.error ?? null,
      calibrated: live?.calibrated ?? false,
      covers: live ? 'רק פריטים עם מלאי מעל 0' : 'הייצוא המלא',
    },
  };
  return cache;
}

/** How an item should be shown to Dror: מק"ט חלופי, or דגם + צבע. Never a barcode. */
export function label(r) {
  const id = r.altCode || [r.model || r.name, r.color].filter(Boolean).join(' ') || r.code;
  return [id, r.name && r.name !== id ? r.name : null, r.size ? `מידה ${r.size}` : null]
    .filter(Boolean).join(' · ');
}

/**
 * Find items by מק"ט חלופי, פריט, ברקוד, or free text over name/model/colour.
 *
 * Exact identifier hits win outright and are returned alone — a search for a
 * מק"ט that also appears inside twenty item names should not bury it.
 */
export function find(query, { limit = 30, withStock = false } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const all = [...stock().items.values()];
  const pool = withStock ? all.filter((r) => r.total > 0) : all;

  const norm = (s) => String(s ?? '').toLowerCase();
  const exact = pool.filter((r) => [r.altCode, r.code, r.barcode].some((v) => norm(v) === norm(q)));
  if (exact.length) return exact;

  const words = norm(q).split(/\s+/).filter(Boolean);
  const hay = (r) => norm([r.altCode, r.name, r.model, r.modelCode, r.color, r.size, r.department, r.code].join(' '));
  return pool
    .filter((r) => { const h = hay(r); return words.every((w) => h.includes(w)); })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/** Where one item sits, best warehouse first. Empty warehouses are dropped. */
export function whereIs(code) {
  const r = stock().items.get(String(code).trim());
  if (!r) return null;
  return {
    item: r,
    at: Object.entries(r.per).filter(([, q]) => q !== 0).sort((a, b) => b[1] - a[1])
      .map(([warehouse, qty]) => ({ warehouse, qty })),
  };
}

/** Everything one warehouse holds, biggest first. */
export function inWarehouse(name, { limit = 0 } = {}) {
  const s = stock();
  const w = s.warehouses.find((x) => x === name)
    ?? s.warehouses.find((x) => x.includes(name) || name.includes(x));
  if (!w) {
    throw new Error(`אין מחסן "${name}" בייצוא. יש: ${s.warehouses.join(' · ')}`);
  }
  const rows = [...s.items.values()].filter((r) => (r.per[w] ?? 0) > 0)
    .sort((a, b) => (b.per[w] ?? 0) - (a.per[w] ?? 0));
  return { warehouse: w, rows: limit ? rows.slice(0, limit) : rows, units: rows.reduce((a, r) => a + r.per[w], 0) };
}
