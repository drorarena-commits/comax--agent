#!/usr/bin/env node
/**
 * משגר את מאזין התור **מנותק**, כדי שישרוד את הסשן שהפעיל אותו.
 *
 * זה אותו לקח בדיוק של `wa-start.js` מול `wa-daemon.js`, והוא הלקח היקר
 * ביותר בפרויקט הזה: דמון שרץ בחזית מתוך סשן Claude מת עם הסשן, **בשקט**.
 * שם זה אמר ש"הי קלוד" מהטלפון נעלם בלי סימן; כאן זה אומר שקובץ משימה ישב
 * ב-`queue/inbox/` לנצח בזמן שדרור מחכה לתשובה בטלפון.
 *
 *   npm run listen-start    משגר ומחכה שיאשר שהוא באוויר
 *   npm run listen-up       רץ? ומה מצב התור
 *   npm run listen-stop     עוצר מסודר
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { DIRS, ensureDirs, PID_FILE, LOG_FILE, STATE_DIR } from '../src/queue/paths.js';
import { listDir } from '../src/queue/store.js';

const LISTENER = resolve(ROOT, 'tools', 'listen.js');
const checkOnly = process.argv.includes('--check');

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function holder() {
  if (!existsSync(PID_FILE)) return null;
  try {
    const p = JSON.parse(readFileSync(PID_FILE, 'utf8'));
    return alive(p.pid) ? p : null;
  } catch {
    return null;
  }
}

/**
 * דיווח מצב — ומצב התור הוא חלק ממנו, בכוונה.
 *
 * ⚠️ תהליך חי אינו מערכת עובדת. ב-14/09/2026 דמון הוואטסאפ דווח "✅ רץ" בזמן
 * שמצבו היה `failed` והתור שלו לא טופל, ועל סמך הדיווח הזה נאמר לדרור שהודעה
 * נשלחה — והיא לא. לכן כאן מודפס גם מה ממתין ב-`inbox` ומה תקוע ב-`working`:
 * מאזין חי עם משימה שנתקעה שם הוא בדיוק המצב שנראה תקין ואינו.
 */
function report() {
  ensureDirs();
  const h = holder();
  const inbox = listDir(DIRS.inbox).length;
  const working = listDir(DIRS.working);

  if (!h) {
    console.log('⛔ המאזין אינו רץ.');
    console.log(`   ${inbox} משימות ב-inbox פשוט ימתינו — בשקט, בלי שגיאה.`);
    console.log('   להפעיל:  npm run listen-start');
    return false;
  }

  console.log(`✅ המאזין רץ (PID ${h.pid}, מאז ${h.startedAt}).`);
  console.log(`   ממתינות: ${inbox} · בריצה: ${working.length} · תוצאות: ${listDir(DIRS.done).length}`);
  if (working.length) console.log(`   בריצה כרגע: ${working.join(', ')}`);
  if (existsSync(LOG_FILE)) console.log(`   לוג: ${LOG_FILE}`);
  return true;
}

if (checkOnly) {
  process.exitCode = report() ? 0 : 1;
} else {
  ensureDirs();
  const running = holder();
  if (running) {
    console.log(`המאזין כבר רץ (PID ${running.pid}). לא מפעיל שני.`);
    report();
  } else {
    mkdirSync(STATE_DIR, { recursive: true });
    const out = openSync(LOG_FILE, 'a');
    // מהיכן נמדד "מה הריצה הזאת כתבה": קריאת הלוג מהסוף הייתה תופסת את שורת
    // ה"עלה" של הריצה הקודמת ומדווחת הצלחה על שיגור שלא קרה.
    const before = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0;

    const child = spawn(process.execPath, [LISTENER], {
      cwd: ROOT,
      detached: true,
      // לקובץ ולא ל-'ignore': לתהליך מנותק שנפל אין לאן לומר את זה, וכשל
      // שקט הוא כל הסיכון של המערכת הזאת.
      stdio: ['ignore', out, out],
      windowsHide: true,
      // אומר לדמון שה-stdout שלו כבר נוחת בקובץ הלוג, כדי שלא יכתוב כל שורה
      // פעמיים — לוג כפול נקרא בדיוק כמו שני מאזינים במקביל.
      env: { ...process.env, QUEUE_LOG_IS_STDOUT: '1' },
    });
    // בלי unref התהליך הזה לא היה יוצא כל עוד המאזין חי — וזה מבטל את הניתוק.
    child.unref();

    console.log(`משוגר מנותק (PID ${child.pid}) — שורד סגירת סשן.`);
    console.log(`לוג: ${LOG_FILE}`);

    // ממתינים לעובדה ("מאזין עלה" בלוג), לא לטיימר.
    const deadline = Date.now() + 30_000;
    const poll = setInterval(() => {
      let tail = '';
      try {
        const buf = readFileSync(LOG_FILE, 'utf8');
        tail = buf.length > before ? buf.slice(before) : '';
      } catch {
        tail = '';
      }
      if (tail.includes('מאזין עלה')) {
        clearInterval(poll);
        console.log('');
        report();
        process.exit(0);
      }
      if (tail.includes('לא מפעיל שני') || tail.includes('המאזין נפל')) {
        clearInterval(poll);
        console.log('');
        console.log(tail.trim().split(/\r?\n/).slice(-8).join('\n'));
        process.exit(1);
      }
      if (Date.now() > deadline) {
        clearInterval(poll);
        console.log('');
        console.log('⚠️ 30 שניות ולא נרשם "מאזין עלה". לבדוק:  npm run listen-up');
        process.exit(1);
      }
    }, 500);
  }
}
