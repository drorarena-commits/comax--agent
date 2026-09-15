#!/usr/bin/env node
/**
 * עצירה מסודרת של מאזין התור.
 *
 * ⛔ לא הורג. נוגע בקובץ דגל, והמאזין יוצא **אחרי** שהמשימה הנוכחית הסתיימה.
 * הרג באמצע משימה כותבת משאיר מסמך חצי-קלוט בקומקס ומושב תפוס — ולכן
 * ההמתנה כאן אינה נימוס אלא הגנה. מי שבאמת צריך לעצור מיד יעשה זאת בידיים
 * ויֵדע מה הוא מקבל.
 *
 *   npm run listen-stop
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DIRS, ensureDirs, PID_FILE, STOP_FILE } from '../src/queue/paths.js';
import { listDir, stampLocal } from '../src/queue/store.js';

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

ensureDirs();

if (!existsSync(PID_FILE)) {
  console.log('המאזין אינו רץ (אין קובץ PID).');
  process.exit(0);
}

let pid = 0;
try {
  pid = JSON.parse(readFileSync(PID_FILE, 'utf8')).pid;
} catch {
  console.log('קובץ ה-PID פגום — כנראה שריד. אין את מי לעצור.');
  process.exit(0);
}

if (!alive(pid)) {
  console.log(`התהליך (PID ${pid}) כבר אינו חי. שריד יתנקה בהפעלה הבאה.`);
  process.exit(0);
}

writeFileSync(STOP_FILE, stampLocal(), 'utf8');
const busy = listDir(DIRS.working);
console.log(`ביקשתי עצירה מ-PID ${pid}.`);
if (busy.length) console.log(`⏳ רצה כרגע ${busy.join(', ')} — הוא יסיים אותה ואז יֵצא.`);

// ממתינים לעובדה: שהתהליך נעלם. משימה כותבת יכולה לקחת דקות, ולכן ההמתנה
// ארוכה ומדווחת מה מתרחש במקום להצהיר "נעצר" לפני שזה קרה.
const deadline = Date.now() + 15 * 60_000;
const poll = setInterval(() => {
  if (!alive(pid)) {
    clearInterval(poll);
    console.log('✅ המאזין נעצר.');
    process.exit(0);
  }
  if (Date.now() > deadline) {
    clearInterval(poll);
    console.log('⚠️ 15 דקות והוא עדיין רץ — כנראה משימה ארוכה. הדגל נשאר, והוא יֵצא כשתסתיים.');
    console.log('   לבדוק:  npm run listen-up');
    process.exit(1);
  }
}, 1000);
