/**
 * קריאה, הזזה וכתיבה של קובצי התור.
 *
 * כל כתיבה היא "קובץ זמני ואז rename" — `rename` על אותו כונן הוא אטומי,
 * ולכן צד שלישי שקורא את התיקייה לעולם לא רואה JSON חצי-כתוב. זה לא קישוט:
 * Claude בשיחת Cowork קורא את `done/` בזמן שהמאזין כותב אליה.
 */
import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIRS, isValidId } from './paths.js';

/** חותמת זמן מקומית עם היסט (‎+03:00) — קריאה לבן אדם בטלפון, לא UTC. */
export function stampLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`
  );
}

export function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
  return file;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * קובצי `.json` בתיקייה, ממוינים לפי שם.
 *
 * המיון לפי שם הוא המיון לפי זמן, כי ה-`id` מתחיל ב-`YYYYMMDD-HHMM`. קבצים
 * שאינם `.json` ו-`.tmp` של כתיבה שעדיין רצה מסוננים בכוונה.
 */
export function listDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

/**
 * מעביר קובץ בין תיקיות התור ומחזיר את הנתיב החדש.
 *
 * `renameSync` ולא "קרא-כתוב-מחק": שני מאזינים שמנסים לקחת את אותה משימה
 * יקבלו אחד הצלחה ואחד ENOENT, ולא שניהם עותק. מאזין אחד הוא הכלל (§8),
 * אבל הגנה שנשענת רק על הכלל נשברת בדיוק כשהוא מופר.
 */
export function move(id, from, to) {
  const src = resolve(from, `${id}.json`);
  const dst = resolve(to, `${id}.json`);
  renameSync(src, dst);
  return dst;
}

export function remove(id, dir) {
  try {
    unlinkSync(resolve(dir, `${id}.json`));
  } catch {
    /* כבר לא שם */
  }
}

/**
 * טוען משימה ומוודא שהיא קבילה — לפני שנוגעים בקומקס.
 *
 * מחזיר `{ task }` או `{ error }`. קובץ פגום אינו קורס את המאזין: הוא הופך
 * לתוצאה עם `status: "failed"` שדרור יכול לקרוא, כי משימה אחת שבורה שמפילה
 * את התהליך היא בדיוק התקלה השקטה שהתור אמור למנוע.
 */
export function loadTask(file, expectedId) {
  let raw;
  try {
    raw = readJson(file);
  } catch (e) {
    return { error: `קובץ המשימה אינו JSON תקין: ${e.message}` };
  }
  if (!raw || typeof raw !== 'object') return { error: 'קובץ המשימה אינו אובייקט.' };
  if (!isValidId(raw.id)) return { error: `id חסר או פסול: ${JSON.stringify(raw.id)}` };
  if (raw.id !== expectedId) {
    return { error: `ה-id בקובץ ("${raw.id}") אינו תואם את שם הקובץ ("${expectedId}").` };
  }
  if (!raw.request || typeof raw.request !== 'string') {
    return { error: 'חסר "request" — מה דרור ביקש, במילים שלו.' };
  }
  if (raw.mode !== 'task' && raw.mode !== 'agent') {
    return { error: `mode חייב להיות "task" או "agent", התקבל: ${JSON.stringify(raw.mode)}` };
  }
  if (raw.mode === 'task') {
    if (!raw.task || typeof raw.task !== 'string' || !/^[A-Za-z0-9._-]+$/.test(raw.task)) {
      return { error: `שם משימה חסר או פסול: ${JSON.stringify(raw.task)}` };
    }
    if (raw.input !== undefined && (typeof raw.input !== 'object' || raw.input === null || Array.isArray(raw.input))) {
      return { error: '"input" חייב להיות אובייקט JSON.' };
    }
  }
  return { task: raw };
}

export { DIRS };
