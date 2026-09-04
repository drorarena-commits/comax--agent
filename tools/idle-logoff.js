/**
 * משחרר את מושב קומקס אחרי חוסר פעילות — הפעלה יזומה, לא ניקוי לילי.
 *
 *   npm run idle-logoff
 *
 * למה זה קיים: קומקס **לא** משחרר את המושב לבד כל עוד חלון הסוכן פתוח. הפריים-סט
 * מתשאל את השרת בעצמו כל ~90 שניות (ממצא א׳ ב-knowledge/MAP.md), ולכן הסשן
 * לעולם לא נראה "לא פעיל". בלי הכלי הזה קוד המשתמש נשאר תפוס כל היום, וכל עמית
 * שינסה להיכנס — או דרור מהמחשב השני — יקבל "קוד משתמש בשימוש".
 *
 * מיועד למשימה מתוזמנת שרצה כל כמה דקות. מתנתק רק כששני התנאים מתקיימים:
 *
 *   1. עברו יותר מ-IDLE_MINUTES מאז השימוש האחרון (`runs/.last-activity`)
 *   2. אין הרצה פעילה — `runs/.lock` פנוי או יתום
 *
 * תנאי 2 הוא לא ייתור: החותמת נכתבת גם בתחילת הרצה וגם בסופה, אבל ייצוא מלא
 * לוקח כחצי שעה (כלל 7 ב-CLAUDE.md) — בלי הנעילה, ניתוק היה נוחת באמצע הדוח.
 *
 * הנעילה נלקחת **מאוחר ככל האפשר ומשוחררת מיד**: הקטע הקריטי הוא ה-`logoff`
 * בלבד. הכלי הזה רץ כל כמה דקות, ובקשה מהאייפון שנכנסת באותה שנייה הייתה נחסמת
 * — לכן ההחזקה מצומצמת לשנייה-שתיים, ו-`tools/run.js` ממתין עד 10 שניות.
 *
 * יוצא בשקט (קוד 0) כשאין מה לעשות, כדי שיהיה בטוח להרצה תכופה.
 */
import { attachBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';
import { isLoggedIn, logoff } from '../src/session.js';
import { acquire, busyMessage } from '../src/lock.js';
import { idleMinutes, lastUse } from '../src/activity.js';

const IDLE_MINUTES = Number(process.env.COMAX_IDLE_MINUTES ?? 10);

// ── תנאי 1: זול, בלי נעילה ובלי לגעת בדפדפן ─────────────────────────────────
const idle = idleMinutes();
if (idle === null) {
  console.log('אין רישום שימוש — לא נוגע.');
  process.exit(0);
}
if (idle < IDLE_MINUTES) {
  console.log(`השימוש האחרון לפני ${idle.toFixed(1)} דקות (סף ${IDLE_MINUTES}) — לא נוגע.`);
  process.exit(0);
}

const logger = new RunLogger('idle-logoff');
const s = await attachBrowser({ logger });
if (!s) {
  console.log('אין חלון סוכן פתוח — אין ממה להתנתק.');
  process.exit(0);
}

if (!(await isLoggedIn(s.page, s.cfg))) {
  console.log('החלון פתוח אבל לא מחובר — המושב כבר פנוי.');
  await s.browser.close().catch(() => {});
  logger.done();
  process.exit(0);
}

// ── תנאי 2: הנעילה, רק עכשיו ────────────────────────────────────────────────
// בלי המתנה: אם משימה אמיתית מחזיקה, אין שום סיבה לעכב אותה — פשוט מוותרים
// והריצה הבאה של המשימה המתוזמנת תטפל.
const lock = await acquire('idle-logoff');
if (!lock.ok) {
  console.log(`${busyMessage(lock.holder).split('\n')[0]} — לא מתנתק.`);
  await s.browser.close().catch(() => {});
  logger.done();
  process.exit(0);
}

let ok = false;
try {
  const use = lastUse();
  ok = await logoff({ ...s, logger });
  console.log(
    ok
      ? `המושב שוחרר אחרי ${idle.toFixed(0)} דקות ללא שימוש (אחרון: ${use?.what ?? 'לא ידוע'}).`
      : 'ההתנתקות לא הושלמה — המתן כ-3 דקות.',
  );
} finally {
  // משחררים לפני הניתוק והלוגים — הקטע הקריטי נגמר.
  lock.release();
}

// ניתוק CDP בלבד — החלון נשאר פתוח, והבקשה הבאה תתחבר מחדש מ-.env.
await s.browser.close().catch(() => {});
logger.done(ok ? 'ok' : 'failed');
