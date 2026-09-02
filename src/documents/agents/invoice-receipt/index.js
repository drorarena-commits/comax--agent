/**
 * סוכן חשבונית מס/קבלה — Doc652 (`a132`).
 *
 * A tax invoice and a receipt in one document, which is exactly where it stops
 * behaving like its neighbours:
 *
 * - **The path lies.** It lives at `Erp/Mehirot/Doc650/InvKab_Mlay/Doc652V.asp`
 *   — under the *Doc650* folder. Matching a frame on "Doc650" catches this
 *   document too, so the prefix must be read from the URL with
 *   `/(Doc\d+)V\.asp/` rather than assumed (MAP.md).
 * - **`הנחה%` has no space**, unlike Doc650 and Doc612 which write `הנחה %`.
 *   Reading the grid by column label breaks on this exact character.
 * - **The list exposes `#wPrt`** — an item filter Doc650V does not have. Worth
 *   using: it finds "which invoice had this item" without opening documents.
 * - **It collects payment.** Filing asks for אמצעי תשלום, which the sales-only
 *   documents never do. That part of the screen is still unmapped, and it is
 *   why `lines` is marked false: the flow cannot be completed blind.
 */
import * as engine from '../../engine.js';

export const profile = {
  name: 'invoice-receipt',
  label: 'חשבונית מס/קבלה',
  shortcut: 'a132',
  doc: 'Doc652',
  path: 'Erp/Mehirot/Doc650/InvKab_Mlay', // deliberately under Doc650
  movesStock: true,
  discountColumn: 'הנחה%', // no space — the difference that breaks label lookups
  hasItemFilter: true, // #wPrt on the list

  // The list is known from customer-history, which reads these documents. The
  // header, the lines and the payment step have never been driven.
  mapped: { list: true, header: false, lines: false },

  frames: {
    list: /Doc652V\.aspx?/i,
    header: /Doc652U\.aspx?/i,
    linesGrid: /Doc652LinesV\.aspx?/i,
    lineForm: /Doc652LinesU\.aspx?/i,
  },

  header: {
    new: '#newRec', ok: '#OK', cancel: '#Cancel', docId: '#DocId',
    customer: '#IdxLk', store: '#Store', priceList: '#Mhr',
    date: '#DateDoc', agent: '#Sochen', details: '#Pratim',
  },

  line: {
    item: '#Prt', qty: '#Cmt', price: '#Mhr', discount: '#AczDis',
    remark: '#Remark', amount: '#Scm', ok: '#OK', okNew: '#OkNew',
  },

  totals: { beforeVat: '#ScmBeforeMaam', vat: '#Scm_Maam', total: '#Scm' },
  finalizeLabel: 'קליטת חשבונית',
};

export async function create(ctx, input) {
  const listFrame = await engine.openList(ctx, profile);
  const { frame, preview } = await engine.startNew(ctx, profile, listFrame); // throws: header not mapped
  const customer = await engine.fillHeader(ctx, profile, frame, input);
  return { preview, customer, header: await engine.readHeader(profile, frame), frame };
}

export async function addLines(ctx, items) {
  const out = [];
  for (const [i, item] of items.entries()) {
    out.push(await engine.addLine(ctx, profile, item, { index: i + 1, last: i === items.length - 1 }));
  }
  return out;
}

/**
 * Filing this document also takes payment, and that screen is not mapped.
 * Refusing here is the honest answer — a half-filed receipt is worse than none.
 */
export async function finalize() {
  throw new Error(
    'חשבונית מס/קבלה: שלב אמצעי התשלום לא מופה, ולכן אני לא קולט את המסמך.\n' +
    '  למפות: npm run open-program -- a132  ואז snapshot אחרי לחיצה על קליטה.',
  );
}

export const readTotals = (ctx) => engine.readTotals(ctx, profile);
export const backOut = (ctx) => engine.backOut(ctx, profile);
