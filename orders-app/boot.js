/**
 * הרמה אוטומטית של אפליקציית ההזמנות אחרי אתחול המחשב.
 *
 * הבעיה שזה פותר: אחרי אתחול (ו-Windows Update מאתחל מעצמו) מתו **שני**
 * תהליכים — שרת ההזמנות והמנהרה — והאייקון שבמסך הבית של האייפון הצביע
 * לכתובת מתה. גרוע מזה: מנהרת `trycloudflare` מקבלת **כתובת חדשה בכל
 * הפעלה**, ולכן גם הרמה אוטומטית לבדה לא הייתה מספיקה — הלינק הישן נשאר
 * שבור בלי שאיש יודע.
 *
 * לכן הסדר כאן הוא: מנהרה ⇒ קריאת הכתובת החדשה ⇒ כתיבתה ל-.env ⇒ הרמת
 * השרת ⇒ **הודעת טלגרם עם הלינק החדש**. הטלגרם הוא החלק שהופך את זה
 * לשמיש: דרור לא יושב מול המחשב ולא יודע שהייתה הפעלה מחדש, ולכן
 * הכתובת צריכה להגיע אליו לטלפון מעצמה.
 *
 * ⚠️ הלינק בהודעה נושא את `ORDERS_TOKEN` — בלעדיו הממשק חוסם. אחרי אתחול
 * הכתובת שונה, כלומר מקור (origin) חדש, והעוגייה מהפעם הקודמת אינה שם.
 *
 *     npm run orders -- boot
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

const ENV_PATH = resolve(ROOT, '.env');
const PORT = Number(process.env.ORDERS_PORT || 4180);

/** cloudflared אינו תמיד ב-PATH של משימה מתוזמנת שרצה לפני התחברות. */
const CLOUDFLARED_CANDIDATES = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  'cloudflared',
];

const log = (msg) => console.log(`[${new Date().toLocaleTimeString('he-IL')}] ${msg}`);

function cloudflaredPath() {
  for (const p of CLOUDFLARED_CANDIDATES) {
    if (p === 'cloudflared' || existsSync(p)) return p;
  }
  throw new Error('cloudflared לא נמצא — התקן עם: winget install --id Cloudflare.cloudflared');
}

/**
 * מרים מנהרה ומחזיר את הכתובת שהיא הדפיסה. cloudflared כותב את הכתובת
 * ל-stderr ולא ל-stdout, ולכן מאזינים לשניהם — אחרת ההמתנה פשוט תפוג.
 */
function startTunnel({ onExit }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(cloudflaredPath(), ['tunnel', '--url', `http://localhost:${PORT}`], {
      windowsHide: true,
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        rejectPromise(new Error('המנהרה לא הדפיסה כתובת תוך 90 שניות'));
      }
    }, 90_000);

    const scan = (chunk) => {
      const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ url: m[0], proc });
      }
    };
    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        rejectPromise(new Error(`cloudflared יצא עם קוד ${code}`));
      } else {
        onExit?.(code);
      }
    });
  });
}

/**
 * מעדכן שורה אחת ב-.env במקום. ⚠️ לא נכתב מחדש כל הקובץ מתבנית — הוא
 * מחזיק את סיסמת קומקס ואת מפתחות WooCommerce, וכתיבה מלאה הייתה
 * מסכנת אותם בכל אתחול.
 */
function writePublicUrl(url) {
  const text = readFileSync(ENV_PATH, 'utf8');
  const line = `ORDERS_PUBLIC_URL=${url}`;
  const updated = /^ORDERS_PUBLIC_URL=.*$/m.test(text)
    ? text.replace(/^ORDERS_PUBLIC_URL=.*$/m, line)
    : `${text.replace(/\n*$/, '\n')}${line}\n`;
  writeFileSync(ENV_PATH, updated, 'utf8');
}

async function main() {
  log('מרים מנהרה…');
  const { url } = await startTunnel({
    onExit: (code) => log(`⚠️ המנהרה נסגרה (קוד ${code}). הרץ שוב: npm run orders -- boot`),
  });
  log(`המנהרה עלתה: ${url}`);

  writePublicUrl(url);

  // ⚠️ הטעינה דינמית **אחרי** כתיבת ה-.env. config.js קורא את הקובץ בזמן
  // ה-import, ולכן import רגיל בראש הקובץ היה תופס את הכתובת הישנה.
  const { config } = await import(`./config.js?fresh=${Date.now()}`);
  const { startServer } = await import('./server.js');
  const { watch } = await import('./watch.js');
  const { sendMessage } = await import('./telegram.js');

  startServer();
  log(`השרת עלה על פורט ${config.server.port}`);

  const link = `${url}/?k=${config.server.token}`;
  try {
    await sendMessage(
      '🔄 <b>אפליקציית ההזמנות עלתה מחדש</b>\n\n' +
        'המחשב הופעל מחדש, ולכן כתובת המנהרה התחלפה. ' +
        'הלינק הקודם — וגם האייקון שבמסך הבית — כבר לא עובדים.\n\n' +
        `<a href="${link}">פתיחת האפליקציה בכתובת החדשה</a>\n\n` +
        'כדאי להוסיף מחדש למסך הבית: שיתוף ← הוספה למסך הבית.',
    );
    log('נשלחה לטלגרם הודעה עם הכתובת החדשה.');
  } catch (err) {
    log(`⚠️ הטלגרם לא קיבל את ההודעה: ${err.message}`);
  }

  await watch();
}

main().catch((err) => {
  console.error(`הרמת ההזמנות נכשלה: ${err.message}`);
  process.exit(1);
});
