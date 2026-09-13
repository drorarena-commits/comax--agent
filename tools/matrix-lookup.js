/**
 * חיפוש במטריצות המוצר של ארנה — לפי **ברקוד (EAN)** או לפי **דגם (Style)**.
 *
 *   node tools/matrix-lookup.js ean 3468336687048
 *   node tools/matrix-lookup.js style 004900
 *   node tools/matrix-lookup.js colors 004900        # רק צבע → שם צבע
 *
 * הקבצים נסרקים לפי הסדר: "D. FW26 Global EN Global" (המלא, 49 עמודות) ואז
 * Teamline/Racing (שמכילים פחות שדות אבל מכסים דגמי 1D...).
 *
 * ⚠️ **הכיוון הוא קומקס ⇒ מטריצה, תמיד.** הכלי הזה **מעשיר** פריט שכבר נבחר
 * מקובץ הפריטים; הוא לעולם לא קובע מה מקימים. צבע שקיים כאן ולא בקומקס הוא
 * סחורה שלא הוזמנה, לא פער לתקן.
 *
 * ⚠️ **שורת הכותרת אינה תמיד הראשונה** — ב-Teamline היא שורה 1 וב-AINT היא
 * עמוקה יותר. לכן מאתרים אותה לפי הימצאות `Style` **וגם** `Colorway`, ולא
 * לפי מספר שורה קבוע.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MX = process.env.MATRIX_DIR
  || 'C:/Users/user/AppData/Local/Temp/claude/C--AGENT-COMAX-CLOAD/6103d884-9989-4f7a-9897-53f17bb7e503/scratchpad/mx';

function parseCsv(text) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); f = ''; rows.push(row); row = []; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/** טוען כל גיליון שיש בו `Style` ו-`Colorway` באותה שורה, ומחזיר רשומות ממופתחות. */
function load() {
  if (!existsSync(MX)) return [];
  const out = [];
  for (const file of readdirSync(MX).filter(f => f.endsWith('.csv'))) {
    const rows = parseCsv(readFileSync(join(MX, file), 'utf8'));
    const hi = rows.findIndex(r => r.some(c => /^style$/i.test(c.trim())) && r.some(c => /colorway/i.test(c)));
    if (hi < 0) continue;
    const hdr = rows[hi].map(c => c.replace(/^\uFEFF/, '').trim());
    for (const r of rows.slice(hi + 1)) {
      if (r.every(c => !c.trim())) continue;
      const o = { _file: file };
      hdr.forEach((h, i) => { if (h) o[h] = (r[i] ?? '').trim(); });
      if (o.Style) out.push(o);
    }
  }
  return out;
}

const ALL = load();
const norm = s => String(s || '').trim().replace(/^0+/, '').toUpperCase();

export function byEan(ean) {
  const e = String(ean).trim();
  return ALL.filter(r => (r.EAN || '').trim() === e);
}
export function byStyle(style) {
  const s = norm(style);
  return ALL.filter(r => norm(r.Style) === s);
}
/** מפה `קוד צבע → שם צבע` לדגם. הקוד מוחזר גם מרופד וגם לא, כי קומקס מוריד אפסים. */
export function colorsOf(style) {
  const m = new Map();
  for (const r of byStyle(style)) {
    const code = (r.Colorway || '').trim();
    const name = (r['Colorway Description'] || '').trim();
    if (!code || !name) continue;
    m.set(code, name);
    m.set(code.replace(/^0+/, ''), name);
  }
  return m;
}

// ⚠️ ב-Windows `file://${path}` נותן שתי לוכסנים ו-import.meta.url שלוש — ההשוואה
// הישירה נכשלת בשקט והכלי פשוט לא מדפיס כלום. pathToFileURL מיישר את שניהם.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, arg] = process.argv.slice(2);
  if (!ALL.length) { console.error(`אין מטריצות ב-${MX} — להריץ קודם: node tools/xlsx.js <קובץ> <תיקייה>`); process.exit(1); }
  if (mode === 'ean') {
    const hits = byEan(arg);
    if (!hits.length) console.log('לא נמצא במטריצה:', arg);
    else for (const r of hits) console.log(JSON.stringify(r, null, 1));
  } else if (mode === 'style') {
    const hits = byStyle(arg);
    console.log(`${hits.length} שורות לדגם ${arg}`);
    if (hits.length) {
      const r = hits[0];
      for (const k of ['_file', 'Style Description', 'Name for the Internet', 'Style Composition',
        'Extended Description ', 'Keywords', 'Main Material', 'Care Label',
        'Product Feature 1', 'Product Feature 2', 'Product Feature 3',
        'Product Feature 4', 'Product Feature 5', 'Product Feature 6',
        'Consumer Target', 'Usage Environment', 'Usage Purpose'])
        if (r[k]) console.log(`\n■ ${k.trim()}:\n${r[k]}`);
      console.log('\n■ צבעים:');
      for (const [c, n] of colorsOf(arg)) if (/^\d{3}$|^\d{2}$/.test(c)) console.log(`  ${c} = ${n}`);
    }
  } else if (mode === 'colors') {
    for (const [c, n] of colorsOf(arg)) console.log(c, '=', n);
  } else {
    console.error('שימוש: node tools/matrix-lookup.js ean|style|colors <ערך>');
    process.exit(1);
  }
}
