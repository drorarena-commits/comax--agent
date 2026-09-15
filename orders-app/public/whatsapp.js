/**
 * כפתור הוואטסאפ — פותח שיחה עם לקוח ההזמנה, עם טקסט מוכן שניתן לערוך.
 *
 * ## קישור אחד. המערכת שואלת, לא אנחנו
 *
 * כאן ישב פעם דיאלוג עם שני כפתורים ("ביזנס" / "רגיל"), סכימה לא מתועדת
 * `whatsapp-business://`, טיימר נפילה חזרה וזיכרון בחירה ב-`localStorage`.
 * **כל זה נמחק ב-15/09/2026 אחרי אימות בטלפון של דרור:** כששתי האפליקציות
 * מותקנות, **iOS עצמו שואל אם לעבור לביזנס** ברגע שנפתח `wa.me`.
 *
 * כלומר הבעיה שהמנגנון בא לפתור לא הייתה קיימת — הוא רק הוסיף מסך שצריך
 * לעבור בו בכל פנייה ללקוח. ⛔ **אל תבנה עקיפה סביב התנהגות מערכת שלא
 * נצפתה**; `whatsapp-business://` ממילא אינה מתועדת על ידי Meta.
 */

/**
 * מספר טלפון ישראלי לפורמט שוואטסאפ דורש: קידומת בינלאומית, בלי + ובלי אפס.
 * מחזיר null אם אי אפשר להכריע — **מספר שלא הובן אינו נשלח לניחוש**, כי
 * הודעה שיוצאת למספר שגוי היא פנייה לאדם זר בשם העסק.
 */
export function toWhatsappNumber(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');

  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '972' + d.slice(1);      // מקומי ישראלי
  else if (/^9725\d{8}$/.test(d)) { /* כבר בינלאומי */ }
  else if (/^5\d{8}$/.test(d)) d = '972' + d;              // נייד בלי האפס
  else if (d.length === 9 || d.length === 10) d = '972' + d.replace(/^0/, '');
  else return null;

  // 972 + 9 ספרות = 12. מחוץ לישראל נקבל אורך אחר וזה תקין כל עוד הוא סביר.
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** הודעת ברירת המחדל — פנייה בשם, עם מספר ההזמנה, ובלי הבטחה שלא ניתן לקיים. */
export function defaultMessage(order) {
  const first = order.billing?.first_name || '';
  const hello = first ? `היי ${first},` : 'היי,';
  return `${hello}\nכאן ארנה ישראל לגבי הזמנה #${order.number}.\n`;
}

/**
 * פתיחת וואטסאפ עם השיחה והטקסט מוכנים.
 * מוחזר `true` אם ניסינו לפתוח, `false` אם המספר לא הובן.
 */
export function openWhatsapp({ phone, text }) {
  const number = toWhatsappNumber(phone);
  if (!number) return false;

  location.href = `https://wa.me/${number}?text=${encodeURIComponent(text || '')}`;
  return true;
}
