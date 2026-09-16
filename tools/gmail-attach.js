/**
 * מוריד קובץ מצורף ממייל, דרך חלון הסוכן, ישירות לדיסק.
 *
 *   node tools/gmail-attach.js <messageId> [חלק-משם-הקובץ] [שם-יעד]
 *   node tools/gmail-attach.js --list <messageId>
 *
 * למה זה קיים, בדיוק כמו `tools/drive-get.js`: מחבר ה-Gmail מחזיר קובץ מצורף
 * כ-base64 **דרך השיחה**, כך שחוברת של 5 MB עולה מאות אלפי טוקנים לקבל ואי
 * אפשר בכלל לכתוב אותה לדיסק. לדפדפן כבר יש סשן גוגל מחובר, ולכן הבייטים
 * עוברים ישירות ל-Chrome ואף אחד מהם לא עובר במודל. הגודל מפסיק להיות שיקול.
 *
 * דורש התחברות חד-פעמית לגוגל בתוך פרופיל ה-Chrome של הסוכן.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, loadConfig } from '../src/config.js';
import { parseFlags, flagProblems } from '../src/cli-args.js';

// Dror has two Gmail accounts — dror.arena@ and drorarena@ (no dot) — and mail
// arrives at both. /mail/u/0/ is whichever Chrome signed in first, so a message
// that lives in the other one reports 'no attachments' rather than 'wrong
// account'. Measured 10/09/2026 on the Wix August report.
//
// ⛔ `--account` נקרא ב-`args[acctFlag + 1]` בלי בדיקה, ואז `splice(acctFlag, 2)`
// חתך שני איברים תמיד. `--account` בסוף השורה נתן `account = undefined` —
// ו-`/mail/u/undefined/` מדווח "אין קבצים מצורפים", שנקרא כתשובה על המייל ולא
// כתקלת פענוח. אותה מלכודת בדיוק שהתגלתה כאן עם `--list`, מהצד השני שלה.
const flags = parseFlags(process.argv.slice(2), {
  skipFirst: false,
  booleans: ['list'],
  valued: ['account'],
});
const problems = flagProblems(flags);
if (problems.length) {
  console.error('\n' + problems.join('\n')
    + '\n\nשימוש: node tools/gmail-attach.js [--account 0|1] [--list] <messageId> [חלק-משם-הקובץ] [שם-יעד]\n');
  process.exit(1);
}
const account = flags.input.account ?? '0';
const list = flags.input.list === true;
const [messageId, match, outName] = flags._;
if (!messageId) {
  console.error('שימוש: node tools/gmail-attach.js <messageId> [חלק-משם-הקובץ] [שם-יעד]');
  process.exit(1);
}

const cfg = loadConfig();

// לא `attachBrowser`: ה-timeout שלו הוא 5 שניות, ו-Playwright מתחבר לכל טאב
// בדפדפן. כשהחלון מחזיק גם את קומקס וגם את Gmail, הלחיצה הזאת אורכת יותר.
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
const ctx = browser.contexts()[0];
if (!ctx) { console.error('אין הקשר דפדפן.'); process.exit(1); }

try {
  const p = await ctx.newPage();
  await p.goto(`https://mail.google.com/mail/u/${account}/#all/${messageId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await p.waitForTimeout(6000);

  if (/accounts\.google\.com|ServiceLogin/i.test(p.url())) {
    console.error('חלון הסוכן אינו מחובר לגוגל. תתחבר פעם אחת ב-npm run open ואז תריץ שוב.');
    process.exit(2);
  }

  // הצ׳יפים של הקבצים המצורפים נושאים את שם הקובץ ב-aria-label או בטקסט.
  const names = await p.evaluate(() =>
    [...document.querySelectorAll('[download_url], .aQH span, [aria-label]')]
      .map((e) => e.getAttribute('download_url') || e.getAttribute('aria-label') || e.textContent || '')
      .filter((s) => /\.(xlsx|xls|csv|pdf|zip|docx|pptx)/i.test(s))
      .map((s) => s.trim())
      .filter((s, i, a) => a.indexOf(s) === i));

  if (list || !match) {
    console.log(names.length ? `קבצים במייל:\n  ${names.join('\n  ')}` : 'לא נמצאו קבצים מצורפים.');
    await p.close();
    process.exit(0);
  }

  const dir = resolve(ROOT, 'data/inbox');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // הכפתור "הורדה" יושב על הצ׳יפ; מזהים אותו לפי שם הקובץ שבתוכו.
  const dl = ctx.waitForEvent('download', { timeout: 10 * 60_000 });
  const clicked = await p.evaluate((needle) => {
    // ל-Gmail יש כפתור ייעודי לכל קובץ, וה-aria-label שלו הוא
    // "להורדת הקובץ המצורף <שם>" / "Download attachment <name>". מזהים לפיו
    // ולא לפי מיקום ב-DOM, שמשתנה בין גרסאות.
    const dlBtn = [...document.querySelectorAll('[aria-label]')].find((e) => {
      const l = e.getAttribute('aria-label') || '';
      return l.includes(needle) && /להורדת|Download/i.test(l);
    });
    if (dlBtn) { dlBtn.click(); return true; }

    // נפילה לאחור: הקישור הישיר שיושב על הצ׳יפ עצמו.
    const chip = [...document.querySelectorAll('[download_url]')]
      .find((e) => (e.getAttribute('download_url') || '').includes(needle));
    const url = chip?.getAttribute('download_url')?.split(':').slice(2).join(':');
    if (url) { window.location.href = url; return true; }
    return false;
  }, match);

  if (!clicked) {
    console.error(`לא מצאתי קובץ מצורף ששמו מכיל "${match}".`);
    console.error(names.length ? `יש במייל:\n  ${names.join('\n  ')}` : 'לא נמצאו קבצים מצורפים.');
    process.exit(1);
  }

  const d = await dl;
  const dest = resolve(dir, outName ?? d.suggestedFilename());
  await d.saveAs(dest);
  console.log(`ירד: ${dest}`);
  console.log(`גודל: ${(statSync(dest).size / 1024 / 1024).toFixed(2)} MB`);
  await p.close().catch(() => {});
} finally {
  await browser.close().catch(() => {}); // מנתק CDP בלבד; החלון נשאר פתוח
}
