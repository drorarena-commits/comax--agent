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
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
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
