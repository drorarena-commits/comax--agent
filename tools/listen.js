#!/usr/bin/env node
/**
 * מאזין התור — התהליך שגורם למשימה שנכתבה ל-`queue/inbox/` באמת לרוץ.
 *
 * בלעדיו קובץ משימה פשוט מחכה. זה כל התפקיד: לסרוק, להריץ דרך `tools/run.js`,
 * ולכתוב תוצאה ל-`queue/done/` שאפשר לקרוא מהטלפון.
 *
 * ⛔ הוא אינו מפרש שפה חופשית, אינו משלים הקשר חסר, ואינו מעביר `--confirm`
 * לעולם. הפירוש נעשה ב-Cowork; האישור יגיע ממסלול האישור (§5 במפרט), שעדיין
 * לא נבנה — ועד אז **משימה כותבת נדחית ולא רצה**, שזו התנהגות מכוונת ולא חסר.
 *
 * מריצים אותו דרך `npm run listen-start`, שמשגר אותו מנותק. הרצה ישירה כאן
 * היא חזית, והיא מתה עם הסשן שפתח אותה — בדיוק הכשל של `wa-daemon` מול
 * `wa-start`.
 *
 *   node tools/listen.js            לולאה, עד `npm run listen-stop`
 *   node tools/listen.js --once     סבב אחד ויציאה (לבדיקות)
 */
import { existsSync, readFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIRS, ensureDirs, PID_FILE, STOP_FILE, LOG_FILE } from '../src/queue/paths.js';
import { listDir, loadTask, move, remove, writeJson, readJson, stampLocal } from '../src/queue/store.js';
import { readTaskMeta } from '../src/queue/task-meta.js';
import { runTask, summarize, collectArtifacts, looksBusy } from '../src/queue/runner.js';
import { notifyResult } from '../src/queue/notify.js';
import { peek, busyMessage } from '../src/lock.js';

const POLL_MS = 30_000;
/** אחרי כמה סבבים תפוסים מוותרים ומדווחים `busy` במקום להסתובב לנצח. */
const MAX_BUSY = 4;

const once = process.argv.includes('--once');

// ── לוג ─────────────────────────────────────────────────────────────────────
// תהליך מנותק אין לו לאן לכתוב חוץ מקובץ, וזו הסיבה היחידה שהלוג הזה קיים.
// הלוג המלא של כל משימה נשאר ב-`runs/` שמנהל `RunLogger` — לא משכפלים אותו.
// ⚠️ `listen-start` מפנה את ה-stdout של הדמון **לאותו** קובץ לוג. כתיבה גם
// לכאן וגם לשם רשמה כל שורה פעמיים, ובקריאת הלוג זה נראה בדיוק כמו שני
// מאזינים שרצים במקביל — כלומר כמו התקלה החמורה ביותר שיש למערכת הזאת
// (נמדד 15/09/2026, בזמן אבחון בקשה אמיתית שנכשלה). לכן השיגור מסמן שה-stdout
// שלו כבר נוחת בקובץ, והדמון מדלג על הכתיבה הכפולה.
const STDOUT_IS_LOG = process.env.QUEUE_LOG_IS_STDOUT === '1';

function log(msg) {
  const line = `${stampLocal()}  ${msg}\n`;
  process.stdout.write(line);
  if (STDOUT_IS_LOG) return;
  try {
    appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    /* לוג שנכשל לא יעצור משימה */
  }
}

// ── מאזין אחד בלבד ──────────────────────────────────────────────────────────
// שני מאזינים = אותה משימה רצה פעמיים. במשימה כותבת זה מסמך כפול בקומקס,
// ולכן זו בדיקה ולא המלצה.
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function claimSingleton() {
  if (existsSync(PID_FILE)) {
    try {
      const prev = JSON.parse(readFileSync(PID_FILE, 'utf8'));
      if (alive(prev.pid) && prev.pid !== process.pid) {
        console.error(`כבר רץ מאזין (PID ${prev.pid}) מאז ${prev.startedAt}. לא מפעיל שני.`);
        process.exit(1);
      }
    } catch {
      /* קובץ פגום = שריד, לא בעלים */
    }
  }
  writeJson(PID_FILE, { pid: process.pid, startedAt: stampLocal() });
}

// ── עצירה מסודרת ────────────────────────────────────────────────────────────
// `listen-stop` נוגע בקובץ דגל, ולא הורג. משימה שרצה מסיימת — עצירה באמצע
// כתיבה לקומקס היא בדיוק המסמך החצי-קלוט שאסור לייצר.
let stopping = false;
const stopRequested = () => stopping || existsSync(STOP_FILE);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopping) process.exit(130);
    stopping = true;
    log(`התקבל ${sig} — מסיים את המשימה הנוכחית ואז יוצא.`);
  });
}

function cleanup() {
  try {
    const cur = JSON.parse(readFileSync(PID_FILE, 'utf8'));
    if (cur.pid === process.pid) unlinkSync(PID_FILE);
  } catch {
    /* כבר נוקה */
  }
  try {
    unlinkSync(STOP_FILE);
  } catch {
    /* לא היה */
  }
}

// ── התאוששות ────────────────────────────────────────────────────────────────
/**
 * כל מה שנשאר ב-`working/` מריצה קודמת חוזר ל-`inbox/` עם `recovered: true`.
 *
 * זה המצב שבו התהליך נהרג באמצע. לא ידוע אם המשימה הספיקה לרוץ, ולכן היא
 * חוזרת למסלול מההתחלה — ולעולם לא נכנסת ישר להרצה מאושרת. במשימה כותבת זו
 * ההגנה שמונעת מסמך כפול אחרי קריסה.
 */
function recoverWorking() {
  for (const f of listDir(DIRS.working)) {
    const id = f.replace(/\.json$/, '');
    try {
      const data = readJson(resolve(DIRS.working, f));
      data.recovered = true;
      data.recoveredAt = stampLocal();
      writeJson(resolve(DIRS.working, f), data);
      move(id, DIRS.working, DIRS.inbox);
      log(`שוחזר לתור: ${id} (התהליך הקודם נקטע באמצע)`);
    } catch (e) {
      log(`⚠️ שחזור ${id} נכשל: ${e.message}`);
    }
  }
}

// ── סיום משימה ──────────────────────────────────────────────────────────────
async function finish(id, base, extra) {
  const done = {
    id,
    request: base.request ?? '(לא צוין)',
    status: 'failed',
    startedAt: base.startedAt,
    finishedAt: stampLocal(),
    task: base.task ?? null,
    mode: base.mode ?? null,
    writes: base.writes ?? null,
    summary: null,
    artifacts: [],
    runDir: null,
    error: null,
    ...extra,
  };
  writeJson(resolve(DIRS.done, `${id}.json`), done);
  remove(id, DIRS.working);
  log(`${id} → ${done.status}${done.error ? ` · ${done.error.split('\n')[0]}` : ''}`);

  if (base.notify !== false) {
    const r = await notifyResult(done);
    if (!r.sent) log(`⚠️ טלגרם: ${r.error}`);
  }
  return done;
}

// ── משימה אחת ───────────────────────────────────────────────────────────────
async function processOne(id) {
  const startedAt = stampLocal();
  let file;
  try {
    file = move(id, DIRS.inbox, DIRS.working);
  } catch (e) {
    // נעלם בין הסריקה להזזה — נמחק ידנית, או מאזין שני. לא שגיאה.
    log(`${id} לא נלקח: ${e.code ?? e.message}`);
    return;
  }

  const { task, error } = loadTask(file, id);
  if (error) {
    return finish(id, { startedAt, request: '(קובץ משימה פגום)' }, { status: 'failed', error });
  }

  const base = {
    startedAt,
    request: task.request,
    task: task.task ?? null,
    mode: task.mode,
    notify: task.notify,
  };
  log(`▶ ${id} · ${task.request}`);

  // mode: "agent" — סשן Claude קצר. עדיין לא נבנה.
  if (task.mode === 'agent') {
    return finish(id, base, {
      status: 'rejected',
      error: 'mode "agent" עדיין לא נבנה במאזין. נבנה רק המסלול הירוק (משימות קריאה).',
    });
  }

  const meta = readTaskMeta(task.task);
  if (!meta.ok) {
    return finish(id, { ...base, writes: true }, { status: 'failed', error: meta.error });
  }

  // ⛔ הקו האדום. משימה כותבת אינה רצה עד שמסלול האישור (§5) קיים ונבדק.
  // היא נדחית במפורש ולא "רצה בלי --confirm", כי גם הרצה בלי אישור פותחת
  // טיוטה בקומקס שמישהו יצטרך לנקות, בזמן שאין מי שיאשר אותה.
  if (meta.writes) {
    return finish(id, { ...base, writes: true }, {
      status: 'rejected',
      error:
        `"${task.task}" היא משימה כותבת (meta.writes ≠ false), ומסלול האישור עדיין לא נבנה.\n` +
        'לא הורצה, לא נוצרה טיוטה, ושום דבר לא נקלט בקומקס.\n' +
        'להריץ ידנית מהמחשב, או להמתין לבניית מסלול ה-hold/approve.',
    });
  }

  // המושב תפוס — מחזירים לתור במקום לשרוף הרצה. ⚠️ ההצצה אינה ערובה;
  // `run.js` הוא שמכריע, ולכן יש גם בדיקת פלט אחרי ההרצה.
  const holder = peek();
  if (holder) return requeueBusy(id, base, task, busyMessage(holder));

  log(`  מריץ: node tools/run.js ${task.task} --json ${JSON.stringify(task.input ?? {})}`);
  const run = await runTask({
    task: task.task,
    input: task.input ?? {},
    onLine: (l) => l.trim() && log(`  | ${l.trim()}`),
  });

  if (run.code !== 0 && looksBusy(run.output)) {
    return requeueBusy(id, base, task, 'המושב נתפס בין הבדיקה להרצה.');
  }

  const ok = run.code === 0 && !run.error;
  return finish(id, { ...base, writes: false }, {
    status: ok ? 'ok' : 'failed',
    writes: false,
    summary: ok ? summarize({ task: task.task, result: run.result, output: run.output }) : null,
    artifacts: ok ? collectArtifacts(run.result) : [],
    runDir: run.runDir,
    error: ok ? null : (run.error ?? errorFrom(run)),
  });
}

/** הודעת השגיאה המלאה — לא חתוכה. `runDir` מפנה ללוג המלא. */
function errorFrom(run) {
  const tail = run.output.split(/\r?\n/).filter((l) => l.trim()).slice(-25).join('\n');
  return `המשימה נכשלה (קוד יציאה ${run.code}).\n${tail}`;
}

async function requeueBusy(id, base, task, reason) {
  const attempts = (task.busyAttempts ?? 0) + 1;
  if (attempts >= MAX_BUSY) {
    return finish(id, base, {
      status: 'busy',
      error: `${reason}\nאחרי ${attempts} ניסיונות המושב עדיין תפוס. לנסות שוב כשהוא יתפנה.`,
    });
  }
  task.busyAttempts = attempts;
  writeJson(resolve(DIRS.working, `${id}.json`), task);
  move(id, DIRS.working, DIRS.inbox);
  log(`⏳ ${id} חוזר לתור (${attempts}/${MAX_BUSY}) — ${reason.split('\n')[0]}`);
}

// ── הלולאה ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** המתנה שמקשיבה לעצירה — `listen-stop` לא צריך לחכות 30 שניות. */
async function waitPoll() {
  for (let i = 0; i < POLL_MS / 500; i++) {
    if (stopRequested()) return;
    await sleep(500);
  }
}

async function main() {
  ensureDirs();
  claimSingleton();
  // דגל עצירה ישן מריצה קודמת היה מכבה את המאזין מיד עם העלייה.
  try {
    unlinkSync(STOP_FILE);
  } catch {
    /* לא היה */
  }
  log(`מאזין עלה (PID ${process.pid}) — סורק את queue/inbox כל ${POLL_MS / 1000} שניות.`);
  recoverWorking();

  for (;;) {
    if (stopRequested()) break;

    // משימה אחת בכל רגע: לקומקס יש מושב יחיד, ולכן אין כאן שום מקביליות.
    const files = listDir(DIRS.inbox);
    if (files.length) {
      await processOne(files[0].replace(/\.json$/, ''));
      if (once) break;
      continue;
    }

    if (once) break;
    await waitPoll();
  }

  log('מאזין יוצא.');
  cleanup();
}

main().catch((e) => {
  log(`⛔ המאזין נפל: ${e.stack}`);
  cleanup();
  process.exit(1);
});
