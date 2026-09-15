/**
 * מוריד את דוח המלאי הארצי של ספורט אנד מור מהמייל, ושומר אותו בתיקייה הקבועה.
 *
 *   npm run sm-stock                 מוצא את המייל האחרון, מוריד, שומר
 *   npm run sm-stock -- --list       רק מציג את המועמדים, בלי להוריד
 *   npm run sm-stock -- --pick 2     בוחר מועמד אחר מהרשימה
 *   npm run sm-stock -- --query "…"  שאילתת Gmail אחרת
 *   npm run sm-stock -- --force      מרשה לדרוס קובץ קיים מאותו תאריך
 *
 * הקובץ נשמר כ-`content/sportmore/מלאי-ספורט-אנד-מור-<תאריך-המייל>.xlsx`,
 * והתאריך הוא **תאריך שליחת המייל** ולא היום — כך שהרצה חוזרת נוחתת על אותו
 * שם ואינה מייצרת עותק שני, והשם מעיד על נכונות הנתונים ולא על מתי הורדנו.
 *
 * למה דרך הדפדפן ולא דרך מחבר ה-Gmail: **הבייטים לא עוברים במודל.** קובץ
 * מצורף שחוזר כ-base64 דרך השיחה עולה מאות אלפי טוקנים ואי אפשר בכלל לכתוב
 * אותו לדיסק. כאן הוא נוחת ישירות מהכרום לדיסק, וגודל הקובץ מפסיק להיות שיקול.
 *
 * ⚠️ **ושתי הכתובות של דרור הן תיבה אחת.** `dror.arena@gmail.com` ו-
 * `drorarena@gmail.com` נבדלות רק בנקודה, ו-Gmail **מתעלם מנקודות** — אותה
 * תיבה בדיוק. נמדד 15/09/2026: `to:drorarena@gmail.com` מחזיר גם מיילים
 * שנשלחו ל-`dror.arena@`, ו-`/mail/u/1/` ו-`/mail/u/2/` **מפנים בשקט חזרה
 * ל-`/u/0/`** כי רק חשבון גוגל אחד מחובר בכרום. לכן סריקה של שתי תיבות אינה
 * מוסיפה דבר, וברירת המחדל היא `u/0` בלבד. `--accounts 0,1` נשאר למקרה שיתווסף
 * חשבון גוגל **נפרד** (לא כתובת נוספת של אותו חשבון) — ואז השורות נקיות
 * מכפילויות לפי מזהה השרשור.
 *
 * ⚠️ מזהי Gmail נושאים בתוכם חותמת זמן: `id >> 20` הוא אפוך-מילישניות. נמדד
 * על חמישה מיילים מול `internalDate` של ה-API — סטייה של עד 30 שניות. משם
 * מגיעים גם הסדר בין שתי התיבות וגם התאריך שבשם הקובץ, בלי לפרסר תאריך עברי
 * מהמסך (שמשתנה עם שפת הממשק ועם "אתמול"/"10:42").
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, loadConfig } from '../src/config.js';

/** התיקייה והתבנית — מתועדות ב-CLAUDE.md, ואסור לשנות בלי לעדכן שם. */
export const DEST_DIR = resolve(ROOT, 'content/sportmore');
export const destFor = (date) => resolve(DEST_DIR, `מלאי-ספורט-אנד-מור-${date}.xlsx`);

/**
 * שתי שאילתות, ובכוונה.
 *
 * הדוח מגיע תחת הנושא **"הפקת דו_ח מלאי נוכחי במחסנים"** — שהוא בעצם שם
 * הקובץ שפריוריטי מייצר, עם מזהה אקראי משורשר אליו. **השולח מתחלף** (נמדד:
 * `alina_v@` ב-03/09, `keren_b@` ב-15/09), ולכן ההתאמה היא לפי הנושא ולא לפיו.
 *
 * ⚠️ `filename:xls` **אינו תופס `.xlsx`** — Gmail משווה סיומת מלאה. זה החזיר
 * תוצאה אחת בודדת ונראה כמו "אין דוח בתיבה".
 *
 * ⚠️ והביטוי נעצר ב-`"מלאי נוכחי"` בכוונה: פריוריטי משרשר מזהה אקראי **בלי
 * רווח** לשם הקובץ (`…במחסנים79F960DDF…`), ולכן `"מלאי נוכחי במחסנים"` נשבר
 * על המילה האחרונה — הוא החזיר דווקא דוחות ישנים מ-2025 ופספס את של היום.
 *
 * אם המדויקת לא מצאה דבר, הרחבה מציגה מועמדים **ולא מורידה** — הורדה של הדוח
 * הלא נכון נראית בדיוק כמו הצלחה, ומרעילה בשקט כל תשובת השלמות אחריה.
 */
const EXACT_QUERY = 'from:@sportm.co.il has:attachment filename:xlsx "מלאי נוכחי"';

/**
 * השאילתה היא רשת, וזה השער.
 *
 * Gmail מחפש את הביטוי גם **בגוף המייל**, ולכן EXACT_QUERY החזיר גם "מלאי כל
 * העולם", "תתחדש" ו"דוח מלאי ומכירות — הולמס פלייס". הדוח הנכון מזוהה בוודאות
 * לפי **הנושא**, שהוא שם הקובץ שפריוריטי הפיק.
 */
const SUBJECT_RE = /מלאי\s*נוכחי/;
const WIDE_QUERY = 'from:@sportm.co.il has:attachment filename:xlsx (מלאי OR מחסן OR מחסנים OR stock)';

/** `id >> 20` — ראה הכותרת. מחזיר Date. */
export const stampOf = (hexId) => new Date(Number(BigInt(`0x${hexId}`) >> 20n));
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const listOnly = flag('list');
const force = flag('force');
const pickArg = opt('pick');
const accounts = (opt('accounts') ?? '0').split(',').map((s) => s.trim()).filter(Boolean);

const cfg = loadConfig();

/* ── חיפוש בתיבה אחת ───────────────────────────────────────────────────── */

/**
 * מחזיר את שורות התוצאה של תיבה אחת, כל אחת עם מזהה השרשור ותאריכה.
 *
 * `data-legacy-thread-id` הוא המזהה ההקסדצימלי שאפשר לפתוח איתו ישירות
 * (`#all/<id>`); ה-`id` שעל ה-`<tr>` הוא מזהה DOM מקומי ומשתנה בין טעינות.
 *
 * ⚠️ והתכונה יושבת על **span שבתוך** השורה, לא על ה-`<tr>` עצמו. נמדד
 * 15/09/2026 על Chrome 152: `tr[data-legacy-thread-id]` החזיר 0 בזמן ש-`tr.zA`
 * החזיר 23 — כלומר סלקטור שגוי נראה בדיוק כמו "אין מיילים כאלה", וזה הכשל
 * המסוכן כאן: הוא שקט, והתשובה שלו נשמעת כמו עובדה על התיבה.
 */
async function searchAccount(ctx, account, query) {
  const p = await ctx.newPage();
  try {
    await p.goto(`https://mail.google.com/mail/u/${account}/#search/${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded', timeout: 120_000 });

    if (/accounts\.google\.com|ServiceLogin/i.test(p.url())) {
      return { account, error: 'לא מחובר' };
    }

    // הרשימה נטענת אסינכרונית, ו"אין תוצאות" הוא מצב תקין ולא שגיאה — ולכן
    // ממתינים לאחד משני הסימנים.
    //
    // ⚠️ והמתנה קצובה קצרה מדי מחזירה 0 שנראה כמו תשובה. נמדד 15/09/2026:
    // `to:drorarena@gmail.com` החזיר 0 אחרי 6 שניות ו-6 תוצאות אחרי 12,
    // ומ-0 הזה הסקתי מסקנה שגויה על התיבה. אין כאן קיצור דרך.
    await p.waitForFunction(
      () => document.querySelector('tr.zA [data-legacy-thread-id]')
        || /לא נמצאו|No messages matched|didn't match any/i.test(document.body.innerText),
      null, { timeout: 90_000 },
    ).catch(() => {});
    await p.waitForTimeout(2500); // השורות ממשיכות להיכנס אחרי הראשונה

    const rows = await p.evaluate(() =>
      [...document.querySelectorAll('tr.zA')].slice(0, 10).map((tr) => ({
        id: tr.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id'),
        subject: tr.querySelector('.bog')?.textContent?.trim() ?? '',
        from: tr.querySelector('.yP, .zF')?.getAttribute('email')
          ?? tr.querySelector('.yP, .zF')?.textContent?.trim() ?? '',
      })).filter((r) => r.id));

    return { account, rows };
  } catch (e) {
    return { account, error: e.message };
  } finally {
    await p.close().catch(() => {});
  }
}

/* ── הורדת הקובץ המצורף ────────────────────────────────────────────────── */

/**
 * מוריד את האקסל מהמייל שנבחר, לתוך `data/inbox/`.
 *
 * ⚠️ **לא בלחיצה על כפתור ההורדה, ולא דרך `waitForEvent('download')`.** שניהם
 * נוסו ב-15/09/2026 ושניהם נכשלו **בשקט** מול דפדפן שמחוברים אליו ב-CDP:
 *   - קליק אמיתי (`locator.click()`) על `button[aria-label^="להורדת הקובץ
 *     המצורף"]` עבר בהצלחה — ולא הפיק אפילו `downloadWillBegin`.
 *   - `browserContext.waitForEvent('download')` פג אחרי 60 שניות, כי הדפדפן
 *     כאן אינו הקשר שפלייררייט יצר, ואירועי ההורדה שלו אינם מגיעים אליו.
 *
 * מה שכן עובד: **ניווט לקישור הישיר של הקובץ המצורף** (`view=att&disp=safe`),
 * כשהיעד נקבע מראש ב-`Browser.setDownloadBehavior`. `page.goto` זורק אז
 * "Download is starting" — וזו ההצלחה, לא כישלון.
 *
 * ⛔ ואין להשתמש ב-`download_url` שעל הצ׳יפ: הערך שם מגיע עם הקידומת **כפולה**
 * (`…/mail/u/0https://mail.google.com/mail/u/0?ui=2…`), וחיתוך על נקודתיים
 * מייצר כתובת שבורה.
 */
async function download(ctx, account, threadId) {
  const p = await ctx.newPage();
  const inbox = resolve(ROOT, 'data/inbox');
  if (!existsSync(inbox)) mkdirSync(inbox, { recursive: true });

  try {
    const cdp = await ctx.newCDPSession(p);
    // allowAndName שומר בשם GUID — אין התנגשות עם קובץ קיים, ואין תלות בשם
    // עברי ארוך שווינדוס עלול לקצץ.
    await cdp.send('Browser.setDownloadBehavior',
      { behavior: 'allowAndName', downloadPath: inbox, eventsEnabled: true });

    let original = null;
    cdp.on('Browser.downloadWillBegin', (e) => { original = e.suggestedFilename; });
    const finished = new Promise((res) => {
      cdp.on('Browser.downloadProgress', (e) => { if (e.state !== 'inProgress') res(e); });
    });

    await p.goto(`https://mail.google.com/mail/u/${account}/#all/${threadId}`,
      { waitUntil: 'domcontentloaded', timeout: 120_000 });

    // ⚠️ המתנה קצובה כאן היא באג ולא הידוק. נמדד על אותו מייל: ב-6 שניות ה-DOM
    // מחזיק 0 צ׳יפים של קבצים מצורפים, ובכ-14 שניות הוא מחזיק 1. כלומר
    // `waitForTimeout(6000)` מדווח "אין קובץ אקסל מצורף במייל הזה" — משפט
    // שנשמע כמו עובדה על המייל ולא כמו המתנה שנגמרה מוקדם.
    const link = 'a[href*="view=att"][href*="disp=safe"]';
    const ok = await p.waitForFunction((s) => document.querySelector(s), link, { timeout: 90_000 })
      .catch(() => null);
    if (!ok) return { error: 'לא נמצא קובץ מצורף להורדה במייל הזה.' };

    const href = await p.evaluate((s) => document.querySelector(s)?.href, link);
    if (!href) return { error: 'לא נמצא קובץ מצורף להורדה במייל הזה.' };

    await p.goto(href, { timeout: 120_000 }).catch((e) => {
      if (!/Download is starting/i.test(e.message)) throw e;
    });

    const res = await Promise.race([
      finished,
      new Promise((r) => setTimeout(() => r({ state: 'timeout' }), 5 * 60_000)),
    ]);
    if (res.state !== 'completed') return { error: `ההורדה לא הושלמה (${res.state}).` };

    return { raw: resolve(inbox, res.guid), original };
  } finally {
    await p.close().catch(() => {});
  }
}

/* ── הזרימה ────────────────────────────────────────────────────────────── */

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 })
  .catch(() => null);
if (!browser) {
  console.error('חלון הסוכן אינו פתוח. תריץ קודם: npm run open');
  process.exit(2);
}
const ctx = browser.contexts()[0];
if (!ctx) { console.error('אין הקשר דפדפן.'); process.exit(2); }

/** מריץ שאילתה על כל התיבות שנתבקשו, ומאחד לרשימה אחת בלי כפילויות. */
async function gather(query) {
  const all = [];
  const seen = new Set();
  for (const a of accounts) {
    const r = await searchAccount(ctx, a, query);
    if (r.error) { console.log(`u/${a}: ⚠️ ${r.error}`); continue; }
    for (const row of r.rows) {
      if (seen.has(row.id)) continue; // אותה תיבה מאחורי שני מספרים
      seen.add(row.id);
      all.push({ ...row, account: a, when: stampOf(row.id) });
    }
  }
  // המזהה נושא חותמת זמן, ולכן המיון נכון גם בין תיבות ובלי לפרסר תאריכים.
  return all.sort((x, y) => y.when - x.when);
}

const show = (rows) => rows.forEach((r, i) =>
  console.log(`  ${String(i + 1).padStart(2)}. ${ymd(r.when)}  ${r.from.padEnd(24).slice(0, 24)}  ${r.subject.slice(0, 48)}`));

try {
  const userQuery = opt('query');
  console.log(`תיבות: ${accounts.map((a) => `u/${a}`).join(' · ')}`);

  let all = await gather(userQuery ?? EXACT_QUERY);
  let widened = Boolean(userQuery);

  if (!userQuery) {
    const onSubject = all.filter((r) => SUBJECT_RE.test(r.subject));
    if (onSubject.length) {
      all = onSubject;
    } else {
      console.log('\nאף נושא לא נראה כמו הדוח הרגיל — מרחיב.');
      all = await gather(WIDE_QUERY);
      widened = true;
    }
  }

  if (!all.length) {
    console.error('\nלא נמצא אף מייל שמתאים. אפשר --query "…" משלך.');
    process.exit(1);
  }

  console.log(`\n${all.length} מועמדים:`);
  show(all);

  if (listOnly) process.exit(0);

  // ההרחבה תופסת גם דוחות אחרים של ספורט אנד מור ("יתרות מלאי לפי דגם"), ולכן
  // היא לעולם לא בוחרת לבד: קובץ לא נכון שנשמר תחת השם הנכון אינו נראה כתקלה
  // בשום שלב אחר כך.
  const chosen = pickArg ? all[Number(pickArg) - 1] : (widened ? null : all[0]);
  if (!chosen) {
    console.error('\n⚠️ לא מצאתי את הדוח הרגיל ("מלאי נוכחי במחסנים"), והמועמדים שלמעלה'
      + '\n   כוללים גם דוחות אחרים. לא בוחר לבד — תריץ שוב עם --pick <מספר>.');
    process.exit(1);
  }

  const pick = chosen;
  console.log(`\nנבחר: ${ymd(pick.when)} · ${pick.from} · ${pick.subject}`);

  const dest = destFor(ymd(pick.when));
  if (existsSync(dest) && !force) {
    console.log(`\nכבר קיים: ${dest}`);
    console.log('אותו תאריך — לא הורדתי שוב. ל-דריסה: --force');
    process.exit(0);
  }

  const got = await download(ctx, pick.account, pick.id);
  if (got.error) {
    console.error(`\n⚠️ ${got.error}`);
    if (got.names) console.error(`קבצים במייל:\n  ${got.names.join('\n  ')}`);
    process.exit(1);
  }

  if (!existsSync(DEST_DIR)) mkdirSync(DEST_DIR, { recursive: true });
  copyFileSync(got.raw, dest);
  rmSync(got.raw, { force: true }); // ה-GUID ב-data/inbox אינו קריא לאדם

  console.log(`\nבמייל:  ${got.original}`);
  console.log(`נשמר:   ${dest}`);
  console.log(`גודל:   ${(statSync(dest).size / 1024).toFixed(0)} KB`);
} finally {
  await browser.close().catch(() => {}); // מנתק CDP בלבד; החלון נשאר פתוח
  // ⚠️ בלי זה התהליך נשאר תלוי אחרי שהכול הצליח: מאזין ה-CDP של ההורדה שורד
  // את `browser.close()` ומחזיק את לולאת האירועים. נראה בדיוק כמו תקיעה.
  process.exit(0);
}
