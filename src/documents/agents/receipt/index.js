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

  // Two numbering series, like Doc470. The list holds `70100xx` (7010013 was
  // the latest, 04/08/2026) but a new receipt is offered `68000xx` — the ADD
  // form showed "(6800005)". Likely POS-generated vs hand-written: 7010013's
  // פרטים field read "קבלה מקופה". Not confirmed — no receipt has been filed.
  series: { onTheList: '70100xx', offeredOnAdd: '68000xx' },

  // Read live on 03/09/2026 — the list opened, and receipt 7010013 opened in
  // UPDATE mode and was backed out with `#Cancel`. Neither screen was *driven*,
  // and the ADD-mode header has never been seen, so only `list` flips.
  mapped: { list: true, header: false, lines: false },

  frames: {
    // `KabalaV`, with no digits. ⚠️ Doc652's payment screens are called
    // `Kabala652_LinesNV.asp` — a loose /Kabala/ match would catch those too.
    list: /KabalaV\.aspx?/i,
    header: /KabalaNU\.aspx?/i,
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
    paymentTypeRadios: 'input[name="Sug"]',
    paymentTypes: { מזומן: '0', שיקים: '1', אשראי: '2' },

    // ⚠️ In ADD the default is **2 — כרטיס אשראי**, with the credit block live.
    // Same trap as Doc652, whose `#numScr` defaults to אשראי: whoever files
    // without touching this field charges a card.
    paymentTypeDefault: '2',

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

    // ⚠️ On this document `#OK` is probably the commit, not "advance to lines" —
    // there are no lines. Unproven, and treated as committing.
    ok: '#OK', cancel: '#Cancel', exit: '#DoExit',
  },

  header: null, // the engine's header contract does not fit — see headerScreen
  line: null,
  totals: null,
  finalizeLabel: null,
  printCopies: null, // ⚠️ must not be copied from a neighbour — Doc650 rejects 0, Doc470 requires 0
};

/** What is missing, phrased for a person, with the command that fixes it. */
const notMapped = (what) => new Error(
  `קבלה: ${what}\n` +
  '  נקרא חי 03/09/2026: הרשימה, והכותרת בשני המצבים (UPDATE ו-ADD).\n' +
  '  לא הורץ: מילוי שדה אחד, מסכי השיקים/האשראי/הקופה, והקליטה עצמה.\n' +
  '  ⚠️ ברירת המחדל בכותרת חדשה היא כרטיס אשראי, ויש בה שדות כרטיס ו-CVV\n' +
  '     שהסוכן לא ממלא לעולם.\n' +
  '  הפרטים: src/documents/agents/receipt/AGENT.md',
);

/**
 * Refuses.
 *
 * Both screens are now mapped well enough to drive — which is exactly why this
 * stays shut. Not one field has ever been typed into, `#OK` is unproven and
 * probably files, and the form opens defaulted to charging a credit card.
 */
export async function create() {
  throw notMapped('אני לא פותח קבלה — מיפיתי את המסך, מעולם לא מילאתי בו שדה.');
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
 * one must not be enough to file a document. Here the gate matters more than
 * usual — filing records money received against the customer's ledger, and the
 * commit button sits on the header, one click away from a screen that is merely
 * being read.
 */
export async function finalize() {
  throw notMapped('אני לא קולט קבלה — הקליטה רושמת כסף שהתקבל, ו-#OK כאן כנראה קולט ולא מתקדם.');
}

/** Nothing is opened by this agent yet, so there is nothing to read. */
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
