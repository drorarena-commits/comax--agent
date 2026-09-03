/**
 * "יש לו בכלל חשבוניות?"
 *
 * A second gate for the receipt agents, next to `duplicate-check.js` — not
 * about the receipt itself, but about the customer it is about to be written
 * against. Dror's rule (03/09/2026): before a103 or a146 opens a single
 * screen, the customer's code is checked against `Doc650V.aspx` (a157, tax
 * invoices). A receipt normally follows an invoice; a customer code with zero
 * invoices ever is the signature of picking the wrong one out of two similar
 * names — and there is no way to un-file a receipt against the wrong ledger.
 *
 * ⚠️ Deliberately not a status check. Dror was explicit: this does not care
 * whether an invoice is open or closed, and it never fails a customer who has
 * other invoices and is only paying part of one. It only refuses a customer
 * with **no invoice at all** — and even then only until a person says
 * `allowNoInvoice: true`.
 *
 * Reuses `recentForCustomer` from `duplicate-check.js` rather than writing a
 * second grid reader: it is already format-agnostic (scans for a date
 * pattern, not column headers), and already tolerates a profile missing some
 * of the filter fields it asks for.
 */
import { openProgram, closePrograms } from '../navigate.js';
import { recentForCustomer } from './duplicate-check.js';

/**
 * `Doc650V.aspx`'s own filters — read live and already driven by
 * `src/tasks/customer-history.js`. Not re-mapped here, just named so
 * `recentForCustomer` can operate them. The `invoice` agent's own profile
 * carries no `list` block (Doc650V has no item filter and nothing there has
 * needed one yet), so this stays a small local shape rather than reaching
 * into another document agent's module — no agent in this repo imports
 * another's, and this does not start.
 */
const INVOICE_LIST = {
  label: 'חשבונית מס',
  frames: { list: /Doc650V\.aspx?/i },
  list: {
    findCustomer: '#wFindLkNm',
    findDocNo: '#wFindDocNo',
    dateFrom: '#wFindDateM',
    dateTo: '#wFindDateA',
  },
  /**
   * ⚠️ `#a157` is not always on the desktop either — read live on 03/09/2026,
   * the same way `a146` was found to vanish: two runs back to back, icon found
   * the first time and gone the second. `openProgram` already knows how to
   * fall back to `top.S.runProgram` when a `program` path is given (built for
   * osh-receipt); this is that same fallback, not a new mechanism.
   */
  program: 'Erp/Mehirot/Doc650/Inv_Mlay/Doc650V.aspx',
};

/**
 * Does this customer have any tax invoice on record?
 *
 * Opens a157 fresh and closes every open program when done, so whichever
 * receipt screen the caller opens right after starts clean — the same reason
 * `customer-history.js` closes between its three programs rather than
 * stacking them.
 */
export async function checkInvoicePresence(ctx, customer, { limit = 3 } = {}) {
  await openProgram(ctx, 'a157', { expect: INVOICE_LIST.frames.list, program: INVOICE_LIST.program });
  const rows = await recentForCustomer(ctx, INVOICE_LIST, customer, { limit });
  await closePrograms(ctx).catch(() => {});
  ctx.logger?.step?.(
    'invoice-check',
    rows.length ? `ללקוח ${customer} יש חשבוניות (${rows.length}+)` : `ללקוח ${customer} אין אף חשבונית — עוצר`,
  );
  return { any: rows.length > 0, rows };
}

/**
 * The refusal. Stops and asks rather than deciding — same shape as
 * `duplicateError`: a genuinely new or first-time customer is real, and only a
 * person knows whether that is what is in front of them right now.
 */
export function noInvoiceError(label, customer) {
  return new Error(
    `${label}: ⚠️ ללקוח ${customer} אין אף חשבונית מס במערכת — עוצר ולא רושם.\n` +
      '  הגנה מפני בחירת לקוח לא נכון מתוך שני לקוחות בעלי שם דומה.\n' +
      '  אם זה הלקוח הנכון בכוונה — לאשר, ואז להריץ שוב עם allowNoInvoice: true.',
  );
}
