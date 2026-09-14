/**
 * כפתור הוואטסאפ — פותח שיחה עם לקוח ההזמנה, עם טקסט מוכן שניתן לערוך.
 *
 * ## למה יש כאן בחירה בין שתי אפליקציות
 *
 * כשגם וואטסאפ וגם וואטסאפ ביזנס מותקנים באותו אייפון, **שתיהן רשומות על
 * אותה סכימה** `whatsapp://`, ו-iOS מחליט לבד מי מהן נפתחת. הקישור הרגיל
 * `wa.me` נופל לאותה הכרעה. לכן הדיאלוג הזה שואל תחילה, ומנסה עבור ביזנס
 * סכימה נפרדת.
 *
 * ⚠️ **הסכימה של ביזנס אינה מתועדת רשמית על ידי Meta.** `whatsapp-business://`
 * היא מה שנצפה בפועל, לא הבטחה. לכן היא נוסה עם **נפילה חזרה** ל-`wa.me`
 * אחרי 1.2 שניות: אם iOS לא הכיר את הסכימה, הדף נשאר גלוי ואנחנו פותחים את
 * הקישור הרגיל. הכשל הגרוע ביותר הוא "נפתחה האפליקציה הלא נכונה" — לא
 * "לא נפתח כלום".
 *
 * מה שעדיין דורש אימות בטלפון אמיתי עם שתי האפליקציות מותקנות: האם ביזנס
 * באמת נפתחת. זה נמדד רק שם, ולא ניתן להסיק אותו מכאן.
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
 * פתיחת וואטסאפ. `app` הוא 'business' או 'regular'.
 * מוחזר `true` אם ניסינו לפתוח, `false` אם המספר לא הובן.
 */
export function openWhatsapp({ phone, text, app }) {
  const number = toWhatsappNumber(phone);
  if (!number) return false;

  const q = `phone=${number}&text=${encodeURIComponent(text || '')}`;
  const web = `https://wa.me/${number}?text=${encodeURIComponent(text || '')}`;

  if (app === 'business') {
    const started = Date.now();
    location.href = `whatsapp-business://send?${q}`;
    // אם הסכימה לא הוכרה, הדף לא איבד מיקוד — אז פותחים את הקישור הרגיל.
    setTimeout(() => {
      if (!document.hidden && Date.now() - started < 2500) location.href = web;
    }, 1200);
    return true;
  }

  location.href = web;
  return true;
}
