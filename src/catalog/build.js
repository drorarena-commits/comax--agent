/**
 * Turns a Comax export into a normalized catalog under data/catalog/.
 *
 * The Hebrew column headings are mapped to stable English keys once, here, so
 * the rest of the project never depends on a heading Comax might reword.
 */
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { parseExport, parseDelimited } from './parse.js';
import { CATALOG_DIR } from './search.js';

const DOWNLOADS = resolve(ROOT, 'runs/downloads');
const CONTENT = resolve(ROOT, 'content');

/** Column mapping per catalog: englishKey -> Hebrew heading in the export. */
const SCHEMAS = {
  items: {
    columns: {
      code: 'פריט',
      name: 'שם פריט',
      altName: 'שם חלופי',
      altCode: 'קוד חלופי',
      nameEn: 'שם פריט באנגלית',
      nameForeign: 'שם פריט בלועזית',
      barcode: 'ברקוד',
      departmentCode: 'מחלקה',
      department: 'שם מחלקה',
      groupCode: 'קבוצה',
      group: 'שם קבוצה',
      subGroupCode: 'קבוצת משנה',
      subGroup: 'שם קבוצת משנה',
      modelCode: 'דגם',
      model: 'שם דגם',
      // "שם צבע" holds the colour *number* (565, 600...) despite its heading,
      // and the readable colour ("SMOKE-BLACK-BLUE") lives in the English name.
      colorCode: 'שם צבע',
      size: 'שם מידה',
      extraCode: 'נוסף',
      extra: 'שם נוסף',
      miscCode: 'שונות',
      misc: 'שם שונות',
      price1: 'מחיר מחירון 1',
      price2: 'מחיר מחירון 2',
      stock: 'יתרת מלאי',
    },
    // `nameEn` is included because it carries the colour description.
    searchFields: [
      'code', 'name', 'altName', 'altCode', 'nameEn', 'nameForeign',
      'barcode', 'modelCode', 'model', 'colorCode', 'size', 'extra', 'misc',
    ],
    key: 'code',
  },
  customers: {
    // From the customers export (a133), saved tab-delimited.
    columns: {
      code: 'קוד',
      name: 'שם',
      address: 'כתובת',
      city: 'ישוב',
      phone: 'טלפון',
      mobile: 'נייד',
      email: 'Email',
      groupCode: 'קוד קבוצה',
      group: 'שם קבוצה',
      priceList: 'מחירון משויך',
    },
    searchFields: ['code', 'name', 'city', 'phone', 'mobile', 'email'],
    key: 'code',
    delimiter: '\t',
  },
};

/** Newest download matching a pattern, so we always build from the latest run. */
export function latestDownload(pattern = /\.xls$/i) {
  const files = readdirSync(DOWNLOADS)
    .filter((f) => pattern.test(f))
    .map((f) => ({ f, t: statSync(resolve(DOWNLOADS, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`אין קבצי ייצוא ב-${DOWNLOADS}`);
  return resolve(DOWNLOADS, files[0].f);
}

/** Newest file in content/, where exports saved by hand are kept. */
export function latestContent(pattern = /./) {
  const files = readdirSync(CONTENT)
    .filter((f) => pattern.test(f))
    .map((f) => ({ f, t: statSync(resolve(CONTENT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`אין קבצים תואמים ב-${CONTENT}`);
  return resolve(CONTENT, files[0].f);
}

export function build(catalog, file) {
  const schema = SCHEMAS[catalog];
  if (!schema) throw new Error(`אין סכימה לקטלוג "${catalog}"`);

  // A schema that names a delimiter comes from a plain text export.
  const { headers, rows } = schema.delimiter ? parseDelimited(file, schema.delimiter) : parseExport(file);

  // A renamed or missing column would silently produce empty fields, so say so.
  const missing = Object.entries(schema.columns)
    .filter(([, heading]) => !headers.includes(heading))
    .map(([key, heading]) => `${key} ("${heading}")`);

  const records = rows.map((r) => {
    const out = {};
    for (const [key, heading] of Object.entries(schema.columns)) out[key] = r[heading] ?? '';
    return out;
  }).filter((r) => r[schema.key]);

  mkdirSync(CATALOG_DIR, { recursive: true });
  const data = {
    builtAt: new Date().toISOString(),
    source: file,
    count: records.length,
    searchFields: schema.searchFields,
    missingColumns: missing,
    records,
  };
  const out = resolve(CATALOG_DIR, `${catalog}.json`);
  writeFileSync(out, JSON.stringify(data), 'utf8');
  return { out, count: records.length, missing, headers };
}

export { SCHEMAS };
