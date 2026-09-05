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
 * ⚠️ Scoped to one fiscal year, and that is a real hole. `Doc650V` shows the
 * session's current year only, so a customer whose invoices are all from a
 * previous year reads as "no invoices at all" and this gate blocks a
 * legitimate receipt. Left refusing rather than loosened — refusing is the
 * safe direction — but the year is now read, logged, and named in the refusal
 * so a person can tell the two cases apart. See the fiscal-year section in
 * `knowledge/MAP.md`.
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
 * Which fiscal year is this list actually showing?
 *
 * `Doc650V.aspx` is scoped to one fiscal year — its URL carries `CurrYear`,
 * and document numbering restarts every year. Measured 05/09/2026: invoice
 * 6500130 (24/12/2025) came back from the `a224` movements report while this
 * same list, filtered by that exact document number, returned zero rows. So a
 * customer whose invoices are all from a previous year looks identical to a
 * customer with no invoices at all — no error, no empty state, just 0.
 *
 * Read rather than assumed, and returned so both the caller and the refusal
 * can name the year they actually searched. Returns null when the URL does not
 * carry it — an unreadable year must not masquerade as a known one.
 */
function fiscalYear(frame) {
  return (/[?&]CurrYear=(\d{4})/i.exec(frame?.url?.() ?? '') ?? [])[1] ?? null;
}

/**
 * Does this customer have any tax invoice on record?
 *
 * Opens a157 fresh and closes every open program when done, so whichever
 * receipt screen the caller opens right after starts clean — the same reason
 * `customer-history.js` closes between its three programs rather than
 * stacking them.
 */
export async function checkInvoicePresence(ctx, customer, { limit = 3 } = {}) {
  const { frame } = await openProgram(ctx, 'a157', {
    expect: INVOICE_LIST.frames.list,
    program: INVOICE_LIST.program,
  });
  const year = fiscalYear(frame);
  const rows = await recentForCustomer(ctx, INVOICE_LIST, customer, { limit });
  await closePrograms(ctx).catch(() => {});
  const scope = year ? ` (שנת כספים ${year})` : '';
  ctx.logger?.step?.(
    'invoice-check',
    rows.length
      ? `ללקוח ${customer} יש חשבוניות (${rows.length}+)${scope}`
      : `ללקוח ${customer} אין אף חשבונית${scope} — עוצר`,
  );
  return { any: rows.length > 0, rows, year };
}

/**
 * The refusal. Stops and asks rather than deciding — same shape as
 * `duplicateError`: a genuinely new or first-time customer is real, and only a
 * person knows whether that is what is in front of them right now.
 */
export function noInvoiceError(label, customer, year = null) {
  const scope = year ? `בשנת כספים ${year}` : 'בשנת הכספים הפעילה';
  return new Error(
    `${label}: ⚠️ ללקוח ${customer} אין אף חשבונית מס ${scope} — עוצר ולא רושם.\n` +
      '  הגנה מפני בחירת לקוח לא נכון מתוך שני לקוחות בעלי שם דומה.\n' +
      '  ⚠️ הרשימה מציגה שנת כספים אחת בלבד. אם כל חשבוניותיו משנה קודמת הן לא נראות כאן,\n' +
      '     וזה נראה בדיוק כמו לקוח בלי אף חשבונית. לבדוק את השנה לפני שמסיקים.\n' +
      '  אם זה הלקוח הנכון בכוונה — לאשר, ואז להריץ שוב עם allowNoInvoice: true.',
  );
}
