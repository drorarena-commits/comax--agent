/**
 * סוכן קבלה לעו"ש — `a146`.
 *
 * The sixth document, and the first one that is not in the same application as
 * the other five. Everything below was read off live screens on 03/09/2026,
 * around receipt **6810057** (customer 112001, ₪1, לאומי 655 / 60100176): Dror
 * clicked the creation steps, this code read, snapshotted, verified and closed.
 *
 * It records money a customer moved on their own — a bank transfer into the
 * current account. Same purpose as the cash receipt (`a103`): register the
 * money, then allocate it against open invoices. Different channel, and a
 * genuinely different program:
 *
 * - **`Max2000_NET_2022`, not `Max2000`.** The paths end in `.aspx`, and none of
 *   them is shared with `a103` — except the allocation layer, which is the very
 *   same `Kupa/ShiuhIdx` / `Kupa/ShiuhAzm` screens, still on the old app.
 * - **It has a Doc type.** `DocType=681`, series `681xxxx`. `a103` has none at
 *   all, and two competing series on top of that.
 * - **It has lines**, unlike `a103`. The bank sits on the header — one account
 *   per receipt — and each line is one transfer: value date, reference, amount.
 * - **No payment-type radio and no card fields anywhere.** The whole `a103`
 *   trap — a form that defaults to charging a credit card, a `#CvvKab` password
 *   box — does not exist here. This document *is* the bank channel.
 * - **The filing dialog has no `#OKAfk`.** `a103`'s "אישור+הפקדה", the button
 *   that files *and deposits to the bank*, is absent — which makes sense, since
 *   this document is the deposit.
 *
 * `driven` stays `false`: the screens are mapped and the flow is proven, but
 * every click that created 6810057 was Dror's. See the refusals below.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../../../config.js';
import { fillLookup, dismissPopups, framePath } from '../../../navigate.js';
import * as engine from '../../engine.js';
import { checkDuplicate, duplicateError } from '../../duplicate-check.js';
import { checkInvoicePresence, noInvoiceError } from '../../invoice-presence-check.js';

/**
 * Find an open screen by its pattern.
 *
 * Matched against the path only. A Max2000 query string carries `DocNo`,
 * `Mode`, `FromFrame` and a timestamp, and matching against all of that turns
 * an exact pattern into a coin flip.
 */
const frameOf = (ctx, re) => ctx.page.frames().find((f) => re.test(framePath(f.url())));

/**
 * Fields this agent does not fill. **Empty here, and that is a finding.**
 *
 * `a103` has four: card number, expiry, CVV and approval code — live payment
 * credentials that could put through a charge. **This document has none of
 * them.** There is no card block on any of its screens, because the money
 * arrived through the bank before the document exists.
 *
 * `#Bank` / `#BankSnif` / `#BankAcc` describe where a transfer *came from*.
 * They are a record of a completed movement, not a means to make one — nothing
 * on this screen can pull money using them — so they are ordinary bookkeeping
 * fields and the agent fills them like any other. (A `#BankAcc` restriction was
 * tried on 03/09/2026 and dropped the same day: Dror's whole point is not
 * having to open Comax, and a document that stops for one field to be typed by
 * hand saves nobody anything.)
 *
 * The array stays, empty, because the next screen mapped here might not be so
 * clean — and an empty list that was reasoned about reads differently from a
 * missing one.
 */
export const NEVER_FILL = [];

export const profile = {
  name: 'osh-receipt',
  label: 'קבלה לעו"ש',
  shortcut: 'a146', // knowledge/desktop-shortcuts.json — קבלות לעו"ש
  doc: 681, // DocType=681, read from the header's own query string

  /**
   * ⚠️ A different application root. Every other agent lives under `Max2000`;
   * this one is under `Max2000_NET_2022`. `framePath()` in `src/navigate.js`
   * already tolerates it — its pattern is `Max2000[^/]*` — but any code that
   * hard-codes the old root will silently fail to match here.
   */
  app: 'Max2000_NET_2022',
  paths: {
    list: 'Kupa/Kab/Osh', // Kabala_OshV.aspx
    header: 'Kupa/Kab/Osh', // Kabala_OshU.aspx — same folder, unlike a103
  },

  /**
   * How Comax itself launches this program, and the reason it is here.
   *
   * The desktop icon is not dependable: on 03/09/2026 `#a146` opened the
   * program at 13:26 and was **gone from the DOM** at 14:44 — the desktop had
   * switched to a 52-icon category view that still had `#a103` but not this
   * one. `knowledge/desktop-shortcuts.json` warns about exactly this ("ה-id
   * עשוי להשתנות אם משנים את סדר שולחן העבודה"), and an agent that can only
   * arrive by icon is an agent that stops working when someone rearranges
   * their desktop.
   *
   * `top.S.runProgram(<path>)` is the call Comax's own buttons make (see
   * `getKupa_onclick`, MAP.md:780). Note the path carries **no** app root —
   * Comax resolves `Max2000_NET_2022` by itself. Verified live.
   */
  program: 'Kupa/Kab/Osh/Kabala_OshV.aspx',

  movesStock: false,
  collectsPayment: true,
  series: '681xxxx', // 6810057, 03/09/2026. One series, unlike a103's two.

  /**
   * ⚠️ The naming trap, and it is worse here than anywhere else.
   *
   * A loose `/Kabala/` matches four unrelated screens: `KabalaV`/`KabalaNU`
   * (a103), `Kabala652_*` (Doc652), and these. Every pattern below is anchored
   * on `_Osh`, and each is anchored tightly enough not to catch its neighbours:
   * `Kabala_OshU` does not occur inside `Kabala_Osh_LinesU`, and
   * `Kabala_OshV` does not occur inside `Kabala_Osh_LinesV`.
   */
  frames: {
    list: /Kabala_OshV\.aspx?/i,
    header: /Kabala_OshU\.aspx?/i,
    linesGrid: /Kabala_Osh_LinesV\.aspx?/i,
    lineForm: /Kabala_Osh_LinesU\.aspx?/i,
    closeDialog: /Kabala_OshCloseU\.aspx?/i,

    // Shared with a103 — and note the mixed roots: the invoice-allocation shell
    // was ported to NET_2022 while its own inner grid, and the whole order
    // screen, stayed on the old app. Matching on the path only keeps this sane.
    allocateInvoices: /ShiuhIdxV\.aspx?/i,
    allocateOrders: /ShiuhAzmV\.aspx?/i,
  },

  list: {
    new: '#newRec',
    edit: '#editRec',

    // ⚠️ Present in one reading of the list and absent in an earlier one, so it
    // is conditional on something — probably a selected row. **What it does was
    // never tested.** Do not assume it is an undo: the one cancellation seen in
    // the data (6810056) is a **negative counter-receipt** of -1.00 whose
    // פרטים read "ביטול קבלה 6810055", not a deleted row.
    del: '#delRec',

    allocateToInvoices: '#ShiuhHesh',
    allocateToOrders: '#ShiuhAzm',
    managementEntry: '#ShiuhPkuDoc', // פקודה ניהולית — untested
    accountQuery: '#SheiltaHesh',
    sourceDoc: '#doMakorDoc',
    updates: '#ListU',
    properties: '#PrmDoc',

    // ⚠️ `wFind` prefixes on the dates. a103 uses bare `#DateM`/`#DateA`, and
    // copying them across finds nothing.
    findDocNo: '#wFindDocNo',
    findCustomer: '#wFindLkNm',
    findAmount: '#FindScm',
    dateFrom: '#wFindDateM',
    dateTo: '#wFindDateA',
    find: '#Find',
    exit: '#DoExit',
  },

  // Visible order, right to left. The grid also carries hidden trailing columns:
  // the internal customer index, ת. פרעון, ת. אסמכתא and the year.
  columns: ['קבלה', 'מתאריך', 'לקוח', 'שם לקוח', 'חשבון בנק', 'סכום', 'הופקד'],

  headerScreen: {
    date: '#DateDoc', // defaults to today

    // ⚠️ Empty in ADD. The next number sits in the field's `label`, in
    // parentheses — it read "(6810057)" right before 6810057 was filed.
    docNo: '#DocNo',

    customer: '#Idx', // shows the name; its `label` is the internal index (82)
    customerCode: '#sLk', // the span that shows the real customer code (112001)
    customerDetails: '#prtLk',
    accountQuery: '#shilta',
    toggleAccounts: '#chg', // לקוחות/כל החשבונות
    newCustomer: '#LkNew',

    /**
     * ⚠️ **The day the money actually moved** — not the day it is recorded.
     * This is the field that makes the document worth having, and it is the one
     * a caller is most likely to leave at its default by accident.
     */
    valueDate: '#DatePeraon',
    amount: '#Scm',
    withholding: '#ScmNikui',
    withholdingPct: '#AczNikui',

    // The destination: Dror's own current account. Arrives already filled with
    // בנק עו"ש (internal 58), so it is normally left alone.
    targetAccount: '#IdxBank',
    toggleBanks: '#chgBnk', // עו''ש/כל הבנקים

    /**
     * The "הועבר מחשבון" block — the customer's account, the source.
     *
     * ⚠️ You type the **national** number and Comax stores its own index: `10`
     * → לאומי, whose `label` then reads `18`. Branch `655` → קסם, label `4397`.
     * Reading the label back and re-sending it writes a different bank.
     * The 50-row national list is in `knowledge/lists.json` → `banks`.
     */
    bank: '#Bank',
    branch: '#BankSnif',
    account: '#BankAcc',

    // ⚠️ `#DateIt` fills itself with **today** the moment a value date is
    // picked. On the one existing document read (6810056) both dates were the
    // transfer date, so matching them is a deliberate act, not the default.
    ref: '#Ref',
    refDate: '#DateIt',
    details: '#Pratim',

    fee: '#ScmAmla', // עמלה — never filled, never tested
    feeAccount: '#IdxHiuvAmla',
    currency: '#Mt', rate: '#tShaar', currencyDate: '#DateMt',
    agent: '#Sochen', collectingAgent: '#SochenGevya',

    lines: '#goLines', // פרוט שורות
    sign: '#getSign', remarks: '#getRemarks',

    // ⚠️ `#OK` here opens the filing dialog. It does not file by itself (as in
    // a103) and it does not advance to the lines screen (as in the four sales
    // documents). It is its own third behaviour.
    ok: '#OK',
    cancel: '#Cancel', // the exit that leaves nothing behind — proven twice
    exit: '#DoExit',

    pickerPrefix: '#CcomboBut', // #CcomboButBank, #CcomboButIdx, …
  },

  /**
   * The lines. One row per transfer, all sharing the header's bank account.
   *
   * ⚠️ In the 6810057 run `#goLines` was never opened: the amount went on the
   * header and Comax created the line itself. **When the lines screen is
   * actually required — more than one transfer on one receipt? — was not
   * tested**, and that is the main thing still missing here.
   */
  linesScreen: {
    edit: '#editRec',
    columns: ['ת. פרעון', 'ת. התיחסות', 'פרטים', 'סכום', 'ש.', 'HC'],
    totals: { net: '#ScmNotAll', withholding: '#ScmNikui', pct: '#AczNikui', gross: '#Scm' },
    exit: '#DoExit',
  },

  lineForm: {
    valueDate: '#DatePeraon',
    refDate: '#DateIt',
    ref: '#Ref',
    amount: '#Scm',
    details: '#Pratim',
    line: '#Line',
    ok: '#OK',
    cancel: '#Cancel',
    // No bank, branch or account here — those live on the header alone.
  },

  closeDialog: {
    ok: '#OK',
    okNew: '#OKNew',
    cancel: '#Cancel',
    copies: '#PrintCopies',
    // ⚠️ There is deliberately no `okDeposit` key. a103's `#OKAfk` does not
    // exist on this dialog, and inventing a name for a button that is not there
    // is how an agent ends up clicking something else that is.
  },

  /**
   * **0**, and it is not a preference.
   *
   * a103 arrives on 1. Anything other than 0 here opens Chrome's own print
   * dialog, which cannot be clicked, screenshotted or closed by the agent and
   * blocks the browser until a person clears it.
   */
  printCopies: '0',
  finalizeLabel: 'קליטת קבלה לעו"ש',

  /**
   * Shared with `a103`, down to the selectors — but with two differences that
   * matter, both read on 6810057:
   *
   * 1. **Both screens open by themselves after filing**, orders on top of
   *    invoices. Dror zeroes the orders (`#ZeroSh`) and confirms.
   * 2. ⚠️ **Comax pre-fills nothing here.** Every `#I0`…`#I6` came back empty,
   *    where a103 arrives with the first row already filled in. This is also
   *    what makes a filled `#I<n>` on a freshly opened screen *proof* that an
   *    allocation reached the server rather than merely leaving the screen —
   *    the check `tools/_smoke/shiuh-verify.mjs` relies on.
   *
   * ⚠️ Note the roots: the shell is `ShiuhIdxV.aspx` under NET_2022 while its
   * own grid is `ShiuhIdx_Fr.asp` — **no `x`** — on the old Max2000. A pattern
   * that insists on the `x` finds the shell and silently misses the grid.
   *
   * The document is identified to both screens as
   * `NmDB=Kabala_Osh&swHova=H&DocType=681&Doc=<number>`.
   */
  allocation: {
    shell: /ShiuhIdxV\.aspx?/i,
    grid: /ShiuhIdx_Fr\.aspx?/i,
    rows: 'input[id^="I"]', // #I0, #I1 … the שיוך column
    /**
     * The יתרה לשיוך amount — **and the control that fills the row**.
     *
     * Read off the DOM on 03/09/2026 (6810059):
     *   <span id="itr0" onclick="onItra('6,136.00','I0',1)">6,136.00 ח</span>
     *
     * Clicking it runs `onItra`, which writes the amount into `#I0`; `#I0`'s own
     * `onblur="parent.setItra(scmShiuh())"` then refreshes the balance block, so
     * focus has to leave the box before שויך / יתרה לשיוך are worth reading.
     * You never type the amount — that is the whole mechanic.
     */
    rowLabels: 'span[id^="itr"]',
    ok: '#OK',
    cancel: '#Cancel',
    zero: '#ZeroSh',
    balance: '#Izun', // ביצוע איזון — untested. Do not press.
  },

  /**
   * ✅ Deferred allocation is proven, not assumed (03/09/2026, 6810057).
   *
   * Closing the allocation screen with `#Cancel` loses nothing: select the
   * receipt on the list, press `#ShiuhHesh`, and the same screen reopens on the
   * same `Doc=`. This is what makes "file now, allocate later" safe advice.
   */
  allocateLater: '#ShiuhHesh',

  hasLines: true, // unlike a103 — and the lines are transfers, never items

  mapped: { list: true, header: true, lines: true },

  /**
   * ✅ **`true` — and about this module's own API, not about a smoke tool.**
   *
   * 6810057 was Dror's hands. **6810058 was this code**, on 03/09/2026:
   * `tools/_smoke/osh-drive.mjs` opened the program, filled every field
   * including the bank, pressed `#OK`, set copies to 0, filed, zeroed the
   * orders screen and read the allocation grid. It is in the list, ₪1.00,
   * customer 112001, value date 01/09/2026.
   *
   * `create` and `finalize` here are that same flow, moved out of the smoke
   * tool and into the agent — plus the two things the run exposed: the
   * allocation screen has to be closed before the list can be filtered, and
   * the list's filters are cumulative.
   */
  driven: true,
  drivenBy: 'tools/_smoke/osh-drive.mjs', // filed 6810058, 03/09/2026

  header: null, // the engine's header contract does not fit this screen
  line: null,
  totals: null,
};

/**
 * The natural order, and — unusually — **not a forced one.**
 *
 * `a103` needs a strict order because picking the customer there wipes the
 * payment type and the amount along with it. Read live here on the same day:
 * picking the customer only fills `#ScmNikui` with `0.00` and touches nothing
 * else. So this list is a convention for readable logs, not a constraint, and
 * saying otherwise would make the next person work around a problem that does
 * not exist.
 */
export const FILL_ORDER = ['customer', 'valueDate', 'amount', 'bank', 'branch', 'account', 'ref', 'details'];

/**
 * "לאומי" → "10".
 *
 * ⚠️ Comax wants the **national** number in `#Bank`. The `idx` column in the
 * catalogue is what Comax hands back afterwards, and feeding that back writes a
 * different bank — so this never reads `idx`.
 *
 * It refuses an ambiguous name rather than picking the first match: "מזרחי" is
 * both מזרחי טפחות (20) and מזרחי השקעות (41), and guessing between them puts a
 * real receipt against the wrong account.
 */
export function resolveBank(value) {
  const v = String(value ?? '').trim();
  if (!v) throw new Error('קבלה לעו"ש: חסר בנק. אפשר שם ("לאומי") או מספר ארצי ("10").');

  const { banks } = JSON.parse(readFileSync(resolve(ROOT, 'knowledge/lists.json'), 'utf8'));
  if (/^\d+$/.test(v)) {
    const hit = banks.find((b) => b.code === v);
    if (!hit) throw new Error(`קבלה לעו"ש: בנק ${v} לא ברשימה הארצית (knowledge/lists.json → banks).`);
    return { code: hit.code, name: hit.name };
  }
  const exact = banks.filter((b) => b.name === v);
  const partial = banks.filter((b) => b.name !== v && b.name.includes(v));
  if (exact.length === 1) return { code: exact[0].code, name: exact[0].name };
  if (!exact.length && partial.length === 1) return { code: partial[0].code, name: partial[0].name };
  if (!exact.length && !partial.length) throw new Error(`קבלה לעו"ש: לא מצאתי בנק בשם "${v}" (knowledge/lists.json → banks).`);
  throw new Error(
    `קבלה לעו"ש: "${v}" מתאים ליותר מבנק אחד — ${[...exact, ...partial].map((b) => `${b.name} (${b.code})`).join(' · ')}.\n` +
    '  לא מנחש בין שני בנקים על קבלה אמיתית. תן את המספר הארצי.',
  );
}

const REQUIRED = ['customer', 'amount', 'valueDate', 'bank', 'branch', 'account'];

/**
 * Gets the list screen open.
 *
 * Choosing between the icon and `top.S.runProgram` is no longer this agent's
 * job — `openProgram` skips an icon that is not in the DOM and takes
 * `profile.program` instead, for whichever agent declares one. What stays here
 * is the short-circuit: reopening the program while the list is already up
 * would reset a screen an earlier step in the same run is still working in.
 */
export async function openList(ctx) {
  const open = frameOf(ctx, profile.frames.list);
  if (open) return open;
  return engine.openList(ctx, profile);
}

/**
 * Opens a receipt and fills the header. Does **not** file it — `#OK` here opens
 * the filing dialog, and that belongs to `finalize`.
 *
 * Three gates run before a single character is typed:
 *
 *   1. **Required input.** A receipt missing its source account is a receipt
 *      that records money from nowhere.
 *   2. ⚠️ **The invoice-presence check.** Before this document is even opened,
 *      the customer's code is checked against a157 (tax invoices). Zero
 *      invoices ever is the signature of picking the wrong one out of two
 *      similar names — Dror's rule (03/09/2026). Runs first, because it opens
 *      a *different* program and would otherwise stack a window on top of
 *      this one.
 *   3. ⚠️ **The duplicate check.** The customer's last 5 receipts are read off
 *      the list, and an existing one with the same amount *and* date stops this
 *      before `#newRec`. Dror's rule (03/09/2026), and the day it was written
 *      customer 112001 already had three ₪1.00 receipts dated 03/09 — it would
 *      have caught a real double entry.
 */
export async function create(ctx, input = {}) {
  const { logger, page, human, dryRun } = ctx;

  const missing = REQUIRED.filter((k) => input[k] == null || input[k] === '');
  if (missing.length) {
    throw new Error(
      `קבלה לעו"ש: חסרים שדות חובה — ${missing.join(', ')}.\n` +
      '  דוגמה: { customer: "112001", amount: "1", valueDate: "01/09/2026",\n' +
      '            bank: "לאומי", branch: "655", account: "60100176" }',
    );
  }
  const bank = resolveBank(input.bank);

  const invoiceCheck = await checkInvoicePresence(ctx, input.customer);
  logger.save('invoice-check.json', {
    any: invoiceCheck.any,
    year: invoiceCheck.year,
    rows: invoiceCheck.rows.map((r) => r.text),
  });
  if (!invoiceCheck.any && !input.allowNoInvoice) {
    throw noInvoiceError(profile.label, input.customer, invoiceCheck.year);
  }

  const listFrame = await openList(ctx);

  const today = new Date().toLocaleDateString('en-GB').replace(/-/g, '/');
  const dup = await checkDuplicate(ctx, profile, {
    customer: input.customer,
    amount: input.amount,
    dates: [input.valueDate, input.date ?? today],
  });
  logger.save('duplicate-check.json', { clean: dup.clean, rows: dup.rows.map((r) => r.text), hits: dup.hits.map((h) => ({ level: h.level, row: h.text })) });
  if (dup.exact.length && !input.allowDuplicate) throw duplicateError(profile.label, input.customer, dup.exact);
  for (const h of dup.hits) logger.step('osh', `⚠️ קבלה דומה (${h.sameAmount ? 'אותו סכום' : ''}${h.sameAmount && h.sameDate ? ' + ' : ''}${h.sameDate ? 'אותו תאריך' : ''}): ${h.text}`);

  await human.click(profile.list.new, { scope: listFrame, label: 'הוספה (קבלה לעו"ש חדשה)' });
  await human.settle('header');
  const frame = frameOf(ctx, profile.frames.header);
  if (!frame) throw new Error('קבלה לעו"ש: הכותרת לא נפתחה.');
  if (!/Mode=%?2?7?'?ADD/i.test(frame.url())) {
    throw new Error(`קבלה לעו"ש: הכותרת לא נפתחה במצב ADD — ${frame.url().split('?')[1]?.slice(0, 60)}`);
  }

  // ⚠️ #DocNo is empty in ADD; the bracketed number in the label is a proposal.
  // The number Comax really assigns arrives on the filing dialog, in `finalize`.
  const preview = (await frame.innerText('body').catch(() => '')).match(/\((\d{6,})\)/)?.[1] ?? null;
  logger.step('osh', `מספר מוצע: ${preview ?? '(לא נקרא)'}`);

  const H = profile.headerScreen;
  await fillLookup(ctx, { frame, field: H.customer, value: String(input.customer), what: 'לקוח' });
  await dismissPopups(ctx);

  if (input.date) await human.type(H.date, String(input.date), { scope: frame, label: 'תאריך מסמך', clear: true });
  // The value date goes in before the reference date: setting it makes Comax
  // stamp #DateIt by itself, which would overwrite an earlier write.
  await human.type(H.valueDate, String(input.valueDate), { scope: frame, label: 'תאריך פרעון', clear: true });
  await human.type(H.amount, String(input.amount), { scope: frame, label: 'סכום', clear: true });
  await human.type(H.bank, bank.code, { scope: frame, label: `בנק ${bank.code} (${bank.name})`, clear: true });
  await human.type(H.branch, String(input.branch), { scope: frame, label: 'סניף', clear: true });
  await human.type(H.account, String(input.account), { scope: frame, label: 'חשבון', clear: true });
  await dismissPopups(ctx);

  if (input.ref) await human.type(H.ref, String(input.ref), { scope: frame, label: 'אסמכתא', clear: true });
  if (input.refDate) await human.type(H.refDate, String(input.refDate), { scope: frame, label: 'תאריך אסמכתא', clear: true });
  if (input.details) await human.type(H.details, String(input.details), { scope: frame, label: 'פרטים', clear: true, paste: true });
  await dismissPopups(ctx);

  // ⚠️ Typing "10" is only half the job — Comax has to resolve it and show the
  // bank's name. If it did not, the field holds a number that means nothing and
  // the receipt would record no source account at all.
  const body = await frame.innerText('body').catch(() => '');
  if (!body.includes(bank.name)) {
    throw new Error(
      `קבלה לעו"ש: הבנק לא נפתר — הקלדתי ${bank.code} ואין "${bank.name}" על המסך.\n` +
      '  לא ממשיך: קבלה בלי חשבון מקור היא קבלה שגויה. היציאה: #Cancel (backOut).',
    );
  }

  const read = async (sel) => frame.locator(sel).inputValue().catch(() => null);
  const header = {
    לקוח: await read(H.customer),
    'תאריך מסמך': await read(H.date),
    'תאריך פרעון': await read(H.valueDate),
    סכום: await read(H.amount),
    בנק: `${await read(H.bank)} — ${bank.name}`,
    סניף: await read(H.branch),
    חשבון: await read(H.account),
    אסמכתא: await read(H.ref),
    'ת. אסמכתא': await read(H.refDate),
    פרטים: await read(H.details),
  };
  logger.save('header.json', header);
  await logger.shot(page, 'header-ready');

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני אישור הכותרת. הקבלה לא נרשמה.');
    // No Frame in the return value: run.js JSON-stringifies it, and a Playwright
    // Frame is circular — a dry run that dies serialising its own result is the
    // most annoying possible way to fail.
    return { dryRun: true, preview, header, duplicates: dup.hits.map((h) => h.text) };
  }
  return { docNo: preview, preview, header, duplicates: dup.hits.map((h) => h.text) };
}

/**
 * Refuses — and the reason is the input's shape, which no amount of mapping
 * will change.
 *
 * This document does have lines, unlike `a103`. They are transfers: value date,
 * reference, amount. They are not items, there is no `#Prt` anywhere in the
 * program, and a caller passing `items` believes this is a sales document.
 * Saying "not mapped yet" would hide that mistake instead of naming it.
 */
export async function addLines(_ctx, lines = []) {
  throw new Error(
    'קבלה לעו"ש: השורות שלה הן העברות, לא פריטים.\n' +
    `  קיבלתי ${lines.length} פריטים — זה הקלט של מסמך מכירה.\n` +
    '  שורה כאן היא: { valueDate, ref, amount, details } — ראה lineForm בפרופיל.\n' +
    '  מאומת על המסך: אין #Prt בשום מסך של a146, והבנק יושב על הכותרת.\n' +
    '  למכירה עם פריטים: חשבונית מס (comax-invoice) או הצעת מחיר (comax-quote).',
  );
}

/**
 * Refuses separately from `create` — the two-gate pattern the other agents use.
 *
 * It matters here because one press sets off a chain: the filing dialog assigns
 * the number, then two allocation screens open by themselves, and a confirmed
 * allocation closes a real invoice in the customer's ledger.
 */
export async function finalize(ctx, { confirm = false, allocate = false } = {}) {
  const { logger, page, human } = ctx;

  const frame = frameOf(ctx, profile.frames.header);
  if (!frame) throw new Error('קבלה לעו"ש: הכותרת לא פתוחה — אין מה לקלוט.');

  if (!confirm) {
    await logger.shot(page, 'before-filing');
    logger.step('osh', 'לא נקלט — חסר confirm. הכותרת פתוחה.');
    return { filed: false };
  }

  await human.click(profile.headerScreen.ok, { scope: frame, label: 'אישור הכותרת (פותח את דיאלוג הקליטה)' });
  await human.settle('close dialog');

  const dlg = frameOf(ctx, profile.frames.closeDialog);
  if (!dlg) throw new Error('קבלה לעו"ש: דיאלוג הקליטה (Kabala_OshCloseU) לא נפתח — לא לוחץ כלום.');

  // ⚠️ The authoritative number. The bracket on the header was a proposal, and
  // on a busy day someone else can take it in between.
  const docNo = decodeURIComponent(dlg.url()).match(/DocNo=(\d+)/)?.[1] ?? null;
  if (!docNo) throw new Error('קבלה לעו"ש: לא הצלחתי לקרוא את מספר הקבלה מהדיאלוג — לא קולט מסמך שאני לא יכול לאמת.');
  logger.step('osh', `מספר הקבלה: ${docNo}`);

  // 0, not 1. Anything else opens Chrome's print dialog, which this agent
  // cannot click, screenshot or close.
  await human.select(profile.closeDialog.copies, profile.printCopies, { scope: dlg, label: `עותקים = ${profile.printCopies}` })
    .catch(() => logger.step('osh', 'לא הצלחתי לקבוע עותקים — ממשיך עם ברירת המחדל'));
  await human.click(profile.closeDialog.ok, { scope: dlg, label: profile.finalizeLabel });
  await human.settle('filed');
  await logger.shot(page, 'after-filing');

  /* ------------------------------------------------------ the allocation -- */

  // Orders open on top of invoices. Zeroing them is housekeeping, not a
  // decision: #ZeroSh clears, it never commits money against anything.
  const orders = frameOf(ctx, profile.frames.allocateOrders);
  if (orders) {
    await human.click(profile.allocation.zero, { scope: orders, label: 'איפוס שיוך להזמנות' }).catch(() => {});
    await human.settle('orders zeroed');
    await human.click(profile.allocation.ok, { scope: orders, label: 'סגירת מסך ההזמנות' }).catch(() => {});
    await human.settle('orders closed');
  }

  const grid = frameOf(ctx, profile.allocation.grid);
  const rows = [];
  if (grid) {
    for (const el of await grid.locator(profile.allocation.rows).all()) {
      const id = await el.getAttribute('id').catch(() => null);
      if (!/^I\d+$/.test(id ?? '')) continue;
      rows.push({
        id,
        שורה: await el.evaluate((e) => e.closest('tr')?.innerText.replace(/\s+/g, ' ').trim() ?? null).catch(() => null),
        משויך: await el.inputValue().catch(() => ''),
      });
    }
    logger.save('allocation.json', rows);
  }

  const shell = frameOf(ctx, profile.allocation.shell);
  if (allocate && shell) {
    await human.click(profile.allocation.ok, { scope: shell, label: 'אישור השיוך' });
    await human.settle('allocated');
    logger.step('osh', 'השיוך אושר');
  } else if (shell) {
    /**
     * ⚠️ Close it, and not only out of tidiness.
     *
     * `FrameShiuhIdxV` sits over the list and intercepts every click — the first
     * code-driven run (6810058) filed correctly and then timed out trying to
     * type into the list's filter to verify itself. And deferring costs
     * nothing: select the receipt on the list, `#ShiuhHesh`, and it reopens on
     * the same document.
     */
    await human.click(profile.allocation.cancel, { scope: shell, label: 'סגירת מסך השיוך (בלי לשייך)' });
    await human.settle('allocation closed');
    logger.step('osh', 'הקבלה לא שויכה — אפשר לשייך אחר כך דרך #ShiuhHesh ברשימה');
  }
  await logger.shot(page, 'after-allocation');

  const verified = await verify(ctx, docNo).catch((e) => ({ found: false, row: null, error: e.message }));
  return { filed: true, docNo, allocated: !!allocate, allocation: rows, verified };
}

/**
 * Whether a receipt really exists, by number.
 *
 * ✅ Unlike `a103` — where a filed receipt does not appear in the default list
 * at all — 6810057 went straight to the top of the grid. The filter is still
 * the right way to check: the list paginates, and scanning the first page is
 * how a document that exists gets reported missing.
 */
export async function verify(ctx, docNo) {
  const list = frameOf(ctx, profile.frames.list);
  if (!list) throw new Error('קבלה לעו"ש: מסך הרשימה לא פתוח — אין איפה לאמת.');

  // ⚠️ The filters are cumulative, and `create` leaves a customer filter behind.
  // Clearing first is what keeps "not found" meaning "not filed" rather than
  // "filtered out by something I set myself two minutes ago".
  for (const sel of [profile.list.findCustomer, profile.list.findAmount, profile.list.dateFrom, profile.list.dateTo]) {
    await list.locator(sel).fill('').catch(() => {});
  }
  await ctx.human.type(profile.list.findDocNo, String(docNo), { scope: list, label: `סינון לקבלה ${docNo}`, clear: true });
  await list.locator(profile.list.findDocNo).press('Enter').catch(() => {});
  await ctx.human.settle('filtered');

  const body = await list.innerText('body').catch(() => '');
  const row = body.split('\n').map((l) => l.trim()).find((l) => l.includes(String(docNo)));
  ctx.logger.step('osh-receipt', row ? `אומת: ${row}` : `לא נמצאה קבלה ${docNo}`);
  return { found: !!row, row: row ?? null };
}

/** The amount is a header field; the lines screen has its own totals block. */
export const readTotals = async () => ({});

/**
 * Leave the header without filing — `#Cancel` on `Kabala_OshU.aspx`.
 *
 * Proven twice on 03/09/2026: once out of an existing document opened in
 * UPDATE, once out of an ADD form that had been filled in. Both times the frame
 * went to `Blank_Screen.htm` and the list was unchanged.
 *
 * Never `#OK` — here it opens the filing dialog.
 */
export async function backOut(ctx) {
  const frame = ctx?.page?.frames?.().find((f) => profile.frames.header.test(f.url().split('?')[0]));
  if (!frame) {
    ctx?.logger?.step?.('osh-receipt', 'אין כותרת פתוחה — אין ממה לצאת.');
    return;
  }
  await ctx.human.click(profile.headerScreen.cancel, { scope: frame, label: 'ביטול (יציאה בלי לקלוט)' });
  await ctx.human.settle('cancelled');
  ctx.logger.step('osh-receipt', 'יצאנו בלי לקלוט');
}
