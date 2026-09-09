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
import { getBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';
import { logoff } from '../src/session.js';
import { ROOT } from '../src/config.js';

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

const session = await getBrowser({ logger });
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

try {
  result = await mod.run({ ...session, logger, input, dryRun, confirm });
  if (result !== undefined) logger.save('result.json', result);
} catch (e) {
  status = 'failed';
  logger.step('error', e.message);
  await logger.shot(session.page, 'error').catch(() => {});
  console.error(`\n${e.stack}`);
}

await shutdown(status === 'ok' ? 0 : 1);
