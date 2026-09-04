/**
 * בדיקה 12א׳: האם המושב באמת פנוי?
 *
 * בדיקות אחרות מאמתות שהסוכן מתאושש — לא שהמושב התפנה. זו מאמתת את התוצאה:
 * אחרי `idle-logoff`, האם דרור יכול להיכנס לקומקס מהמחשב השני?
 *
 * מדמה מחשב שני באמת: כרום נפרד, `--user-data-dir` זמני ופורט דיבאג אחר —
 * עוגיות אחרות וסשן דפדפן אחר, לא רק לשונית נוספת.
 *
 * ⚠️ הכרום הזמני **תופס את המושב** ברגע שהתחבר, וסגירת החלון לא משחררת (ממצא
 * א׳ — קומקס משחרר רק אחרי ~10 דקות). לכן הסקריפט עושה `logoff` מפורש לפני
 * שהוא סוגר. בלי זה, המשימה הבאה של הסוכן הייתה שורפת עד שלוש דקות של
 * busyRetries וזה היה נראה כאילו הבדיקה שברה משהו.
 */
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { loadConfig } from '../../src/config.js';
import { Human } from '../../src/human.js';
import { login, logoff, isLoggedIn } from '../../src/session.js';

const cfg = loadConfig();
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'comax-second-'));

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('לא נמצא chrome.exe'); process.exit(1); }

// לוגר שמקליט, כדי לספור הופעות של "קוד משתמש בשימוש".
const steps = [];
const logger = {
  step(kind, msg) { steps.push(`${kind}: ${msg}`); console.log(`  ${kind.padEnd(8)} ${msg}`); },
};

console.log(`\nמשיק כרום "מחשב שני" — פרופיל ${profile}, פורט ${PORT}\n`);
const child = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
], { detached: true, stdio: 'ignore' });
child.unref();

const alive = async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
};
const deadline = Date.now() + 30_000;
while (Date.now() < deadline && !(await alive())) await new Promise((r) => setTimeout(r, 500));
if (!(await alive())) { console.error('הכרום הזמני לא ענה'); rmSync(profile, { recursive: true, force: true }); process.exit(1); }

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 5000 });
const context = browser.contexts()[0];
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(cfg.pace.actionTimeoutMs);
page.setDefaultNavigationTimeout(cfg.pace.navTimeoutMs);
page.on('dialog', (d) => { page.__lastDialog = { message: d.message(), at: Date.now() }; d.accept().catch(() => {}); });

const human = new Human(page, cfg.pace, logger);

const t0 = Date.now();
const ok = await login({ page, human, logger, cfg });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const busy = steps.filter((s) => /בשימוש|עדיין תפוס/.test(s));

console.log('\n─────────────────────────────────────────────────────────────');
console.log(`  התחברות מהמחשב השני: ${ok ? 'הצליחה' : 'נכשלה'} תוך ${secs}ש׳`);
console.log(`  הופעות "קוד משתמש בשימוש": ${busy.length}`);
console.log(`  ${ok && busy.length === 0 ? '✅ המושב היה פנוי' : '❌ המושב לא היה פנוי'}`);
console.log('─────────────────────────────────────────────────────────────\n');

// ⚠️ שחרור מפורש לפני הסגירה — ראה את ההערה בראש הקובץ.
if (await isLoggedIn(page, cfg)) {
  const released = await logoff({ page, human, logger, cfg });
  console.log(released ? '  המושב שוחרר מהכרום הזמני.' : '  ⚠️ השחרור לא הושלם — המתן כ-3 דקות.');
}

await context.close().catch(() => {});
await browser.close().catch(() => {});

// browser.close() על חיבור CDP הוא ניתוק בלבד — הכרום הזמני שורד אותו. בלי
// ההריגה המפורשת נשארו 8 תהליכים ותיקיית פרופיל נעולה אחרי כל הרצה.
try {
  execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
} catch { /* כבר מת */ }
await new Promise((r) => setTimeout(r, 2000));
try { rmSync(profile, { recursive: true, force: true }); console.log('  הפרופיל הזמני נמחק.\n'); }
catch { console.log(`  (הפרופיל הזמני נשאר: ${profile})\n`); }

process.exit(ok && busy.length === 0 ? 0 : 1);
