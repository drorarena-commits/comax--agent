/**
 * הצעת מחיר מקצה לקצה — בהרצה אחת.
 *
 * WHY THIS EXISTS — it is not a convenience wrapper, it buys real time.
 *
 * Every `npm run` is a fresh Node process that has to take the lock, attach to
 * Chrome, check the session, and tear the CDP connection down again. That is
 * paid **per command**, and it is not small. Measured 06/09/2026, the same
 * command against the same screen state:
 *
 *   close-windows        cold 40.1s   warm  9.7s
 *   first click in a run cold 15.4s   warm  1.3s
 *
 * The full quote flow was six commands, so it paid that warm-up six times. A
 * live end-to-end run came to 457s, of which ~80-100s was nothing but process
 * start-up. This task runs the same four steps against **one** browser and one
 * `Human`, so the warm-up is paid once.
 *
 * **The steps are not reimplemented here.** Each existing task module is called
 * with the shared `ctx` and its own `input`. Duplicating their logic would let
 * the two copies drift, and the single-step tasks stay useful on their own —
 * for repairing a document by hand, or for mapping.
 *
 * SAFETY — two things this composite must get right, and does:
 *
 * 1. **The recipient is validated before Comax is touched at all** (כלל 14).
 *    Building a document and only then discovering the address is missing would
 *    leave a live quote open with nobody to send it to.
 * 2. **`--confirm` still gates everything.** A dry run stops after the header,
 *    exactly where `quote-new` stops on its own, and reports what it would do.
 *
 * A side effect worth knowing: the run lock is held for the **whole** flow
 * rather than released between commands. That is an improvement, not a cost —
 * with six commands there were five windows where a request from the phone
 * could land inside a half-built quote, and `quote-add-line` assumes the
 * document is already on screen.
 */
import { closePrograms } from '../navigate.js';
import { requireRecipient } from '../documents/recipient.js';
import * as quoteNew from './quote-new.js';
import * as quoteAddLine from './quote-add-line.js';
import * as quoteFinalize from './quote-finalize.js';
import * as documentEmail from './document-email.js';

export const meta = {
  name: 'quote-full',
  description: 'הצעת מחיר מקצה לקצה בהרצה אחת — כותרת, שורות, קליטה, PDF ומייל',
  writes: true,
  input: {
    customer: 'string — שם הלקוח. חובה',
    store: 'string, אופציונלי — מחסן',
    priceList: 'string, אופציונלי — מחירון. "מחירון קבוצות" מפעיל סיטונאות לבד',
    details: 'string, אופציונלי — שדה "פרטים". עד 40 תווים, קומקס קוצץ בשקט',
    date: 'string dd/mm/yyyy, אופציונלי',
    items: 'array — [{ code, qty, price, discount, remark }]. חובה',
    wholesale: 'boolean, אופציונלי — לכפות או לבטל סיטונאות. ברירת המחדל נקבעת מהמחירון',
    copies: 'number, אופציונלי — ברירת מחדל 0. ערך אחר פותח את דיאלוג ההדפסה של Chrome',
    outDir: 'string, אופציונלי — תיקיית ה-PDF',
    to: 'string, אופציונלי — נמען. בלעדיו לא נשלח מייל ולא נפתחת מעטפה',
    toName: 'string, אופציונלי — שם הנמען',
    subject: 'string, אופציונלי',
    remark: 'string, אופציונלי — גוף ההודעה',
  },
};

export async function run(ctx) {
  const { logger, input, dryRun } = ctx;

  if (!input.customer) throw new Error('חסר customer — למי ההצעה?');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('חסר items — הצעה בלי שורות היא מסמך ריק שנשאר פתוח בקומקס.');
  }

  /**
   * כלל 14, לפני שנוגעים בקומקס.
   *
   * `document-email` בודק את זה בעצמו, אבל שם זה כבר מאוחר מדי במסלול הזה:
   * המסמך היה נוצר ונקלט, ורק אז הריצה הייתה נופלת על כתובת חסרה.
   */
  const to = input.to ? requireRecipient(input.to, { what: 'הצעת מחיר' }) : null;

  const started = Date.now();
  const timeline = [];
  const step = async (label, mod, stepInput) => {
    const t0 = Date.now();
    const r = await mod.run({ ...ctx, input: stepInput });
    const secs = Number(((Date.now() - t0) / 1000).toFixed(1));
    timeline.push({ step: label, secs });
    logger.step('שלב', `${label} — ${secs}s`);
    return r;
  };

  /**
   * 1. כותרת — מחירון קבוצות ומחסן קבוצות הם ברירת המחדל, לא בקשה מיוחדת.
   *
   * דרור, 09/09/2026, אחרי שהצעה 6120055 יצאה שגויה:
   * "בהצעת מחיר תמיד!!! מחירון קבוצות להגדיר וגם מחסן קבוצות".
   *
   * זה כאן ולא כהוראה ב-CLAUDE.md כי הכשל **נראה בדיוק כמו הצלחה**. המחירון
   * קובע את משטר המע"מ: `מכירה ראשי` הוא `vatIncluded: true`, ולכן מחיר
   * שמוקלד בשורה נבלע **כולל** מע"מ ומחולץ אחורה. ב-6120055 הוקלדו 102 ו-41
   * תחת מחירון ראשי, הסכום הסופי יצא בדיוק 32,100 כפי שאושר — אבל הוא הפך
   * מ"לפני מע"מ" ל"כולל", הנטו של הז'קט ירד ל-86.44 מול עלות 85.13, והרווח
   * קרס מ-16.87 ₪ ל-1.31 ₪. אין שגיאה, אין אזהרה, רק מסמך שנראה תקין.
   *
   * `מחירון קבוצות` הוא `vatIncluded: false`, ולכן המחיר שמוקלד הוא הנטו.
   *
   * ⚠️ ובחירת המחירון היא **סימון בכותרת בלבד**, כמו המחסן — דרור באותו יום:
   * "הוא לא צריך לגבור על מחיר שהוחלט". נוסחת ה-50% של מחירון קבוצות חלה רק
   * כשלא נמסר מחיר לשורה; מחיר מפורש בקלט הוא הסופי, ולשם כך מעבירים
   * `wholesale: false`. שני התפקידים חיים באותו שם ואינם אותו דבר.
   */
  const created = await step('כותרת', quoteNew, {
    customer: input.customer,
    store: input.store ?? 'מחסן קבוצות',
    priceList: input.priceList ?? 'מחירון קבוצות',
    details: input.details,
    date: input.date,
  });

  if (dryRun) {
    logger.step('dryrun', 'עוצר אחרי הכותרת. ההצעה לא נוצרה, ולכן אין שורות, PDF או מייל.');
    console.log('\n  DRY RUN — לא נוצר מסמך. להרצה מלאה: --confirm\n');
    return { dryRun: true, header: created?.header, timeline };
  }

  const docNo = created?.docNo;
  if (!docNo) throw new Error('הכותרת אושרה אבל לא קיבלתי מספר הצעה — עוצר לפני השורות.');

  // 2. שורות. `wholesale` מועבר רק כשנמסר במפורש, אחרת ברירת המחדל של
  //    quote-add-line לפי המחירון של המסמך היא שקובעת.
  const lines = await step('שורות', quoteAddLine, {
    items: input.items,
    ...(input.wholesale === undefined ? {} : { wholesale: input.wholesale }),
  });

  /**
   * הסכומים מוצגים לפני הקליטה, לא אחריה (כלל 3).
   *
   * אחרי `#OK` ההצעה נקלטה, ותיקון מחיר דורש מסמך חדש. אם משהו נראה שגוי —
   * זה הרגע לעצור, ולכן הוא נדפס גם כשהכל תקין.
   */
  if (lines?.totals) {
    console.log(`\n  הצעה ${docNo} — לפני קליטה:`);
    console.log(`    לפני מע"מ ${lines.totals.beforeVat} · מע"מ ${lines.totals.vat} · סה"כ ${lines.totals.total}`);
  }

  // 3. קליטה + PDF. `docNo` מועבר במפורש: הזיהוי האוטומטי לא ממופה, ובלעדיו
  //    quote-finalize קולט אבל לא מפיק PDF.
  const filed = await step('קליטה ו-PDF', quoteFinalize, {
    docNo,
    copies: input.copies ?? 0,
    outDir: input.outDir,
  });

  // 4. מייל — רק אם נמסר נמען.
  let mailed = null;
  if (to) {
    mailed = await step('מייל', documentEmail, {
      document: 'quote',
      docNo,
      customer: input.customer,
      to,
      toName: input.toName,
      subject: input.subject,
      remark: input.remark,
    });
  } else {
    logger.step('מייל', 'לא נמסר נמען — מדלג על השליחה');
    await closePrograms(ctx);
  }

  const total = Number(((Date.now() - started) / 1000).toFixed(1));
  console.log(`\n  ${timeline.map((t) => `${t.step} ${t.secs}s`).join(' · ')}`);
  console.log(`  סה"כ ${total}s בהרצה אחת\n`);

  return { docNo, header: created?.header, totals: lines?.totals, pdf: filed?.pdf, mail: mailed?.mail, sent: mailed?.sent, timeline, seconds: total };
}
