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
    docNo: 'string — מספר החשבונית',
    to: 'string — כתובת הנמען. חובה. אין ברירת מחדל, בכוונה',
    customer: 'string, אופציונלי — שם הלקוח, לבחירת השורה כשהמספר חוזר בין שנים',
    toName: 'string, אופציונלי — שם הנמען',
    subject: 'string, אופציונלי — גובר על הנושא שקומקס מרכיב',
    remark: 'string, אופציונלי — גוף ההודעה',
    stopAfter: 'string, אופציונלי — למפות ולעצור: shihzur | chooser | form',
    keepOpen: 'boolean — להשאיר את החלונות פתוחים בסוף. ברירת מחדל: סוגר',
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

export async function run(ctx) {
  const { page, human, logger, cfg, input, dryRun } = ctx;

  if (!input.docNo) throw new Error('חסר docNo — איזו חשבונית לשלוח?');
  if (!input.to) {
    throw new Error(
      'חסר to — כתובת הנמען חייבת להיות מפורשת.\n' +
        'קומקס ממלא אוטומטית את כתובת הלקוח, ושליחה בטעות ללקוח אינה הפיכה.',
    );
  }
  if (!EMAIL_RE.test(input.to)) throw new Error(`"${input.to}" אינה כתובת דוא"ל תקינה.`);

  await ensureLoggedIn({ page, human, logger, cfg });
  const { frame: list } = await openProgram(ctx, 'a157', { expect: /Doc650V\.asp/i });

  /* ------------------------------------------------- 1. find the invoice -- */
  await human.type('#wFindDocNo', String(input.docNo), { scope: list, label: 'מספר חשבונית' });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.settle('filtered');

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
  if (String(range.docFrom) !== String(input.docNo) || String(range.docTo) !== String(input.docNo)) {
    throw new Error(
      `טווח השיחזור הוא ${range.docFrom}–${range.docTo} ולא ${input.docNo} בלבד. ` +
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
