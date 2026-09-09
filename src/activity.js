/**
 * מתי הסוכן נגע בקומקס בפעם האחרונה.
 *
 * קומקס **לא** משחרר את המושב לבד כל עוד חלון הסוכן פתוח: הפריים-סט מתשאל את
 * השרת בעצמו כל ~90 שניות (ממצא 3 ב-knowledge/MAP.md), כך שהסשן לעולם לא נראה
 * "לא פעיל" והקוד נשאר תפוס — גם אם איש לא עבד שעות. השחרור חייב להיות יזום,
 * ולכן צריך לדעת מתי באמת השתמשנו.
 *
 * החותמת נכתבת **בתחילת כל הרצה וגם בסופה**. בהתחלה, כדי שהמדידה תתחיל מחדש עם
 * כל שימוש; בסוף, כדי שחלון החסד יימדד מסיום העבודה ולא מתחילתה. יחד עם הנעילה
 * ב-src/lock.js זה מה שמונע ניתוק באמצע עבודה.
 */
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

const PATH = resolve(ROOT, 'runs', '.last-activity');

export function touch(what = null) {
  try {
    mkdirSync(resolve(ROOT, 'runs'), { recursive: true });
    writeFileSync(PATH, JSON.stringify({ at: new Date().toISOString(), what }), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** כמה דקות עברו מאז השימוש האחרון, או null אם אין רישום. */
export function idleMinutes() {
  try {
    const at = Date.parse(JSON.parse(readFileSync(PATH, 'utf8')).at);
    if (!at) return null;
    return (Date.now() - at) / 60_000;
  } catch {
    return null;
  }
}

export function lastUse() {
  try {
    return JSON.parse(readFileSync(PATH, 'utf8'));
  } catch {
    return null;
  }
}

// ── החזקה מפורשת ────────────────────────────────────────────────────────────
// עבודה **ידנית** מול חלון הסוכן אינה נרשמת בשום מקום: אין הרצה, אין חותמת,
// ו-`idle-logoff` מנתק באמצע. החותמת האוטומטית פותרת רק את הפתיחה, לא את
// חצי השעה שאחריה.
//
// לכן יש החזקה מפורשת — דרור מבקש אותה, היא נשמרת עם **מועד תפוגה**, ואחריו
// המושב משתחרר לבד. זה לא סותר את כלל 1 ב-CLAUDE.md: הכלל אוסר על ניטור
// תקופתי שדוחף את החותמת קדימה בלי סוף, וכאן אין טיימר ואין חידוש עצמי — יש
// בקשה אחת של אדם, עם קצה.

const HOLD_PATH = resolve(ROOT, 'runs', '.hold');
const HOLD_MAX_MINUTES = 240;

/** מחזיק את המושב ל-N דקות. מחזיר את מועד התפוגה. */
export function hold(minutes = 60, why = null) {
  const m = Math.min(Math.max(Number(minutes) || 0, 1), HOLD_MAX_MINUTES);
  const until = new Date(Date.now() + m * 60_000).toISOString();
  mkdirSync(resolve(ROOT, 'runs'), { recursive: true });
  writeFileSync(HOLD_PATH, JSON.stringify({ until, minutes: m, why }), 'utf8');
  return { until, minutes: m };
}

/** ההחזקה שבתוקף כרגע, או null. החזקה שפגה נחשבת כלא קיימת. */
export function holdActive() {
  try {
    const h = JSON.parse(readFileSync(HOLD_PATH, 'utf8'));
    const until = Date.parse(h.until);
    if (!until || until <= Date.now()) return null;
    return { ...h, minutesLeft: (until - Date.now()) / 60_000 };
  } catch {
    return null;
  }
}

/** מבטל החזקה פעילה. מחזיר true אם הייתה כזאת. */
export function releaseHold() {
  const had = holdActive() !== null;
  try { rmSync(HOLD_PATH, { force: true }); } catch { /* אין קובץ — אין מה לבטל */ }
  return had;
}
