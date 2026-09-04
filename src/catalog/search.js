/**
 * Local catalog search.
 *
 * This exists because searching Comax itself is unsafe: pressing Enter on an
 * item field silently resolves to the first match and gives no hint that others
 * existed ("cobra" landed on COBRA ULTRA SWIPE), and the arrow picker filters by
 * code rather than name. Here every match is returned, ranked, and the caller —
 * or Dror — chooses. Comax is then driven with an exact code.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

export const CATALOG_DIR = resolve(ROOT, 'data/catalog');

const cache = new Map();

export function load(name) {
  if (cache.has(name)) return cache.get(name);
  const file = resolve(CATALOG_DIR, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      [
        `הקטלוג "${name}" לא קיים ב-${CATALOG_DIR}.`,
        'data/ לא נשמר ב-git, אז במחשב חדש הוא פשוט חסר.',
        'הכי מהיר: להעתיק את data/catalog/items.json ממחשב שכבר בנה אותו.',
        'לחלופין: ייצוא טרי מקומקס ואז  npm run catalog -- build items <קובץ>',
        '(הבנייה מצפה לייצוא HTML של קומקס, לא ל-CSV שב-content/)',
      ].join('\n'),
    );
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  cache.set(name, data);
  return data;
}

/** Fold away the differences that make Hebrew/English searches miss. */
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')      // niqqud
    .replace(/["'`׳״]/g, '')              // quotes and gershayim
    .replace(/[-_/\\.,()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score a record against the query. Every query token must appear somewhere,
 * so "cobra core" cannot match a plain "cobra" item. Ordering rewards exact and
 * prefix hits, which puts the obvious answer first without hiding the rest.
 */
function score(record, tokens, haystack) {
  let total = 0;
  for (const tok of tokens) {
    if (!haystack.includes(tok)) return 0;
    if (haystack === tok) total += 100;
    else if (haystack.startsWith(tok)) total += 40;
    else if (new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(haystack)) total += 25;
    else total += 10;
  }
  // Prefer shorter names: a tight match beats a long one that merely contains it.
  return total + Math.max(0, 40 - haystack.length / 4);
}

/**
 * Search one catalog. Returns every match, best first — never a single silent
 * pick. `exactField` lets a caller resolve a known code straight through.
 */
export function search(name, query, { fields, limit = 50, exactField = null } = {}) {
  const records = load(name).records;
  const q = normalize(query);
  if (!q) return [];

  if (exactField) {
    const hit = records.filter((r) => normalize(r[exactField]) === q);
    if (hit.length) return hit.map((r) => ({ ...r, _score: 1000, _exact: true }));
  }

  const tokens = q.split(' ').filter(Boolean);
  const cols = fields ?? load(name).searchFields;

  const out = [];
  for (const r of records) {
    const haystack = normalize(cols.map((c) => r[c]).filter(Boolean).join(' '));
    const s = score(r, tokens, haystack);
    if (s > 0) out.push({ ...r, _score: s });
  }
  out.sort((a, b) => b._score - a._score);
  return out.slice(0, limit);
}

/** Convenience wrappers over the two catalogs a document needs. */
export const findItems = (q, opts) => search('items', q, { exactField: 'code', ...opts });
export const findCustomers = (q, opts) => search('customers', q, { exactField: 'code', ...opts });

/**
 * Every variant of one model, which is how Dror actually thinks about stock:
 * a model code plus a colour number. Optionally narrowed to one colour.
 *
 * Note the column naming in the export is misleading — `colorCode` ("שם צבע")
 * is the colour *number*, and the readable description sits in `nameEn`.
 */
export function findModel(modelCode, { color = null } = {}) {
  const wanted = normalize(modelCode);
  let rows = load('items').records.filter((r) => normalize(r.modelCode) === wanted);
  if (!rows.length) {
    // Allow a leading-zero-insensitive match: "3930" should find "003930".
    const loose = wanted.replace(/^0+/, '');
    rows = load('items').records.filter((r) => normalize(r.modelCode).replace(/^0+/, '') === loose);
  }
  if (color != null) {
    const c = normalize(color);
    rows = rows.filter((r) => normalize(r.colorCode) === c);
  }
  return rows.sort((a, b) => String(a.colorCode).localeCompare(String(b.colorCode), 'en', { numeric: true }));
}
