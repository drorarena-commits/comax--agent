/**
 * בניית קובץ יבוא **מחיר עלות** לפריטים שכבר קיימים בקומקס, מדוח רכישות
 * של ספורט אנד מור.
 *
 * זו התשובה לחוב שמתועד ב-`knowledge/MAP.md:2928` וב-
 * `.claude/agents/comax-items.md:114` — "מחיר עלות לא נכנס ביבוא הפריטים,
 * הוא נכנס דרך יבוא מחירונים, מסך אחר וקובץ אחר". היבוא הזה **מעדכן פריטים
 * קיימים בלבד** ולא מקים אף פריט.
 *
 * ⛔ **הכלל הראשון: הדוח לפני כל נגיעה בקומקס.** דרור, 07/09/2026 —
 * "לפני שעושה משהו בקומקס, מראה לי את הדוח עם ההפרשים המודגשים". הכלי הזה
 * רץ מקבצים מקומיים בלבד, ולא פותח דפדפן.
 *
 * ⚠️ **שלוש מלכודות שנמדדו על הקובץ של דרור, וכולן נראות כמו נתונים תקינים:**
 *
 *   1. **34 שורות "חבילות"** — ברקוד `9997`, מק"ט `9997000`, 25₪. הן
 *      **קיימות בקטלוג** כפריט אמיתי, ולכן סינון לפי "לא קיים בקומקס" היה
 *      מכניס אותן. הסינון היחיד שעובד הוא `/^\d{13}$/` על הברקוד.
 *
 *   2. **אותו ברקוד נקנה בכמה מחירים** — 25 מקרים. ברובם זה הפרש אגורות,
 *      אבל `3468337807131` נקנה שלוש פעמים ב-33.55 ופעם ב-**64.50**. "האחרון
 *      גובר" נותן 64.50 והממוצע המשוקלל נותן 37.42 — שתי תשובות שונות לגמרי.
 *      **הכרעת דרור (07/09/2026): הממוצע המשוקלל, לכל הפריטים.** לא רק ל-25
 *      החריגים — לכולם, כי לפריט עם רכישה אחת הוא שווה למחיר היחיד ממילא.
 *      גיליון החריגים נשאר בדוח לעיון, אבל אינו חוסם עוד את בניית הקובץ.
 *
 *   3. **"פער קטן" הוא מסגור שגוי** — מתוך 195 הפערים מול קומקס, רק 45 קטנים
 *      מ-1% ו-**79 גדולים מ-20%**. דוח שממוין לפי ברקוד שם את שורות ה-0.01%
 *      בראש ומלמד להתעלם. המיון הוא לפי הפער היחסי, יורד.
 *
 * ⚠️ ומלכודת רביעית שנמדדה בקטלוג ולא בקובץ: **137 פריטים בקומקס נושאים
 * `מחיר עלות לפי ספק ≠ מחיר עלות נטו`** — כלומר קומקס מחזיק הנחת קניה
 * ומחשב את הנטו בעצמו. אצל 719 הפריטים שלנו: 0. `savedDiscountGate` מוודא
 * שזה נשאר נכון גם בהרצה הבאה, כי כתיבה לשדה "לפי ספק" על פריט עם הנחה
 * שמורה מייצרת נטו אחר לגמרי, בשקט.
 */
import { existsSync } from 'node:fs';
import { sheetNames, readSheet } from '../../tools/xlsx.js';
import { comaxCatalog, KCOL, serialDate } from './build-import.js';

/**
 * מיקומי העמודות בדוח הרכישות של ספורט אנד מור (0-בסיס), מאומתים על הקובץ
 * `פירוט תעודות_מחיר מחירון_ברקודים - רכישות דרור ספורט אנד מור.xlsx`.
 * הקובץ נושא 45 עמודות; אלה השבע שבשימוש.
 */
export const SRC = {
  date: 2,        // "תאריך" — סידורי של אקסל
  invoice: 3,     // "חשבונית"
  barcode: 13,    // "ברקוד"
  sku: 17,        // "מק'ט"
  name: 18,       // "תאור מוצר"
  qty: 20,        // "כמות"
  cost: 24,       // "מחיר ליחידה" — ⇐ העלות ששולמה
  discount: 25,   // "הנחה (%)"
  listPrice: 26,  // "מחיר מחירון" של הספק
};

/** שורת נתונים תקינה = ברקוד בן 13 ספרות. ראה מלכודת 1. */
const VALID_BARCODE = /^\d{13}$/;

const num = (v) => Number(String(v ?? '').trim());
const round2 = (n) => Math.round(n * 100) / 100;

/** תאריך סידורי → `dd/mm/yy`, לתצוגה בגיליון. */
export const shortDate = (serial) => {
  const d = serialDate(serial);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}`;
};

/**
 * קורא את דוח הרכישות ומקבץ לפי ברקוד.
 * @returns {{ groups: Map<string, object[]>, rows: number, dropped: number }}
 */
export function readPurchases(file) {
  if (!existsSync(file)) throw new Error(`קובץ הרכישות לא נמצא: ${file}`);
  const sheets = sheetNames(file);
  if (!sheets.length) throw new Error(`אין גיליונות ב-${file}`);
  const rows = readSheet(file, sheets[0].path);
  const body = rows.slice(1);

  const groups = new Map();
  let dropped = 0;
  for (const r of body) {
    const barcode = String(r[SRC.barcode] ?? '').trim();
    if (!VALID_BARCODE.test(barcode)) { dropped++; continue; }
    const buy = {
      barcode,
      date: num(r[SRC.date]),
      invoice: String(r[SRC.invoice] ?? '').trim(),
      sku: String(r[SRC.sku] ?? '').trim(),
      name: String(r[SRC.name] ?? '').trim(),
      qty: num(r[SRC.qty]) || 0,
      cost: num(r[SRC.cost]),
      discount: num(r[SRC.discount]) || 0,
      listPrice: num(r[SRC.listPrice]),
    };
    if (!groups.has(barcode)) groups.set(barcode, []);
    groups.get(barcode).push(buy);
  }
  // מיון כרונולוגי בתוך כל קבוצה — "האחרון" נשען עליו.
  for (const a of groups.values()) a.sort((x, y) => x.date - y.date);
  return { groups, rows: body.length, dropped, sheet: sheets[0].name };
}

/**
 * מסכם ברקוד אחד: המחירים שנצפו, האחרון, איפה הוא יושב בטווח, והממוצע
 * המשוקלל **לפי הכמות הכוללת** — שלושת הדברים שדרור ביקש לראות במפורש.
 */
export function summarize(buys) {
  const prices = buys.map((b) => b.cost);
  const last = buys[buys.length - 1].cost;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const totalQty = buys.reduce((s, b) => s + b.qty, 0);
  // אם כל הכמויות אפס — ממוצע פשוט, כדי לא לחלק באפס.
  const weighted = totalQty > 0
    ? buys.reduce((s, b) => s + b.cost * b.qty, 0) / totalQty
    : prices.reduce((s, p) => s + p, 0) / prices.length;
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  return {
    buys,
    last,
    min,
    max,
    totalQty,
    weighted: round2(weighted),
    // ⇐ **הערך שנכנס לקומקס.** דרור, 07/09/2026: "תעשה את המחיר המשוקלל".
    //    לפני כן ברירת המחדל הייתה הרכישה האחרונה, והיא נשארת בדוח לעיון —
    //    ההבדל ביניהן הוא 64.50 מול 37.42 בברקוד 3468337807131.
    chosen: round2(weighted),
    lastIs: eq(last, max) ? 'היקר' : eq(last, min) ? 'הזול' : 'באמצע',
    conflicted: new Set(prices).size > 1,
    spread: min > 0 ? max / min : Infinity,
  };
}

/**
 * מצליב את הרכישות מול הקטלוג של קומקס ומחזיר את כל מה שהדוח וקובץ היבוא
 * צריכים. **הצלבה לפי ברקוד בלבד** — הכלל החוצה-מערכות של הפרויקט.
 */
export function buildCost({ file, comax } = {}) {
  const { groups, rows, dropped, sheet } = readPurchases(file);
  const K = comax ? comax : comaxCatalog();

  const cat = new Map();
  for (const r of K.rows) {
    const b = String(r[KCOL.barcode] ?? '').trim();
    if (!b) continue;
    if (cat.has(b)) cat.get(b).push(r); else cat.set(b, [r]);
  }

  const items = [];       // כל ברקוד שנמצא בקומקס
  const notInComax = [];  // ⇐ שער הקיום
  const duplicated = [];  // ברקוד שמופיע פעמיים בקטלוג

  for (const [barcode, buys] of groups) {
    const hits = cat.get(barcode);
    if (!hits) { notInComax.push({ barcode, ...summarize(buys) }); continue; }
    if (hits.length > 1) duplicated.push({ barcode, count: hits.length });
    const row = hits[0];
    const s = summarize(buys);
    const currentNet = String(row[KCOL.costNet] ?? '').trim();
    const currentSup = String(row[KCOL.costSupplier] ?? '').trim();
    const price1 = String(row[KCOL.price1] ?? '').trim();
    items.push({
      barcode,
      sku: String(row[KCOL.item] ?? '').trim(),
      alt: String(row[KCOL.alt] ?? '').trim(),
      name: String(row[KCOL.name] ?? '').trim() || buys[0].name,
      price1: price1 ? num(price1) : null,
      currentNet: currentNet ? num(currentNet) : null,
      currentSup: currentSup ? num(currentSup) : null,
      ...s,
    });
  }

  const conflicts = items.filter((i) => i.conflicted)
    .sort((a, b) => b.spread - a.spread);

  const diffs = items
    .filter((i) => i.currentNet !== null && Math.abs(i.chosen - i.currentNet) > 0.0001)
    .map((i) => ({
      ...i,
      deltaShekel: round2(i.chosen - i.currentNet),
      deltaPct: round2((i.chosen - i.currentNet) / i.currentNet * 100),
    }))
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  const stats = {
    sheet,
    sourceRows: rows,
    droppedRows: dropped,
    barcodes: groups.size,
    inComax: items.length,
    notInComax: notInComax.length,
    duplicated: duplicated.length,
    withExistingCost: items.filter((i) => i.currentNet !== null).length,
    diffs: diffs.length,
    conflicts: conflicts.length,
    lastIsMax: conflicts.filter((c) => c.lastIs === 'היקר').length,
    lastIsMin: conflicts.filter((c) => c.lastIs === 'הזול').length,
    over20: diffs.filter((d) => Math.abs(d.deltaPct) > 20).length,
    between5and20: diffs.filter((d) => Math.abs(d.deltaPct) > 5 && Math.abs(d.deltaPct) <= 20).length,
    between1and5: diffs.filter((d) => Math.abs(d.deltaPct) > 1 && Math.abs(d.deltaPct) <= 5).length,
    upTo1: diffs.filter((d) => Math.abs(d.deltaPct) <= 1).length,
    up: diffs.filter((d) => d.deltaPct > 0).length,
    down: diffs.filter((d) => d.deltaPct < 0).length,
    catalogRows: K.rows.length,
  };

  return { items, conflicts, diffs, notInComax, duplicated, stats };
}

// ── השערים ──────────────────────────────────────────────────────────────────
// כולם חוסמים חוץ מ-`rangeGate`, שהוא אזהרה: פער של פי 1.6 בעלות נמדד והוא
// אמיתי (523.35 ⇒ 858.62), ולחסום עליו היה עוצר הרצה תקינה.

/** ⛔ הנחה שלא הופחתה מהמחיר היא עלות שגויה בשקט. נמדד 0/872 בקובץ הראשון. */
export function discountGate(items) {
  const bad = [];
  for (const i of items) {
    for (const b of i.buys) if (b.discount !== 0) bad.push({ barcode: i.barcode, invoice: b.invoice, discount: b.discount });
  }
  return bad;
}

/**
 * ⛔ פריט שקומקס מחזיק עליו הנחת קניה (`לפי ספק ≠ נטו`) מסוכן: אם `chk111`
 * נוחת בשדה "לפי ספק", קומקס יחשב נטו אחר ממה שכתבנו. 137 כאלה בקטלוג.
 */
export function savedDiscountGate(items) {
  return items.filter((i) =>
    i.currentSup !== null && i.currentNet !== null && Math.abs(i.currentSup - i.currentNet) > 0.005);
}

/**
 * ⚠️ מזהיר בלבד: עלות שאינה סבירה מול מחיר המכירה.
 *
 * החציון המדוד הוא `מחירון 1 ÷ עלות = 3.327` (`knowledge/items-setup.md`),
 * ולכן הטווח אינו סימטרי: עלות **גבוהה ממחיר המכירה** היא סימן לעמודה
 * שהוחלפה, ועלות מתחת ל-5% ממנו היא כנראה תא ריק שנקרא כאפס.
 */
export function rangeGate(items) {
  return items.filter((i) => i.price1 && (i.chosen < i.price1 * 0.05 || i.chosen > i.price1));
}

/**
 * שני קבצי היבוא, שתי עמודות כל אחד — כל עמודה נוספת היא עמודה שקומקס יכתוב.
 *
 * **שתי הרצות, שני תפקידים** (הכרעת דרור, 07/09/2026):
 *
 *   1. **מחירון הספק** — המחיר שספורט אנד מור מוכרים לו. בקומקס אפשר להחזיק
 *      עלות נפרדת לכל ספק, ולכן פריט שנקנה משני ספקים נושא שתי עלויות.
 *      הערך: **הממוצע המשוקלל** — המחיר המייצג שבו הוא קונה.
 *   2. **מחיר קניה אחרונה** — שדה על הפריט שאמור להתעדכן לבד בכל קליטת
 *      חשבונית ספק למלאי. המנגנון הזה עדיין לא נלמד, ולכן ממלאים אותו ידנית
 *      כדי שלא יישאר ריק בפריטים שכבר נקנו. הערך: **הרכישה האחרונה בפועל**,
 *      כי זה בדיוק מה שהמנגנון האוטומטי היה כותב.
 *
 * ההבדל בין השניים נוגע ל-25 פריטים בלבד מתוך 719 — אבל באחד מהם הוא
 * 64.50 מול 37.42.
 */
export const COST_HEADERS = ['ברקוד', 'מחיר קניה'];

/** איזה ערך נכנס לכל הרצה. המפתח הוא שם השדה ב-`summarize()`. */
export const RUNS = {
  supplier: { field: 'weighted', label: 'מחירון ספק — ספורט אנד מור', file: 'מחירון-ספק-ספורט-אנד-מור' },
  last: { field: 'last', label: 'מחיר קניה אחרונה', file: 'מחיר-קניה-אחרונה' },
};
