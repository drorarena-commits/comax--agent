/**
 * שליחת הצעת מחיר בדוא"ל — דרך מנגנון השליחה של קומקס עצמו.
 *
 * Comax attaches and sends the document itself, so the PDF never passes through
 * the agent. That matters: attaching a file through a mail API means base64-ing
 * the whole thing through the conversation, which for a 119 KB quote exceeded
 * the tool output limit and would have produced a truncated, corrupt PDF.
 *
 * The route (found by Dror): quotes list → tab "הדפסה" (`#Row3`) → envelope
 * (`#Email`) → `Erp/Divor_Doc.asp`.
 *
 * SAFETY — read this before changing anything here:
 * The recipient field arrives **pre-filled with the customer's own address**,
 * pulled from their card (`erez@kmc.co.il` on the first run). One stray click
 * mails a live quote to a real customer, and that cannot be taken back. So this
 * task refuses to send unless `to` was passed explicitly, and it verifies the
 * field actually holds that address immediately before clicking send.
 */
import { openProgram, closePrograms } from '../navigate.js';

export const meta = {
  name: 'quote-email',
  description: 'שליחת הצעת מחיר בדוא"ל דרך קומקס',
  writes: true,
  input: {
    docNo: 'string — מספר ההצעה',
    customer: 'string, אופציונלי — שם הלקוח, לזיהוי השורה כשיש כפילות מספרים בין שנים',
    to: 'string — כתובת הנמען. חובה. אין ברירת מחדל, בכוונה',
    toName: 'string, אופציונלי — שם הנמען',
    subject: 'string, אופציונלי — גובר על הנושא שקומקס מרכיב',
    remark: 'string, אופציונלי — גוף ההודעה',
    keepOpen: 'boolean — להשאיר את החלונות פתוחים בסוף. ברירת מחדל: סוגר',
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function run(ctx) {
  const { page, human, logger, input, dryRun } = ctx;

  if (!input.docNo) throw new Error('חסר docNo — איזו הצעה לשלוח?');
  if (!input.to) {
    throw new Error(
      'חסר to — כתובת הנמען חייבת להיות מפורשת.\n' +
      'קומקס ממלא אוטומטית את כתובת הלקוח, ושליחה בטעות ללקוח אינה הפיכה.',
    );
  }
  if (!EMAIL_RE.test(input.to)) throw new Error(`"${input.to}" אינה כתובת דוא"ל תקינה.`);

  const { frame: list } = await openProgram(ctx, 'a164', { expect: /Doc612V\.asp/i });

  // Filter to the document. Note: NOT clicking #Find — that opens the advanced
  // search dialog and leaves it hanging; typing into the field is enough.
  await human.type('#wFindDocNo', String(input.docNo), { scope: list, label: 'מספר הצעה' });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.settle('filtered');

  // Document numbers restart each year, so the same number can match more than
  // one row. Pick by customer when we were told which one.
  if (input.customer) {
    await human.click(`td:text-is(${JSON.stringify(input.customer)})`, {
      scope: list,
      label: `בחירת השורה של ${input.customer}`,
    });
    await human.think('row selected');
  }

  await human.click('#Row3', { scope: list, label: 'לשונית הדפסה' });
  await human.think('tab switched');
  await human.click('#Email', { scope: list, label: 'מעטפה — שליחת דוא"ל' });
  await human.settle('email dialog');

  const dlg = page.frames().find((f) => /Divor_Doc\.asp/i.test(f.url()));
  if (!dlg) throw new Error('חלון שליחת הדוא"ל לא נפתח.');

  const original = await dlg.locator('#Email').inputValue().catch(() => '');
  if (original && original.toLowerCase() !== input.to.toLowerCase()) {
    logger.step('warn', `קומקס מילא את כתובת הלקוח: ${original} — מחליף ל-${input.to}`);
  }

  await human.type('#Email', input.to, { scope: dlg, label: 'מקבל דוא"ל' });
  if (input.toName) await human.type('#SentToEmail_Add', input.toName, { scope: dlg, label: 'שם הנמען' });
  if (input.subject) await human.type('#Subject', input.subject, { scope: dlg, label: 'נושא' });
  if (input.remark) await human.type('#Remark', input.remark, { scope: dlg, label: 'הערה' });

  const mail = await dlg.evaluate(() => ({
    to: document.getElementById('Email')?.value,
    toName: document.getElementById('SentToEmail_Add')?.value,
    from: document.getElementById('FromEmail')?.value,
    subject: document.getElementById('Subject')?.value,
    remark: document.getElementById('Remark')?.value,
  }));

  await logger.shot(page, 'email-ready');
  console.log('\n  המייל:');
  console.log(`    אל:    ${mail.to}${mail.toName ? `  (${mail.toName})` : ''}`);
  console.log(`    מאת:   ${mail.from}`);
  console.log(`    נושא:  ${mail.subject}`);
  if (mail.remark) console.log(`    הערה:  ${mail.remark}`);
  if (original && original.toLowerCase() !== input.to.toLowerCase()) {
    console.log(`\n    (קומקס הציע לשלוח ל-${original} — כתובת הלקוח)`);
  }

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני השליחה.');
    console.log('\n  DRY RUN — לא נשלח. לשליחה: --confirm\n');
    return { dryRun: true, mail, comaxSuggested: original };
  }

  // Last check against the live field: everything above could have been
  // repopulated by the page between filling and clicking.
  const finalTo = await dlg.locator('#Email').inputValue();
  if (finalTo.trim().toLowerCase() !== input.to.trim().toLowerCase()) {
    throw new Error(`שדה הנמען מכיל "${finalTo}" ולא "${input.to}" — לא שולח.`);
  }

  await human.click('#OK', { scope: dlg, label: 'שליחה' });
  await human.settle('sending');
  const stillOpen = page.frames().some((f) => /Divor_Doc\.asp/i.test(f.url()) && !/Blank/i.test(f.url()));
  logger.step('email', stillOpen ? 'חלון השליחה עדיין פתוח — ייתכן שהשליחה נכשלה' : `נשלח אל ${finalTo}`);
  await logger.shot(page, 'after-send');

  // Leave the desktop clean. Windows left open stack up and block the next
  // task's clicks — a covered desktop icon simply swallows the double-click.
  if (input.keepOpen !== true) await closePrograms(ctx);

  return { mail, comaxSuggested: original, sent: !stillOpen };
}
