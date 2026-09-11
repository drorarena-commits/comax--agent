/**
 * שולח מייל עם קבצים מצורפים — דרך חלון הסוכן, ישירות מהדיסק.
 *
 *   node tools/gmail-send.js --to a@b.com --subject "..." --body-file body.txt \
 *     --attach data/out/invoice.pdf --attach data/out/items.xlsx
 *   node tools/gmail-send.js ... --confirm          ← שולח בפועל
 *   node tools/gmail-send.js --reply <messageId> --to a@b.com --body "..." --attach f.pdf
 *
 * למה זה קיים — בדיוק ההיפך של `tools/gmail-attach.js`:
 * מחבר ה-Gmail (MCP) מקבל קובץ מצורף רק כ-base64 **דרך השיחה**. חשבונית PDF
 * של 200KB הופכת ל-~270KB base64 ≈ 70 אלף טוקנים שהמודל צריך להקליד תו-תו,
 * וקובץ אקסל של כמה מגה הוא בלתי אפשרי. גם כשזה "עובד" זה איטי, יקר, ותו אחד
 * שמשתבש הורס את הקובץ בלי שאף אחד יראה.
 *
 * לדפדפן של הסוכן כבר יש סשן גוגל מחובר. לכן הבייטים עוברים מהדיסק ל-Chrome
 * וממנו ל-Gmail, **ואף בית לא עובר במודל**. הגודל מפסיק להיות שיקול — עד
 * תקרת ה-25MB של Gmail עצמו.
 *
 * דורש התחברות חד-פעמית לגוגל בתוך פרופיל ה-Chrome של הסוכן (`npm run open`).
 *
 * ⚠️ כלל 2 של הפרויקט: בלי `--confirm` הסקריפט ממלא הכל, מצרף, מצלם — **ועוצר
 * לפני כפתור השליחה**. מה שנשאר הוא טיוטה אמיתית בג'ימייל שאפשר לפתוח ולראות.
 * ⚠️ כלל 14: נמען מפורש בלבד. בלי `--to` אין הרצה, ולפני הקליק על "שליחה"
 * הסקריפט **קורא את צ׳יפי הנמענים מהמסך ומשווה בשוויון מדויק** לרשימה שנתתי.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ROOT, loadConfig } from '../src/config.js';

// ---------- פענוח הארגומנטים ----------

const argv = process.argv.slice(2);
const opts = { to: [], cc: [], bcc: [], attach: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => argv[++i];
  if (a === '--to') opts.to.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
  else if (a === '--cc') opts.cc.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
  else if (a === '--bcc') opts.bcc.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
  else if (a === '--subject') opts.subject = val();
  else if (a === '--body') opts.body = val();
  else if (a === '--body-file') opts.bodyFile = val();
  else if (a === '--attach') opts.attach.push(val());
  else if (a === '--reply') opts.reply = val();
  else if (a === '--account') opts.account = val();
  else if (a === '--confirm') opts.confirm = true;
  else { console.error(`ארגומנט לא מוכר: ${a}`); process.exit(1); }
}

const USAGE = `שימוש:
  node tools/gmail-send.js --to a@b.com --subject "נושא" --body-file body.txt \\
    --attach קובץ [--attach קובץ...] [--cc x] [--bcc y] [--account 0|1] [--confirm]
  node tools/gmail-send.js --reply <messageId> --to a@b.com --body "..." --attach קובץ [--confirm]`;

if (!opts.to.length) { console.error(`חסר --to. נמען מפורש הוא חובה (כלל 14).\n\n${USAGE}`); process.exit(1); }
if (!opts.reply && !opts.subject) { console.error(`חסר --subject.\n\n${USAGE}`); process.exit(1); }
if (opts.body && opts.bodyFile) { console.error('--body ו---body-file סותרים.'); process.exit(1); }

const body = opts.bodyFile ? readFileSync(resolve(ROOT, opts.bodyFile), 'utf8') : (opts.body ?? '');

// ---------- בדיקת הקבצים לפני שנוגעים בדפדפן ----------

const files = opts.attach.map((f) => {
  const path = resolve(ROOT, f);
  if (!existsSync(path)) { console.error(`אין קובץ כזה: ${path}`); process.exit(1); }
  const size = statSync(path).size;
  if (!size) { console.error(`הקובץ ריק: ${path}`); process.exit(1); }
  return { path, name: basename(path), size };
});

const total = files.reduce((s, f) => s + f.size, 0);
// תקרת Gmail היא 25MB על ההודעה **אחרי** קידוד base64, שמנפח ב-~37%. לכן
// הסף המעשי על הבייטים הגולמיים הוא ~18MB, לא 25.
const LIMIT = 18 * 1024 * 1024;
if (total > LIMIT) {
  console.error(`סך הקבצים ${(total / 1024 / 1024).toFixed(1)}MB — מעבר לתקרה המעשית של Gmail (~18MB גולמי = 25MB אחרי קידוד).`);
  console.error('להעלות ל-Drive ולשלוח קישור במקום.');
  process.exit(1);
}

const fmt = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);
const norm = (s) => String(s).trim().toLowerCase();

console.log(opts.reply ? `תגובה בשרשור: ${opts.reply}` : `מייל חדש`);
console.log(`אל:    ${opts.to.join(', ')}`);
if (opts.cc.length) console.log(`עותק:  ${opts.cc.join(', ')}`);
if (opts.bcc.length) console.log(`מוסתר: ${opts.bcc.join(', ')}`);
if (opts.subject) console.log(`נושא:  ${opts.subject}`);
console.log(`גוף:   ${body.split('\n').length} שורות, ${body.length} תווים`);
for (const f of files) console.log(`מצורף: ${f.name}  (${fmt(f.size)})`);
console.log(`סה"כ מצורפים: ${fmt(total)}`);
console.log('');

// ---------- חיבור לחלון הסוכן ----------

const cfg = loadConfig();
const account = opts.account ?? '0';

// ייבוא דינמי ולא בראש הקובץ: כל הבדיקות שמעל — נמען, נושא, קיום הקבצים
// וגודלם — הן בדיקות טהורות, וכדאי שירוצו (וייכשלו ברור) גם במקום שבו
// playwright עוד לא הותקן.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core לא מותקן. להריץ `npm install` ואז שוב.');
  process.exit(1);
}

// לא `attachBrowser`: ה-timeout שלו הוא 5 שניות, ו-Playwright מתחבר לכל טאב
// בדפדפן. כשהחלון מחזיק גם את קומקס וגם את Gmail, הלחיצה הזאת אורכת יותר.
let browser;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`, { timeout: 120_000 });
} catch (e) {
  console.error(`לא הצלחתי להתחבר לחלון הסוכן: ${e.message.split('\n')[0]}`);
  console.error('להריץ `npm run open` ואז שוב.');
  process.exit(1);
}
const ctx = browser.contexts()[0];
if (!ctx) { console.error('אין הקשר דפדפן.'); process.exit(1); }

const runs = resolve(ROOT, 'runs');
if (!existsSync(runs)) mkdirSync(runs, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const shot = resolve(runs, `gmail-send-${stamp}.png`);

// שמות הכפתורים ב-Gmail תלויים בשפת הממשק. דרור עובד בעברית, אבל הממשק חוזר
// לאנגלית אחרי כל החלפת חשבון — לכן שתי השפות, תמיד.
// ⚠️ בלי `\b` בסוף: גבול-מילה ב-JS הוא ASCII בלבד, ואחרי ו' של "שליחה" אין
// גבול כזה — `/^שליחה\b/` לא מתאים ל"שליחה (Ctrl-Enter)" ונכשל בשקט על
// ממשק בעברית. נמצא בקריאת הקוד, לפני ההרצה הראשונה.
const RE_SEND = '^(שליחה|Send)';
// יותר מנמען אחד → "השב לכולם". תגובה רגילה שולחת רק לשולח האחרון ומאבדת את
// כל ה-cc של השרשור — מלכודת שכבר תפסה אותנו פעם ב-`reply` של ה-MCP.
const RE_REPLY = ([...opts.to, ...opts.cc].length > 1)
  ? '^(השב לכולם|Reply all|Reply to all)'
  : '^(השב|תשובה|Reply)';


// ---------- איתור מיכל הכתיבה ----------

/**
 * מחזיר את האלמנט שמכיל את חלון הכתיבה עצמו — לא את כל הדף.
 *
 * זה קריטי דווקא בתגובה בתוך שרשור: התגובה אינה `div[role="dialog"]` אלא
 * טופס שיושב **מתחת להודעות הקודמות**, ולכן קריאת נמענים מ-document.body
 * הייתה אוספת את כל הכתובות של כל ההודעות בשרשור ומכריזה עליהן "עודפים".
 *
 * המסלול: מוצאים את כפתור השליחה — הוא קיים בכל צורות הכתיבה, בדיאלוג
 * ובתגובה כאחד — ומטפסים ממנו למעלה עד למיכל שמחזיק גם את גוף ההודעה.
 */
const SCOPE_FN = `(sendSrc) => {
  const re = new RegExp(sendSrc, 'i');
  const btn = [...document.querySelectorAll('[role="button"]')].find((e) => {
    const l = e.getAttribute('data-tooltip') || e.getAttribute('aria-label') || '';
    return re.test(l.trim());
  });
  if (!btn) return null;
  let n = btn;
  for (let i = 0; i < 12 && n.parentElement; i++) {
    n = n.parentElement;
    if (n.querySelector('[contenteditable="true"]')) return n;
  }
  return null;
}`;

let page;
try {
  page = await ctx.newPage();

  // ---------- פתיחת חלון הכתיבה ----------

  if (opts.reply) {
    await page.goto(`https://mail.google.com/mail/u/${account}/#all/${opts.reply}`,
      { waitUntil: 'domcontentloaded', timeout: 120_000 });
  } else {
    // `view=cm&fs=1` הוא חלון כתיבה מלא עם כל השדות ממולאים מה-URL. זה עדיף
    // על הקלדה לתוך השדות: peoplekit מחליף סלקטורים בין גרסאות, וכתובת
    // שנכנסה חצי-מוקלדת נשארת טקסט חופשי במקום להפוך לצ׳יפ — ואז Gmail שולח
    // לכתובת קטועה בלי להתלונן.
    const q = new URLSearchParams({ view: 'cm', fs: '1', tf: '1' });
    q.set('to', opts.to.join(','));
    if (opts.cc.length) q.set('cc', opts.cc.join(','));
    if (opts.bcc.length) q.set('bcc', opts.bcc.join(','));
    q.set('su', opts.subject);
    q.set('body', body);
    await page.goto(`https://mail.google.com/mail/u/${account}/?${q}`,
      { waitUntil: 'domcontentloaded', timeout: 120_000 });
  }
  await page.waitForTimeout(5000);

  if (/accounts\.google\.com|ServiceLogin/i.test(page.url())) {
    console.error('חלון הסוכן אינו מחובר לגוגל. להתחבר פעם אחת ב-`npm run open` ואז להריץ שוב.');
    process.exit(2);
  }

  if (opts.reply) {
    const clicked = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const btn = [...document.querySelectorAll('[role="button"]')].find((e) => {
        const l = e.getAttribute('data-tooltip') || e.getAttribute('aria-label') || '';
        return re.test(l.trim());
      });
      if (!btn) return false;
      btn.click();
      return true;
    }, RE_REPLY);
    if (!clicked) {
      console.error('לא מצאתי את כפתור "השב" בשרשור. ייתכן ש-messageId שגוי או שההודעה בחשבון השני (--account 1).');
      process.exit(1);
    }
    await page.waitForTimeout(3000);

    // גוף התגובה נכנס בהקלדה — בתגובה אין URL שממלא אותו.
    const bodyBox = page.locator('div[role="textbox"][contenteditable="true"]').last();
    await bodyBox.click({ timeout: 30_000 });
    await bodyBox.pressSequentially(body, { delay: 5 });
  }

  // ---------- צירוף הקבצים ----------

  if (files.length) {
    // Playwright יודע להזין קבצים גם ל-input מוסתר, וזה בדיוק מה ש-Gmail
    // מחזיק: input אחד מוסתר שמאזין ל-change. הקלטת הבייטים היא של Chrome —
    // הסקריפט מוסר רק נתיבים.
    // סדר עדיפות מפורש ולא איחוד סלקטורים עם `.last()`: ב-Gmail יש כמה
    // input-ים מסוג file באותו דף (תמונה מוטבעת, חתימה), ו"האחרון ב-DOM"
    // אינו בהכרח זה של הצירוף.
    let input = null;
    for (const sel of ['input[type="file"][name="Filedata"]', 'input[type="file"][multiple]', 'input[type="file"]']) {
      const loc = page.locator(sel).last();
      if (await loc.count()) { input = loc; break; }
    }
    if (!input) {
      console.error('לא מצאתי את שדה הצירוף של Gmail. לצלם את המסך ולמפות מחדש.');
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      process.exit(1);
    }
    await input.waitFor({ state: 'attached', timeout: 60_000 });
    await input.setInputFiles(files.map((f) => f.path));

    // הצ׳יפ עם שם הקובץ מופיע רק כשההעלאה הסתיימה. לחכות לכל אחד בנפרד —
    // "העלאה בתהליך" שנשלחת נשלחת בלי הקובץ, וזה נראה בדיוק כמו הצלחה.
    console.log(`ממתין לסיום ההעלאה (${fmt(total)})...`);
    for (const f of files) {
      // ⚠️ לא רק `innerText`: Gmail **מקצר שם ארוך** בצ׳יפ ומוסיף "…", ושם
      // קובץ עברי ארוך לא יימצא כמחרוזת מלאה — הסקריפט היה נכשל אחרי 15
      // דקות על קובץ שצורף בהצלחה. לכן גם המאפיינים (שנושאים את השם המלא)
      // וגם קידומת של 18 תווים כנפילה לאחור.
      const ok = await page.waitForFunction(
        (name) => {
          const head = name.slice(0, 18);
          if (document.body.innerText.includes(head)) return true;
          return [...document.querySelectorAll('[title],[aria-label],[download_url]')].some((e) =>
            [e.getAttribute('title'), e.getAttribute('aria-label'), e.getAttribute('download_url')]
              .some((v) => v && v.includes(head)));
        },
        f.name,
        { timeout: 15 * 60_000 },
      ).then(() => true).catch(() => false);
      if (!ok) {
        console.error(`הקובץ ${f.name} לא הופיע כמצורף אחרי 15 דקות — לא שולח.`);
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
        process.exit(1);
      }
      console.log(`צורף: ${f.name}`);
    }
    // סרגל ההתקדמות נעלם אחרי הצ׳יפ, לא לפניו.
    await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'), null, { timeout: 5 * 60_000 })
      .catch(() => {});
    await page.waitForTimeout(2000);
  }

  // ---------- אימות הנמענים מול המסך (כלל 14) ----------

  // Gmail מסמן כל נמען בצ׳יפ שנושא `email="..."`. קוראים משם ולא ממה שביקשנו,
  // כי זה מה שבאמת יישלח: כתובת שלא הפכה לצ׳יפ פשוט לא תופיע כאן, וכתובת
  // שנשארה מטיוטה קודמת כן תופיע. השוואה היא **שוויון קבוצות מדויק**, לא
  // הכלה — שדה עם שתי כתובות "מכיל" את הנכונה ויעבור בשקט.
  const onScreen = await page.evaluate(({ scopeFn, sendSrc }) => {
    const scope = eval(scopeFn)(sendSrc);
    if (!scope) return null;
    return [...scope.querySelectorAll('[email]')]
      .map((e) => (e.getAttribute('email') || '').trim().toLowerCase())
      .filter((v, i, a) => v && a.indexOf(v) === i);
  }, { scopeFn: SCOPE_FN, sendSrc: RE_SEND });

  if (onScreen === null) {
    console.error('לא מצאתי את חלון הכתיבה על המסך — לא שולח.');
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    console.error(`צילום: ${shot}`);
    process.exit(1);
  }

  const expected = [...opts.to, ...opts.cc, ...opts.bcc].map(norm);
  const missing = expected.filter((e) => !onScreen.includes(e));
  const extra = onScreen.filter((e) => !expected.includes(e));

  console.log(`\nנמענים על המסך: ${onScreen.join(', ') || '(אין)'}`);
  if (missing.length || extra.length) {
    console.error('\n⛔ הנמענים על המסך אינם מה שביקשתי — לא שולח.');
    if (missing.length) console.error(`  חסרים: ${missing.join(', ')}`);
    if (extra.length) console.error(`  עודפים: ${extra.join(', ')}`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    console.error(`צילום: ${shot}`);
    process.exit(1);
  }

  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  console.log(`צילום: ${shot}`);

  // ---------- שליחה ----------

  if (!opts.confirm) {
    console.log('\nעצרתי לפני השליחה (אין --confirm).');
    console.log('הטיוטה, על כל הקבצים המצורפים, שמורה בג\'ימייל — אפשר לפתוח ולראות.');
    console.log('לשלוח: אותה פקודה בתוספת --confirm.');
    // לא סוגרים את הטאב: Gmail שומר טיוטה אוטומטית, אבל סגירה מיד אחרי
    // ההעלאה יכולה להקדים את השמירה והקבצים נעלמים מהטיוטה.
    await page.waitForTimeout(4000);
    process.exit(0);
  }

  const sent = await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const btn = [...document.querySelectorAll('[role="button"]')].find((e) => {
      const l = e.getAttribute('data-tooltip') || e.getAttribute('aria-label') || '';
      return re.test(l.trim());
    });
    if (!btn) return false;
    btn.click();
    return true;
  }, RE_SEND);

  if (!sent) {
    // גיבוי: קיצור המקלדת של Gmail לשליחה. עובד גם כשהכפתור לא אותר.
    await page.keyboard.press('Control+Enter');
  }

  // "ההודעה נשלחה" / "Message sent" הוא האישור היחיד שבא מ-Gmail עצמו.
  const confirmed = await page.waitForFunction(
    () => /ההודעה נשלחה|Message sent|נשלחה\./i.test(document.body.innerText),
    null,
    { timeout: 5 * 60_000 },
  ).then(() => true).catch(() => false);

  await page.screenshot({ path: shot.replace('.png', '-sent.png'), fullPage: false }).catch(() => {});

  if (!confirmed) {
    console.error('\n⚠️ לא ראיתי אישור שליחה מ-Gmail. לבדוק ב"נשלחו" לפני שמנסים שוב —');
    console.error('   ניסיון שני יכול לשלוח את אותו מייל פעמיים.');
    process.exit(1);
  }
  console.log('\n✓ נשלח.');
} finally {
  await page?.close().catch(() => {});
  await browser.close().catch(() => {}); // מנתק CDP בלבד; החלון נשאר פתוח
}
