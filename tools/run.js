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
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RunLogger } from '../src/logger.js';
import { logoff } from '../src/session.js';
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
// `--json-file` קיים כי PowerShell מפשיט את המרכאות מ-`--json '{"a":1}'` והקלט
// מגיע כ-`{a:1}` שאינו JSON תקין (נמדד 07/09/2026). קלט ארוך עובר דרך קובץ.
const fileIdx = argv.indexOf('--json-file');
const input = fileIdx >= 0
  ? JSON.parse(readFileSync(resolve(ROOT, argv[fileIdx + 1]), 'utf8'))
  : jsonIdx >= 0 ? JSON.parse(argv[jsonIdx + 1]) : {};
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

let closing = false;

/**
 * Release the seat, then close — the only way out of here.
 *
 * Comax gives a user code a single seat, and closing the window does **not**
 * hand it back: the server keeps holding it for about three minutes, and the
 * next run is refused with "קוד משתמש בשימוש". A task that opened its own
 * window must sign off before it goes, exactly like `open.js` already does.
 * Without this, every interrupted run locked out the run after it — which is
 * what made one unmapped screen look like a browser that keeps breaking.
 *
 * When we only attached to a window `npm run open` owns, we do the opposite:
 * signing off would pull the seat out from under whoever is sitting there, so
 * we detach and leave the session alone.
 */
async function shutdown(code) {
  if (closing) return;
  closing = true;

  // Let the last click finish landing before we pull the session out.
  //
  // Comax commits on the server, and the confirmation only comes back when the
  // screen behind the dialog repaints. Signing off in the gap between the click
  // and that repaint aborts the request mid-flight — the document looks filed
  // on our side and never arrives on theirs. Dror caught this on the invoice
  // email route (09/09/2026): "אחרי ה-V הירוק הסופי הסוכן צריך לחכות כמה שניות
  // ורק אז לצאת". So we wait for the network to go quiet, and give it a floor
  // of a couple of seconds even when it already looks idle.
  //
  // Only for a run that wrote something: a read-only task has nothing in flight
  // and should not pay for the wait.
  // The idle wait is short because Comax never goes idle (see `Human.settle`);
  // the fixed three seconds after it is the part that actually does the work.
  if (writes && !dryRun) {
    const idle = session.cfg?.pace?.settleTimeoutMs ?? 2500;
    await session.page.waitForLoadState('networkidle', { timeout: idle }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    logger.step('settle', 'המתנה לסיום הפעולה לפני היציאה');
  }

  if (session.owned) {
    await logoff({ ...session, logger }).catch(() => {});
    await session.context.close().catch(() => {});
  } else {
    await session.browser.close().catch(() => {});
  }
  const dir = logger.done(status);
  console.log(`\nלוג והרצה: ${dir}`);
  process.exit(code);
}

// Ctrl+C, and the kill a harness sends when it stops a run, both land here.
// The default handler ends the process between the first click and the last
// with the seat still held. A second signal gives up and leaves immediately —
// otherwise an impatient Ctrl+C Ctrl+C would hang on the sign-off request.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (closing) process.exit(130);
    status = 'failed';
    logger.step('run', `נקטע (${sig}) — משחרר את המושב לפני היציאה`);
    shutdown(130);
  });
}


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
