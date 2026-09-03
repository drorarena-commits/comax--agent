/**
 * "רגע — לא כבר עשו לו קבלה כזאת?"
 *
 * A receipt is the one document in the set that is easy to file twice: the
 * money arrives once, but the person recording it and the person who saw the
 * bank line are not always the same, and nothing in Comax objects. A duplicate
 * receipt closes an invoice that was already closed, and unpicking it means a
 * negative counter-receipt.
 *
 * So before either receipt agent fills a form, it looks at that customer's last
 * few receipts and says what it sees. Dror's rule, 03/09/2026:
 *
 *   > אם יש כבר קבלה על אותו סכום — הסוכן יעצור, יתריע, ורק אם אאשר יתקדם.
 *   > ואם לא אאשר, לא תיווצר קבלה בכלל.
 *
 * **The amount is the trigger.** Two levels:
 *
 *   - **`exact`** — same amount, whatever the date. A stop: the agent refuses
 *     and waits for a person to say "yes, this is a second real transfer",
 *     which arrives as `allowDuplicate: true`.
 *   - **`partial`** — same date, different amount. Reported and never blocking:
 *     several receipts a day for one customer is ordinary, and an alarm that
 *     always rings is an alarm nobody reads.
 *
 * ⚠️ Read-only. It types into the list's own filter boxes and reads the grid;
 * it opens nothing and files nothing.
 */

/** dd/mm/yyyy anywhere in a cell. */
const DATE = /\b(\d{2}\/\d{2}\/\d{4})\b/;

/** "1,476.00" → 1476, "-1.00" → -1. Returns null for anything that is not money. */
export function money(text) {
  const m = String(text ?? '').replace(/[,\s₪]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(m)) return null;
  return Number(m);
}

/**
 * The customer's most recent receipts, newest first.
 *
 * ⚠️ **Every other filter box is cleared first, and that is the whole trick.**
 * The list's filters are cumulative: a leftover `#wFindDocNo` from an earlier
 * verification narrowed customer 112001 down to a single row on 03/09/2026,
 * which reads exactly like "this customer has no other receipts". A duplicate
 * check that can quietly return "all clear" because of a stale filter is worse
 * than no check at all.
 */
export async function recentForCustomer(ctx, profile, customer, { limit = 5 } = {}) {
  const frame = ctx.page.frames().find((f) => profile.frames.list.test(f.url().split('?')[0]));
  if (!frame) throw new Error(`${profile.label}: מסך הרשימה לא פתוח — אין איפה לבדוק כפילות.`);

  const L = profile.list;
  for (const sel of [L.findDocNo, L.findAmount, L.dateFrom, L.dateTo].filter(Boolean)) {
    await frame.locator(sel).fill('').catch(() => {});
  }
  await ctx.human.type(L.findCustomer, String(customer), { scope: frame, label: `סינון ללקוח ${customer}`, clear: true });
  await frame.locator(L.findCustomer).press('Enter').catch(() => {});
  await ctx.human.settle('filtered by customer');

  const raw = await frame.evaluate(() =>
    [...document.querySelectorAll('tr')]
      .map((tr) => [...tr.cells].map((c) => (c.innerText || '').trim()))
      .filter((cells) => cells.length > 3 && cells.some(Boolean)));

  // The first row is the header; the grid is already newest-first.
  return raw
    .filter((cells) => cells.some((c) => DATE.test(c)))
    .slice(0, limit)
    .map((cells) => ({
      cells,
      amounts: cells.map(money).filter((n) => n !== null),
      dates: cells.map((c) => c.match(DATE)?.[1]).filter(Boolean),
      text: cells.filter(Boolean).join(' · '),
    }));
}

/**
 * Compares a receipt about to be written against those rows.
 *
 * `dates` is every date the new receipt carries — document date and value date
 * both — because the grid holds several date columns and which one means what
 * differs between `a103` and `a146`. Matching any of them against any of the
 * row's is the comparison that survives both.
 */
export async function checkDuplicate(ctx, profile, { customer, amount, dates = [], limit = 5 } = {}) {
  const rows = await recentForCustomer(ctx, profile, customer, { limit });
  const value = money(amount);
  const wanted = dates.filter(Boolean).map(String);

  const hits = rows.map((r) => {
    const sameAmount = value !== null && r.amounts.includes(value);
    const sameDate = wanted.some((d) => r.dates.includes(d));
    // The amount alone decides. A same-day receipt for a different sum is
    // normal traffic; the same sum twice is what a double entry looks like.
    return { ...r, sameAmount, sameDate, level: sameAmount ? 'exact' : (sameDate ? 'partial' : null) };
  }).filter((r) => r.level);

  const exact = hits.filter((h) => h.level === 'exact');
  ctx.logger?.step?.('duplicate-check',
    rows.length === 0 ? `ללקוח ${customer} אין קבלות קודמות ברשימה הזאת`
      : `נבדקו ${rows.length} קבלות אחרונות · ${exact.length} חשודות · ${hits.length - exact.length} דומות חלקית`);

  return { rows, hits, exact, clean: hits.length === 0 };
}

/**
 * The refusal, when the customer already has a receipt for this amount.
 *
 * It stops and asks rather than deciding: a second transfer of the same sum is
 * perfectly possible, and only Dror knows whether the bank line he is looking
 * at is the one already recorded here. Approval arrives as
 * `allowDuplicate: true` on the next call.
 */
export function duplicateError(label, customer, exact) {
  return new Error(
    `${label}: ⚠️ ללקוח ${customer} כבר יש קבלה על אותו סכום — עוצר ולא רושם.\n` +
    exact.map((h) => `  • ${h.text}`).join('\n') + '\n' +
    '  אם זו העברה נוספת אמיתית ולא כפילות — לאשר, ואז להריץ שוב\n' +
    '  עם allowDuplicate: true. בלי אישור מפורש לא נוצרת שום קבלה.',
  );
}
