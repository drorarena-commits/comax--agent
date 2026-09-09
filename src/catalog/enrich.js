/**
 * העשרת פריטים לתצוגה — כלל 5 במקום אחד.
 *
 * קומקס מחזיר בכל מסך את **הקוד** של הפריט בלבד. כלל 5 אומר שלדרור מציגים
 * מק"ט חלופי או דגם+צבע, ולעולם לא ברקוד. הגשר בין השניים הוא הקטלוג המקומי
 * (`data/catalog/items.json`), וזה המקום היחיד שיודע לחצות אותו.
 *
 * היה עותק פרטי של הלוגיקה הזאת ב-`customer-history`, ו-`customer-movements`
 * לא העשיר בכלל — כלומר אותו דוח החזיר ברקודים גולמיים. מודול אחד מונע את זה.
 *
 * ⚠️ `data/` לא נשמר ב-git. במחשב שלא בנה את הקטלוג הקובץ פשוט לא קיים, וזה
 * לא מקרה קצה נדיר אלא מה שקורה בכל מחשב חדש. לכן הכשל כאן **רועש**: דוח
 * שמפר את כלל 5 בשקט גרוע מדוח שאומר שחסר לו מידע.
 */
import { load } from './search.js';

let index = null;
let state = null;

/** barcode/code → רשומת קטלוג. מפה ריקה כשהקטלוג חסר — עם `state` שמסביר. */
export function itemIndex() {
  if (index) return index;
  index = new Map();
  try {
    const data = load('items');
    for (const r of data.records ?? []) {
      if (r.code) index.set(String(r.code).trim(), r);
      if (r.barcode) index.set(String(r.barcode).trim(), r);
    }
    state = index.size ? { ok: true, size: index.size } : { ok: false, reason: 'הקטלוג ריק' };
  } catch (e) {
    state = { ok: false, reason: e.message };
  }
  return index;
}

export function catalogState() {
  itemIndex();
  return state;
}

/**
 * איך פריט נראה לדרור: מק"ט חלופי, ואם אין — דגם+צבע. הקוד הגולמי הוא
 * המוצא האחרון, והוא מסומן `enriched: false` כדי שהקורא יוכל להתריע.
 */
export function itemLabel(code) {
  const raw = String(code ?? '').trim();
  const rec = itemIndex().get(raw);
  if (!rec) return { label: raw, enriched: false, rec: null };

  const alt = String(rec.altCode ?? '').trim();
  if (alt) return { label: alt, enriched: true, rec };

  const model = String(rec.modelCode ?? '').trim();
  const color = String(rec.colorCode ?? '').trim();
  if (model) return { label: color ? `${model}-${color}` : model, enriched: true, rec };

  return { label: raw, enriched: false, rec };
}

/**
 * האזהרה שמלווה דוח שהודפס בלי קטלוג. רועשת בכוונה.
 */
export function catalogWarning() {
  const s = catalogState();
  if (!s || s.ok) return null;
  return (
    `⚠️  הקטלוג לא נטען — ${s.reason}\n` +
    '    הפריטים מוצגים לפי ברקוד ולא לפי מק"ט חלופי, בניגוד לכלל 5.\n' +
    '    להעתיק את data/catalog/items.json ממחשב שכבר בנה אותו, או להריץ ייצוא ובנייה מחדש.'
  );
}

/** לבדיקות: לשכוח את מה שנטען, כדי שהטעינה הבאה תקרא מהדיסק מחדש. */
export function resetCatalog() {
  index = null;
  state = null;
}
