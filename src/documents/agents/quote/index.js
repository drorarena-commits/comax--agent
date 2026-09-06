/**
 * סוכן הצעת מחיר — Doc612 (`a164`).
 *
 * The only document that is fully mapped and proven end to end (01/09/2026),
 * and the one the engine was extracted from. Its specialities:
 *
 * - **Nothing moves.** A quote touches no stock and no ledger, which is why it
 *   is the safe document to rehearse a flow on before running it as an invoice.
 * - **An unissued draft is re-adopted.** Running `create` again for the same
 *   customer returns to the existing open quote and rewrites its header instead
 *   of starting a fresh one (MAP.md). So `finalize` before starting another.
 * - **Wholesale pricing has two spellings of the same money.** When the price
 *   list already includes VAT the target is reached by discount; when it does
 *   not, by entering the net price with zero discount. The document declares
 *   which it is in its own footer — and this agent refuses to guess.
 * - **Printing must be suppressed.** Any copies value other than 0 makes Comax
 *   call `window.print()`, whose dialog blocks CDP so completely that only a
 *   human can clear it. `quote-finalize` sets 0 and renders the PDF itself.
 */
import * as engine from '../../engine.js';

export const profile = {
  name: 'quote',
  label: 'הצעת מחיר',
  shortcut: 'a164',
  doc: 'Doc612',
  path: 'Erp/Mehirot/Doc612/AzaaMhr',

  /**
   * The program's own path, so `openProgram` can hand it to `top.S.runProgram`
   * instead of raising the desktop and hunting for the a164 icon. Measured
   * 06/09/2026: the desktop route cost 40.8s in `quote-new` and 22.3s again in
   * `quote-email`, on a run that took 457s end to end.
   *
   * This is an addition, not a replacement for `path` above: `path` is the
   * folder and is documentation only — nothing in the code reads it — while
   * `program` is the file, and it is the only thing that selects the fast route.
   *
   * Note the `.asp`, not `.aspx`, exactly as in the invoice profile: that is
   * what `runProgram` takes, even though the frame it produces is `Doc612V.asp`.
   *
   * ⚠️ `?SwVO=0&SwLk=1` is load-bearing — do not "clean up" the query string.
   * `runProgram` does NOT reproduce the parameters the desktop icon passes, and
   * the difference does not show up when the program opens. It shows up later:
   * without `SwLk=1` the screen opens fine, the header dialog opens fine, and
   * then the customer field `#IdxLk` stays *hidden* — present in the DOM,
   * never visible — so filling it times out after 30s with no hint of why.
   * Measured 06/09/2026: reproduced twice on a clean desktop, fixed on the
   * first run after adding the parameter.
   *
   * `Lk` is Comax's abbreviation for customer throughout (`IdxLk`, `LkKod`,
   * `Idx_Lk`), so `SwLk=1` reads as "this screen has a customer field".
   * The desktop icon also passes `MCGLOBAL=879`, deliberately left out: it
   * looks like a menu-instance id, it was not needed, and guessing at it
   * would be exactly the kind of inference that rule 9 forbids.
   */
  program: 'Erp/Mehirot/Doc612/AzaaMhr/Doc612V.asp?SwVO=0&SwLk=1',

  movesStock: false,
  discountColumn: 'הנחה %',
  printView: '/Max2000/Erp/Mehirot/Doc612/AzaaMhr/Doc612_HtmlP_T13.asp',

  // Proven in a live run, not inferred.
  mapped: { list: true, header: true, lines: true },

  frames: {
    list: /Doc612V\.aspx?/i,
    header: /Doc612U\.aspx?/i,
    linesGrid: /Doc612LinesV\.aspx?/i,
    lineForm: /Doc612LinesU\.aspx?/i,
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
  finalizeLabel: 'קליטת הצעה',
};

export async function create(ctx, input) {
  const { logger, page, dryRun } = ctx;

  const listFrame = await engine.openList(ctx, profile);
  const { frame, preview } = await engine.startNew(ctx, profile, listFrame);
  const customer = await engine.fillHeader(ctx, profile, frame, input);

  const header = await engine.readHeader(profile, frame);
  logger.save('header.json', header);
  await logger.shot(page, 'header-ready');

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני אישור הכותרת. ההצעה לא נוצרה.');
    return { dryRun: true, preview, customer, header, frame };
  }

  await engine.commitHeader(ctx, profile, frame);
  const docNo = await engine.readDocNumber(ctx, profile);
  logger.step(profile.name, `הצעה ${docNo ?? preview} נפתחה`);
  return { docNo: docNo ?? preview, preview, customer, header };
}

export async function addLines(ctx, items) {
  const out = [];
  for (const [i, item] of items.entries()) {
    out.push(await engine.addLine(ctx, profile, item, { index: i + 1, last: i === items.length - 1 }));
  }
  return out;
}

/**
 * קליטת הצעה. Reversible in practice — a quote commits nothing but itself —
 * so this one keeps the engine's behaviour rather than adding an extra gate.
 * The PDF is produced by `src/tasks/quote-finalize.js`, which owns the print
 * suppression and the Doc612_HtmlP_T13 render.
 */
export async function finalize(ctx, { confirm = false } = {}) {
  const totals = await engine.readTotals(ctx, profile);
  if (!confirm) {
    ctx.logger.step('dryrun', `עוצר לפני קליטת ההצעה. סה"כ ${totals.total ?? '?'}`);
    return { filed: false, totals };
  }
  await engine.finalize(ctx, profile);
  return { filed: true, totals };
}

export const readTotals = (ctx) => engine.readTotals(ctx, profile);
export const backOut = (ctx) => engine.backOut(ctx, profile);
