/**
 * שיחזור חשבונית — הזרימה המלאה, מ-a157 עד מסך המייל.
 *
 *   a157 → לשונית הדפסה → #PrintDocAll → טווח → וי ירוק
 *        → PicOne (מדפסת/דוא"ל/פקס) → Divor_Doc → שליחה
 *
 * ברירת המחדל עוצרת על מסך המייל עם הנמען מוחלף ומאומת. `--send` הוא הדבר
 * היחיד שלוחץ על הוי הירוק, והוא מסרב אם הנמען אינו הכתובת שהתבקשה.
 *
 * ⚠️ קומקס ממלא את #Email מכרטיס הלקוח. שיחזור שנועד לדרור מגיע ללקוח אם לא
 * מחליפים — זו הסיבה שהכתובת נכתבת, נקראת בחזרה, ונבדקת שוב לפני השליחה.
 *
 *   node tools/_smoke/invoice-restore.mjs <docNo> <email> [--send]
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { openProgram } from '../../src/navigate.js';
import { loadConfig } from '../../src/config.js';
import { acquire, busyMessage } from '../../src/lock.js';
import { touch } from '../../src/activity.js';
import { profile } from '../../src/documents/agents/invoice/index.js';
import { requireRecipient, takeOverRecipient, assertRecipient } from '../../src/documents/recipient.js';

const [DOC, RAW_TO] = process.argv.slice(2);
const SEND = process.argv.includes('--send');
if (!DOC || !RAW_TO) {
  console.log('שימוש: node tools/_smoke/invoice-restore.mjs <docNo> <email> [--send]');
  process.exit(1);
}
// כלל 14 — נמען מפורש ותקין, לפני שנוגעים בקומקס.
const TO = requireRecipient(RAW_TO, { what: `חשבונית ${DOC}` });

// אותה נעילה ש-run.js לוקח, ומאותה סיבה: לקומקס יש מושב אחד, ו-`idle-logoff`
// רץ כל 5 דקות ומשחרר אותו. בלי הנעילה הוא יכול לנתק את הסשן באמצע הזרימה —
// כלומר בין הרגע שהמעטפה נפתחה לרגע שקוראים ממנה את הנמען.
const lock = await acquire('invoice-restore', { waitMs: 10_000 });
if (!lock.ok) {
  console.error(`\n${busyMessage(lock.holder)}\n`);
  process.exit(1);
}
touch('invoice-restore');
process.on('exit', () => { touch('invoice-restore'); lock.release(); });

// Max2000 puts the parent frame's name in the query string, so matching a whole
// URL on "Doc650_ShihzurP" also catches Doc650_HtmlP_T13. Always match the path.
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };
const byPath = (page, re) => page.frames().find((f) => re.test(pathOf(f.url())));

const logger = new RunLogger('invoice-restore');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח'); process.exit(1); }
const ctx = { ...s, logger, cfg: s.cfg ?? loadConfig() };
const { page, human } = ctx;

let list = byPath(page, /Doc650V\.aspx?$/i);
if (!list) {
  logger.step('flow', 'פותח את a157');
  // `program` הוא הנתיב החלופי לאייקון שקומקס הוריד מהשולחן. `a157` נעלם
  // ב-04/09/2026, ובלי הנתיב הכלי מת על 30 שניות המתנה ל-`#a157` שלא קיים.
  const r = await openProgram(ctx, profile.shortcut, {
    expect: profile.frames.list,
    program: profile.program ?? null,
  });
  list = r.frame ?? byPath(page, /Doc650V\.aspx?$/i);
}
if (!list) { console.log('לא הצלחתי לפתוח את רשימת החשבוניות.'); process.exit(1); }

const tab = await list.evaluate(() => {
  for (const el of document.querySelectorAll('[id^=Row]')) if ((el.innerText || '').includes('הדפסה')) return el.id;
  return null;
});
if (!tab) { console.log('אין לשונית הדפסה.'); process.exit(1); }
await human.click(`#${tab}`, { scope: list, label: 'לשונית הדפסה' });
await human.settle('print tab');

await human.click('#PrintDocAll', { scope: list, label: 'הדפסת שיחזור' });
await human.settle('restore dialog');

const dlg = byPath(page, /Doc650_ShihzurP\.asp$/i);
if (!dlg) { console.log('דיאלוג השיחזור לא נפתח.'); process.exit(1); }

for (const id of ['DocM', 'DocA']) {
  await dlg.locator(`#${id}`).fill('').catch(() => {});
  await human.type(`#${id}`, DOC, { scope: dlg, label: id });
}
const range = await dlg.evaluate(() => ({
  docM: document.querySelector('#DocM')?.value, docA: document.querySelector('#DocA')?.value,
}));
console.log(`\n  טווח: ${range.docM} → ${range.docA}`);
if (range.docM !== DOC || range.docA !== DOC) {
  console.log(`\n  ⛔ הטווח אינו ${DOC}→${DOC} — עוצר לפני אישור.\n`);
  process.exit(1);
}

await human.click('#OK', { scope: dlg, label: 'אישור השיחזור' });
await human.settle('choice');

const pic = byPath(page, /PicOne\.asp$/i);
if (!pic) { console.log('מסך הבחירה לא נפתח.'); process.exit(1); }
await human.click('img[title=\'דוא"ל\']', { scope: pic, label: 'דוא"ל' });
await human.settle('mail screen');
await human.think('mail form');

const mail = byPath(page, /Divor_Doc\.asp$/i);
if (!mail) { console.log('מסך המייל לא נפתח.'); process.exit(1); }

const { prefilled: before } = await takeOverRecipient({ frame: mail, human, logger, to: TO });

const state = await mail.evaluate(() => ({
  to: document.querySelector('#Email')?.value,
  name: document.querySelector('#SentToEmail_Add')?.value,
  from: document.querySelector('#FromEmail')?.value,
  subject: document.querySelector('#Subject')?.value,
}));
console.log(`\n  נמען שקומקס מילא: ${JSON.stringify(before)}   ← כרטיס הלקוח`);
console.log(`  נמען אחרי החלפה : ${JSON.stringify(state.to)}`);
console.log(`  שולח            : ${JSON.stringify(state.from)}`);
console.log(`  נושא            : ${JSON.stringify(state.subject)}`);
// אותה בדיקה בדיוק כמו לפני השליחה — סמנטיקה אחת, גם במסלול היבש.
await assertRecipient(mail, TO);
await logger.shot(page, 'mail-ready');

if (!SEND) {
  console.log('\n  מוכן. לא שלחתי — להוסיף --send.\n');
  await s.browser.close().catch(() => {});
  logger.done();
  process.exit(0);
}

// כלל 14: הבדיקה על השדה החי, צמוד לקליק. הדף יכול להיטען מחדש בין ההקלדה
// לשליחה ולהחזיר את כתובת הלקוח — לכן לא מסתמכים על מה שנקרא קודם.
const finalTo = await assertRecipient(mail, TO);
await human.click('#OK', { scope: mail, label: `שליחה ל-${finalTo}` });
await human.settle('sent');
await human.think('server response');

const gone = !byPath(page, /Divor_Doc\.asp$/i);
console.log(`\n  ${gone ? `✅ נשלח ל-${TO}` : '⛔ מסך המייל עדיין פתוח — לא בטוח שנשלח.'}\n`);
await logger.shot(page, 'after-send');
await s.browser.close().catch(() => {});
logger.done();
