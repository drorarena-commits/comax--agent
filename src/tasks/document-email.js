/**
 * שליחת מסמך בדוא"ל — דרך מנגנון השליחה של קומקס עצמו, לכל סוגי המסמכים.
 *
 * Comax attaches and sends the document itself, so the PDF never passes through
 * the agent. That matters: attaching a file through a mail API means base64-ing
 * the whole thing through the conversation, which for a 119 KB quote exceeded
 * the tool output limit and would have produced a truncated, corrupt PDF.
 *
 * The route (found by Dror on a quote): documents list → tab "הדפסה" (`#Row3`)
 * → envelope (`#Email`) → `Erp/Divor_Doc.asp`.
 *
 * **This used to be quote-only.** It was generalised on 05/09/2026 when Dror
 * asked for an invoice by mail and there was simply no path for it — the
 * envelope screen is shared by every document type, and only the list program
 * differs. The document type now comes from `registry`, so the same code sends
 * a quote (`a164`), an invoice (`a157`) or anything else with a mapped list.
 *
 * SAFETY — read this before changing anything here:
 * The recipient field arrives **pre-filled with the customer's own address**,
 * pulled from their card (`erez@kmc.co.il` on the first run). One stray click
 * mails a live document to a real customer, and that cannot be taken back.
 *
 * That guard lives in `src/documents/recipient.js` (כלל 14) rather than here,
 * because it is not specific to any document type: every one opens the same
 * `Erp/Divor_Doc.asp` envelope with the customer's address already in it. An
 * invoice Dror asked for **himself** came up pre-filled with the customer's
 * address on 04/09/2026.
 */
import { openProgram, closePrograms } from '../navigate.js';
import * as registry from '../documents/registry.js';
import { requireRecipient, takeOverRecipient, assertRecipient } from '../documents/recipient.js';

/**
 * Match a frame on its **path**, never on the whole URL.
 *
 * Max2000 puts the parent frame's name in the query string, so testing a full
 * URL for "Doc650_ShihzurP" also matches `Doc650_HtmlP_T13` and picks the wrong
 * frame. Lifted from `tools/_smoke/invoice-restore.mjs`, where it was learned.
 */
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };
const byPath = (page, re) => page.frames().find((f) => re.test(pathOf(f.url())));

/**
 * Open `Erp/Divor_Doc.asp` — the envelope every document shares — from the
 * print tab of the document's own list.
 *
 * **The route is declared in the document profile (`profile.mail`), never
 * inferred from which buttons the page happens to have.** That inference is
 * exactly what broke invoice mail: the quote's `#Email` does not exist on
 * `Doc650V`, so the code fell back to `#DoPrint`, which prints (or does
 * nothing) but never opens the envelope.
 *
 *   via 'button'  — one dedicated button straight to the envelope (quote).
 *   via 'restore' — print-restore, a document range, then printer/mail/fax
 *                   (invoice: `#PrintDocAll`, confirmed by Dror as the route
 *                   for this document, always).
 */
async function openEnvelope(ctx, profile, list, docNo) {
  const { page, human, logger } = ctx;
  const route = profile.mail;

  if (!route) {
    throw new Error(
      `${profile.label}: אין מסלול שליחה מוגדר בפרופיל (profile.mail).\n`
      + '  המסלול שונה בין סוגי המסמכים ואי אפשר לנחש אותו מהכפתורים שקיימים —\n'
      + '  צריך למפות אותו במסך ולהצהיר עליו, כמו ב-quote וב-invoice.',
    );
  }

  logger.step('מעטפה', `${profile.label} — מסלול "${route.via}" דרך ${route.button}`);
  await human.click(route.button, { scope: list, label: `מעטפה — ${route.button}` });
  await human.settle('envelope step');

  if (route.via === 'button') return;

  // --- via 'restore': range dialog → chooser → envelope ---
  const range = byPath(page, route.range.frame);
  if (!range) throw new Error(`${profile.label}: מסך טווח ההדפסה לא נפתח.`);

  for (const field of [route.range.from, route.range.to]) {
    await range.locator(field).fill('').catch(() => {});
    await human.type(field, docNo, { scope: range, label: field });
  }

  /**
   * The range is read back before it is confirmed. It defaults to a span of
   * documents, and confirming a wrong one mails somebody else's invoice to this
   * recipient — the same class of mistake כלל 14 guards against, one screen up.
   */
  const got = await range.evaluate(
    ([from, to]) => ({
      from: document.querySelector(from)?.value,
      to: document.querySelector(to)?.value,
    }),
    [route.range.from, route.range.to],
  );
  if (got.from !== docNo || got.to !== docNo) {
    throw new Error(`טווח ההדפסה הוא ${got.from}→${got.to} ולא ${docNo}→${docNo} — עוצר לפני אישור.`);
  }
  logger.step('טווח', `${got.from} → ${got.to}`);

  await human.click(route.range.ok, { scope: range, label: 'אישור טווח ההדפסה' });
  await human.settle('chooser');

  const chooser = byPath(page, route.chooser.frame);
  if (!chooser) throw new Error(`${profile.label}: מסך הבחירה (מדפסת/דוא"ל/פקס) לא נפתח.`);
  await human.click(route.chooser.email, { scope: chooser, label: 'דוא"ל' });
  await human.settle('envelope');
  await human.think('mail form');
}

export const meta = {
  name: 'document-email',
  description: 'שליחת מסמך בדוא"ל דרך קומקס — הצעת מחיר, חשבונית וכל מסמך עם רשימה ממופה',
  writes: true,
  input: {
    document: 'string — סוג המסמך: quote · invoice · וכו\'. ברירת מחדל: quote',
    docNo: 'string — מספר המסמך',
    customer: 'string, אופציונלי — שם הלקוח, לזיהוי השורה כשיש כפילות מספרים בין שנים',
    to: 'string — כתובת הנמען. חובה. אין ברירת מחדל, בכוונה',
    toName: 'string, אופציונלי — שם הנמען',
    subject: 'string, אופציונלי — גובר על הנושא שקומקס מרכיב',
    remark: 'string, אופציונלי — גוף ההודעה',
    keepOpen: 'boolean — להשאיר את החלונות פתוחים בסוף. ברירת מחדל: סוגר',
  },
};

export async function run(ctx) {
  const { page, human, logger, input, dryRun } = ctx;

  if (!input.docNo) throw new Error('חסר docNo — איזה מסמך לשלוח?');

  const agent = registry.get(input.document ?? 'quote');
  const { profile } = agent;
  const to = requireRecipient(input.to, { what: profile.label });

  /**
   * The list screen must be mapped, but the header and lines need not be: we
   * are only reading a row and pressing the envelope. `assertReady` insists on
   * more than that, so the narrower check is made here rather than reused.
   */
  if (!profile.mapped?.list) {
    throw new Error(`${profile.label}: מסך הרשימה לא ממופה — אי אפשר לאתר את המסמך לשליחה.`);
  }

  const { frame: list } = await openProgram(ctx, profile.shortcut ?? profile.program, {
    expect: profile.frames.list,
    program: profile.program,
  });

  // Filter to the document. Note: NOT clicking #Find — that opens the advanced
  // search dialog and leaves it hanging; typing into the field is enough.
  await human.type('#wFindDocNo', String(input.docNo), { scope: list, label: `מספר ${profile.label}` });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.settle('filtered');

  // Document numbers restart each fiscal year, so the same number can match
  // more than one row. Pick by customer when we were told which one.
  // בחירת השורה לפני פתיחת המעטפה. קומקס שולח את המסמך ה**נבחר**, וסינון לבדו
  // לא בוחר — הוא רק מצמצם. בהצעה זה עבד כי היה שם קליק לפי שם הלקוח; כאן זה
  // נעשה תמיד, לפי מספר המסמך, כדי שלא נשלח את השורה שהייתה מסומנת קודם.
  await human
    .click(`td:text-is(${JSON.stringify(String(input.docNo))})`, {
      scope: list,
      label: `בחירת ${profile.label} ${input.docNo}`,
    })
    .catch(() => logger.step('warn', `לא מצאתי שורה עם ${input.docNo} ללחוץ עליה — ממשיך על הבחירה הנוכחית`));
  await human.think('row selected');

  await human.click('#Row3', { scope: list, label: 'לשונית הדפסה' });
  await human.think('tab switched');

  await openEnvelope(ctx, profile, list, String(input.docNo));

  const dlg = byPath(page, /Divor_Doc\.asp$/i);
  if (!dlg) throw new Error('חלון שליחת הדוא"ל לא נפתח.');

  const { prefilled: original } = await takeOverRecipient({ frame: dlg, human, logger, to });
  if (input.toName) await human.type('#SentToEmail_Add', input.toName, { scope: dlg, label: 'שם הנמען', paste: true });
  if (input.subject) await human.type('#Subject', input.subject, { scope: dlg, label: 'נושא', paste: true });
  if (input.remark) await human.type('#Remark', input.remark, { scope: dlg, label: 'הערה', paste: true });

  const mail = await dlg.evaluate(() => ({
    to: document.getElementById('Email')?.value,
    toName: document.getElementById('SentToEmail_Add')?.value,
    from: document.getElementById('FromEmail')?.value,
    subject: document.getElementById('Subject')?.value,
    remark: document.getElementById('Remark')?.value,
  }));

  await logger.shot(page, 'email-ready');
  console.log(`\n  ${profile.label} ${input.docNo} — המייל:`);
  console.log(`    אל:    ${mail.to}${mail.toName ? `  (${mail.toName})` : ''}`);
  console.log(`    מאת:   ${mail.from}`);
  console.log(`    נושא:  ${mail.subject}`);
  if (mail.remark) console.log(`    הערה:  ${mail.remark}`);
  if (original && original.toLowerCase() !== to.toLowerCase()) {
    console.log(`\n    (קומקס הציע לשלוח ל-${original} — כתובת הלקוח)`);
  }

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני השליחה.');
    console.log('\n  DRY RUN — לא נשלח. לשליחה: --confirm\n');
    return { dryRun: true, document: profile.name, docNo: input.docNo, mail, comaxSuggested: original };
  }

  // Last check against the live field: everything above could have been
  // repopulated by the page between filling and clicking.
  const finalTo = await assertRecipient(dlg, to);

  await human.click('#OK', { scope: dlg, label: 'שליחה' });
  await human.settle('sending');
  const stillOpen = page.frames().some((f) => /Divor_Doc\.asp/i.test(f.url()) && !/Blank/i.test(f.url()));
  logger.step('email', stillOpen ? 'חלון השליחה עדיין פתוח — ייתכן שהשליחה נכשלה' : `נשלח אל ${finalTo}`);
  await logger.shot(page, 'after-send');

  if (input.keepOpen !== true) await closePrograms(ctx);

  return { document: profile.name, docNo: input.docNo, mail, comaxSuggested: original, sent: !stillOpen };
}
