/**
 * סוכן חשבונית מס — Doc650 (`a157`).
 *
 * The specialist for this one document. It leans on the shared engine for the
 * parts every document does the same way, and owns everything that is true
 * only of a tax invoice:
 *
 * - **Filing moves stock.** Unlike a quote, קליטת חשבונית commits inventory the
 *   moment it is pressed. There is no "unfile". So `finalize` here refuses to
 *   press until it can say, from evidence, which side of the VAT line the money
 *   on screen is standing on.
 * - **The list has no `#wPrt`.** `Doc652V` and `Doc612V` expose an item filter;
 *   `Doc650V` does not (verified against the live snapshot). Anything that wants
 *   to find an invoice by item has to filter by customer and read the lines.
 * - **Discount column is `הנחה %`, with a space** — `Doc652` writes `הנחה%`
 *   without one. Reading a grid by label has to use the exact string.
 * - **The path is `Doc650/Inv_Mlay/`**, while `Doc652` hides under
 *   `Doc650/InvKab_Mlay/`. Matching on "Doc650" alone catches both.
 */
import * as engine from '../../engine.js';
import { readTotals as readTotalsBlock, money, vatRegime } from '../../../document-totals.js';

export const profile = {
  name: 'invoice',
  label: 'חשבונית מס',
  shortcut: 'a157',
  doc: 'Doc650',
  path: 'Erp/Mehirot/Doc650/Inv_Mlay',
  movesStock: true,
  discountColumn: 'הנחה %', // with the space — Doc652 has none
  hasItemFilter: false, // no #wPrt, unlike Doc652V and Doc612V

  // Only `list` is verified so far: Doc650V.aspx was opened and its 126
  // elements read off it live (02/09/2026) — see AGENT.md for what is actually
  // on it. The header and line screens are next; until they are mapped the
  // engine refuses to drive them.
  mapped: { list: true, header: false, lines: false },

  frames: {
    list: /Doc650V\.aspx?/i,
    header: /Doc650U\.aspx?/i,
    linesGrid: /Doc650LinesV\.aspx?/i,
    lineForm: /Doc650LinesU\.aspx?/i,
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

/**
 * Open a new invoice and fill its header. Stops before the header is committed
 * when `dryRun`, so the whole thing is testable without burning a number.
 */
export async function create(ctx, input) {
  const { logger, page, dryRun } = ctx;

  const listFrame = await engine.openList(ctx, profile);
  const { frame, preview } = await engine.startNew(ctx, profile, listFrame);
  const customer = await engine.fillHeader(ctx, profile, frame, input);

  const header = await engine.readHeader(profile, frame);
  logger.save('header.json', header);
  await logger.shot(page, 'header-ready');

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני אישור הכותרת. החשבונית לא נוצרה.');
    // The frame is deliberately not returned: `run.js` JSON-stringifies whatever
    // a task hands back, and a Playwright Frame is circular — the dry run died
    // on serialising its own result instead of reporting it.
    return { dryRun: true, preview, customer, header };
  }

  await engine.commitHeader(ctx, profile, frame);
  const docNo = await engine.readDocNumber(ctx, profile);
  logger.step(profile.name, `חשבונית ${docNo ?? preview} נפתחה`);
  return { docNo: docNo ?? preview, preview, customer, header };
}

/** Add every line in one pass; `#OkNew` reopens the dialog between them. */
export async function addLines(ctx, items) {
  const out = [];
  for (const [i, item] of items.entries()) {
    out.push(await engine.addLine(ctx, profile, item, { index: i + 1, last: i === items.length - 1 }));
  }
  return out;
}

/**
 * Which side of the VAT line the line amounts are on, from two independent
 * witnesses — and a refusal when they are missing or disagree.
 *
 * The regime follows the **price list, not the document type** (MAP.md): on
 * מחירון קבוצות the lines are net and Comax adds VAT at the total; on מכירה
 * ראשי the line amount is already gross and the document total equals the plain
 * sum of the lines. Getting this backwards is not a rounding error — it is the
 * whole 18%, and it already happened once on a quote that looked perfectly fine
 * (6120045, undercharged by 15%).
 *
 *   1. **What Comax says.** The footer names the price list and, when it
 *      includes VAT, says so. This is the better witness, because it is right
 *      for a price list nobody has catalogued yet.
 *   2. **What the numbers say.** `vatRegime()` checks which of `ScmBeforeMaam`
 *      and `Scm` the sum of the lines actually lands on.
 *
 * Agreement is the pass. One witness alone is accepted and labelled with which
 * one it was. Silence from both, or a conflict between them, is a refusal —
 * never a default.
 */
function resolveVatRegime(lines, totals) {
  const declared = totals.vatIncludedLabel == null ? null
    : totals.vatIncludedLabel ? 'included' : 'excluded';

  const measured = lines?.length
    ? vatRegime(lines.map((l) => ({ total: l.amount })), totals)
    : { mode: 'unknown', source: 'no-lines', lineSum: 0 };

  const common = {
    priceList: totals.priceList,
    rate: totals.vatRate,
    lineSum: measured.lineSum,
    declared,
    measured: measured.mode === 'unknown' ? null : measured.mode,
  };

  if (declared && measured.mode !== 'unknown') {
    return declared === measured.mode
      ? { ...common, mode: declared, source: 'both' }
      : { ...common, mode: 'conflict', source: 'both' };
  }
  if (declared) return { ...common, mode: declared, source: 'footer' };
  if (measured.mode !== 'unknown') return { ...common, mode: measured.mode, source: measured.source };
  return { ...common, mode: 'unknown', source: 'none' };
}

/** What the money means, in one line, for the log and for the human. */
const describeRegime = (r) => {
  const witness = r.source === 'both' ? 'הצהרה + חשבון'
    : r.source === 'footer' ? 'הצהרת המחירון'
      : 'חשבון הסכומים';
  return `${r.priceList ?? '(מחירון לא נקרא)'} · שורות ${r.mode === 'included' ? 'כוללות' : 'לפני'} מע"מ`
    + `${r.rate != null ? ` ${r.rate}%` : ''} · לפי ${witness}`;
};

/**
 * קליטת חשבונית — irreversible, and it moves stock.
 *
 * Overridden rather than inherited: the shared `finalize` is fine for a quote,
 * which commits nothing but itself. An invoice gets three gates instead, all
 * read fresh off the screen immediately before the click:
 *
 *   1. the total must be readable — an invoice whose total nobody can read is
 *      an invoice nobody has verified;
 *   2. the VAT regime must be *known*, not assumed;
 *   3. the two witnesses to it must not contradict each other.
 */
export async function finalize(ctx, { confirm = false, lines = [] } = {}) {
  const { logger, page } = ctx;

  const grid = engine.linesFrame(ctx, profile);
  if (!grid) throw new Error(`${profile.label}: מסך השורות לא פתוח — אין מה לקלוט.`);

  const totals = await readTotalsBlock(grid);
  const regime = resolveVatRegime(lines, totals);

  logger.save('totals-before-filing.json', { totals, regime });
  await logger.shot(page, 'before-filing');

  if (totals.total == null) {
    throw new Error('לא הצלחתי לקרוא את סכום החשבונית — לא קולט מסמך שלא אומת.');
  }

  if (regime.mode === 'conflict') {
    throw new Error(
      'סתירה במשטר המע"מ — לא קולט חשבונית שאני לא בטוח בכסף שלה.\n'
      + `  המחירון "${regime.priceList ?? '?'}" מצהיר: שורות ${regime.declared === 'included' ? 'כוללות' : 'לפני'} מע"מ.\n`
      + `  הסכומים אומרים ההפך: סכום השורות ${regime.lineSum} מול לפני מע"מ ${totals.beforeVat} / סה"כ ${totals.total}.\n`
      + '  לבדוק ידנית איזו שורה חורגת לפני שקולטים. היציאה הבטוחה: #DoExit ואז #Cancel.',
    );
  }

  if (regime.mode === 'unknown') {
    throw new Error(
      'לא ידוע אם השורות לפני מע"מ או כוללות אותו — לא קולט חשבונית שמזיזה מלאי על ניחוש.\n'
      + `  הפוטר לא הצהיר על משטר המחירון${totals.priceList ? ` (נקרא "${totals.priceList}", בלי סיומת מע"מ)` : ''},\n`
      + `  וסכום השורות ${regime.lineSum || '(אין שורות)'} לא נפל על לפני מע"מ ${totals.beforeVat ?? '?'} ולא על סה"כ ${totals.total}.\n`
      + '  היציאה הבטוחה: #DoExit ואז #Cancel.',
    );
  }

  logger.step('מע"מ', describeRegime(regime));

  // On a VAT-exclusive price list the total is the line sum plus VAT; on an
  // inclusive one they are the same number. Either way the total must not sit
  // *below* the lines — that shape means a document-level discount nobody asked
  // for, and it is worth seeing before the stock moves, not after.
  const lineSum = money(regime.lineSum);
  if (lineSum && totals.total < lineSum * 0.995) {
    logger.step('אזהרה', `סה"כ המסמך ${totals.total} נמוך מסכום השורות ${lineSum} — הנחת מסמך?`);
  }

  if (!confirm) {
    logger.step('dryrun', `עוצר לפני קליטה. סה"כ ${totals.total}. להרצה אמיתית: --confirm`);
    return { filed: false, totals, vat: regime };
  }

  await engine.finalize(ctx, profile);
  return { filed: true, totals, vat: regime };
}

export const readTotals = (ctx) => engine.readTotals(ctx, profile);
export const backOut = (ctx) => engine.backOut(ctx, profile);
