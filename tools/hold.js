/**
 * מחזיק את מושב קומקס בזמן עבודה ידנית מול חלון הסוכן.
 *
 *   npm run hold                 מחזיק שעה
 *   npm run hold -- 30           מחזיק 30 דקות
 *   npm run hold -- off          משחרר את ההחזקה
 *   npm run hold -- status       מה מצב ההחזקה
 *
 * למה זה קיים: `idle-logoff` מודד את השימוש האחרון מ-`runs/.last-activity`,
 * והחותמת נכתבת רק כשהקוד עושה משהו. עבודה ידנית — לחיצות שלך בחלון, קריאת
 * מסך, צילום — אינה נרשמת בשום מקום, ולכן המושב שוחרר באמצע העבודה
 * (נמדד 07/09/2026: "המושב שוחרר אחרי 347 דקות ללא שימוש" בזמן עבודה חיה).
 *
 * ⛔ ההחזקה **פגה מעצמה** (ברירת מחדל שעה, מקסימום 4 שעות) ואינה מתחדשת. זה
 *    מה שמפריד אותה מהניטור התקופתי שכלל 1 ב-CLAUDE.md אוסר: שם הטיימר היה
 *    דוחף את החותמת קדימה לנצח והמושב היה נתפס כל היום בלי סימן.
 */
import { hold, holdActive, releaseHold } from '../src/activity.js';

const arg = (process.argv[2] ?? '').trim().toLowerCase();
const fmt = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

if (arg === 'off' || arg === 'stop' || arg === 'release') {
  console.log(releaseHold() ? 'ההחזקה בוטלה — המושב ישוחרר כרגיל אחרי 10 דקות ללא שימוש.' : 'לא הייתה החזקה פעילה.');
  process.exit(0);
}

if (arg === 'status' || arg === 'מצב') {
  const h = holdActive();
  console.log(h
    ? `מוחזק עד ${fmt(h.until)} — עוד ${h.minutesLeft.toFixed(0)} דקות.`
    : 'אין החזקה פעילה.');
  process.exit(0);
}

const minutes = arg ? Number(arg) : 60;
if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error(`לא הבנתי "${arg}". שימוש: npm run hold -- [דקות | off | status]`);
  process.exit(1);
}

const h = hold(minutes, 'עבודה ידנית');
console.log(`המושב מוחזק ${h.minutes} דקות — עד ${fmt(h.until)}.`);
console.log('אחרי זה הוא ישוחרר לבד. לשחרור מיידי: npm run hold -- off');
