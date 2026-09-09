/**
 * פתיחת חשבונית מס קיימת ועריכת שורה בה — מחיר, הנחה, הערה.
 *
 * **ולעולם לא קולטת.** כלי אחד עורך, כלי אחד קולט — הפרדה שכבר נלמדה כאן
 * ביוקר (`transfer-add-lines` מול `transfer-file`). הקליטה היא
 * `transfer-to-invoice --json '{"file":true,"expectTotal":N}' --confirm`.
 *
 * ⚠️ עד 06/09/2026 לא היה בפרויקט שום ידע על פתיחת שורה **שמורה** לעריכה: אין
 * `#editRec` ברשת השורות, וה-snapshot היחיד של `Doc650LinesU` נתפס במצב
 * `Mode='ADD'`. דרור הראה את המסלול בעצמו — **דאבל-קליק על שורת הפריט ברשת** —
 * וזה מה שממומש כאן.
 *
 * הדוגמה שהוליד את הקובץ, שורת מתנה:
 *
 *   node tools/run.js invoice-edit-line --json '{
 *     "docNo":"6500086","match":"3468335830650",
 *     "price":42,"discount":100,"remark":"מתנה מדרור"
 *   }' --confirm
 *
 * מחיר צרכן + הנחה 100% ⇒ הפריט מופיע בחשבונית עם הערך האמיתי שלו ועולה 0.
 * קומקס יקפיץ `חריגה ממחירון מינימום ! האם להמשיך ?`, ו-`browser.js` מאשר
 * דיאלוגים אוטומטית ורושם ביומן.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram, closePrograms, dismissPopups } from '../navigate.js';
import { readTotals } from '../document-totals.js';
import * as engine from '../documents/engine.js';
import * as invoice from '../documents/agents/invoice/index.js';

const { profile } = invoice;

export const meta = {
  name: 'invoice-edit-line',
  description: 'עריכת שורה בחשבונית מס קיימת — מחיר, הנחה, הערה. לא קולטת',
  writes: true,
  input: {
    docNo: 'string — מספר החשבונית. חובה — גם כדי לאמת שחזרנו לטיוטה הנכונה',
    customer: 'string, אופציונלי — קוד לקוח. **הדרך היחידה להגיע לטיוטה**, שאינה ניתנת לחיפוש. בלעדיו מחפשים ברשימה, מה שעובד רק על חשבונית שנקלטה',
    store: 'string, אופציונלי — מחסן לכותרת שנכתבת מחדש. ברירת המחדל "מחסן קבוצות"',
    date: 'string dd/mm/yyyy, אופציונלי',
    details: 'string, אופציונלי — שדה פרטים לכותרת שנכתבת מחדש',
    match: 'string — הקוד כפי שהוא מוצג ברשת השורות (ברקוד). חובה',
    price: 'number, אופציונלי — מחיר חדש',
    discount: 'number, אופציונלי — % הנחה. 100 = מתנה',
    remark: 'string, אופציונלי — הערת שורה',
  },
};

/**
 * `#OK` on a document **header** only.
 *
 * On the lines screen the same id is "(Alt+e) קליטת חשבונית" and it files the
 * document. Same guard `customer-history.peek()` puts in front of the sales
 * documents, for the same reason.
 */
async function pressHeaderOk(ctx, frame, label) {
  const url = frame.url();
  if (!/U\.aspx?/i.test(url) || /LinesV/i.test(url)) {
    throw new Error(
      `סירוב ללחוץ #OK מחוץ למסך כותרת — ה-frame הוא ${url.split('/').pop()?.split('?')[0]}.\n`
      + '  במסך השורות #OK הוא "קליטת חשבונית" — הוא מזיז מלאי, ואין ביטול.',
    );
  }
  await ctx.human.click(profile.header.ok, { scope: frame, label });
}

export async function run(ctx) {
  const { page, human, logger, cfg, input, dryRun } = ctx;

  if (!input.docNo) throw new Error('חסר docNo — איזו חשבונית לפתוח?');
  if (!input.match) throw new Error('חסר match — איזו שורה לערוך? (הקוד כפי שהוא מוצג ברשת)');
  if (input.price == null && input.discount == null && input.remark == null) {
    throw new Error('לא נמסר מה לשנות — price / discount / remark, לפחות אחד.');
  }

  await ensureLoggedIn({ page, human, logger, cfg });
  await closePrograms(ctx).catch(() => {});

  /* ── מסלול הטיוטה: דרך הלקוח, כי טיוטה לא ניתנת לחיפוש ──────────────── */

  if (input.customer) {
    /*
     * 💣 **טיוטה לא מופיעה בחיפוש.** Verified live 06/09/2026: filtering `a157`
     * by `#wFindDocNo=6500086` returned a grid with header rows and **zero data
     * rows** — the filter worked, there was simply nothing to find.
     *
     * Dror's route in: **start a new invoice for the same customer.** Comax
     * re-catches the open draft and the lines screen comes back holding
     * everything that was already entered. Same behaviour `README.md` already
     * documented for quotes; now known for tax invoices too.
     *
     * ⚠️ The header is **rewritten** on the way in, so it has to be refilled
     * with the same values or what was there is lost.
     *
     * 🚨 And the number is read back and asserted: if Comax did *not* re-catch,
     * we are standing in a brand-new invoice, and adding lines to it would be
     * the duplicate-document failure this project keeps almost making. On a
     * mismatch: back out, touch nothing.
     */
    const created = await invoice.create(ctx, {
      customer: input.customer,
      store: input.store ?? 'מחסן קבוצות',
      date: input.date,
      details: input.details,
    });

    if (dryRun) {
      console.log(`\n  DRY RUN — נעצר לפני אישור הכותרת. מספר שהוצג: ${created.preview ?? '(לא נקרא)'}\n`);
      return { dryRun: true, ...created };
    }

    if (String(created.docNo ?? '') !== String(input.docNo)) {
      await engine.backOut(ctx, profile).catch(() => {});
      throw new Error(
        `ציפיתי לחזור לטיוטה ${input.docNo}, אבל קומקס פתח ${created.docNo || '(מספר לא נקרא)'}.\n`
        + '  הטיוטה לא נתפסה מחדש — יצאתי בלי לגעת בכלום.\n'
        + '  ⚠️ לא מוסיף שורות למסמך שאינו זה שביקשת: זו הדרך לייצר חשבונית כפולה.',
      );
    }
    logger.step('טיוטה', `נתפסה מחדש: ${created.docNo} ✓`);

    // Re-catching lands on the lines screen with the "add line" dialog already
    // open on top of the grid. It would swallow the double-click, so it goes
    // first — `#Cancel` discards an empty new line, nothing more.
    const stray = page.frames().find((f) => profile.frames.lineForm.test(f.url()));
    if (stray) {
      await human.click('#Cancel', { scope: stray, label: 'סגירת דיאלוג שורה ריק' }).catch(() => {});
      await human.settle('line dialog closed');
    }

    return await editAndReport(ctx, input, created.header ?? {});
  }

  /* ── פתיחת חשבונית שנקלטה, מהרשימה ─────────────────────────────────── */

  const { frame: list } = await openProgram(ctx, profile.shortcut, {
    expect: profile.frames.list,
    program: profile.program,
  });
  if (!list) throw new Error('רשימת החשבוניות לא נפתחה.');

  // Typing + Enter applies the filter. NOT #Find — that opens the חיתוכים
  // dialog and leaves it hanging over the list.
  await human.type('#wFindDocNo', String(input.docNo), { scope: list, label: `סינון לחשבונית ${input.docNo}`, clear: true });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.think('filter applied');

  const cell = `td:text-is(${JSON.stringify(String(input.docNo))})`;
  if (!(await list.locator(cell).count().catch(() => 0))) {
    /*
     * "לא נמצא" has at least three different causes here, and they need
     * different answers — so read the grid rather than report a bare miss:
     *
     *   - the draft genuinely is not listed (never filed)
     *   - the filter matched nothing
     *   - the row IS there but the cell is not literally the number
     *
     * `Doc650V` is `.aspx` under Max2000_NET_2022, a different application from
     * the classic `.asp` lists, so its grid is not assumed to look the same.
     */
    const rows = await list.evaluate(() =>
      [...document.querySelectorAll('tr')]
        .map((tr) => [...tr.cells].map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()))
        .filter((cells) => cells.length > 2 && cells.some(Boolean))
        .slice(0, 25));
    logger.save('list-rows.json', rows);
    logger.step('רשימה', `${rows.length} שורות ברשת אחרי הסינון`);
    await logger.shot(page, 'list-not-found');

    throw new Error(
      `חשבונית ${input.docNo} לא נמצאה ברשימה. ${rows.length} שורות ברשת אחרי הסינון:\n`
      + rows.slice(0, 8).map((r) => `    ${r.filter(Boolean).join(' · ').slice(0, 110)}`).join('\n')
      + '\n  ⚠️ אם היא נבנתה ולא נקלטה — ייתכן שטיוטה לא מופיעה כאן. **לא לבנות חשבונית שנייה.**\n'
      + '  ⚠️ ורשימת a157 מוגבלת לשנת הכספים הנוכחית — מסמך משנה קודמת יחזיר 0 שורות בלי שגיאה.\n'
      + `  הרשת המלאה נשמרה ב-list-rows.json ובצילום.`,
    );
  }

  await human.doubleClick(cell, { scope: list, label: `פתיחת חשבונית ${input.docNo}` });
  await human.settle('header opening');

  const F = (re) => page.frames().find((f) => re.test(f.url()));
  const hdr = F(profile.frames.header);
  if (!hdr) throw new Error(`כותרת החשבונית ${input.docNo} לא נפתחה.`);

  const header = await engine.readHeader(profile, hdr);
  logger.save('header.json', header);

  await dismissPopups(ctx);
  await pressHeaderOk(ctx, hdr, 'אישור כותרת — מעבר לשורות');
  await human.settle('lines loading');

  return await editAndReport(ctx, input, header);
}

/**
 * The edit itself, shared by both routes in — the list (a filed invoice) and
 * the customer (a draft, which cannot be searched for).
 *
 * Whatever happens, the way out is `#DoExit` + `#Cancel`. Never `#OK`.
 */
async function editAndReport(ctx, input, header) {
  const { page, human, logger, dryRun } = ctx;
  const F = (re) => page.frames().find((f) => re.test(f.url()));

  let result = null;
  let totals = null;
  try {
    let grid = null;
    for (let i = 0; i < 6 && !grid; i++) {
      grid = F(profile.frames.linesGrid);
      if (!grid) await human.think('waiting for the lines grid');
    }
    if (!grid) throw new Error(`מסך השורות של ${input.docNo} לא נפתח.`);

    const beforeTotals = await readTotals(grid);
    logger.step('לפני', `סכום שורות ${beforeTotals.subtotal} · סה"כ ${beforeTotals.total}`);

    if (dryRun) {
      // The row is located and reported, but nothing is typed. Locating is a
      // read; it pages the grid and clicks nothing that changes the document.
      const { cell: rowCell } = await engine.findLineRow(ctx, profile, input.match);
      const row = await grid.locator(rowCell).evaluate((td) =>
        [...td.closest('tr').cells].map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()));
      logger.step('dryrun', 'עוצר לפני העריכה. השורה אותרה ולא נגעתי בה.');
      console.log(`\n  חשבונית ${input.docNo} · ${header.לקוח ?? ''}`);
      console.log(`  השורה שנמצאה: ${row.filter(Boolean).join(' · ')}`);
      console.log(`\n  ישתנה ל: ${[
        input.price != null ? `מחיר ${input.price}` : null,
        input.discount != null ? `הנחה ${input.discount}%` : null,
        input.remark != null ? `הערה "${input.remark}"` : null,
      ].filter(Boolean).join(' · ')}`);
      console.log('\n  DRY RUN — לא נערך. לביצוע: --confirm\n');
      result = { dryRun: true, row };
    } else {
      result = await engine.editLine(ctx, profile, {
        match: input.match,
        price: input.price,
        discount: input.discount,
        remark: input.remark,
      });

      totals = await readTotals(grid);
      logger.save('totals-after-edit.json', totals);
      await logger.shot(page, 'after-edit');

      console.log(`\n  חשבונית ${input.docNo} · ${header.לקוח ?? ''} · ${totals.priceList ?? ''}`);
      console.log(`\n  השורה ${input.match}:`);
      console.log(`    לפני:  מחיר ${result.before.price} · הנחה ${result.before.discount}`);
      console.log(`    אחרי:  מחיר ${result.after.price} · הנחה ${result.after.discount} · סכום ${result.after.amount}`);
      if (result.after.remark) console.log(`    הערה:  ${result.after.remark}`);
      console.log(`\n  סכום שורות: ${beforeTotals.subtotal} → ${totals.subtotal}`);
      console.log(`  לפני מע"מ: ${totals.beforeVat}   מע"מ: ${totals.vat}   סה"כ: ${totals.total}`);
      console.log(
        '\n  החשבונית פתוחה על המסך ולא נקלטה.\n'
        + `  לקליטה, אחרי אישור:\n    node tools/run.js transfer-to-invoice --json '{"file":true,"expectTotal":${totals.total}}' --confirm\n`,
      );
    }
  } catch (e) {
    // Out through the door, never through קליטה — whatever went wrong.
    await engine.backOut(ctx, profile).catch(() => {});
    throw e;
  }

  return { docNo: input.docNo, header, ...result, totals };
}
