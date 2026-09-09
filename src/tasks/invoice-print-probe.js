/**
 * מיפוי נתיב ההדפסה/שליחה של חשבונית מס — בלי ללחוץ על כלום.
 *
 * A quote is emailed from its list: tab "הדפסה" (`#Row3`) → envelope (`#Email`)
 * → `Divor_Doc.asp`. A tax invoice has no such envelope — `Doc650V` exposes
 * `#Print` ("הדפסה (Alt+p)") and a `#DoPrint` image instead, and `Row3` there is
 * "שיוכים", not "הדפסה". So the quote route cannot simply be pointed at Doc650.
 *
 * Everything this task does is read the page: it selects the invoice row, then
 * reports the handlers behind the print controls and every mention of the mail
 * chooser (`mail.gif`, `GetVal`) in the frame's own HTML. It clicks no print
 * control, because a print that escapes `suppressPrintDialog` opens
 * `chrome://print/` — a dialog the agent can neither click nor close, which
 * freezes the browser until a person clears it by hand.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram, closePrograms } from '../navigate.js';

export const meta = {
  name: 'invoice-print-probe',
  description: 'מה מסתתר מאחורי כפתורי ההדפסה של חשבונית מס — קריאה בלבד, בלי קליק',
  writes: false,
  input: {
    docNo: 'string — מספר החשבונית שממנה בודקים',
    customer: 'string, אופציונלי — שם הלקוח, לבחירת השורה כשהמספר חוזר בין שנים',
    keepOpen: 'boolean — להשאיר את התוכנית פתוחה בסוף. ברירת מחדל: סוגר',
  },
};

export async function run(ctx) {
  const { page, human, logger, cfg, input } = ctx;
  if (!input.docNo) throw new Error('חסר docNo — מאיזו חשבונית לבדוק?');

  await ensureLoggedIn({ page, human, logger, cfg });
  const { frame: list } = await openProgram(ctx, 'a157', {
    expect: /Doc650V\.asp/i,
    // The desktop is not a stable route: it switches category on its own, and on
    // 09/09/2026 it came up on "לקוחות", where a157 simply is not present. The
    // path is the same one customer-history.js and the invoice document profile
    // already use, and it skips raising the desktop entirely (~18s).
    program: 'Erp/Mehirot/Doc650/Inv_Mlay/Doc650V.asp',
  });

  // Typing filters; #Find opens the advanced search dialog and leaves it up.
  await human.type('#wFindDocNo', String(input.docNo), { scope: list, label: 'מספר חשבונית' });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.settle('filtered');

  if (input.customer) {
    // The grid renders the name in more than one cell — the padded one it
    // measures with, and the one it shows — so an exact-text match is not
    // unique and strict mode rejects it. The docNo filter has already cut the
    // list down, so the first hit is the row we mean.
    await human.click(list.locator(`td:text-is(${JSON.stringify(input.customer)})`).first(), {
      label: `בחירת השורה של ${input.customer}`,
    });
    await human.think('row selected');
  }
  await logger.shot(page, 'list-row-selected');

  // Switching to the "הדפסה" tab only swaps which button strip is shown
  // (`setTbl`) — it prints nothing. Everything the screen offers for getting a
  // document out lives behind it, so an envelope under some other id would be
  // here or nowhere.
  await human.click('#Row3', { scope: list, label: 'לשונית הדפסה' });
  await human.think('print tab');
  await logger.shot(page, 'print-tab');

  const found = await list.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const describe = (el) =>
      el && {
        tag: el.tagName,
        id: el.id || null,
        title: norm(el.title) || null,
        text: norm(el.textContent).slice(0, 40) || null,
        src: el.getAttribute('src') || null,
        // The route lives in the handler, not in the label.
        onclick: norm(el.getAttribute('onclick')) || null,
        parentOnclick: norm(el.parentElement?.getAttribute('onclick')) || null,
        visible: !!el.offsetParent,
      };

    const html = document.documentElement.innerHTML;
    const grab = (re) => [...new Set((html.match(re) || []).map((s) => s.replace(/\s+/g, ' ')))].slice(0, 12);

    return {
      // The tab strip: which one is actually "הדפסה" on this screen.
      tabs: [...document.querySelectorAll('td[id^="Row"]')].map((t) => ({
        id: t.id,
        label: norm(t.textContent),
        onclick: norm(t.getAttribute('onclick')) || null,
      })),
      printControls: ['Print', 'DoPrint', 'PrintDoc', 'Email', 'Divor']
        .flatMap((id) => [...document.querySelectorAll(`#${id}`)])
        .map(describe),
      // Every control the print tab actually offers, not just the ids we
      // guessed at. An envelope hiding under a name we did not think of would
      // show up here.
      allControls: [...document.querySelectorAll('button, img[onclick], a[onclick], td[onclick]')]
        .filter((el) => el.offsetParent)
        .map(describe)
        .filter((d) => d.id || d.title || d.onclick),
      mentionsMailGif: grab(/[^"'()]*mail[^"'()]*\.gif/gi),
      mentionsGetVal: grab(/GetVal\([^)]*\)/g),
      mentionsDivor: grab(/[A-Za-z_/]*Divor[A-Za-z_.]*/g),
      // `#DoPrint` calls `top.Cs.doPrint_Email` — reading that function is how
      // we find out whether it opens a chooser or prints straight away, without
      // being the ones who find out the expensive way.
      doPrintEmailSource: (() => {
        try {
          return String(top.Cs.doPrint_Email).replace(/\s+/g, ' ').slice(0, 1500);
        } catch (e) {
          return `unavailable: ${e.message}`;
        }
      })(),
    };
  });

  logger.save('probe.json', found);
  console.log(JSON.stringify(found, null, 1));

  if (!input.keepOpen) await closePrograms(ctx);
  return found;
}
