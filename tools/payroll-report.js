/**
 * דוח הנוכחות החודשי לשכר — הרצה עצמאית, בלי אדם ליד המסך.
 *
 *   npm run payroll -- --to dror.arena@gmail.com              # החודש הקודם
 *   npm run payroll -- --to dror.arena@gmail.com --month 08/2026
 *   npm run payroll -- --to dror.arena@gmail.com --dry        # בלי לשלוח
 *
 * מפיק את `a162` לחודש המבוקש, שומר PDF, ושולח אותו **לדרור עצמו** מתוך קומקס.
 * זה כל מה שהמשימה המתוזמנת עושה — היא **לא** פונה לרואת החשבון. ההעברה לשירן
 * נעשית ביד, בג'ימייל, אחרי שדרור אמר "שלח": ההערות פר-עובד משתנות כל חודש
 * ואי אפשר לנחש אותן, וכלי ההעברה שולח מיד ולא מייצר טיוטה.
 *
 * הרקע המלא: knowledge/payroll-attendance.md
 */
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';
import { ensureLoggedIn, logoff } from '../src/session.js';
import { openProgram, closePrograms } from '../src/navigate.js';
import { acquire, busyMessage } from '../src/lock.js';
import { requireRecipient, takeOverRecipient, assertRecipient } from '../src/documents/recipient.js';
import { ROOT } from '../src/config.js';

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dry = args.includes('--dry');

// כלל 14: אין ברירת מחדל לנמען, גם כשהיא "ברורה". המשימה המתוזמנת מוסרת אותה
// במפורש בשורת הפקודה, וכך היא נשארת דבר שמישהו כתב ולא דבר שהקוד המציא.
const to = requireRecipient(flag('--to') || process.env.PAYROLL_MAIL_TO, { what: 'דוח הנוכחות' });

// ברירת המחדל היא **החודש הקודם** — ב-4 בספטמבר מפיקים את אוגוסט.
const month = flag('--month') || (() => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
})();
if (!/^\d{2}\/\d{4}$/.test(month)) { console.error(`חודש לא תקין: "${month}" — נדרש MM/YYYY`); process.exit(1); }
const [mm, yyyy] = month.split('/');
const monthLabel = `${HEBREW_MONTHS[Number(mm) - 1]} ${yyyy}`;
const subject = `דוח נוכחות עובדים ${monthLabel}`;

const logger = new RunLogger('payroll-report');
const lock = await acquire('payroll-report', { waitMs: 60_000 });
if (!lock.ok) { console.error(`\n${busyMessage(lock.holder)}\n`); process.exit(1); }

let session = null;
const fail = async (msg) => {
  console.error(`\n⛔ ${msg}`);
  logger.step('fail', msg);
  if (session) {
    await logoff({ ...session, logger }).catch(() => {});
    await session.context.close().catch(() => {});
  }
  lock.release();
  logger.done();
  process.exit(1);
};

try {
  session = await openBrowser({ logger });
  const { page, human } = session;
  await ensureLoggedIn({ ...session, logger });

  // שאריות מהרצה קודמת בולעות את הדאבל-קליק על האייקון (כלל 10).
  await closePrograms({ ...session, logger }).catch(() => {});
  await openProgram({ ...session, logger }, 'a162');

  const prog = () => page.frames().find((f) => (f.url() || '').includes('Hr_WorkTeken_HtmlP.aspx'));
  if (!prog()) await fail('a162 לא נפתח');

  // ⚠️ #DMA דביק: הוא נפתח על החודש שהופק לאחרונה, והדוח שיוצא ממנו נראה
  // שלם ותקין — של החודש הלא נכון. לכן כותבים, קוראים חזרה, ומשווים.
  const before = await prog().evaluate(() => document.getElementById('DMA')?.value);
  logger.step('read', `#DMA לפני: ${before}`);
  await human.click('#Shonot', { scope: prog(), label: 'לשונית שונות' });
  await human.think('tab switch');
  await human.type('#DMA', month, { scope: prog(), label: `חודש = ${month}` });
  const after = await prog().evaluate(() => document.getElementById('DMA')?.value);
  if (after !== month) await fail(`החודש לא נתפס: ביקשנו ${month}, במסך ${after}`);
  logger.step('verify', `#DMA אומת: ${after}`);

  await human.click('#OK', { scope: prog(), label: 'הרצת הדוח' });
  await human.settle('report running');
  await human.think('report');

  const ctrl = () => page.frames().find((f) => (f.url() || '').includes('Rpt_DafHtml_G'));
  const body = () => page.frames().find((f) => (f.url() || '').includes('ReadFile_HtmlP'));

  // הדוח נבנה בשרת, והזמן משתנה עם עומס. בדיקה מיידית אחרי `think` עברה
  // בהרצה אחת ונפלה בשנייה על אותו דוח בדיוק — ממתינים ל-frames, לא לשעון.
  for (let waited = 0; waited < 60_000 && !(ctrl() && body()); waited += 1500) {
    await page.waitForTimeout(1500);
  }
  if (!ctrl() || !body()) await fail('הצופה לא נפתח תוך 60 שניות אחרי #OK');

  const pages = await ctrl().evaluate(() => (typeof MaxPages !== 'undefined' ? MaxPages : null));
  const text = await body().evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' ').trim());

  // כלל 16: מה שקראנו חייב להסתכם למה שהמסמך מצהיר. עמוד לעובד, ולכן מספר
  // הכותרות חייב להיות מספר העמודים — קריאה כפולה נראית בדיוק כמו קריאה שלמה.
  const staff = [...text.matchAll(/פרוט לפי תקן:\s*(.+?)\s*\((\d+)\)/g)].map((m) => ({ name: m[1], id: m[2] }));
  const hours = [...text.matchAll(/סה''כ לעובד:\s*[\d.]+\s+([\d.]+)/g)].map((m) => m[1]);
  const shownMonth = (text.match(/לחודש:\s*(\d{2}\/\d{4})/) || [])[1];
  if (shownMonth !== month) await fail(`הדוח מציג ${shownMonth} ולא ${month}`);
  if (pages !== staff.length) await fail(`${pages} עמודים מול ${staff.length} עובדים — קריאה חלקית או כפולה`);

  console.log(`\nחודש ${month} · ${staff.length} עובדים:`);
  staff.forEach((s, i) => console.log(`  ${s.name} (${s.id}) — ${hours[i] ?? '?'} שעות`));

  // ה-PDF נוצר בשרת ונשמר גם מקומית, כדי שיהיה עותק גם אם המייל ייפול.
  await ctrl().evaluate(() => document.getElementById('PDF').click());

  // המרה בשרת, ולכן הזמן משתנה עם עומס. המתנה קבועה של 12 שניות נכשלה בהרצה
  // הראשונה על דוח בן עמוד אחד — מחכים ל-frame עצמו, לא לשעון.
  const pdfUrl = /Max2000Spool\/.*_pdf\.pdf$/;
  let pdfFrame = null;
  for (let waited = 0; waited < 60_000 && !pdfFrame; waited += 1500) {
    pdfFrame = page.frames().find((f) => pdfUrl.test(f.url() || ''));
    if (!pdfFrame) await page.waitForTimeout(1500);
  }
  if (!pdfFrame) await fail('ה-PDF לא נוצר תוך 60 שניות');
  logger.step('pdf', pdfFrame.url());

  const b64 = await ctrl().evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    if (!r.ok) return `ERR ${r.status}`;
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin);
  }, pdfFrame.url());
  if (typeof b64 === 'string' && b64.startsWith('ERR')) await fail(`הורדת ה-PDF נכשלה: ${b64}`);
  const dir = resolve(ROOT, 'runs', 'downloads');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${subject}.pdf`);
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') await fail('הקובץ שהתקבל אינו PDF');
  writeFileSync(file, bytes);
  console.log(`\nנשמר: ${file} (${bytes.length.toLocaleString()} bytes)`);

  // המעטפה. #onS מוסתר בסרגל, ולכן קוראים ל-onSend() ישירות.
  const viewer = page.frames().find((f) => (f.url() || '').includes('ShowDoc_Prog_G'));
  await viewer.evaluate(() => onSend());
  await page.waitForTimeout(6000);
  const env = page.frames().find((f) => (f.url() || '').includes('SendSpoolToEmail_PDF'));
  if (!env) await fail('מסך המעטפה לא נפתח');

  await takeOverRecipient({ frame: env, human, logger, to, field: '#Email' });
  await human.type('#SentToEmail', 'דרור', { scope: env, label: 'שם הנמען' });
  await human.type('#Subject', subject, { scope: env, label: 'נושא' });

  if (dry) {
    console.log(`\n--dry: מולא ולא נשלח. נמען ${to}, נושא "${subject}".`);
  } else {
    // הבדיקה החיה האחרונה: הדף יכול למלא מחדש את השדה בין ההקלדה לשליחה.
    await assertRecipient(env, to, { field: '#Email' });
    await human.click('#OK', { scope: env, label: 'שליחה' });
    await human.settle('sending');
    await human.think('after send');
    console.log(`\nנשלח ל-${to}.`);
  }

  await logger.shot(page, 'done');
  await closePrograms({ ...session, logger }).catch(() => {});
  await logoff({ ...session, logger }).catch(() => {});
  await session.context.close().catch(() => {});
  lock.release();
  logger.done();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`דוח נוכחות ${monthLabel} — ${staff.length} עובדים`);
  if (!dry) console.log(`המייל בדרך ל-${to}. להעברה לשירן צריך את ההערות פר-עובד.`);
  console.log('─'.repeat(60));
} catch (e) {
  await fail(e.message);
}
