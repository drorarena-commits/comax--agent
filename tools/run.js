/**
 * Task dispatcher.
 *
 *   node tools/run.js <task> --json '{"key":"value"}'
 *   node tools/run.js <task> --json '{...}' --confirm     (allow the final write)
 *   node tools/run.js --list
 *
 * Tasks are dry-run by default: they fill everything in, screenshot the ready
 * form, and stop before the irreversible button. --confirm is the only way past
 * that line.
 */
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RunLogger } from '../src/logger.js';
import { ROOT } from '../src/config.js';
import { ensureComax } from '../src/ensure-comax.js';
import { acquire, busyMessage } from '../src/lock.js';
import { touch } from '../src/activity.js';
import { login } from '../src/session.js';

const TASK_DIR = resolve(ROOT, 'src/tasks');

const listTasks = () =>
  readdirSync(TASK_DIR)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .map((f) => f.replace(/\.js$/, ''));

const argv = process.argv.slice(2);

if (!argv.length || argv[0] === '--list') {
  const tasks = listTasks();
  console.log(tasks.length ? `משימות זמינות:\n  ${tasks.join('\n  ')}` : 'עדיין אין משימות. נבנה אותן ביחד.');
  process.exit(0);
}

const taskName = argv[0];
const jsonIdx = argv.indexOf('--json');
const input = jsonIdx >= 0 ? JSON.parse(argv[jsonIdx + 1]) : {};
const confirm = argv.includes('--confirm');

const taskFile = resolve(TASK_DIR, `${taskName}.js`);
if (!existsSync(taskFile)) {
  console.error(`אין משימה בשם "${taskName}". קיימות: ${listTasks().join(', ') || '(אין)'}`);
  process.exit(1);
}

const mod = await import(pathToFileURL(taskFile).href);
if (typeof mod.run !== 'function') {
  console.error(`${taskName}.js חייב לייצא פונקציה בשם run`);
  process.exit(1);
}

const writes = mod.meta?.writes !== false; // assume a task writes unless it says otherwise
const dryRun = writes && !confirm;

const logger = new RunLogger(taskName);
logger.step('input', JSON.stringify(input));
logger.step('mode', dryRun ? 'DRY RUN — יעצור לפני השמירה' : writes ? 'LIVE — יבצע את הפעולה' : 'READ ONLY');

// לקומקס יש מושב אחד, ומאז שהסוכן זמין מהאייפון הרצה מהטלפון יכולה להיכנס על
// הרצה מקומית. הנעילה נלקחת לפני שנוגעים בדפדפן.
// waitMs: idle-logoff רץ כל 5 דקות ומחזיק את הלוק לשנייה-שתיים. בלי המתנה,
// בקשה שנכנסת באותה שנייה הייתה נדחית עם PID שדרור לא מכיר.
const lock = await acquire(taskName, { waitMs: 10_000 });
if (!lock.ok) {
  console.error(`\n${busyMessage(lock.holder)}\n`);
  logger.done('failed');
  process.exit(1);
}

// מוודא חלון חי וסשן חי לפני הקליק הראשון. נופל כאן עם הודעה ברורה במקום
// להיכשל עמוק בתוך משימה על מסמך אמיתי.
const ready = await ensureComax({ logger });
if (ready.status !== 'READY') {
  console.error(`\nקומקס לא מוכן (${ready.status}) — ${ready.reason}\n`);
  lock.release();
  logger.done('failed');
  process.exit(1);
}
// משתמשים בסשן ש-ensureComax כבר פתח. חיבור CDP שני לאותו חלון היה רושם
// handleDialogs פעמיים, כלומר שני accept() לכל דיאלוג של קומקס.
const session = ready.session;

// השעון מתחיל מחדש עם כל שימוש. בלי החותמת בהתחלה, משימה ארוכה הייתה נראית
// ל-idle-logoff כמו שקט מתמשך.
touch(taskName);

/**
 * דיווח כישלון אחיד.
 *
 * `original` היא תמיד השגיאה שמדווחת. כשגם הניסיון השני נכשל, השגיאה שלו נרשמת
 * ללוג אבל **לא** מחליפה את המקורית: אחרת כל תקלה אמיתית — אייקון שנעלם, שדה
 * ששמו השתנה — הייתה נראית כמו בעיית סשן, וניפוי הבאג הבא היה מתחיל מהמקום
 * הלא נכון.
 */
let status = 'ok';
let result;

async function fail(original, second = null) {
  status = 'failed';
  logger.step('error', original.message);
  if (second) logger.step('error', `גם הניסיון השני נכשל: ${second.message}`);
  await logger.shot(session.page, 'error').catch(() => {});
  console.error(`\n${original.stack}`);
}

const attempt = async () => {
  const r = await mod.run({ ...session, logger, input, dryRun, confirm });
  if (r !== undefined) logger.save('result.json', r);
  return r;
};

try {
  result = await attempt();
} catch (e) {
  // אין דרך לשאול את קומקס אם הסשן חי: נמדדו 37 כתובות והן זהות בייט על סשן חי
  // ועל סשן מת (ממצא ב׳ ב-MAP.md). וסשן מת גם לא מנווט למסך התחברות — התוכנית
  // פשוט לא נפתחת וה-DOM נשאר שלם (ממצא ג׳). לכן אין מה לזהות, ומגיבים לכישלון
  // עצמו.
  if (!writes) {
    // קריאה: אין מה לאבד. לוגין מחדש וניסיון שני יחיד מכסים את מקרה הסשן המת
    // בלי לנסות להבחין בו. המחיר: לוגין מיותר על כישלון שאינו קשור לסשן.
    logger.step('session', 'המשימה נכשלה — מתחבר מחדש ומנסה שוב פעם אחת');
    const back = await login({ ...session, logger }).catch(() => false);
    if (!back) {
      logger.step('session', 'ההתחברות מחדש נכשלה');
      await fail(e);
    } else {
      try {
        result = await attempt();
        logger.step('session', 'הניסיון השני הצליח אחרי לוגין מחדש');
      } catch (e2) {
        await fail(e, e2);
      }
    }
  } else {
    // כתיבה: הטיוטה בצד השרת מתה יחד עם הסשן. המשך מאותה נקודה היה מקליד לתוך
    // מסך ריק שאין בו השורות הקודמות, והתוצאה מסמך חלקי או כפול על מסמך אמיתי
    // בעסק — בזמן שאף אחד לא ליד המסך. מתחברים מחדש כדי שהסשן יהיה נקי לניסיון
    // הבא, ועוצרים עם דיווח. הניסיון החוזר מוגן בבדיקת הכפילות של כלל 11.
    const back = await login({ ...session, logger }).catch(() => false);
    await fail(e);
    console.error(
      `\n⚠️  משימה כותבת נכשלה (${taskName}).` +
        `\n    ${back ? 'התחברתי מחדש — הסשן נקי לניסיון הבא.' : 'ההתחברות מחדש נכשלה.'}` +
        '\n    לא ידוע אם המסמך נוצר, ולכן לא מנסים שוב אוטומטית.' +
        '\n    תבדוק בקומקס לפני שתריץ שוב.\n',
    );
  }
} finally {
  // חותמת שנייה: חלון החסד נמדד מסיום העבודה, לא מתחילתה.
  touch(taskName);
  // אין כאן logoff יותר, ובכוונה. הסשן נשאר פתוח כדי שבקשות רצופות מהאייפון
  // ירוצו מיד בלי לוגין חוזר, וקומקס משחרר את המושב לבד אחרי כ-10 דקות של
  // חוסר פעילות. `npm run logoff` נשאר לשחרור מיידי כשצריך.
  //
  // ensureComax תמיד מתחבר לחלון קיים (detached), אז זה ניתוק CDP בלבד —
  // החלון עצמו נשאר פתוח לבקשה הבאה.
  await session.browser?.close().catch(() => {});
  lock.release();
  const dir = logger.done(status);
  console.log(`\nלוג והרצה: ${dir}`);
}

process.exit(status === 'ok' ? 0 : 1);
