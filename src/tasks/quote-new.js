/**
 * הצעת מחיר חדשה — Doc612.
 *
 * Built in two halves, because the item-lines screen only exists after the
 * header is committed and a document number is burned:
 *
 *   steps 1-7  header: open the program, start a new quote, pick the customer,
 *              clear the remarks popup, fill the details. Fully testable with
 *              --dry-run without creating anything.
 *   step  8    lines: needs `knowledge/screens/quote-lines.json`, which we get
 *              by mapping the screen while Dror drives it by hand.
 */
import { readFileSync } from 'node:fs';
import { ensureLoggedIn } from '../session.js';
import { openProgram, dismissPopups, fillLookup } from '../navigate.js';

export const meta = {
  name: 'quote-new',
  description: 'הצעת מחיר חדשה ללקוח',
  writes: true,
  input: {
    customer: 'string — שם הלקוח, מלא או חלקי',
    store: 'string, אופציונלי — מחסן. ברירת מחדל: מה שמגיע מכרטיס הלקוח',
    priceList: 'string, אופציונלי — מחירון. ברירת מחדל: מכרטיס הלקוח',
    agent: 'string, אופציונלי — סוכן',
    details: 'string, אופציונלי — שדה "פרטים"',
    date: 'string dd/mm/yyyy, אופציונלי — ברירת מחדל היום',
    items: 'array, אופציונלי — [{ code, qty, price }]. עדיין לא נתמך',
  },
};

/** Catalogs read from the live combos — see knowledge/lists.json. */
function knownLists() {
  return JSON.parse(
    readFileSync(new URL('../../knowledge/lists.json', import.meta.url), 'utf8'),
  );
}

const QUOTES_SHORTCUT = 'a164'; // הצעות מחיר ללקוחות

export async function run(ctx) {
  const { page, human, logger, cfg, input, dryRun } = ctx;

  if (!input.customer) throw new Error('חסר שדה customer — למי ההצעה?');

  // Fail on a bad warehouse/price list before opening anything, and say which
  // values are legal — a typo here would otherwise land silently in a document.
  const lists = knownLists();
  const check = (value, options, what) => {
    if (!value) return;
    if (options.some((o) => o.name === value)) return;
    throw new Error(
      `אין ${what} בשם "${value}". הקיימים:\n` +
      options.map((o) => `  ${o.name}  (${o.code})`).join('\n'),
    );
  };
  check(input.store, lists.warehouses, 'מחסן');
  check(input.priceList, lists.priceLists, 'מחירון');

  await ensureLoggedIn({ page, human, logger, cfg });

  // 1. Open the quotes program. The frame name is discovered, never hardcoded.
  const { frame: listFrame } = await openProgram(ctx, QUOTES_SHORTCUT, { expect: /Doc612V\.asp/i });
  if (!listFrame) throw new Error('מסך ההצעות לא נפתח.');

  // 2. New quote — this opens the header dialog in a frame of its own.
  const framesBefore = new Set(page.frames().map((f) => f.url()));
  await human.click('#newRec', { scope: listFrame, label: 'הוספה (הצעה חדשה)' });
  await human.settle('header form');

  const formFrame = page
    .frames()
    .find((f) => /Doc612U\.asp/i.test(f.url()) && !framesBefore.has(f.url()))
      ?? page.frames().find((f) => /Doc612U\.asp/i.test(f.url()));
  if (!formFrame) throw new Error('טופס הכותרת (Doc612U) לא נפתח.');

  // The allocated number is rendered as text in #DocId, not as an input value.
  const docNo = await formFrame.locator('#DocId').innerText().catch(() => null);
  logger.step('quote', `מספר הצעה שהוקצה: ${docNo?.trim() || '(לא נקרא)'}`);

  // 3. Customer. The arrow is derived as #CcomboButIdxLk — never #chg, which
  //    switches the customer type and swaps the field out from under us.
  const customer = await fillLookup(ctx, {
    frame: formFrame,
    field: '#IdxLk',
    value: input.customer,
    what: 'לקוח',
  });

  // 4. Choosing a customer with remarks pops a dialog over the form.
  await dismissPopups(ctx);

  // 5. Warehouse and price list. Comax prefills these from the customer card,
  //    but the default is not always the right one — so an explicit value wins,
  //    and whatever ends up in the document is reported back either way.
  if (input.store) {
    await fillLookup(ctx, { frame: formFrame, field: '#Store', value: input.store, what: 'מחסן' });
  }
  if (input.priceList) {
    await fillLookup(ctx, { frame: formFrame, field: '#Mhr', value: input.priceList, what: 'מחירון' });
  }

  // 6. The remaining optional header fields.
  if (input.date) await human.type('#DateDoc', input.date, { scope: formFrame, label: 'תאריך' });
  if (input.agent) await fillLookup(ctx, { frame: formFrame, field: '#Sochen', value: input.agent, what: 'סוכן' });
  // Paste rather than type: this is long free text, and typing it costs
  // ~121ms per character (measured 05/09/2026). Dates, quantities and
  // prices deliberately keep typing — see the note in human.type().
  if (input.details) await human.type('#Pratim', input.details, { scope: formFrame, label: 'פרטים', paste: true });
  await dismissPopups(ctx);

  // 6. Show the finished header before anything is committed.
  const header = await readHeader(formFrame);
  logger.save('header.json', header);
  await logger.shot(page, 'header-ready');

  console.log('\n  כותרת ההצעה מוכנה:');
  for (const [k, v] of Object.entries(header)) if (v) console.log(`    ${k.padEnd(10)} ${v}`);

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני אישור הכותרת. ההצעה לא נוצרה.');
    console.log('\n  DRY RUN — לא נוצר מסמך. להרצה אמיתית: --confirm\n');
    return { dryRun: true, docNo, customer, header };
  }

  // 7. Committing the header creates the document.
  await human.click('#OK', { scope: formFrame, label: 'אישור הכותרת' });
  await human.settle('quote created');
  await dismissPopups(ctx);
  await logger.shot(page, 'after-header-ok');

  // `#DocId` in the add dialog is only a preview — it once showed 6120041,
  // which turned out to be an existing 2025 quote for a different customer.
  // The number the document actually received is on the lines screen.
  const realDocNo = await readDocNumber(page);
  if (realDocNo && realDocNo !== docNo?.trim()) {
    logger.step('quote', `מספר המסמך בפועל: ${realDocNo} (בטופס הופיע ${docNo?.trim()})`);
  } else {
    logger.step('quote', `הצעה ${realDocNo ?? docNo} נוצרה`);
  }

  // 8. Item lines. Committing the header opens the add-line dialog on its own.
  const added = [];
  const items = input.items ?? [];
  for (const [i, item] of items.entries()) {
    const last = i === items.length - 1;
    added.push(await addLine(ctx, { item, index: i + 1, last }));
  }

  const totals = await readTotals(page);
  await logger.shot(page, 'lines-done');
  const shown = realDocNo ?? docNo;
  if (items.length) {
    console.log(`\n  ${added.length} שורות נוספו להצעה ${shown}:`);
    for (const l of added) console.log(`    ${l.item}  ×${l.qty}  = ${l.amount ?? '?'}`);
    console.log(`\n  סה"כ לפני מע"מ: ${totals.beforeVat}   מע"מ: ${totals.vat}   סה"כ: ${totals.total}`);
  }
  console.log(`\n  ההצעה ${shown} פתוחה על המסך. לא לחצתי "קליטת הצעה" — זה נשאר לך.\n`);

  return { docNo: shown, previewDocNo: docNo, customer, header, lines: added, totals };
}

/**
 * The document number as shown on the lines screen — the live document, not the
 * preview the add dialog displays before anything is saved.
 */
async function readDocNumber(page) {
  const grid = page.frames().find((f) => /Doc612LinesV\.asp/i.test(f.url()));
  if (!grid) return null;
  try {
    const text = await grid.innerText('body');
    const m = /מספר:\s*\(?\s*(\d+)/.exec(text);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Adds one line to the open quote.
 *
 * `#OkNew` (אישור+חדש) commits the line and immediately reopens the dialog for
 * the next one, which is why lines are added in a single pass. Never touch
 * `#chg` here: like its namesake in the header, it toggles the item *type*
 * (פריטים / פריט כללי) rather than opening anything.
 */
async function addLine(ctx, { item, index, last }) {
  const { page, human, logger } = ctx;

  const frame = page.frames().find((f) => /Doc612LinesU\.asp/i.test(f.url()));
  if (!frame) throw new Error('דיאלוג הוספת שורה לא פתוח.');

  logger.step('line', `שורה ${index}: ${item.code ?? item.name}`);
  await fillLookup(ctx, {
    frame,
    field: '#Prt',
    value: String(item.code ?? item.name),
    what: 'פריט',
  });
  await dismissPopups(ctx);

  await human.type('#Cmt', String(item.qty ?? 1), { scope: frame, label: 'כמות' });
  if (item.price != null) await human.type('#Mhr', String(item.price), { scope: frame, label: 'מחיר' });
  if (item.discount != null) await human.type('#AczDis', String(item.discount), { scope: frame, label: '% הנחה' });
  if (item.remark) await human.type('#Remark', item.remark, { scope: frame, label: 'הערה', paste: true });

  const line = {
    item: await frame.locator('#Prt').inputValue().catch(() => null),
    qty: await frame.locator('#Cmt').inputValue().catch(() => null),
    price: await frame.locator('#Mhr').inputValue().catch(() => null),
    discount: await frame.locator('#AczDis').inputValue().catch(() => null),
    amount: await frame.locator('#Scm').inputValue().catch(() => null),
  };

  // Last line closes the dialog; the others reopen it for the next item.
  await human.click(last ? '#OK' : '#OkNew', {
    scope: frame,
    label: last ? 'אישור השורה' : 'אישור + שורה חדשה',
  });
  await human.settle(`line ${index} saved`);
  await dismissPopups(ctx);
  return line;
}

/** Document totals as shown at the foot of the lines grid. */
async function readTotals(page) {
  const grid = page.frames().find((f) => /Doc612LinesV\.asp/i.test(f.url()));
  if (!grid) return {};
  const read = async (sel) => grid.locator(sel).inputValue().catch(() => null);
  return {
    beforeVat: await read('#ScmBeforeMaam'),
    vat: await read('#Scm_Maam'),
    total: await read('#Scm'),
  };
}

/** Read back what the header actually holds, for the log and for your review. */
async function readHeader(frame) {
  const read = async (sel) => frame.locator(sel).inputValue().catch(() => null);
  return {
    הצעה: await frame.locator('#DocId').innerText().catch(() => null),
    תאריך: await read('#DateDoc'),
    שעה: await read('#DocTime'),
    לקוח: await read('#IdxLk'),
    סוכן: await read('#Sochen'),
    פרטים: await read('#Pratim'),
    מחסן: await read('#Store'),
    מחירון: await read('#Mhr'),
    סטטוס: await read('#SwIzur'),
  };
}
