/**
 * שליחת חשבונית מס בדוא"ל — דרך מנגנון השליחה של קומקס עצמו.
 *
 * The route, mapped from Dror's screenshots (09/09/2026) after the obvious
 * guesses all failed:
 *
 *   רשימת חשבוניות → לשונית "הדפסה" (#Row3) → "הדפסת שיחזור" (#PrintDocAll)
 *     → דיאלוג "שיחזור חשבוניות"  (מ-<doc> עד-<doc>, לקוח <code>)  → ✓ ירוק
 *     → בורר "בחירה":  פקס · דוא"ל · מדפסת                          → דוא"ל
 *     → "שליחת מסמך בדוא\"ל" (Erp/Divor_Doc.asp)                     → ✓ ירוק
 *
 * Two things about this are worth knowing before touching it.
 *
 * First: the chooser is real, but it is not the one in `top.Cs.doPrint_Email`.
 * That function is what `#DoPrint` calls, and in Chrome it collapses to a bare
 * `window.confirm("האם ברצונך להדפיס?")` with its email branch commented out
 * ("בהוראת מירב להוריד אופציה של שליחת דואר אלקטרוני"). Reading that function
 * is what made the route look impossible. The printer/email/fax chooser lives
 * one screen further in, behind the שיחזור dialog, and has nothing to do with
 * it. Do not "simplify" this back to #DoPrint.
 *
 * Second, and the reason for every guard below: the recipient field arrives
 * **pre-filled with the customer's own address** — `mrlite3h@gmail.com` for
 * מ.פיור וואטר. One stray click mails a real invoice to a real customer, and
 * that cannot be taken back. So `to` has no default, the field is overwritten
 * rather than trusted, and its contents are read back and compared immediately
 * before the send. Same rule as `quote-email.js`, for the same reason.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram, closePrograms } from '../navigate.js';

export const meta = {
  name: 'invoice-email',
  description: 'שליחת חשבונית מס בדוא"ל דרך קומקס',
  writes: true,
  input: {
    docNo: 'string — מספר החשבונית. בלעדיו נדרש customer, ותישלח האחרונה שלו',
    to: 'string — כתובת הנמען. חובה. אין ברירת מחדל, בכוונה',
    customer: 'string, אופציונלי — שם הלקוח, לבחירת השורה כשהמספר חוזר בין שנים',
    toName: 'string, אופציונלי — שם הנמען',
    subject: 'string, אופציונלי — גובר על הנושא שקומקס מרכיב',
    remark: 'string, אופציונלי — גוף ההודעה',
    stopAfter: 'string, אופציונלי — למפות ולעצור: shihzur | chooser | form',
    keepOpen: 'boolean — להשאיר את החלונות פתוחים בסוף. ברירת מחדל: סוגר',
  },
  /**
   * Everything here is decidable without Comax, so it runs before the login
   * rather than 51 seconds into the task — which is where `חסר docNo` surfaced
   * on 09/09/2026, after a full login, for a call that was never going to work.
   */
  precheck(input) {
    if (!input.docNo && !input.customer) {
      return 'חסר docNo — איזו חשבונית לשלוח? (או customer, ואז תישלח האחרונה שלו)';
    }
    if (!input.to) {
      return (
        'חסר to — כתובת הנמען חייבת להיות מפורשת.\n' +
        'קומקס ממלא אוטומטית את כתובת הלקוח, ושליחה בטעות ללקוח אינה הפיכה (כלל 14).'
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) return `"${input.to}" אינה כתובת דוא"ל תקינה.`;
    return null;
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Everything clickable in a frame — how an unmapped dialog gets mapped. */
const CONTROLS = () => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('button, input, img, a, td[onclick], div[onclick]')]
    .filter((el) => el.offsetParent)
    .map((el) => ({
      tag: el.tagName,
      id: el.id || null,
      name: el.name || null,
      title: norm(el.title) || null,
      alt: norm(el.alt) || null,
      src: (el.getAttribute('src') || '').split('/').pop() || null,
      text: norm(el.textContent).slice(0, 40) || null,
      value: el.value ?? null,
      onclick: norm(el.getAttribute('onclick')).slice(0, 90) || null,
    }))
    .filter((c) => c.id || c.title || c.alt || c.text || c.onclick);
};

/**
 * Wait for the frame that actually contains something, by asking each frame.
 *
 * Comax's dialogs are frames whose urls carry no stable name — the chooser's is
 * just a timestamp — so matching on the url finds a frame that happens to be
 * there and reports zero controls. Asking "which frame has the דוא"ל icon"
 * cannot pick the wrong one.
 */
async function waitForFrameWith(page, probe, { label, timeoutMs = 30_000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const fr of page.frames()) {
      const hit = await fr.evaluate(probe).catch(() => false);
      if (hit) return fr;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} לא נפתח.`);
}

/** Wait for a frame whose url matches, then hand it back. */
async function waitForFrame(page, re, { label, timeoutMs = 30_000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const f = page.frames().find((fr) => re.test(fr.url()));
    if (f) return f;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} לא נפתח (חיפשתי frame שמתאים ל-${re}).`);
}

/** Dump a frame's controls into the log and the run folder. */
async function mapFrame(frame, logger, name) {
  const controls = await frame.evaluate(CONTROLS).catch(() => []);
  logger.save(`frame-${name}.json`, { url: frame.url(), controls });
  logger.step('map', `${name} — ${controls.length} פקדים — ${frame.url().split('/').pop().slice(0, 60)}`);
  return controls;
}

/**
 * The invoice list grid, as rows. Column positions are read from the header
 * rather than assumed — Comax reorders them between screens, and a fixed index
 * would quietly pick up the wrong column.
 *
 * Only the visible page is read, which is exactly right here and would be wrong
 * elsewhere: the newest invoice sorts onto page 1, so no paging is needed to
 * find it. Reading a *document's lines* is the case that must page and prove
 * its total (rule 16) — that is `src/documents/read-lines.js`, not this.
 */
async function readInvoiceGrid(frame) {
  return frame.evaluate(() => {
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    for (const t of document.querySelectorAll('table')) {
      const rows = [...t.rows].map((tr) => [...tr.cells].map(txt));
      const hi = rows.findIndex((r) => r.includes('שם לקוח'));
      if (hi < 0) continue;
      const head = rows[hi];
      const at = (l) => head.indexOf(l);
      const dc = ['חשבונית', 'מסמך', 'תעודה'].map(at).find((i) => i >= 0);
      if (dc === undefined) continue;
      const out = [];
      for (const r of rows.slice(hi + 1)) {
        const docNo = r[dc];
        if (!docNo || !/^\d+$/.test(docNo)) continue;
        out.push({
          docNo,
          date: at('מתאריך') >= 0 ? r[at('מתאריך')] : '',
          customer: at('שם לקוח') >= 0 ? r[at('שם לקוח')] : '',
          code: at('לקוח') >= 0 ? r[at('לקוח')] : '',
          amount: at('סכום') >= 0 ? r[at('סכום')] : '',
        });
      }
      return out;
    }
    return [];
  });
}

export async function run(ctx) {
  const { page, human, logger, cfg, input, dryRun } = ctx;

  if (!input.docNo && !input.customer) {
    throw new Error('חסר docNo — איזו חשבונית לשלוח? (או customer, ואז תישלח האחרונה שלו)');
  }
  if (!input.to) {
    throw new Error(
      'חסר to — כתובת הנמען חייבת להיות מפורשת.\n' +
        'קומקס ממלא אוטומטית את כתובת הלקוח, ושליחה בטעות ללקוח אינה הפיכה.',
    );
  }
  if (!EMAIL_RE.test(input.to)) throw new Error(`"${input.to}" אינה כתובת דוא"ל תקינה.`);

  await ensureLoggedIn({ page, human, logger, cfg });
  const { frame: list } = await openProgram(ctx, 'a157', {
    expect: /Doc650V\.asp/i,
    // The desktop is not a stable route: it switches category on its own, and on
    // 09/09/2026 it came up on "לקוחות", where a157 simply is not present. The
    // path is the same one customer-history.js and the invoice document profile
    // already use, and it skips raising the desktop entirely (~18s).
    program: 'Erp/Mehirot/Doc650/Inv_Mlay/Doc650V.asp',
  });

  /* ------------------------------------------------- 1. find the invoice -- */
  /**
   * "שלח לי את החשבונית האחרונה של X" is one print, not a search followed by a
   * send. Dror's correction, 09/09/2026:
   *
   *   "גם לא ביקשתי שיפתח או יחפש משהו — רק שישלח לי למייל.
   *    בקשה כזו לא דורשת פתיחה, רק 'הדפסה' למייל."
   *
   * He was right, and the run he stopped proved it: reaching for
   * `customer-history` to learn the number opened each invoice in turn to read
   * its lines — ten Comax actions to answer something the grid already shows,
   * and every one of them a real invoice opened on a screen where `#OK` means
   * קליטה (rule 4).
   *
   * So when only a customer is given, the number is read off the filtered grid
   * and the existing print route continues untouched. Nothing is opened.
   */
  let docNo = input.docNo;
  if (!docNo) {
    // The filter boxes accumulate — a leftover docNo filter silently yields
    // "this customer has no invoices" (the same trap as rule 11's duplicate
    // check). Clear them before filtering by customer.
    for (const sel of ['#wFindDocNo', '#wFindDateM', '#wFindDateA']) {
      await list.locator(sel).fill('').catch(() => {});
    }
    await human.type('#wFindLkNm', String(input.customer), {
      scope: list, label: `סינון ללקוח ${input.customer}`, clear: true,
    });
    await human.press('Enter', { label: 'החלת הסינון' });
    await human.settle('filtered by customer');

    const grid = await readInvoiceGrid(list);
    const mine = grid.filter((r) => String(r.code) === String(input.customer));
    if (!mine.length) {
      throw new Error(
        `ללקוח ${input.customer} אין חשבוניות בשנת העבודה הנוכחית.\n` +
          'זה אינו "אין לו חשבוניות" — חשבונית משנה קודמת דורשת החלפת חברה (כלל 9).',
      );
    }
    // Highest document number wins. The running number resets each year, but the
    // grid here is scoped to one working year, so within it the order holds.
    mine.sort((a, b) => Number(b.docNo) - Number(a.docNo));
    docNo = mine[0].docNo;
    logger.step('found', `החשבונית האחרונה של ${input.customer}: ${docNo} מ-${mine[0].date}, ${mine[0].amount} ₪`);
    if (mine.length > 1) {
      logger.step('found', `(מתוך ${mine.length} חשבוניות: ${mine.slice(0, 5).map((r) => r.docNo).join(', ')}…)`);
    }
  }

  await human.type('#wFindDocNo', String(docNo), { scope: list, label: 'מספר חשבונית' });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.settle('filtered');

  // Still selected by customer even when we just derived the number: rule 18 —
  // a document number repeats across years, so the docNo filter alone can leave
  // two unrelated invoices in the grid.
  if (input.customer) {
    // The grid paints the name into more than one cell, so exact text is not
    // unique; the docNo filter has already narrowed it to the right row.
    await human.click(list.locator(`td:text-is(${JSON.stringify(input.customer)})`).first(), {
      label: `בחירת השורה של ${input.customer}`,
    });
    await human.think('row selected');
  }
  await logger.shot(page, '01-row-selected');

  /* ------------------------------------------- 2. print tab → הדפסת שיחזור -- */
  await human.click('#Row3', { scope: list, label: 'לשונית הדפסה' });
  await human.think('print tab');
  await human.click('#PrintDocAll', { scope: list, label: 'הדפסת שיחזור' });
  await human.settle('שיחזור dialog');

  const shihzur = await waitForFrame(page, /Prt_Doc|Shihzur|PrintAll|Doc650P/i, {
    label: 'דיאלוג "שיחזור חשבוניות"',
  }).catch(async (e) => {
    // The dialog's url is not known ahead of time on every install; map what is
    // actually on screen instead of failing blind.
    for (const fr of page.frames()) await mapFrame(fr, logger, `unknown-${fr.name() || 'anon'}`);
    await logger.shot(page, '02-shihzur-not-found');
    throw e;
  });
  // Mapping dumps and the intermediate screenshots only when mapping. On the
  // happy path they cost about eleven seconds recording screens we already
  // understand; the shots that matter — the filled form before sending, and the
  // list after — are taken either way.
  if (input.stopAfter) {
    await mapFrame(shihzur, logger, 'shihzur');
    await logger.shot(page, '02-shihzur');
  }

  // This dialog takes a *range*, not a document — `#DocM`..`#DocA` and
  // `#LkM`..`#LkA`. Comax fills it from the selected row, so it is normally the
  // one invoice we mean; but if the row selection ever misses, the range stays
  // wide open and the mail goes out with other customers' invoices attached.
  // Checking the four fields costs nothing and is the only thing standing
  // between a misselected row and someone else's invoice in a stranger's inbox.
  const range = await shihzur.evaluate(() => ({
    docFrom: document.getElementById('DocM')?.value ?? null,
    docTo: document.getElementById('DocA')?.value ?? null,
    lkFrom: document.getElementById('LkM')?.value ?? null,
    lkTo: document.getElementById('LkA')?.value ?? null,
  }));
  logger.step('range', `חשבונית ${range.docFrom}–${range.docTo} · לקוח ${range.lkFrom}–${range.lkTo}`);
  // `docNo`, not `input.docNo` — when the number was derived from the customer
  // the latter is undefined, and this gate is the one thing standing between a
  // single invoice and a mail carrying other customers' invoices too.
  if (String(range.docFrom) !== String(docNo) || String(range.docTo) !== String(docNo)) {
    throw new Error(
      `טווח השיחזור הוא ${range.docFrom}–${range.docTo} ולא ${docNo} בלבד. ` +
        'עוצר: שליחה כזאת תצרף חשבוניות של לקוחות אחרים.',
    );
  }
  if (input.stopAfter === 'shihzur') return { stoppedAt: 'shihzur', url: shihzur.url(), range };

  /* ------------------------------------------------ 3. אישור → בורר בחירה -- */
  await human.click('#OK', { scope: shihzur, label: 'אישור השיחזור (✓ ירוק)' });
  await human.settle('בורר בחירה');

  const chooser = await waitForFrameWith(
    page,
    () => /דוא"ל|דוא״ל/.test(document.body?.innerText || '') && /פקס/.test(document.body?.innerText || ''),
    { label: 'בורר "בחירה" (פקס / דוא"ל / מדפסת)' },
  ).catch(async (e) => {
    for (const fr of page.frames()) await mapFrame(fr, logger, `after-ok-${fr.name() || 'anon'}`);
    await logger.shot(page, '03-chooser-not-found');
    throw e;
  });
  if (input.stopAfter) {
    await mapFrame(chooser, logger, 'chooser');
    await logger.shot(page, '03-chooser');
  }
  if (input.stopAfter === 'chooser') return { stoppedAt: 'chooser', url: chooser.url(), range };

  /* ------------------------------------------------- 4. דוא"ל בבורר בחירה -- */
  // `Erp/PicOne.asp` — מדפסת GetVal('1') · דוא"ל GetVal('2') · פקס GetVal('3').
  // Targeted by the image file rather than by position: the icons are unlabelled
  // <img>s with no id, and picking the middle one would send the invoice to a
  // fax the day Comax reorders them.
  await human.click('img[src*="mail.gif"]', { scope: chooser, label: 'דוא"ל (GetVal 2)' });
  await human.settle('email dialog');

  /* ---------------------------------------------- 5. שליחת מסמך בדוא"ל -- */
  const dlg = await waitForFrameWith(page, () => !!document.getElementById('Email'), {
    label: 'חלון "שליחת מסמך בדוא\'\'ל"',
  });
  if (input.stopAfter) await mapFrame(dlg, logger, 'email-form');

  // Comax fills the recipient from the customer's card. Overwrite it; never
  // trust it. `mrlite3h@gmail.com` was sitting here on the first run.
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

  await logger.shot(page, '04-email-ready');
  console.log('\n  המייל:');
  console.log(`    חשבונית: ${range.docFrom}  ·  לקוח ${range.lkFrom}`);
  console.log(`    אל:      ${mail.to}${mail.toName ? `  (${mail.toName})` : ''}`);
  console.log(`    מאת:     ${mail.from}`);
  console.log(`    נושא:    ${mail.subject}`);
  if (mail.remark) console.log(`    הערה:    ${mail.remark}`);
  if (original && original.toLowerCase() !== input.to.toLowerCase()) {
    console.log(`\n    (קומקס הציע ${original} — כתובת הלקוח. הוחלף.)`);
  }

  if (dryRun || input.stopAfter === 'form') {
    logger.step('dryrun', 'עוצר לפני השליחה.');
    console.log('\n  DRY RUN — לא נשלח. לשליחה: --confirm\n');
    return { dryRun: true, mail, comaxSuggested: original, range };
  }

  // Read the live field one last time: everything above could have been
  // repopulated by the page between filling it and clicking send.
  const finalTo = await dlg.locator('#Email').inputValue();
  if (finalTo.trim().toLowerCase() !== input.to.trim().toLowerCase()) {
    throw new Error(`שדה הנמען מכיל "${finalTo}" ולא "${input.to}" — לא שולח.`);
  }

  await human.click('#OK', { scope: dlg, label: 'שליחה (✓ ירוק)' });

  // Dror, 09/09/2026: "אחרי ה-V הירוק הסופי הסוכן צריך לחכות כמה שניות כדי
  // שהפעולה תקרה, ואז זה יחזור לראות את מסך החשבוניות — ורק אז לצאת."
  // Sending is a server round trip; the dialog closing and the list coming back
  // is the receipt. Leaving before that means never learning it failed.
  const gone = await waitForGone(page, () => !!document.getElementById('Email'), 30_000);
  await human.settle('after send');
  await logger.shot(page, '05-after-send');

  if (!gone) {
    logger.step('email', 'חלון השליחה עדיין פתוח — השליחה כנראה נכשלה');
    throw new Error('חלון השליחה לא נסגר — לא מאשר שהמייל נשלח.');
  }
  logger.step('email', `נשלח אל ${finalTo} — חלון השליחה נסגר והרשימה חזרה`);

  // Leave the desktop clean. Windows left open stack up and block the next
  // task's clicks — a covered desktop icon swallows the double-click.
  if (input.keepOpen !== true) await closePrograms(ctx);

  return { mail, comaxSuggested: original, range, sent: true };
}

/** Poll until no frame satisfies `probe` any more. */
async function waitForGone(page, probe, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    let present = false;
    for (const fr of page.frames()) {
      if (await fr.evaluate(probe).catch(() => false)) {
        present = true;
        break;
      }
    }
    if (!present) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
