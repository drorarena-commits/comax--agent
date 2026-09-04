/**
 * נעילת הרצה יחידה.
 *
 * לקומקס יש מושב אחד לקוד משתמש, ושתי פעולות שרצות במקביל מפילות אחת את השנייה
 * (כלל 1 ב-CLAUDE.md). עד עכשיו הכלל היה כתוב במסמך בלבד — וזה הספיק כל עוד
 * דרור הריץ הכל בעצמו מטרמינל אחד.
 *
 * זה נשבר ברגע שהסוכן זמין מהאייפון: הרצה מהטלפון יכולה להיכנס על הרצה מקומית,
 * דרור עובד משני מחשבים, וגם `npm run logoff` ידני יכול לשחרר את המושב מתחת
 * למשימה שרצה. לכן האכיפה עברה לכאן, לקוד — כמו בדיקת הכפילות של כלל 11
 * ובדיקת החשבוניות של כלל 13. כלל שכתוב רק במסמך נשכח בדיוק בפעם שהוא חשוב.
 */
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

const LOCK_PATH = resolve(ROOT, 'runs', '.lock');

/** משימות תחזוקה שמחזיקות את הלוק לרגע — לא "מישהו עובד". */
const MAINTENANCE = new Set(['idle-logoff', 'logoff']);

/** האם התהליך הזה עדיין חי? */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // אות 0 לא שולח כלום — הוא רק בודק שהתהליך קיים ושמותר לגעת בו.
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = התהליך קיים אבל שייך למישהו אחר. זה עדיין "חי".
    return e.code === 'EPERM';
  }
}

/** ניסיון כתיבה אטומי. `wx` נכשל אם הקובץ קיים — פעולה אחת, בלי מרוץ. */
function tryWrite(holder) {
  try {
    writeFileSync(LOCK_PATH, JSON.stringify(holder, null, 2), { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

/** מי מחזיק בלוק כרגע, או null אם הקובץ נעלם או השתבש. */
function readHolder() {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** ניסיון רכישה יחיד. מחזיר true, או holder כשתפוס. */
function attempt(mine) {
  if (tryWrite(mine)) return true;

  const holder = readHolder();

  // קובץ שלא ניתן לקרוא הוא שריד של כתיבה שנקטעה — לא בעלים אמיתי.
  if (holder && alive(holder.pid)) return holder;

  // לוק יתום: התהליך מת מקריסה או מ-Ctrl+C ולא הספיק לנקות.
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    /* מישהו אחר הקדים אותנו לנקות */
  }

  // ניסיון שני יחיד, ובכוונה לא בלולאה: שתי הרצות שמנקות את אותו לוק יתום
  // בו-זמנית חוזרות למרוץ, ולולאה רק מאריכה אותו.
  return tryWrite(mine) ? true : (readHolder() ?? { pid: 0, task: null });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * לוקח את הלוק, או מחזיר את מי שמחזיק בו.
 *
 * `waitMs` הוא מה שמונע כשל מיותר מול משימת התחזוקה: `idle-logoff` רץ כל 5 דקות
 * ולוקח את אותו לוק לשנייה-שתיים. בלי המתנה, בקשה מהאייפון שנכנסת באותה שנייה
 * הייתה נדחית עם PID שדרור לא מכיר — נדיר, אבל נראה כמו תקלה אקראית. עשר שניות
 * מכסות בנוחות את זמן ההחזקה.
 *
 * ההמתנה אסינכרונית: המתנה סינכרונית (Atomics.wait) הייתה חוסמת את לולאת
 * האירועים, כך ששום דבר אחר בתהליך לא יכול להתקדם בזמנה — כולל שחרור לוק.
 */
export async function acquire(task, { waitMs = 0 } = {}) {
  mkdirSync(resolve(ROOT, 'runs'), { recursive: true });
  const mine = { pid: process.pid, task, startedAt: new Date().toISOString() };

  const deadline = Date.now() + waitMs;
  let holder;
  for (;;) {
    const r = attempt(mine);
    if (r === true) return { ok: true, release: () => release(mine.pid) };
    holder = r;
    if (Date.now() >= deadline) return { ok: false, holder };
    await sleep(250);
  }
}

/** משחרר את הלוק, אבל רק אם הוא באמת שלנו. */
export function release(pid = process.pid) {
  const holder = readHolder();
  if (holder && holder.pid !== pid) return false;
  try {
    unlinkSync(LOCK_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * הודעת סירוב קריאה, לטרמינל ולאייפון כאחד.
 *
 * ההבחנה בין תחזוקה למשימה אמיתית היא ההבדל בין הודעה מרגיעה למבהילה: "המערכת
 * משחררת את המושב, נסה עוד רגע" מול "מישהו אחר עובד עכשיו".
 */
export function busyMessage(holder) {
  if (!holder) return 'הרצה אחרת מחזיקה בנעילה.';

  if (MAINTENANCE.has(holder.task)) {
    return 'שחרור מושב אוטומטי רץ כרגע — נסה שוב עוד רגע.\n' +
      'זו תחזוקה שגרתית שנמשכת שנייה-שתיים, לא תקלה.';
  }

  const since = holder.startedAt ? new Date(holder.startedAt).toLocaleTimeString('he-IL') : 'לא ידוע';
  return `כבר רצה משימה "${holder.task ?? 'לא ידוע'}" (PID ${holder.pid}) מאז ${since}.\n` +
    'לקומקס יש מושב אחד — שתי פעולות במקביל מפילות אחת את השנייה.\n' +
    'חכה שהיא תסתיים, או עצור אותה ונסה שוב.';
}
