/**
 * הוספת שורות להצעת מחיר שכבר פתוחה על המסך.
 *
 * Separate from `quote-new` on purpose: it works on the document already open,
 * which is what we want while learning the pricing mechanics without creating
 * new documents.
 *
 * A dry run stops after the fields are filled and reports **what Comax itself
 * computed** — the only reliable answer to "what does this cost under this
 * price list", since the catalog holds the net price, not the gross.
 */
import { dismissPopups, fillLookup } from '../navigate.js';
import { withVat, DEFAULT_VAT_RATE } from '../catalog/pricing.js';
import { resolveWholesale, assertWholesaleLanded } from '../documents/wholesale.js';
import { readTotals } from '../document-totals.js';

export const meta = {
  name: 'quote-add-line',
  description: 'הוספת שורות להצעת מחיר פתוחה',
  writes: true,
  input: {
    code: 'string — קוד פריט מדויק (לשורה בודדת)',
    qty: 'number — כמות (ברירת מחדל 1)',
    items: 'array — [{ code, qty, price?, discount?, remark? }] לכמה שורות ברצף',
    price: 'number, אופציונלי — מחיר ידני',
    discount: 'number, אופציונלי — % הנחה',
    wholesale: 'boolean, אופציונלי — מחיר סיטונאי: נטו חצי מהברוטו. **ברירת המחדל היא true תחת מחירון שמסומן wholesale ב-knowledge/lists.json** (מחירון קבוצות). להעביר false כדי לבטל. דרך ההזנה נקבעת לפי משטר המע\"מ של המסמך',
    remark: 'string, אופציונלי',
  },
};

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const lineDialogOf = (page) => page.frames().find((f) => /Doc612LinesU\.asp/i.test(f.url()));

export async function run(ctx) {
  const { page, human, logger, input, dryRun } = ctx;

  const items = input.items?.length
    ? input.items
    : [{ code: input.code, qty: input.qty, price: input.price, discount: input.discount, remark: input.remark }];
  if (!items[0]?.code) throw new Error('חסר code / items — איזה פריט להוסיף?');

  const grid = page.frames().find((f) => /Doc612LinesV\.asp/i.test(f.url()));
  if (!grid) throw new Error('אין הצעת מחיר פתוחה על המסך.');

  const results = [];
  for (const [i, item] of items.entries()) {
    const last = i === items.length - 1;
    results.push(await fillLine(ctx, {
      grid,
      item: { wholesale: input.wholesale, ...item },
      index: i + 1,
      of: items.length,
      // In a dry run nothing is committed, so only the first line can be shown.
      commit: !dryRun,
      last,
    }));
    if (dryRun) break;
  }

  const totals = dryRun ? null : await readTotals(grid);
  await logger.shot(page, dryRun ? 'line-ready' : 'lines-saved');

  // A wholesale line on an empty document had to assume the VAT rate, and the
  // discount it typed depends on it. Now that the document has a line it states
  // its real rate — so check, rather than leave an assumption unexamined. The
  // line is already saved, hence a loud report and not an exception.
  for (const r of results) {
    const assumed = r.wholesale;
    if (!assumed || totals?.vatRate == null) continue;
    if (Math.abs(totals.vatRate - assumed.rate) > 0.01) {
      logger.step('error', `הנחת מע"מ ${assumed.rate}% אבל המסמך אומר ${totals.vatRate}% — השורה שנשמרה שגויה, תתקן ידנית`);
      console.log(`\n  ⚠ מע"מ שהונח: ${assumed.rate}% · מע"מ במסמך: ${totals.vatRate}% — השורה צריכה תיקון.\n`);
    }
  }

  console.log(dryRun ? '\n  השורה כפי שהיא כרגע:' : `\n  ${results.length} שורות נשמרו:`);
  for (const r of results) {
    console.log(`    ${String(r.item).slice(0, 46)}`);
    console.log(`      כמות ${r.qty}  ×  ${r.price}  =  ${r.amount}${r.gross ? `    (ברוטו ${r.gross})` : ''}`);
  }
  if (totals) {
    console.log(`\n  סיכום המסמך: לפני מע"מ ${totals.beforeVat} · מע"מ ${totals.vat} · סה"כ ${totals.total}`);
  } else {
    const amt = num(results.at(-1)?.amount);
    if (amt != null) console.log(`    + מע"מ ${DEFAULT_VAT_RATE * 100}% (הערכה — המסמך עוד לא סוכם) ⇒ ${withVat(amt)}`);
  }

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני אישור השורה.');
    console.log(`\n  DRY RUN — לא נשמר. ${items.length > 1 ? `(הוצגה שורה 1 מתוך ${items.length}) ` : ''}לאישור: --confirm\n`);
    return { dryRun: true, lines: results };
  }
  console.log('');
  return { lines: results, totals };
}

/**
 * Fills one line and, when committing, saves it.
 *
 * `#OkNew` (אישור+חדש — the "+V" button) saves and immediately reopens the
 * dialog for the next item, so a run of lines needs only one pass. The last
 * line uses `#OK`, which saves and closes.
 */
async function fillLine(ctx, { grid, item, index, of, commit, last }) {
  const { page, human, logger } = ctx;

  let frame = lineDialogOf(page);
  const visible = frame && (await frame.locator('#Prt').isVisible({ timeout: 2000 }).catch(() => false));

  // A dialog left over from an earlier attempt still holds that attempt's price,
  // and `wholesale` would then halve an already-halved number. Only a blank
  // dialog is safe to reuse; a filled one is discarded and reopened clean.
  const leftovers = visible && (await frame.locator('#Prt').inputValue().catch(() => '')).trim();
  if (leftovers) {
    logger.step('line', `דיאלוג עם שאריות (${leftovers.slice(0, 28)}) — מבטל ופותח נקי`);
    await human.click('#Cancel', { scope: frame, label: 'ביטול שורה קודמת' });
    await human.settle('stale line discarded');
  }
  if (!visible || leftovers) {
    await human.click('#newRec', { scope: grid, label: 'הוספת שורה' });
    await human.settle('line dialog');
    frame = lineDialogOf(page);
  }
  if (!frame) throw new Error('דיאלוג הוספת שורה לא נפתח.');

  logger.step('line', `שורה ${index}/${of}: ${item.code}`);

  // Exact code — no name guessing, which is the whole point of the catalog.
  await fillLookup(ctx, { frame, field: '#Prt', value: String(item.code), what: 'פריט' });
  await dismissPopups(ctx);

  await human.type('#Cmt', String(item.qty ?? 1), { scope: frame, label: 'כמות' });
  await human.press('Tab', { label: 'יציאה משדה הכמות' });
  await human.think('price recalculation');

  const auto = {
    price: await frame.locator('#Mhr').inputValue().catch(() => null),
    discount: await frame.locator('#AczDis').inputValue().catch(() => null),
  };
  logger.step('auto', `קומקס הציע: מחיר ${auto.price} · הנחה ${auto.discount}`);

  // Wholesale: the **net** is half the gross list price. How that net is
  // entered depends on whether this document's price list already includes VAT.
  //
  // The gross is what Comax puts in `#Mhr` before applying the standard
  // discount. The catalog holds the *net* (289.90 × 0.8275 = 239.89), so
  // halving the catalog price would under-quote by that discount. Reading the
  // gross off the live form stays correct even when the catalog is stale.
  //
  // The rule itself moved to `src/documents/wholesale.js` (06/09/2026) so the
  // invoice could use it too — it had no wholesale pricing at all, and a tax
  // invoice on מחירון קבוצות was taking Comax's own offer. Two copies of this
  // would have drifted, and the one that drifts is always the one on the
  // document that moves stock.
  const { price, discount, plan: wholesalePlan } = await resolveWholesale({
    logger,
    grid,
    gross: num(auto.price),
    item,
  });

  if (price != null) {
    await human.type('#Mhr', String(price), { scope: frame, label: 'מחיר' });
    await human.press('Tab', { label: 'יציאה משדה המחיר' });
    await human.think('amount recalculation');
  }
  if (discount != null) {
    await human.type('#AczDis', String(discount), { scope: frame, label: '% הנחה' });
    await human.press('Tab');
    await human.think('discount applied');
  }
  // Paste rather than type: this is long free text, and typing it costs
  // ~121ms per character (measured 05/09/2026). Dates, quantities and
  // prices deliberately keep typing — see the note in human.type().
  if (item.remark) await human.type('#Remark', item.remark, { scope: frame, label: 'הערה' });

  const line = {
    item: await frame.locator('#Prt').inputValue().catch(() => null),
    qty: await frame.locator('#Cmt').inputValue().catch(() => null),
    price: await frame.locator('#Mhr').inputValue().catch(() => null),
    discount: await frame.locator('#AczDis').inputValue().catch(() => null),
    amount: await frame.locator('#Scm').inputValue().catch(() => null),
    gross: wholesalePlan ? auto.price : null,
    wholesale: wholesalePlan,
  };

  // Read the net back off the live fields. Everything above could be right and
  // still land wrong — Comax recalculates on Tab and can reinstate a standard
  // discount — and a wholesale line that is 18% off looks entirely normal in
  // the document afterwards. So the arithmetic is confirmed, not assumed.
  assertWholesaleLanded(wholesalePlan, line, logger);

  if (!commit) return line;

  await human.click(last ? '#OK' : '#OkNew', {
    scope: frame,
    label: last ? 'אישור השורה' : 'אישור + שורה חדשה (+V)',
  });
  await human.settle(`line ${index} saved`);
  await dismissPopups(ctx);
  return line;
}

/** Document totals as shown at the foot of the lines grid. */
