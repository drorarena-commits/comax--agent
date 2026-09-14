/**
 * מצב הלולאה — אילו הזמנות כבר דווחו בטלגרם.
 *
 * ⚠️ **הכשל שזה מונע הוא דיווח כפול, לא דיווח חסר.** הסתמכות על חותמת זמן
 * בלבד שבירה: שעון האתר ושעון המחשב אינם זהים, הזמנה שנשמרת שנייה לפני
 * הסקירה עלולה ליפול בין הכיסאות, ותהליך שנפל באמצע חוזר ושולח שוב. לכן
 * נשמרים **מזהי ההזמנות שדווחו** ולא רק "עד מתי הגענו", והחותמת משמשת רק
 * כדי לא למשוך את כל ההיסטוריה בכל סבב.
 *
 * הקובץ יושב ב-`runs/` שאינו נשמר בגיט — זה מצב מקומי של מחשב אחד, ואסור
 * לו לנדוד בין המחשבים ולגרום להזמנה להיחשב "כבר דווחה" במקום שבו לא דווחה.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

const EMPTY = { reportedIds: [], lastSeenIso: null, startedIso: null };
/** כמה מזהים לשמור. 500 הזמנות אחורה מכסות כל חלון שבו סבב יכול לחזור. */
const KEEP = 500;

let state = null;

export function loadState() {
  if (state) return state;
  try {
    if (existsSync(config.statePath)) {
      state = { ...EMPTY, ...JSON.parse(readFileSync(config.statePath, 'utf8')) };
    } else {
      state = { ...EMPTY };
    }
  } catch {
    // קובץ מצב פגום אינו סיבה להפיל את הניטור — מתחילים נקי ומדווחים מחדש.
    state = { ...EMPTY };
  }
  return state;
}

export function saveState() {
  const s = loadState();
  s.reportedIds = s.reportedIds.slice(-KEEP);
  mkdirSync(dirname(config.statePath), { recursive: true });
  writeFileSync(config.statePath, JSON.stringify(s, null, 2), 'utf8');
}

export const wasReported = (id) => loadState().reportedIds.includes(Number(id));

export function markReported(id, dateIso) {
  const s = loadState();
  const n = Number(id);
  if (!s.reportedIds.includes(n)) s.reportedIds.push(n);
  if (dateIso && (!s.lastSeenIso || dateIso > s.lastSeenIso)) s.lastSeenIso = dateIso;
  saveState();
}

/**
 * מאיזה רגע למשוך הזמנות. בהרצה ראשונה **לא** מושכים היסטוריה — אחרת
 * ההתקנה עצמה תירה עשרות התראות על הזמנות ישנות.
 */
export function since() {
  const s = loadState();
  if (!s.startedIso) {
    s.startedIso = new Date().toISOString();
    saveState();
  }
  // חלון חפיפה של שעה אחורה מכסה פערי שעון בין האתר למחשב; הכפילות נמנעת
  // ממילא על ידי reportedIds.
  //
  // ⚠️ אבל **לא בהרצה הראשונה.** נמדד 14/09/2026: בהתקנה הראשונה החלון הזה
  // שלף שתי הזמנות מהשעה שקדמה להפעלה ושלח עליהן התראות, בסתירה להבטחה
  // ש"הזמנות שנכנסו לפני הרגע הזה לא ידווחו למפרע". כשאין עדיין מה להשוות
  // מולו, נקודת ההתחלה היא בדיוק רגע ההפעלה.
  if (!s.lastSeenIso) return s.startedIso.replace(/\.\d+Z$/, '');
  return new Date(new Date(s.lastSeenIso).getTime() - 3_600_000).toISOString().replace(/\.\d+Z$/, '');
}
