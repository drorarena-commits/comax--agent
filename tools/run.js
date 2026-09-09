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

/**
 * `--list` used to print bare filenames, and that is what made an agent write a
 * task that already existed.
 *
 * Measured 09/09/2026: asked for "the customer's last invoice", an agent read a
 * list of 23 names, saw nothing called anything like it, and wrote 3,782 bytes
 * of new task — four minutes before the Comax window even opened. The task it
 * needed was `customer-history`, whose own `meta.description` says "מה לקוח
 * רכש בעבר — חשבונית מס...". The name did not say it; the description did.
 *
 * So the listing reads each task's `meta` and prints what it does, what it
 * takes, and whether it writes. Finding an existing task has to be cheaper than
 * writing a new one, or the new one keeps winning.
 */
async function describeTasks() {
  const rows = [];
  for (const name of listTasks()) {
    try {
      const m = (await import(pathToFileURL(resolve(TASK_DIR, `${name}.js`)).href)).meta ?? {};
      rows.push({
        name,
        description: m.description ?? '(אין תיאור)',
        writes: m.writes !== false,
        input: Object.entries(m.input ?? {}).map(([k, v]) => `${k}: ${v}`),
      });
    } catch (e) {
      rows.push({ name, description: `⚠️ לא נטען: ${e.message}`, writes: true, input: [] });
    }
  }
  return rows;
}

if (!argv.length || argv[0] === '--list') {
  const rows = await describeTasks();
  if (!rows.length) {
    console.log('עדיין אין משימות. נבנה אותן ביחד.');
    process.exit(0);
  }
  console.log(`\n${rows.length} משימות זמינות — חפש כאן לפני שאתה כותב משימה חדשה:\n`);
  for (const r of rows) {
    console.log(`  ${r.writes ? '✏️ ' : '👁️ '} ${r.name}`);
    console.log(`      ${r.description}`);
    for (const i of r.input) console.log(`        · ${i}`);
    console.log('');
  }
  console.log('👁️  = קריאה בלבד   ✏️  = כותבת (דורשת --confirm)\n');
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

/**
 * `--key value` pairs, folded into the same input object as `--json`.
 *
 * Until 09/09/2026 the only way in was `--json '{"customer":"112074"}'`, and
 * anything else was **swallowed in silence**: `--customer 112074` left `input`
 * as `{}` and the run went on to spend 128 seconds — a login, a failure, a
 * second login — before the task itself said "חסר customer". The obvious
 * spelling has to either work or complain; quietly doing neither is what makes
 * the dispatcher look broken and a fresh task look easier.
 *
 * Values are read verbatim, with no numeric or boolean coercion beyond a bare
 * flag becoming `true` — Dror's rule that a source value is written as it is.
 * A leading `112074` must stay the string Comax matches on.
 */
const KNOWN_FLAGS = new Set(['--json', '--json-file', '--confirm']);
const unknown = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  if (KNOWN_FLAGS.has(a)) { if (a !== '--confirm') i++; continue; }
  const key = a.slice(2);
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) { unknown.push(a); continue; }
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) {
    input[key] = true;
  } else {
    // A repeated flag builds a list, so `--programs a157 --programs a132` works
    // for the array-shaped inputs without making the caller reach for --json.
    input[key] = Object.hasOwn(input, key)
      ? [].concat(input[key], next)
      : next;
    i++;
  }
}
if (unknown.length) {
  console.error(`דגל לא מוכר: ${unknown.join(', ')}\nהרץ "npm run run -- --list" כדי לראות מה כל משימה מקבלת.`);
  process.exit(1);
}

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

/**
 * Input is checked **before** the browser, the lock and the login.
 *
 * `customer-history` validates its own `customer` and throws a clear message —
 * but it throws from inside the task, which is after `ensureComax` and a login.
 * Measured 09/09/2026: a run missing `customer` cost 128 seconds and *two*
 * logins (the retry re-logged in and hit the identical line) to deliver "חסר
 * customer — על איזה לקוח לבדוק?". Nothing about that answer needed Comax.
 *
 * The convention is already in the codebase: a required field's description
 * ends with "חובה". So it is enforced here rather than restated in a new
 * `required` array that every task would have to keep in sync.
 *
 * The same pass normalises inputs the meta calls `array`, so `--programs a157`
 * reaches a task expecting a list as `['a157']` instead of a bare string that
 * fails much later, somewhere less obvious.
 */
for (const [key, spec] of Object.entries(mod.meta?.input ?? {})) {
  if (typeof spec !== 'string') continue;
  if (/^array\b/.test(spec) && Object.hasOwn(input, key) && !Array.isArray(input[key])) {
    input[key] = [input[key]];
  }
  const missing = input[key] === undefined || input[key] === '';
  if (/חובה/.test(spec) && missing) {
    console.error(
      `\nחסר "${key}" — ${spec}\n\n` +
        `  ${taskName}: ${mod.meta?.description ?? ''}\n\n` +
        `הרץ "npm run run -- --list" כדי לראות את כל השדות.\n`,
    );
    process.exit(1);
  }
}

/**
 * A task's own pre-flight check, run before the browser, the lock and the login.
 *
 * The "חובה" convention above covers a plainly required field, but not an
 * either/or: `invoice-email` needs `docNo` **or** `customer`, and neither is
 * required on its own. Measured 09/09/2026 — a call missing both still cost 81
 * seconds and a login before the task said so from inside.
 *
 * So a task may export `meta.precheck(input)`, which throws (or returns a
 * string) when the combination cannot work. It gets the parsed input and
 * nothing else: no page, no session. Anything needing Comax to answer is not a
 * precheck.
 */
if (typeof mod.meta?.precheck === 'function') {
  let problem = null;
  try {
    problem = mod.meta.precheck(input) ?? null;
  } catch (e) {
    problem = e.message;
  }
  if (problem) {
    console.error(`\n${problem}\n\n  ${taskName}: ${mod.meta?.description ?? ''}\n`);
    process.exit(1);
  }
}

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
  if (e?.sessionUnrelated) {
    // יש כישלונות שאנחנו כן יודעים לזהות, ולוגין מחדש לא נוגע בהם: אייקון שאינו
    // בשולחן העבודה, תווית כפולה, קטלוג קיצורים ישן. הניסיון השני ימות באותה
    // שורה בדיוק — נמדד 09/09/2026, שלוש הרצות customer-history שכל אחת שילמה
    // לוגין של ~50 שניות ונכשלה שוב על אותו a157.
    //
    // זה לא סותר את "אי אפשר לזהות סשן מת ב-GET": אין כאן ניסיון להוכיח שהסשן
    // חי, אלא רק להכיר בכישלון שהסיבה שלו ידועה ואינה הסשן. כל שאר הכישלונות
    // נשארים תחת ברירת המחדל של הניסיון החוזר.
    logger.step('session', `הכישלון אינו קשור לסשן — לא מתחבר מחדש. ${e.message.split('\n')[0]}`);
    await fail(e);
  } else if (!writes) {
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
