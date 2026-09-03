/**
 * סוכן קבלה — `a103`.
 *
 * The fifth document, and the first one that is **not a stock document at all**.
 * That single fact is why it gets its own agent instead of a flag on
 * `invoice-receipt`, and it is what every function here is shaped around:
 *
 * - **No items, ever.** A quote, an invoice, a transfer and a tax-invoice/receipt
 *   all end at `<Doc>LinesU` with `#Prt` (פריט) in it. A receipt has no `#Prt`.
 *   Its lines are *payments* — cash, cheque, card, transfer — and *allocations*
 *   against open invoices. So `engine.addLine`, which types an item code into
 *   `#Prt`, is the wrong tool here even after the screens are mapped. `addLines`
 *   refuses on that ground rather than on the mapping, because the mapping will
 *   eventually be done and this reason will still hold.
 * - **It moves money, not stock.** `movesStock: false` — and that is *not* the
 *   same as safe. Filing a receipt closes invoices in the customer's ledger and
 *   records a payment; there is no "ביטול קליטה", only a counter-document.
 * - **The document number is unknown, and is not guessed.** Doc652's payment
 *   screens are called `Kabala652_*` and live under the *Doc650* folder, so the
 *   naming here cannot be inferred from a neighbour — `Doc652` itself proved
 *   that the path lies. The prefix is to be read off the live URL with
 *   `/(Doc\d+)V\.aspx?/i` when the list is first opened, not assumed now.
 *
 * Nothing below has been driven. `mapped` is all `false`, `create` refuses
 * before the first click, and `finalize` refuses separately — the same two
 * independent gates that `invoice-receipt` carries.
 */
export const profile = {
  name: 'receipt',
  label: 'קבלה',
  shortcut: 'a103', // knowledge/desktop-shortcuts.json — קבלות. NOT a146 (קבלות לעו"ש)
  doc: null, // there is no Doc number — see `path`
  path: 'Kupa/Kab/Kab', // ← NOT Erp/Mehirot. Read live 03/09/2026
  movesStock: false, // moves money — which is irreversible in its own way
  collectsPayment: true, // the only other agent with this is invoice-receipt
  series: '70100xx', // 7010013 was the latest on 04/08/2026

  // The list was opened and read live on 03/09/2026. Nothing past it has been
  // touched. `mapped: true` is a statement that a screen was driven, not that a
  // neighbour's shape was assumed.
  mapped: { list: true, header: false, lines: false },

  frames: {
    // No `Doc\d+` anywhere in the URL — a `/Doc\d+V\.aspx?/` pattern, which every
    // other agent here uses, would never have matched this screen.
    list: /KabalaV\.aspx?/i,
    header: null, // unknown
    linesGrid: null, // unknown
    lineForm: null, // unknown
  },

  /** Read live off `KabalaV.asp` on 03/09/2026. */
  list: {
    new: '#newRec', edit: '#editRec', del: '#delRec', copy: '#doCopy',
    // The button that proves the shape of this document: a receipt is allocated
    // against open invoices, it does not carry items.
    allocateToInvoices: '#ShiuhHesh', // שיוך לחשבוניות
    findDeposits: '#AfKadot', // איתור הפקדות
    movements: '#PirutHtnu', // פרוט תנועות
    sourceDoc: '#doMakorDoc', // מסמך מקור
    signDoc: '#PDF_DOC', // חתימת מסמך
    // Filters. Note what is absent: there is no item filter, because there are
    // no items — `Doc652V` has `#wPrt` and this screen has nothing like it.
    findCustomer: '#wFindLkNm', findDocNo: '#wFindDocNo', findAmount: '#FindScm',
    dateFrom: '#DateM', dateTo: '#DateA', find: '#Find',
    exit: '#DoExit',
  },

  /** Grid columns, right to left as Comax paints them. */
  columns: ['קבלה', 'תאריך', 'לקוח', 'שם לקוח', 'אסמכתא', 'סכום', 'הופקד'],

  header: null,
  line: null,
  totals: null,
  finalizeLabel: null,
  printCopies: null, // ⚠️ must not be copied from a neighbour — Doc650 rejects 0, Doc470 requires 0
};
/** What is missing, phrased for a person, with the command that fixes it. */
const notMapped = (what) => new Error(
  `קבלה: ${what}\n` +
  `  הרשימה מופתה חי (KabalaV.asp, 03/09/2026). הכותרת והשורות לא נפתחו מעולם.
` +
  `  להמשיך: npm run open (טרמינל נפרד) ואז npm run open-program -- ${profile.shortcut}
` +
  `  ⚠️ #newRec יוצר קבלה אמיתית.
` +
  `  הפרטים: src/documents/agents/receipt/AGENT.md`,
);

/**
 * Refuses. The list is mapped, so `#newRec` can now be found and pressed — and
 * that is exactly why this stays shut: it would create a real receipt on a
 * header screen nobody has ever seen.
 */
export async function create() {
  throw notMapped('אני לא פותח קבלה — ראיתי את הרשימה בלבד, לא את הכותרת.');
}

/**
 * Refuses — and for a reason that will outlive the mapping.
 *
 * A receipt has no items. Whatever this agent grows, it will not be
 * `engine.addLine`: that function fills `#Prt` (פריט), and a receipt line is a
 * payment (`{ method, amount, ... }`) or an allocation against an open invoice
 * (`{ docNo, amount }`). Handing it `items` means the caller thinks this is a
 * sales document, and answering that with "not mapped yet" would hide the
 * actual mistake.
 */
export async function addLines(_ctx, lines = []) {
  throw new Error(
    'קבלה: אין לה שורות פריטים.\n' +
    `  קיבלתי ${lines.length} פריטים — זה הקלט של מסמך מכירה, לא של קבלה.\n` +
    '  שורות הקבלה הן אמצעי תשלום (מזומן · שיק · אשראי · העברה) והקצאה מול\n' +
    '  חשבוניות פתוחות. הצורה המיועדת: { payments: [...], invoices: [...] }\n' +
    '  והיא עוד לא מומשה כי אף מסך לא מופה.\n' +
    '  למכירה עם פריטים: חשבונית מס (comax-invoice) או חשבונית מס/קבלה.',
  );
}

/**
 * Refuses separately from `create`, on purpose.
 *
 * Two independent gates is the pattern `invoice-receipt` established: softening
 * one of them must not be enough to file a document. Filing a receipt closes
 * invoices in the ledger and records money received — there is no undo, only a
 * counter-document.
 */
export async function finalize() {
  throw notMapped('אני לא קולט קבלה — קליטה סוגרת חשבוניות בכרטיס הלקוח ואין לה ביטול.');
}

/** Nothing is open, so there is nothing to read and nothing to back out of. */
export const readTotals = async () => ({});
export const backOut = async (ctx) => {
  ctx?.logger?.step?.('receipt', 'אין מסמך פתוח — הסוכן לא פותח כלום.');
};
