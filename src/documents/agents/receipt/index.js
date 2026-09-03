/**
 * סוכן קבלה — `a103`.
 *
 * The fifth document, and the one that breaks the mould in four separate ways.
 * All four were read off the live screens on 03/09/2026, and none of them could
 * have been inferred from a neighbour:
 *
 * - **It has no Doc number, and it is not under `Erp/Mehirot`.** The list is
 *   `Kupa/Kab/Kab/KabalaV.asp` and the header is `Kupa/Kab/KabAsh/KabalaNU.asp`
 *   — different folder, different name, no digits anywhere. The
 *   `/Doc\d+V\.aspx?/i` pattern that the other four agents share would have
 *   matched nothing, and the agent would have reported "the list did not open"
 *   about a screen that opened perfectly.
 * - **No items, ever.** The other four end at `<Doc>LinesU` with `#Prt` in it.
 *   Here the list has no `#wPrt`, the grid has no item column, and the list
 *   carries `#ShiuhHesh` — "שיוך לחשבוניות". A receipt is allocated against open
 *   invoices; it does not carry goods. So `engine.addLine`, which types an item
 *   code into `#Prt`, is the wrong tool here *even after* the mapping is
 *   finished, and `addLines` refuses on that ground rather than on the mapping.
 * - **There is no separate lines screen.** The payment lives on the header
 *   itself: a `סוג תשלום` radio, then a cash / cheque / credit block, with
 *   `#goLines` (פרוט שיקים) and `#goAshrai` (פרוט אשראי) as sub-screens. Which
 *   means the header's own `#OK` is very probably the commit — the exact
 *   inverse of the rule that holds for the other four, where a header `#OK`
 *   only advances. Not yet proven, and treated as committing until it is.
 * - **⚠️ The header holds live card data.** `#AshraiNum` is a credit card
 *   number and `#CvvKab` is a CVV field (`type=password`). This agent must
 *   never type into either. See `NEVER_FILL`.
 *
 * `mapped.header` stays `false`: the screen was *read* in UPDATE mode on an
 * existing receipt, never *driven*, and never seen in ADD mode at all.
 */

/**
 * Fields this agent is not allowed to fill, ever — not with `--confirm`, not
 * with an explicit instruction, not "just for a test".
 *
 * Card number, expiry, CVV and the approval code are payment credentials. A
 * browser agent typing them is exactly the thing that must stay a human action,
 * and the fact that Comax will happily accept them from a script is the reason
 * to write the rule down rather than rely on it never coming up.
 */
export const NEVER_FILL = ['#AshraiNum', '#AshraiToDate', '#CvvKab', '#IshurAshrai'];

export const profile = {
  name: 'receipt',
  label: 'קבלה',
  shortcut: 'a103', // knowledge/desktop-shortcuts.json — קבלות. NOT a146 (קבלות לעו"ש)
  doc: null, // there is no Doc number — see `paths`
  paths: {
    list: 'Kupa/Kab/Kab', // KabalaV.asp
    header: 'Kupa/Kab/KabAsh', // KabalaNU.asp — a different folder from the list
  },
  movesStock: false, // moves money — which is irreversible in its own way
  collectsPayment: true, // the only other agent with this is invoice-receipt

  // Two numbering series, and the split is now confirmed: receipt 6800005 was
  // filed by hand on 03/09/2026 and got a `68000xx` number, while every row the
  // list shows by default is `70100xx` — those come from the till (7010013's
  // פרטים read "קבלה מקופה").
  //
  // ⚠️ **A hand-filed receipt is not in the default list view.** 6800005 was
  // filed and verified and still did not appear in the grid until `#wFindDocNo`
  // filtered for it. "Not in the list" is therefore NOT evidence that filing
  // failed — the filter is what proves it, and `verify` below uses it.
  series: { fromTill: '70100xx', filedByHand: '68000xx' },

  // The print view, lifted from the frame Comax opened on filing.
  printView: 'Kupa/Kab/Kab/Kabala_HtmlP.asp', // ?Doc=<מספר>&PrintCopies=<n>

  // Proven end to end on 03/09/2026: receipt **6800005** — לקוח 112001, מזומן,
  // ₪1 — was filled, filed, allocated against an open invoice, and verified in
  // the list. Dror drove every click; this agent photographed every screen.
  //
  // `lines` stays false and always will — this document has no lines screen.
  mapped: { list: true, header: true, lines: false },

  frames: {
    // `KabalaV`, with no digits. ⚠️ Doc652's payment screens are called
    // `Kabala652_LinesNV.asp` — a loose /Kabala/ match would catch those too.
    list: /KabalaV\.aspx?/i,
    header: /KabalaNU\.aspx?/i,

    // The filing dialog. The engine's default `/Close|Kbl|Ishur/i` happens to
    // match `KabalaCloseNU` on the word "Close", but it is declared explicitly
    // anyway: relying on the default is what let Doc652 report a document
    // "נקלט" that was not (`Kbl` is not `Kabala`).
    closeDialog: /KabalaCloseNU\.aspx?/i,

    // Filing opens these by itself. The invoice one is the one that matters;
    // the orders one appears ONLY for a customer who has open orders.
    allocateInvoices: /ShiuhIdx(V|_Fr)\.aspx?/i,
    allocateOrders: /ShiuhAzm(V|_Fr)\.aspx?/i,

    // There is no items grid on this document. `#goLines` / `#goAshrai` open the
    // cheque and credit detail screens; neither has been opened.
    linesGrid: null,
    lineForm: null,
  },

  /** `KabalaV.asp` — read live 03/09/2026. */
  list: {
    new: '#newRec', edit: '#editRec', del: '#delRec', copy: '#doCopy',
    // The button that proves the shape of this document.
    allocateToInvoices: '#ShiuhHesh', // שיוך לחשבוניות
    findDeposits: '#AfKadot', // איתור הפקדות — the thread to a146
    movements: '#PirutHtnu', // פרוט תנועות
    sourceDoc: '#doMakorDoc', // מסמך מקור
    signDoc: '#PDF_DOC', // חתימת מסמך
    // Note what is absent: no item filter. `Doc652V` has `#wPrt`; this has
    // nothing like it, because there are no items.
    findCustomer: '#wFindLkNm', findDocNo: '#wFindDocNo', findAmount: '#FindScm',
    dateFrom: '#DateM', dateTo: '#DateA', find: '#Find',
    exit: '#DoExit',
  },

  /** Grid columns, right to left as Comax paints them. */
  columns: ['קבלה', 'תאריך', 'לקוח', 'שם לקוח', 'אסמכתא', 'סכום', 'הופקד'],

  /**
   * `KabalaNU.asp` — read in BOTH modes on 03/09/2026 and backed out of both:
   * UPDATE on 7010013, and ADD (title "הוספת // קבלה", orange; UPDATE is green).
   * Same URL for both; `DocMode` in the query string is what differs.
   *
   * Deliberately NOT named `header` like the other agents: this screen is the
   * whole document, not a step before the lines, so a caller that treats it like
   * `Doc650U` will press `#OK` expecting to advance and file instead.
   */
  headerScreen: {
    // ⚠️ `#DocNo`, not `#DocId` — the opposite of Doc652. In ADD the field is
    // EMPTY and its label carries the next number in parentheses, e.g.
    // "(6800005)". The `DocNo=` in the query string is the row that was
    // selected on the list, NOT the number this document will get — reading it
    // from the URL gives the wrong receipt.
    docNo: '#DocNo',
    date: '#DateDoc', time: '#DocTime',
    customer: '#IdxLk',
    details: '#Pratim', // "קבלה מקופה" on 7010013
    ref: '#Ref', refDate: '#DateIt', // אסמכתא
    collectingAgent: '#SochenGevya', agent: '#Sochen',
    withholding: '#Nikui', withholdingPct: '#wAczNikui', // ניכוי במקור
    currency: '#Mt', rate: '#tShaar', currencyDate: '#DateMt',
    costCode: '#Svg', costCode2: '#Svg2', // קוד תמחירי 1 / 2

    // סוג תשלום — three radios named `Sug`, `Sug_onclick(0|1|2)`.
    //
    // The mapping is proven, not guessed. In UPDATE mode Comax disables the
    // radios that are *not* selected, so on 7010013 — a receipt paid by credit
    // card — values 0 and 1 came back `disabled: true` and value 2 did not.
    // The screenshot agrees: כרטיס אשראי is the filled one.
    // ⚠️ The label text is NOT clickable — there is no `<label for>` tying it to
    // the input. `getByLabel` and clicking the word both miss; the radio itself
    // has to be the target.
    paymentTypeRadios: 'input[name="Sug"]',
    paymentTypes: { מזומן: '0', שיקים: '1', אשראי: '2' },

    // ⚠️ In ADD the default is **2 — כרטיס אשראי**, with the credit block live.
    // Same trap as Doc652, whose `#numScr` defaults to אשראי: whoever files
    // without touching this field charges a card.
    paymentTypeDefault: '2',

    // Cash. The whole credit block — `#ScmAshrai`, `#AshraiNum`, `#CvvKab`,
    // `#IshurAshrai`, `#AshraiType`, `#IskaType` — LEAVES THE PAGE when `Sug`
    // is 0, and `#Mezuman` takes its place. So a cash receipt has no card
    // fields on screen at all, and `NEVER_FILL` has nothing to guard.
    cashAmount: '#Mezuman',

    // Credit block. Amounts and instalments are safe to read; the four in
    // NEVER_FILL must not be written by this agent under any circumstances.
    cardIssuer: '#AshraiType', dealType: '#IskaType',
    cardAmount: '#ScmAshrai',
    // These three exist only once a credit deal is on the document: they were
    // present in UPDATE on 7010013 and absent from the blank ADD form. Their
    // absence is the form being empty, not a failed read.
    instalments: '#TashNum', firstInstalment: '#ScmTash1', otherInstalments: '#ScmTash',

    // ADD-only, and none of them were in UPDATE.
    dateCalendar: '#CdrDateDoc',
    newCustomer: '#LkNew', // opens a customer card
    hasum: '#SwHasum', // checkbox by the customer row — purpose unknown
    // ⚠️ `#chg` is NOT a picker. MAP.md, correction #1: on Comax forms it
    // switches the *customer type*. The real pickers are `#CcomboBut<field>` —
    // `#CcomboButIdxLk`, `#CcomboButAshraiType`, `#CcomboButIskaType`,
    // `#CcomboButSochen`, `#CcomboButSochenGevya`, `#CcomboButSvg`,
    // `#CcomboButSvg2`, `#CcomboButMt`.
    pickerPrefix: '#CcomboBut',

    kupa: '#getKupa', // חשבון קופה
    creditDetail: '#goAshrai', // פרוט אשראי
    chequeDetail: '#goLines', // פרוט שיקים
    sign: '#getSign', remarks: '#getRemarks',

    // ⚠️ CONFIRMED: `#OK` here does NOT advance — it opens the filing dialog.
    // There are no lines to advance to. Exact inverse of rule 4 in CLAUDE.md.
    ok: '#OK', cancel: '#Cancel', exit: '#DoExit',
  },

  /**
   * `KabalaCloseNU.asp` — the filing dialog, read live 03/09/2026.
   *
   * Four different confirm buttons, and only the first is wanted. `#OKAfk`
   * files **and deposits to the bank**, which is a second irreversible act on
   * top of filing and is the thread to `a146`.
   */
  closeDialog: {
    ok: '#OK', // אישור — the only one this agent may press
    okNew: '#OKNew', // אישור+חדש — files and opens another receipt
    okCopy: '#OKCopy', // אישור+שיכפול
    okDeposit: '#OKAfk', // 🚫 אישור+הפקדה — files AND deposits. Never.
    cancel: '#Cancel', exit: '#DoExit',
    copies: '#PrintCopies',
  },
  // Observed default on this dialog. NOT 0 like Doc470, and not the "must be
  // at least 1" of Doc650 — it simply arrives as 1. Printing is neutralised in
  // browser.js, so 1 files and loses only the paper.
  printCopies: '1',
  finalizeLabel: 'קליטת קבלה',

  /**
   * `Kupa/ShiuhIdx/` — allocation against open invoices. Comax opens it BY
   * ITSELF the moment the receipt is filed, already holding the receipt's
   * number, and it pre-fills the first matching invoice with the full amount.
   *
   * `Kupa/ShiuhAzm/` (orders) opens alongside it **only for a customer who has
   * open orders**, and sits on top. It is closed and ignored.
   *
   * ⚠️ Dror's rule: the agent must ASK — "האם לסגור חשבונית מספר X מתאריך Y" —
   * and wait for a yes, unless he said up front that allocation is expected.
   * Comax's pre-fill is a suggestion, not an instruction.
   */
  allocation: {
    shell: /ShiuhIdxV\.aspx?/i, // the buttons and the balance block
    grid: /ShiuhIdx_Fr\.aspx?/i, // one row per open invoice

    // `#I0`, `#I1` … the **שיוך** column: what this receipt pays against that
    // document. The right-hand **יתרה לשיוך** column holds the invoice's own
    // open balance.
    rows: 'input[id^="I"]',

    // ⚠️ You do not type into the שיוך box. **Click the amount itself in the
    // יתרה לשיוך column** and it jumps across into שיוך (Dror, 03/09/2026).
    // Typing works too, but clicking is the route Comax expects and the one
    // that fills the exact remaining balance.

    // The completeness check, read off the shell: סכום קבלה / שויך / יתרה
    // לשיוך. Fully allocated means **יתרה לשיוך = 0.00** — worth reading rather
    // than trusting the rows to add up.
    totals: { receipt: 'סכום קבלה', allocated: 'שוייך', left: 'יתרה לשיוך' },

    ok: '#OK', cancel: '#Cancel',
    zero: '#ZeroSh', // איפוס שיוך — leaves the receipt as an unallocated credit
    balance: '#Izun', // ביצוע איזון — untested across all rows. Do not press.
  },

  /**
   * ⚠️ A closed allocation screen is never a lost cause.
   *
   * On the receipts list: filter to the receipt, select its row, and press
   * **"לחשבוניות"** (`#ShiuhHesh`). The same screen opens on the existing
   * document, showing what is already allocated. Proven on 6800007.
   *
   * It is also the read-only way to answer "was this receipt allocated?" — the
   * list grid does not carry that column.
   */
  allocateLater: '#ShiuhHesh',

  // This document has no lines screen at all, which is different from having one
  // that is not mapped yet. The registry reads it so the agent listing stops
  // reporting "חסר מיפוי: lines" about a screen that does not exist.
  hasLines: false,

  /**
   * The flow has now been driven by code — `tools/_smoke/receipt-drive.mjs`
   * filed **6800007** on 03/09/2026 using these very selectors, allocated it,
   * and verified it through `#wFindDocNo`. So the profile below is proven, not
   * observed.
   *
   * `driven` still says false because it is about THIS module's own API:
   * `create` and `finalize` are still the refusals further down, and the working
   * flow lives in the smoke tool. Wiring the two together is the remaining work,
   * and until it is done "the agent can file a receipt" would be a false claim.
   */
  driven: false,
  drivenBy: 'tools/_smoke/receipt-drive.mjs', // filed 6800005 (by hand) and 6800007 (by code)

  header: null, // the engine's header contract does not fit — see headerScreen
  line: null,
  totals: null,
};

/**
 * The order the header must be filled in, and the reason it is not obvious.
 *
 * **Choosing the customer resets `Sug` back to its default — credit card.**
 * Found the hard way on 6800005: מזומן was selected, then the customer, and the
 * cash block silently became the credit block again. So the customer goes first,
 * the payment type second, and the amount last — an amount typed before the
 * customer is wiped along with the block that held it.
 */
export const FILL_ORDER = ['customer', 'paymentType', 'amount', 'details'];

/** What has still never been driven, phrased for a person. */
const notDriven = (what) => new Error(
  `קבלה: ${what}\n` +
  '  הזרימה הוכחה חי ב-03/09/2026 על קבלה 6800005 (לקוח 112001, מזומן, ₪1),\n' +
  '  אבל דרור הקליק אותה ידנית — הסוכן צילם. הקוד כאן נכתב מהתצפית הזאת\n' +
  '  ומעולם לא הריץ קבלה בעצמו.\n' +
  '  מה שעדיין לא נראה: שיקים (#goLines) · אשראי (#goAshrai) · קופה (#getKupa).\n' +
  '  הפרטים: src/documents/agents/receipt/AGENT.md',
);

/**
 * Refuses — and the reason changed.
 *
 * It is no longer "I have not seen the screen": the whole flow is mapped, down
 * to the filing dialog and the allocation screen. What is missing now is that
 * **this code has never driven it.** Every click on 6800005 was Dror's, and a
 * receipt filed by untried code against a live ledger is not a rehearsal.
 *
 * The next real receipt is what turns this on, and it should be driven with a
 * human watching each step — the same way 6800005 was.
 */
export async function create() {
  throw notDriven('אני לא פותח קבלה — הקוד הזה מעולם לא הריץ אחת בעצמו.');
}

/**
 * Refuses — for a reason that will outlive the mapping.
 *
 * Confirmed on screen 03/09/2026: the list has `#ShiuhHesh` ("שיוך לחשבוניות"),
 * no `#wPrt`, and no item column. A receipt is allocated against open invoices;
 * it does not carry goods. Handing this `items` means the caller thinks it is a
 * sales document, and "not mapped yet" would hide that.
 */
export async function addLines(_ctx, lines = []) {
  throw new Error(
    'קבלה: אין לה שורות פריטים.\n' +
    `  קיבלתי ${lines.length} פריטים — זה הקלט של מסמך מכירה, לא של קבלה.\n` +
    '  מאומת על המסך: ברשימה יש #ShiuhHesh ("שיוך לחשבוניות"), אין #wPrt,\n' +
    '  ואין עמודת פריט. התשלום יושב על הכותרת עצמה, לא במסך שורות.\n' +
    '  הצורה המיועדת: { payments: [...], invoices: [...] } — עוד לא מומשה.\n' +
    '  למכירה עם פריטים: חשבונית מס (comax-invoice) או חשבונית מס/קבלה.',
  );
}

/**
 * Refuses separately from `create`, on purpose.
 *
 * Two independent gates is the pattern `invoice-receipt` established: softening
 * one must not be enough to file a document. It matters more here than anywhere
 * else in the set, because filing this document sets off a chain by itself —
 * the filing dialog, then the allocation screen, then an invoice closing in the
 * customer's ledger. Three irreversible steps behind one button.
 */
export async function finalize() {
  throw notDriven('אני לא קולט קבלה — קליטה פותחת מסך שיוך וסוגרת חשבונית, ואין לזה ביטול.');
}

/**
 * Whether a receipt really exists, by number.
 *
 * ⚠️ Reading the grid is not enough. A hand-filed receipt is in the `68000xx`
 * series and **does not show in the default list view at all** — 6800005 was
 * filed, allocated and verified while the grid still showed only `70100xx`. The
 * `#wFindDocNo` filter is what proves it, and calling a receipt missing on the
 * strength of the unfiltered grid is a false negative waiting to happen.
 */
export async function verify(ctx, docNo) {
  const list = ctx.page.frames().find((f) => profile.frames.list.test(f.url().split('?')[0]));
  if (!list) throw new Error('קבלה: מסך הרשימה לא פתוח — אין איפה לאמת.');

  await ctx.human.type(profile.list.findDocNo, String(docNo), { scope: list, label: `סינון לקבלה ${docNo}` });
  await list.locator(profile.list.findDocNo).press('Enter').catch(() => {});
  await ctx.human.settle('filtered');

  const body = await list.innerText('body').catch(() => '');
  const row = body.split('\n').map((l) => l.trim()).find((l) => l.includes(String(docNo)));
  ctx.logger.step('receipt', row ? `אומת: ${row}` : `לא נמצאה קבלה ${docNo}`);
  return { found: !!row, row: row ?? null };
}

/** No totals block on this document — the amount is a header field. */
export const readTotals = async () => ({});

/**
 * Leave the header without filing. `#Cancel` on `KabalaNU.asp` — proven on
 * 7010013 (03/09/2026): the frame went away and nothing was written.
 *
 * Never `#OK`. `#DoExit` exists too but is not the exit that was tested here.
 */
export async function backOut(ctx) {
  const frame = ctx?.page?.frames?.().find((f) => profile.frames.header.test(f.url().split('?')[0]));
  if (!frame) {
    ctx?.logger?.step?.('receipt', 'אין כותרת פתוחה — אין ממה לצאת.');
    return;
  }
  await ctx.human.click(profile.headerScreen.cancel, { scope: frame, label: 'ביטול (יציאה בלי לקלוט)' });
  await ctx.human.settle('cancelled');
  ctx.logger.step('receipt', 'יצאנו בלי לקלוט');
}
