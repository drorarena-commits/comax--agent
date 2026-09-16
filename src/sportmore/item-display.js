/**
 * איך פריט מוצג לדרור — שורה אחת, תמיד באותם שדות.
 *
 * כלל קבוע של דרור: בכל דיווח על פריטים — מק"ט **וגם** מק"ט חלופי, וגם תיאור
 * צבע כשהוא קיים. לא ברקוד בלבד ולא מק"ט בלבד. ⛔ **ושדה שחסר נכתב "חסר"** —
 * עמודה שנעלמת בשקט נראית כמו פריט שאין לו צבע, ולא כמו מידע שלא נמצא.
 *
 *   אב  — מק"ט · מק"ט חלופי · תיאור
 *   בן  — מק"ט · מק"ט חלופי · תיאור · תיאור צבע
 *
 * **מאיפה כל שדה, ולמה:**
 *
 *   מק"ט חלופי של **בן** — \`קוד חלופי\` בקטלוג קומקס (\`content/פריטים-מלא-*.csv\`),
 *   לפי ברקוד. לא מכרטיס ספורט אנד מור: שם \`פריט מקביל\` של בן הוא קוד **האב**
 *   (\`000022555\`), כלומר רזולוציה לא נכונה.
 *
 *   מק"ט חלופי של **אב** — \`פריט מקביל\` בכרטיס, שהוא המק"ט בלי \`AR\`. לאב שאינו
 *   בכרטיס (מחשבונית, או אב יתום) — מאותו מקור שממנו נגזר: דגם+צבע מהחשבונית,
 *   או \`פריט מקביל\` של הבנים.
 *
 *   תיאור צבע — \`שם פריט באנגלית\` בקטלוג קומקס (\`SILVER-BLACK-BLACK\`). ⚠️ **לא**
 *   \`שם צבע\`, שמחזיק למרות שמו את **מספר** הצבע (555). ולפריט חדש שעוד אינו
 *   בקומקס — \`Color description\` מחשבונית ארנה. כרטיס ספורט אנד מור **אינו
 *   מחזיק תיאור צבע כלל**: \`צבע2\` הוא תמיד \`00\` אצל בן.
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTENT_DIR, decodeCsv, parseCsv } from '../catalog/local-stock.js';

export const MISSING = 'חסר';

let comax = null;

/** ברקוד/פריט ⇒ { altCode, colorDesc, name }. נטען פעם אחת. */
export function comaxCatalog() {
  if (comax) return comax;
  comax = { index: new Map(), file: null, error: null };
  try {
    const file = readdirSync(CONTENT_DIR).filter((f) => /^פריטים-מלא-.*\.csv$/.test(f)).sort().pop();
    if (!file) throw new Error('אין content/פריטים-מלא-*.csv');
    const rows = parseCsv(decodeCsv(resolve(CONTENT_DIR, file)));
    const h = rows[0] ?? [];
    const at = (name) => h.indexOf(name);
    const iItem = at('פריט'), iBarcode = at('ברקוד'), iAlt = at('קוד חלופי');
    const iColor = at('שם פריט באנגלית'), iName = at('שם פריט');
    if (iAlt < 0 || iColor < 0) throw new Error(`בקטלוג ${file} חסרות העמודות "קוד חלופי" או "שם פריט באנגלית"`);
    for (const r of rows.slice(1)) {
      const rec = { altCode: (r[iAlt] ?? '').trim(), colorDesc: (r[iColor] ?? '').trim(), name: (r[iName] ?? '').trim() };
      for (const key of [r[iBarcode], r[iItem]]) {
        const k = String(key ?? '').trim();
        if (k && !comax.index.has(k)) comax.index.set(k, rec);
      }
    }
    comax.file = file;
  } catch (e) {
    comax.error = e.message;
  }
  return comax;
}

/**
 * אזהרה אחת, כשהקטלוג לא נטען. בלעדיה כל שורה הייתה אומרת "חסר" בלי שיהיה
 * ברור שהחוסר הוא של הקטלוג ולא של הפריט.
 */
export function catalogWarning() {
  const c = comaxCatalog();
  return c.error ? `⚠  קטלוג קומקס לא נטען (${c.error}) — מק"ט חלופי ותיאור צבע יוצגו כ"${MISSING}".` : null;
}

const or = (v) => (String(v ?? '').trim() || MISSING);

export function parentLine({ sku, altSku, desc }) {
  return `${or(sku)} · חלופי ${or(altSku)} · ${or(desc)}`;
}

export function childLine({ sku, altSku, desc, colorDesc }) {
  return `${or(sku)} · חלופי ${or(altSku)} · ${or(desc)} · צבע ${or(colorDesc)}`;
}

/** בן מתוך שורת חשבונית של ארנה. הצבע מקומקס קודם, ואחר כך מהחשבונית. */
export function childFromInvoice(row, { sku, barcode }) {
  const c = comaxCatalog().index.get(String(barcode ?? '').trim());
  return {
    sku,
    altSku: c?.altCode,
    desc: row.styleDesc || row.articleDesc,
    colorDesc: c?.colorDesc || row.colorDesc,
  };
}

/** אב מתוך שורת חשבונית: המק"ט החלופי הוא דגם+צבע, כמו ב-\`פריט מקביל\` בכרטיס. */
export function parentFromInvoice(row, sku) {
  const style = String(row.style ?? '').trim();
  const color = String(row.colorCode ?? '').trim();
  return { sku, altSku: style && color ? style + color : '', desc: row.styleDesc || row.articleDesc };
}

/** אב יתום — יש לו בנים בכרטיס ואין לו שורה. הנתונים מהבנים, לא מניחוש. */
export function parentFromOrphan(sku, kids = []) {
  const first = kids.find((k) => k.supplierSku) ?? kids[0] ?? {};
  return { sku, altSku: first.supplierSku, desc: first.desc };
}
