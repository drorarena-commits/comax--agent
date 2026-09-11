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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as engine from '../../engine.js';
import { ROOT } from '../../../config.js';
import { readTotals as readTotalsBlock, money, vatRegime } from '../../../document-totals.js';

/**
 * The price lists we have observed, with whether their prices carry VAT.
 * Read once at import: it is a small file and a missing entry only costs the
 * gate one of its three witnesses.
 */
const PRICE_LISTS = (() => {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, 'knowledge/lists.json'), 'utf8')).priceLists ?? [];
  } catch {
    return [];
  }
})();

export const profile = {
  name: 'invoice',
  label: 'חשבונית מס',
  shortcut: 'a157',
  doc: 'Doc650',
  path: 'Erp/Mehirot/Doc650/Inv_Mlay',

  /**
   * How Comax itself launches this program, and why the path is written down.
   *
   * `a157` was on the desktop on 02/09/2026 and **gone** by 04/09/2026 — the
   * same disappearance `a146` suffered a day earlier, when the desktop switched
   * to a category view. `openProgram` falls back to `top.S.runProgram(program)`
   * when the icon is not in the DOM, and `engine.openList` already forwards
   * `profile.program`; without this line every invoice flow dies on 30s of
   * "waiting for locator('#a157')" with nothing saying the icon is simply gone.
   *
   * Note the `.asp`, not `.aspx`: that is what `runProgram` takes, even though
   * the frame it produces is `Doc650V.aspx`.
   */
  program: 'Erp/Mehirot/Doc650/Inv_Mlay/Doc650V.asp',

  /**
   * The invoice reaches the envelope the long way, and this is the **only** way.
   *
   * Mapped 06/09/2026 by dumping every control on the print tab. It holds six
   * buttons and every one of them prints: `#PrintDoc`, `#PrintDocAll`,
   * `#PrintDocVet`, `#PrintDocN`, `#Madbekot`, `#PrintDegem`. There is no
   * `#Email` here — that button exists only on the quote.
   *
   * Dror confirmed the route: "הדפסת שיחזור" (`#PrintDocAll`), always, for this
   * document. It asks for a document range, then offers printer / mail / fax,
   * and mail opens the same `Erp/Divor_Doc.asp` envelope every document shares.
   *
   * ⛔ Do not reach for `#DoPrint`, whatever its name suggests. Its handler is
   * `top.Cs.doPrint_Email`, and generalising the quote's route to the invoice
   * fell back to it and broke sending entirely. Measured on a live run with a
   * row selected: it raises `confirm("האם ברצונך להדפיס?")` and then opens
   * nothing — no envelope, no chooser, not even a new frame — whether the
   * confirm is answered yes **or** no.
   */
  mail: {
    via: 'restore',
    button: '#PrintDocAll',
    range: { frame: /Doc650_ShihzurP\.asp$/i, from: '#DocM', to: '#DocA', ok: '#OK' },
    chooser: { frame: /PicOne\.asp$/i, email: 'img[title=\'דוא"ל\']' },
  },

  movesStock: true,
  discountColumn: 'הנחה %', // with the space — Doc652 has none
  hasItemFilter: false, // no #wPrt, unlike Doc652V and Doc612V

  /**
   * A tax invoice is always written on מחירון קבוצות — דרור's rule, 02/09/2026.
   *
   * Not a fallback for an empty field: it is forced even when the customer card
   * fills in something else. 429028 carries no price list at all (מחירון משויך
   * = 0), and a customer that prefills מכירה ראשי would put the lines on the
   * VAT-inclusive side of a document whose prices were agreed net.
   *
   * `lists.json` has this one as `vatIncluded: false`, which is what makes the
   * VAT gate below resolve instead of refusing.
   */
  forcePriceList: 'מחירון קבוצות',

  // `list` and `header` verified live (02/09/2026): Doc650V.aspx read off the
  // screen, then #newRec opened Doc650U.asp and its 57 elements were read too.
  // The line screens are still unmapped; until they are, the engine refuses to
  // drive them.
  mapped: { list: true, header: true, lines: true },

  frames: {
    list: /Doc650V\.aspx?/i,
    header: /Doc650U\.aspx?/i,
    linesGrid: /Doc650LinesV\.aspx?/i,
    lineForm: /Doc650LinesU\.aspx?/i,
    // Named exactly, not left to the engine's `/Close|Kbl|Ishur/i` fallback:
    // filing leaves a `Doc650CloseIo_sql.asp` frame behind, which that fallback
    // matches and would read as "the dialog never closed".
    closeDialog: /Doc650CloseU\.asp/i,
  },

  // Read off Doc650U.asp live. `#OK` is the green tick; `#OKNot` is the blue
  // "ללא הזמנות" beside it and `#OKRikuz` is "אישור + ריכוז" — three ways
  // to leave the header, all of which only advance to the lines.
  //
  // 💣 **ובחשבונית מס מאשרים ב-`#OKNot`, לא בירוק.** דרור, 11/09/2026, על
  // צילום של דיאלוג "הוספת // חשבונית" עם הכפתור מוקף: "זה הכפתור שלוחצים
  // עליו ולא על הירוק". עד אז הקוד לחץ `#OK` — **וזה עבד**, במובן שהמסמך
  // נפתח והשורות נטענו, ולכן שום הרצה לא התריעה. זו הסיבה ש-`commitWith`
  // יושב כאן ולא ב-engine: אין להסיק מכאן על `Doc470U` של תעודת ההעברה, שיש
  // בה `#OKNot` זהה ושלגביה דרור לא אמר דבר.
  //
  // `#DocNo` is an *input whose value is empty*: the number Comax assigned sits
  // in its label, `(6500084)`. Nothing writes it — the number is automatic.
  header: {
    new: '#newRec', ok: '#OK', okNoOrders: '#OKNot', commitWith: 'okNoOrders',
    cancel: '#Cancel', docId: '#DocNo',
    customer: '#IdxLk', store: '#Store', priceList: '#Mhr',
    date: '#DateDoc', agent: '#Sochen', details: '#Pratim',
  },

  line: {
    item: '#Prt', qty: '#Cmt', price: '#Mhr', discount: '#AczDis',
    remark: '#Remark', amount: '#Scm', ok: '#OK', okNew: '#OKNew',
  },

  totals: { beforeVat: '#ScmBeforeMaam', vat: '#Scm_Maam', total: '#Scm' },
  finalizeLabel: 'קליטת חשבונית',

  /**
   * At least one printed copy — the safe default for **any** customer.
   *
   * 0 is what a quote uses, and on Doc650 it was rejected outright: Comax shows
   * "חובת הדפסה לפחות עותק אחד !" in red and leaves the document unfiled, while
   * the click itself looks like it worked. Observed on 6500084, 02/09/2026, and
   * again on 6500088, 11/09/2026.
   *
   * ⚠️ **אבל זו אינה תכונה של חשבונית מס — היא תכונה של הלקוח.** דרור,
   * 11/09/2026: "אם ללקוח בכרטיס לקוח אין אימייל שמור — המערכת לא תיתן להפיק
   * 0 עותקים". כלומר 0 **מותר** ללקוח שנושא אימייל בכרטיס, כי אז המסמך נשלח
   * במייל במקום להידפס. שתי ההרצות שראינו היו על לקוחות בלי אימייל, והכלל
   * נרשם על סוג המסמך — הכללה שגויה מתוך מדגם מוטה.
   *
   * ⇒ 1 נשאר ברירת המחדל. לרדת ל-0 מותר **רק** אחרי קריאת כתובת האימייל
   * מכרטיס הלקוח, ולעולם לא בהנחה שהיא קיימת.
   *
   * Safe because `browser.js` neutralises `window.print` — the filing is already
   * committed by the time the print would fire.
   */
  printCopies: 1,
};

/**
 * The header input with the price list forced, whatever the caller asked for.
 *
 * `fillHeader` writes the customer first and the price list after, so this also
 * beats whatever the customer card prefilled — which is the point: the rule is
 * "change it to מחירון קבוצות even if Comax already put מכירה ראשי there".
 */
function forcedList(ctx, input) {
  if (!profile.forcePriceList) return input;
  if (input.priceList && input.priceList !== profile.forcePriceList) {
    ctx.logger.step('מחירון', `התבקש "${input.priceList}" — נדרס ל-"${profile.forcePriceList}" (כלל החשבונית).`);
  }
  return { ...input, priceList: profile.forcePriceList };
}

/**
 * Read the price list back off the committed header and refuse to go on if it
 * is not the one we forced.
 *
 * Typing into a Max2000 lookup is not the same as it accepting the value — the
 * field can silently keep what the customer card put there. Since this single
 * field decides whether every line is net or gross, it gets read back rather
 * than assumed.
 */
async function assertPriceList(ctx, frame, header) {
  if (!profile.forcePriceList) return;
  const got = (header?.מחירון ?? await frame.locator(profile.header.priceList).inputValue().catch(() => null) ?? '').trim();
  if (got.includes(profile.forcePriceList)) {
    ctx.logger.step('מחירון', `${got} ✓`);
    return;
  }
  throw new Error(
    `המחירון בכותרת הוא "${got || '(ריק)'}" ולא "${profile.forcePriceList}" — עוצר לפני אישור הכותרת.\n`
    + '  המחירון קובע אם השורות לפני מע"מ או כוללות אותו, וחשבונית על המחירון הלא נכון גובה 18% שגויים.\n'
    + '  היציאה הבטוחה: #Cancel בכותרת.',
  );
}

/**
 * Open a new invoice and fill its header. Stops before the header is committed
 * when `dryRun`, so the whole thing is testable without burning a number.
 */
export async function create(ctx, input) {
  const { logger, page, dryRun } = ctx;

  const listFrame = await engine.openList(ctx, profile);
  const { frame, preview } = await engine.startNew(ctx, profile, listFrame);
  const customer = await engine.fillHeader(ctx, profile, frame, forcedList(ctx, input));

  const header = await engine.readHeader(profile, frame);
  await assertPriceList(ctx, frame, header);
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

  // The middle witness MAP.md prescribes and the first version skipped: a price
  // list Comax names but does not annotate. "מחירון קבוצות" prints bare, with
  // no "(כולל מע''מ)" suffix, so the footer alone can never resolve it — and it
  // is the price list every tax invoice here uses.
  const catalogued = catalogueRegime(totals.priceList);

  /**
   * The line sum comes from the grid's own `ScmBeforeDis`, not from adding up
   * what the line dialog showed.
   *
   * `addLine` reads `#Scm` immediately after typing, and Comax has not
   * recalculated it yet — it still holds quantity × the *price list* price
   * (6 × 239.89 = 1,439.35) rather than the discounted 869.70. Summing those
   * gave 5,517.48 against a real document of 3,448.80 and made this gate refuse
   * a perfectly good invoice. The grid's figure is the one Comax itself uses.
   */
  const lineSum = totals.subtotal ?? null;
  const measured = lineSum != null
    ? vatRegime([{ total: lineSum }], totals)
    : lines?.length
      ? vatRegime(lines.map((l) => ({ total: l.amount })), totals)
      : { mode: 'unknown', source: 'no-lines', lineSum: 0 };

  const witnesses = [
    ['footer', declared],
    ['lists.json', catalogued],
    [measured.source, measured.mode === 'unknown' ? null : measured.mode],
  ].filter(([, v]) => v);

  const common = {
    priceList: totals.priceList,
    rate: totals.vatRate,
    lineSum: measured.lineSum,
    declared,
    catalogued,
    measured: measured.mode === 'unknown' ? null : measured.mode,
    witnesses: witnesses.map(([k]) => k),
  };

  if (!witnesses.length) return { ...common, mode: 'unknown', source: 'none' };
  const modes = new Set(witnesses.map(([, v]) => v));
  if (modes.size > 1) return { ...common, mode: 'conflict', source: witnesses.map(([k]) => k).join('+') };
  return { ...common, mode: witnesses[0][1], source: witnesses.map(([k]) => k).join('+') };
}

/** What `knowledge/lists.json` records about a price list, if anything. */
function catalogueRegime(name) {
  if (!name) return null;
  const entry = PRICE_LISTS.find((p) => p.name && String(name).includes(p.name));
  if (!entry || entry.vatIncluded == null) return null;
  return entry.vatIncluded ? 'included' : 'excluded';
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
