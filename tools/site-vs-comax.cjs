/**
 * מה יש באתר ארנה ישראל ולא קיים בקומקס.
 *
 *   node tools/site-vs-comax.cjs [runs/site-skus.json] [content/פריטים-מלא-<תאריך>.csv]
 *
 * הבאג שהכלי הזה משרת: תוסף הסנכרון של האתר **מפיל הזמנה שלמה** אם אחד
 * הפריטים בה לא קיים בקומקס — ההזמנה לא משודרת, המלאי לא יורד, ואין שגיאה
 * שמישהו רואה. לכן מק"ט שקיים באתר ולא בקומקס אינו "פריט חסר" אלא פצצה
 * מתוזמנת: כל הזמנה עתידית שתכלול אותו תיעלם.
 *
 * ההצלבה היא לפי **מק"ט מדויק** מול שלוש עמודות בייצוא של קומקס — `פריט`,
 * `ברקוד` ו-`קוד חלופי`. שלושתן, כי לא כל פריט בקומקס נושא ברקוד בשדה הברקוד,
 * ובאתר הוזנו לפעמים דווקא המק"ט הפנימי או הקוד החלופי.
 *
 * ⛔ **בלי נרמול.** לא חיתוך סיומות, לא ריפוד באפסים, לא lowercase. מק"ט
 * `3468333894005-41342` באתר אינו `3468333894005` בקומקס — הוא מחרוזת אחרת,
 * והתוסף משווה מחרוזות. "כמעט זהה" הוא בדיוק מה שמפיל את ההזמנה.
 * מה שכן נעשה: לכל מק"ט חסר מדווח גם **החלק שלפני המקף** אם הוא כן נמצא
 * בקומקס — לא כהתאמה, אלא כרמז לאדם שמחליט.
 */
const fs = require('fs');

const parse = (t) => {
  const rows = []; let row = [], cell = '', q = false;
  t = t.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

const sitePath = process.argv[2] || 'runs/site-skus.json';
const catPath = process.argv[3]
  || fs.readdirSync('content').filter((f) => /^פריטים-מלא-.*\.csv$/.test(f)).sort().pop();

const cat = parse(fs.readFileSync(catPath.includes('/') ? catPath : `content/${catPath}`, 'utf8'));
const H = cat[0], ix = (n) => H.indexOf(n);
const C = {
  sku: ix('פריט'), bar: ix('ברקוד'), alt: ix('קוד חלופי'), name: ix('שם פריט'),
  model: ix('שם דגם'), color: ix('שם צבע'), size: ix('שם מידה'), stock: ix('מלאי'),
};

const known = new Map(); // מק"ט כלשהו → השורה בקומקס
for (const r of cat.slice(1)) {
  if (!r[C.sku]) continue;
  for (const k of [r[C.sku], r[C.bar], r[C.alt]]) {
    const v = (k || '').trim();
    if (v && !known.has(v)) known.set(v, r);
  }
}

const site = JSON.parse(fs.readFileSync(sitePath, 'utf8'));
// מוצר-אב של וריאציות אינו נשלח להזמנה — רק הווריאציה. מוצר פשוט כן.
const parents = new Set(site.filter((s) => s.type === 'product_variation').map((s) => s.parent));

const rows = [];
for (const s of site) {
  const sku = String(s.sku ?? '').trim();
  const isParentOfVariations = s.type === 'product' && parents.has(s.id);
  if (isParentOfVariations) continue;            // האב לא נשלח לקומקס
  if (known.has(sku) && sku) continue;           // קיים — אין בעיה
  const base = sku.includes('-') ? sku.split('-')[0] : null;
  const hint = base && known.has(base) ? known.get(base) : null;
  rows.push({
    id: s.id, type: s.type, status: s.status, sku,
    title: String(s.title ?? '').replace(/&#8211;/g, '–').replace(/&amp;/g, '&'),
    empty: !sku,
    hintCode: hint ? hint[C.sku] : '',
    hintAlt: hint ? hint[C.alt] : '',
    hintName: hint ? hint[C.name] : '',
  });
}

const out = 'content/פריטים-באתר-שאין-בקומקס.csv';
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const head = ['מק"ט באתר', 'סוג', 'סטטוס', 'שם המוצר באתר', 'מזהה באתר', 'רמז: מק"ט קומקס לפני המקף', 'רמז: קוד חלופי', 'רמז: שם בקומקס'];
fs.writeFileSync(out, '﻿' + [head.map(esc).join(',')]
  .concat(rows.map((r) => [r.sku, r.type === 'product' ? 'מוצר פשוט' : 'וריאציה', r.status, r.title, r.id, r.hintCode, r.hintAlt, r.hintName].map(esc).join(',')))
  .join('\r\n'), 'utf8');

console.log(`קטלוג קומקס : ${catPath}`);
console.log(`רשומות באתר : ${site.length} (מהן ${site.filter((s) => s.type === 'product_variation').length} וריאציות)`);
console.log(`נבדקו       : ${site.length - site.filter((s) => s.type === 'product' && parents.has(s.id)).length} (מוצרי-אב של וריאציות לא נבדקים — הם לא נשלחים לקומקס)`);
console.log(`חסרים בקומקס: ${rows.length}  · מהם בלי מק"ט כלל: ${rows.filter((r) => r.empty).length}`);
console.log(`נכתב        : ${out}`);
console.log('');
for (const r of rows.slice(0, 60)) {
  console.log(`  ${(r.sku || '(ריק)').padEnd(24)} ${r.status.padEnd(8)} ${r.title.slice(0, 60)}${r.hintCode ? `   ← בקומקס יש ${r.hintCode}` : ''}`);
}
if (rows.length > 60) console.log(`  ... ועוד ${rows.length - 60}`);
