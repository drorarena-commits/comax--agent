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
import { logoff } from '../src/session.js';
import { RunLogger } from '../src/logger.js';
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
try {
  result = await mod.run({ ...session, logger, input, dryRun, confirm });
  if (result !== undefined) logger.save('result.json', result);
} catch (e) {
  status = 'failed';
  logger.step('error', e.message);
  await logger.shot(session.page, 'error').catch(() => {});
  console.error(`\n${e.stack}`);
} finally {
  // A window we launched dies with this process, and Comax holds the seat for
  // about three minutes unless CloseSession.ashx actually fires — so release it
  // here, while the page is still alive to send it. A window we attached to
  // belongs to `npm run open`; logging that one off would pull the seat out
  // from under whoever is working in it.
  if (session.owned) {
    await logoff({ ...session, logger }).catch((e) => logger.step('session', `שחרור המושב נכשל: ${e.message}`));
    await session.context.close().catch(() => {});
  } else {
    await session.browser.close().catch(() => {});
  }
  const dir = logger.done(status);
  console.log(`\nלוג והרצה: ${dir}`);
}

process.exit(status === 'ok' ? 0 : 1);
