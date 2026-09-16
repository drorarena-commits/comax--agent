/**
 * איך פריט מוצג לדרור — שורה אחת, תמיד באותם שדות.
 *
 * כלל קבוע של דרור: בכל דיווח על פריטים — מק"ט **וגם** מק"ט חלופי, ותיאור צבע
 * כשהוא קיים. ⛔ **שדה שחסר נכתב "חסר"** — עמודה שנעלמת בשקט נראית כמו פריט בלי
 * צבע, ולא כמו מידע שלא נמצא.
 *
 *   אב  — מק"ט · מק"ט חלופי · תיאור
 *   בן  — מק"ט · מק"ט חלופי · תיאור · תיאור צבע
 *
 * ⛔ **אין כאן אף ערך נגזר ואין פרסור מחרוזות.** כל שדה הוא שדה שלם ממקור אחד,
 * וכשאין שדה כזה — "חסר". דרור (16/09/2026): "אני מעדיף שדה שלם גם אם הוא פחות
 * יפה על פני מחרוזת מפורסרת." נוסחה שנראית נכונה ומחזירה שטות בלי להיכשל היא
 * גרועה מ"חסר".
 *
 * ── המקורות ────────────────────────────────────────────────────────────────
 *
 *   **תיאור** — \`Style description\` מחשבונית ארנה (לפריט מהחשבונית), או \`תאור\`
 *   מכרטיס ספורט אנד מור. שדה שלם.
 *
 *   **תיאור צבע** — \`Color description\` מחשבונית ארנה. שדה שלם, והוא שדה הצבע
 *   של ארנה עצמה (\`550-BLACK-WHITE\`, עם קוד הצבע בתחילתו). כרטיס ספורט אנד מור
 *   **אינו מחזיק תיאור צבע כלל** (\`צבע2\` תמיד \`00\` אצל בן).
 *   ⚠️ **לא** \`שם פריט באנגלית\` מקטלוג קומקס: זה שדה שם הפריט, לא שדה צבע. נמדד
 *   מול חשבונית 28.5: הוא זהה ל-Color description רק ב-54 מתוך 114 — בשאר קוד
 *   הצבע נחתך ממנו ידנית (\`NAVY-WHITE\` מול \`75-NAVY-WHITE\`). כלומר תוכנו צבע
 *   רק כי מישהו מילא אותו כך, ולא כי זה מה שהשדה אומר.
 *
 *   **מק"ט חלופי של אב** — \`פריט מקביל\` מכרטיס ספורט אנד מור, כשיש לו שורה
 *   (לאב יתום: \`פריט מקביל\` של הבנים). אב חדש מהחשבונית **אין לו** שדה כזה, ולכן
 *   "חסר". ⚠️ לא \`מק"ט בלי AR\`: הזהות הזאת מתקיימת רק ב-599 מתוך 728 אבות.
 *
 *   **מק"ט חלופי של בן** — \`קוד חלופי\` מקטלוג קומקס, לפי ברקוד. ⬇ ראה החריגה.
 *
 * ── ⚠️ החריגה לגבול: קריאה מקומקס, לתצוגה בלבד ──────────────────────────────
 *
 * \`sportmore-items\` הוא מפעל אקסלים לפריוריטי, וקריאת קומקס **אינה שלו**. הקריאה
 * היחידה כאן היא חריגה מוצהרת, ורק משום שנבדק שאין לה חלופה בתוך הגבול:
 *
 *   הקוד החלופי **אינו בכרטיס.** מק"ט הבן בכרטיס הוא הקוד של פריוריטי
 *   (\`אב + מידה + 00\` ב-1,674 מתוך 2,636 בנים), והוא זהה ל-\`קוד חלופי\` בקומקס
 *   רק ב-911 מתוך 1,999.
 *
 *   **ואי אפשר לגזור אותו משדות שלמים.** הנוסחה \`אב + 00 + מידה\` משחזרת את
 *   הערך שבקומקס רק ב-1,214 מתוך 1,999: ב-31 המידה בכרטיס \`OS\` ובקומקס \`0\`,
 *   וב-754 הקוד בקומקס בפורמט מורשת שאין לו כלל (\`001130553/55\`,
 *   \`AR00241890055\`). נוסחה כאן הייתה מציגה קוד שאינו מה שדרור רואה בקומקס.
 *
 * ולכן היא כפופה לשלושה תנאים מחייבים:
 *
 *   1. **תצוגה בלבד.** אינה משפיעה על מה מוקם, מה נכנס לקובץ או על סדר השורות.
 *      נאכף בבדיקה: אף מודול תחת \`src/sportmore/\` אינו מייבא את הקובץ הזה —
 *      רק \`tools/sportmore.js\`, ורק כדי להדפיס.
 *   2. **לא חוסמת.** קטלוג חסר, ישן או לא קריא — ההרצה ממשיכה עם נתוני הכרטיס
 *      והחשבונית, ומודפסת שורה אחת שאומרת שההעשרה לא זמינה. לא נכשלת, לא
 *      עוצרת, לא שואלת. גם מודול הקריאה נטען בתוך ה-try, כדי שתקלה בו לא תפיל
 *      את ה-CLI.
 *   3. **אינה תקדים.** אין להסיק ממנה שמותר ל-\`sportmore-items\` לקרוא קומקס
 *      לשום צורך אחר.
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

export const MISSING = 'חסר';

let comax = null;

/**
 * ברקוד ⇒ קוד חלופי מקטלוג קומקס. **תצוגה בלבד, ולעולם לא זורק.**
 * נטען פעם אחת, ורק כשמישהו מבקש להציג פריט.
 */
export async function loadComaxAltCodes({ dir = resolve(ROOT, 'content'), fresh = false } = {}) {
  if (comax && !fresh) return comax;
  comax = { index: new Map(), file: null, error: null };
  try {
    // נטען בתוך ה-try: אם מודול הקריאה עצמו שבור, ההעשרה פשוט לא זמינה.
    const { decodeCsv, parseCsv } = await import('../catalog/local-stock.js');
    const file = readdirSync(dir).filter((f) => /^פריטים-מלא-.*\.csv$/.test(f)).sort().pop();
    if (!file) throw new Error('אין content/פריטים-מלא-*.csv');
    const rows = parseCsv(decodeCsv(resolve(dir, file)));
    const h = rows[0] ?? [];
    const iBarcode = h.indexOf('ברקוד');
    const iAlt = h.indexOf('קוד חלופי');
    if (iBarcode < 0 || iAlt < 0) throw new Error(`בקטלוג ${file} חסרות העמודות "ברקוד" או "קוד חלופי"`);
    for (const r of rows.slice(1)) {
      const bc = String(r[iBarcode] ?? '').trim();
      const alt = String(r[iAlt] ?? '').trim();
      if (bc && alt && !comax.index.has(bc)) comax.index.set(bc, alt);
    }
    comax.file = file;
  } catch (e) {
    comax.error = e.message;
  }
  return comax;
}

/** שורה אחת כשההעשרה לא זמינה. null כשהכול תקין. */
export function enrichmentNotice() {
  if (!comax?.error) return null;
  return `ℹ  העשרת מק"ט חלופי מקומקס לא זמינה (${comax.error}) — מוצג "${MISSING}", וההרצה ממשיכה כרגיל.`;
}

const or = (v) => (String(v ?? '').trim() || MISSING);

export function parentLine({ sku, altSku, desc }) {
  return `${or(sku)} · חלופי ${or(altSku)} · ${or(desc)}`;
}

export function childLine({ sku, altSku, desc, colorDesc }) {
  return `${or(sku)} · חלופי ${or(altSku)} · ${or(desc)} · צבע ${or(colorDesc)}`;
}

/** בן מתוך שורת חשבונית. דורש \`loadComaxAltCodes()\` קודם; בלעדיו החלופי "חסר". */
export function childFromInvoice(row, { sku, barcode }) {
  return {
    sku,
    altSku: comax?.index.get(String(barcode ?? '').trim()),
    desc: row.styleDesc || row.articleDesc,
    colorDesc: row.colorDesc,
  };
}

/** אב חדש מהחשבונית: אין לו שדה חלופי שלם בשום מקור בתוך הגבול — "חסר". */
export function parentFromInvoice(row, sku) {
  return { sku, altSku: null, desc: row.styleDesc || row.articleDesc };
}

/** אב יתום — יש לו בנים בכרטיס ואין לו שורה. \`פריט מקביל\` ו\`תאור\` של הבנים. */
export function parentFromOrphan(sku, kids = []) {
  const first = kids.find((k) => k.supplierSku) ?? kids[0] ?? {};
  return { sku, altSku: first.supplierSku, desc: first.desc };
}
