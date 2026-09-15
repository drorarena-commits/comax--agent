/**
 * תיקיות התור, ומי מורשה לכתוב לכל אחת.
 *
 * `inbox` ו-`approve` נכתבות מבחוץ (Claude בשיחת Cowork). כל השאר בבעלות
 * המאזין בלבד — הפרדה שמאפשרת לקרוא את מצב התור מהדיסק בלי לשאול אף תהליך.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

export const QUEUE = resolve(ROOT, 'queue');

export const DIRS = {
  inbox: resolve(QUEUE, 'inbox'),
  working: resolve(QUEUE, 'working'),
  hold: resolve(QUEUE, 'hold'),
  approve: resolve(QUEUE, 'approve'),
  done: resolve(QUEUE, 'done'),
};

/** מצב הריצה של המאזין — ב-runs/, שאינו נשמר בגיט. */
export const STATE_DIR = resolve(ROOT, 'runs', 'queue');
export const PID_FILE = resolve(STATE_DIR, 'listener.json');
export const STOP_FILE = resolve(STATE_DIR, 'stop');
export const LOG_FILE = resolve(STATE_DIR, 'listener.log');

export function ensureDirs() {
  for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
}

/**
 * מזהה משימה = שם הקובץ. הוא מגיע מבחוץ ומרכיב נתיבים, ולכן הוא מסונן:
 * `..` או לוכסן בתוך `id` היו כותבים תוצאה מחוץ לתיקיית התור.
 */
export const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export const isValidId = (id) => typeof id === 'string' && VALID_ID.test(id);
