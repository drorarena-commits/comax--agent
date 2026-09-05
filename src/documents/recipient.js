/**
 * כלל 14: כל שליחת מסמך דורשת נמען מפורש.
 *
 * קומקס ממלא את שדה הנמען מראש **בכתובת של הלקוח**, מכרטיס הלקוח. זו לא תקלה
 * חד-פעמית אלא ההתנהגות הקבועה של מסך המעטפה (`Erp/Divor_Doc.asp`) בכל סוגי
 * המסמכים. נצפה פעמיים: `erez@kmc.co.il` בהצעת מחיר, ו-`felixrubin88@gmail.com`
 * בחשבונית 6500085 שדרור ביקש לעצמו.
 *
 * המשמעות: כל בקשה שמגיעה מהטלפון מתחילה **טעונה בכתובת של הלקוח**. קליק אחד
 * מיותר שולח מסמך חי ללקוח אמיתי, וזה לא הפיך — בזמן שאף אחד לא ליד המסך.
 *
 * לכן: אין נמען מפורש → עצירה. לעולם לא לקבל בשקט את מה שמולא מראש.
 * הכלל יושב כאן ולא כהוראה במסמך, כמו בדיקת הכפילות של כלל 11 ובדיקת
 * החשבוניות של כלל 13 — כלל שכתוב רק במסמך נשכח בדיוק בפעם שהוא חשוב.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * דורש נמען מפורש. לזרוק כאן, לפני שנפתח משהו בקומקס.
 *
 * `what` הוא תיאור המסמך, לשגיאה קריאה מהטלפון.
 */
export function requireRecipient(to, { what = 'המסמך' } = {}) {
  if (!to) {
    throw new Error(
      `חסרה כתובת נמען לשליחת ${what} — היא חייבת להיות מפורשת.\n` +
        'קומקס ממלא מראש את כתובת הלקוח, ושליחה בטעות ללקוח אינה הפיכה.\n' +
        'אין ברירת מחדל, בכוונה.',
    );
  }
  const clean = String(to).trim();
  if (!EMAIL_RE.test(clean)) throw new Error(`"${clean}" אינה כתובת דוא"ל תקינה.`);
  return clean;
}

/**
 * משתלט על שדה הנמען במעטפה: קורא מה קומקס מילא, מתריע אם זה מישהו אחר,
 * ומחליף בכתובת שהתבקשה.
 *
 * מחזיר את הכתובת שקומקס הציע, כדי שהקורא יוכל להציג אותה — דרור צריך לראות
 * למי זה *היה* נשלח, לא רק למי זה יישלח.
 */
export async function takeOverRecipient({ frame, human, logger, to, field = '#Email' }) {
  const prefilled = (await frame.locator(field).inputValue().catch(() => '')) || '';

  if (prefilled && prefilled.trim().toLowerCase() !== to.trim().toLowerCase()) {
    logger?.step('warn', `קומקס מילא את כתובת הלקוח: ${prefilled} — מחליף ל-${to}`);
  }

  // ניקוי לפני ההקלדה: `type` מוסיף לתוכן הקיים, וכתובת הלקוח הייתה נשארת
  // כתחילית — מה שמייצר כתובת לא תקינה, או גרוע מזה, כתובת אחרת שכן קיימת.
  await frame.locator(field).fill('');
  // Paste rather than type. An address is the longest string in any of these
  // flows, and this is also the only field with a real gate behind it:
  // `assertRecipient` re-reads it at send time and throws on exact mismatch,
  // so a paste that did not land cannot reach the send button.
  await human.type(field, to, { scope: frame, label: 'מקבל דוא"ל', paste: true });

  // קריאה-חזרה מיד, לא רק בשער השליחה. הדבקה היא אירוע input אחד, ושדה שבונה
  // את עצמו מחדש היה בולע אותה בשקט; ב-DRY RUN גם אין assertRecipient שיתפוס
  // את זה, כי הוא רץ אחרי השער. כאן זה נתפס בנקודת הכתיבה.
  const landed = (await frame.locator(field).inputValue().catch(() => '')) || '';
  if (landed.trim().toLowerCase() !== to.trim().toLowerCase()) {
    throw new Error(
      `שדה הנמען מכיל "${landed}" מיד אחרי הכתיבה, ולא "${to}" — עוצר.\n` +
        'ההדבקה לא נקלטה. להריץ שוב, או להחזיר את השדה הזה להקלדה תו-תו.',
    );
  }

  return { prefilled };
}

/**
 * הבדיקה האחרונה לפני הקליק על "שלח".
 *
 * לא ייתור: הדף יכול למלא מחדש את השדה בין ההקלדה לשליחה — הוא עושה את זה
 * בטעינה, וטעינה מחדש באמצע הזרימה מחזירה את כתובת הלקוח. זו הנקודה היחידה
 * שבודקת את המצב **החי** של השדה ברגע השליחה.
 */
export async function assertRecipient(frame, to, { field = '#Email' } = {}) {
  const live = (await frame.locator(field).inputValue()) || '';
  if (live.trim().toLowerCase() !== to.trim().toLowerCase()) {
    throw new Error(
      `שדה הנמען מכיל "${live}" ולא "${to}" — לא שולח.\n` +
        'ייתכן שהדף נטען מחדש והחזיר את כתובת הלקוח.',
    );
  }
  return live.trim();
}

export { EMAIL_RE };
