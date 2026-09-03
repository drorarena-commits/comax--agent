/**
 * Drives a קבלה לעו"ש end to end — the first time this code, rather than Dror,
 * runs the flow that 6810057 proved by hand on 03/09/2026.
 *
 *   node tools/_smoke/osh-drive.mjs runs/osh.json             # fills, stops before filing
 *   node tools/_smoke/osh-drive.mjs runs/osh.json --confirm   # ⚠️ files
 *   node tools/_smoke/osh-drive.mjs runs/osh.json --allocate  # ⚠️ also confirms the invoice allocation
 *
 * Three gates, because filing sets off three separate things: the document,
 * the two allocation screens that open by themselves, and — only if you say so
 * — an invoice closing in the customer's ledger. `--confirm` files and STOPS
 * with the invoice allocation on screen; `--allocate` is what confirms that,
 * and per Dror's rule it should only follow an explicit yes to
 * "האם לסגור חשבונית מספר X מתאריך Y".
 *
 * Input (runs/osh.json):
 *   {
 *     "customer":  "112001",
 *     "amount":    "1",
 *     "valueDate": "01/09/2026",     // the day the money actually moved
 *     "bank":      "לאומי",           // a name from knowledge/lists.json, or the number
 *     "branch":    "655",
 *     "account":   "60100176",
 *     "ref":       "12345",          // optional
 *     "refDate":   "01/09/2026",     // optional — else Comax puts today
 *     "details":   "העברה בנקאית"
 *   }
 */
import { readFileSync } from 'node:fs';
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { openProgram, fillLookup, dismissPopups } from '../../src/navigate.js';
import { profile } from '../../src/documents/agents/osh-receipt/index.js';
import { ROOT } from '../../src/config.js';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
const confirm = args.includes('--confirm');
const allocate = args.includes('--allocate');

const input = {
  details: 'קבלה לעו"ש לבדיקת סוכן',
  ...(path ? JSON.parse(readFileSync(path, 'utf8')) : {}),
};

/* ------------------------------------------------------- the bank catalogue -- */

/**
 * "לאומי" → "10".
 *
 * ⚠️ What Comax wants in `#Bank` is the **national** number. The `idx` column in
 * the catalogue is what Comax hands back afterwards, and feeding that back in
 * writes a different bank entirely — so this deliberately never reads `idx`.
 */
const { banks } = JSON.parse(readFileSync(resolve(ROOT, 'knowledge/lists.json'), 'utf8'));
function bankCode(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const byCode = banks.find((b) => b.code === v);
    if (!byCode) throw new Error(`בנק ${v} לא ברשימה הארצית. הרשימה: knowledge/lists.json → banks`);
    return { code: byCode.code, name: byCode.name };
  }
  const hits = banks.filter((b) => b.name === v) .concat(banks.filter((b) => b.name !== v && b.name.includes(v)));
  if (!hits.length) throw new Error(`לא מצאתי בנק בשם "${v}". הרשימה: knowledge/lists.json → banks`);
  // Never guess between two banks — that is a wrong account on a real receipt.
  if (hits.length > 1 && hits[0].name !== v) {
    throw new Error(`"${v}" מתאים ליותר מבנק אחד: ${hits.map((b) => `${b.name} (${b.code})`).join(' · ')}`);
  }
  return { code: hits[0].code, name: hits[0].name };
}

for (const k of ['customer', 'amount', 'valueDate', 'bank', 'branch', 'account']) {
  if (input[k] == null || input[k] === '') {
    console.log(`חסר "${k}". דוגמה מלאה בראש הקובץ: tools/_smoke/osh-drive.mjs`);
    process.exit(1);
  }
}
const bank = bankCode(input.bank);

const logger = new RunLogger('osh-drive');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון פתוח. npm run open בטרמינל נפרד.'); process.exit(1); }
const ctx = { ...s, logger };
const { page, human } = ctx;

const frameFor = (re) => page.frames().find((f) => re.test(f.url().split('?')[0]));
const H = profile.headerScreen;

/* ------------------------------------------------------------ the header -- */

await openProgram(ctx, profile.shortcut, { expect: profile.frames.list });
const list = frameFor(profile.frames.list);
if (!list) throw new Error('מסך הרשימה לא נפתח.');

await human.click(profile.list.new, { scope: list, label: 'הוספה (קבלה לעו"ש חדשה)' });
await human.settle('header');
const header = frameFor(profile.frames.header);
if (!header) throw new Error('הכותרת לא נפתחה.');
if (!/Mode=%?2?7?'?ADD/i.test(header.url())) {
  throw new Error(`הכותרת לא נפתחה במצב ADD: ${header.url().split('?')[1]?.slice(0, 80)}`);
}

// ⚠️ #DocNo is empty in ADD; the next number sits in the label, in brackets.
// It is a *proposal* — the authoritative number arrives on the filing dialog's
// own query string, and that is what gets verified at the end.
const proposed = (await header.innerText('body').catch(() => '')).match(/\((\d{6,})\)/)?.[1] ?? null;
logger.step('osh', `מספר מוצע: ${proposed ?? '(לא נקרא)'}`);

await fillLookup(ctx, { frame: header, field: H.customer, value: String(input.customer), what: 'לקוח' });
await dismissPopups(ctx);

// The value date goes in before the reference date: picking it makes Comax
// stamp #DateIt with today, which would silently overwrite an earlier write.
await human.type(H.valueDate, String(input.valueDate), { scope: header, label: 'תאריך פרעון', clear: true });
await human.type(H.amount, String(input.amount), { scope: header, label: 'סכום', clear: true });

await human.type(H.bank, bank.code, { scope: header, label: `בנק ${bank.code} (${bank.name})`, clear: true });
await human.type(H.branch, String(input.branch), { scope: header, label: 'סניף', clear: true });
await human.type(H.account, String(input.account), { scope: header, label: 'חשבון', clear: true });
await dismissPopups(ctx);

if (input.ref) await human.type(H.ref, String(input.ref), { scope: header, label: 'אסמכתא', clear: true });
if (input.refDate) await human.type(H.refDate, String(input.refDate), { scope: header, label: 'תאריך אסמכתא', clear: true });
if (input.details) await human.type(H.details, String(input.details), { scope: header, label: 'פרטים', clear: true });
await dismissPopups(ctx);

/* --------------------------------------------------------- did it resolve? -- */

// Typing "10" is only half of it: Comax has to recognise the number and show
// the bank's name. If it did not, the field holds a number that means nothing
// and the receipt would record no source account at all.
const body = await header.innerText('body').catch(() => '');
if (!body.includes(bank.name)) {
  throw new Error(
    `הבנק לא נפתר: הקלדתי ${bank.code} ולא רואה "${bank.name}" על המסך.\n` +
    '  לא ממשיך — קבלה בלי חשבון מקור היא קבלה שגויה. הכותרת פתוחה; לצאת: osh-backout.mjs',
  );
}

const read = async (sel) => header.locator(sel).inputValue().catch(() => null);
const filled = {
  לקוח: await read(H.customer),
  'תאריך פרעון': await read(H.valueDate),
  סכום: await read(H.amount),
  בנק: `${await read(H.bank)} — ${bank.name}`,
  סניף: await read(H.branch),
  חשבון: await read(H.account),
  אסמכתא: await read(H.ref),
  'ת. אסמכתא': await read(H.refDate),
  פרטים: await read(H.details),
  'תאריך מסמך': await read(H.date),
  'מספר מוצע': proposed,
};
logger.save('header.json', filled);
await logger.shot(page, 'osh-ready');

console.log('\n  הקבלה לעו"ש מוכנה לקליטה:');
for (const [k, v] of Object.entries(filled)) console.log(`    ${k.padEnd(14)} ${v ?? ''}`);

if (!confirm) {
  console.log('\n  DRY RUN — לא נקלט. הקבלה פתוחה על המסך.');
  console.log('  לקלוט:  node tools/_smoke/osh-drive.mjs <קובץ> --confirm');
  console.log('  לצאת :  node tools/_smoke/osh-backout.mjs\n');
  await s.browser.close().catch(() => {});
  logger.done();
  process.exit(0);
}

/* ------------------------------------------------------------- the filing -- */

await human.click(H.ok, { scope: header, label: 'אישור הכותרת (פותח את דיאלוג הקליטה)' });
await human.settle('close dialog');

const dlg = frameFor(profile.frames.closeDialog);
if (!dlg) throw new Error('דיאלוג הקליטה (Kabala_OshCloseU) לא נפתח — לא לוחץ כלום.');

// The dialog's own query string carries the number Comax actually assigned.
// The bracketed proposal on the header is a guess until this point.
const docNo = decodeURIComponent(dlg.url()).match(/DocNo=(\d+)/)?.[1] ?? proposed;
if (proposed && docNo !== proposed) logger.step('osh', `⚠️ המספר שהוקצה (${docNo}) שונה מהמוצע (${proposed})`);
logger.step('osh', `מספר הקבלה: ${docNo}`);

// 0, not 1. Anything else opens Chrome's print dialog, which this agent cannot
// click, screenshot or close.
await human.select(profile.closeDialog.copies, profile.printCopies, { scope: dlg, label: `עותקים = ${profile.printCopies}` })
  .catch(() => logger.step('osh', 'לא הצלחתי לקבוע עותקים — ממשיך עם ברירת המחדל'));
await human.click(profile.closeDialog.ok, { scope: dlg, label: profile.finalizeLabel });
await human.settle('filed');
await logger.shot(page, 'after-filing');

/* ---------------------------------------------------------- the allocation -- */

// Orders open on top of invoices. Dror zeroes them — the receipt is against
// invoices, not against open orders — and that is housekeeping, not a decision:
// #ZeroSh clears, it never commits money against anything.
const orders = frameFor(profile.frames.allocateOrders);
if (orders) {
  await human.click(profile.allocation.zero, { scope: orders, label: 'איפוס שיוך להזמנות' }).catch(() => {});
  await human.settle('orders zeroed');
  await human.click(profile.allocation.ok, { scope: orders, label: 'סגירת מסך ההזמנות' }).catch(() => {});
  await human.settle('orders closed');
  logger.step('osh', 'מסך ההזמנות אופס ונסגר');
}

const grid = frameFor(profile.allocation.grid);
const rows = [];
if (grid) {
  for (const el of await grid.locator(profile.allocation.rows).all()) {
    const id = await el.getAttribute('id').catch(() => null);
    if (!/^I\d+$/.test(id ?? '')) continue;
    // ⚠️ `#itr<n>` is NOT the document description — it holds the open amount
    // and its ח/ז side ("185.01 ח"). Read the whole row instead; the invoice
    // type and number live in sibling cells.
    const row = await el.evaluate((e) => e.closest('tr')?.innerText.replace(/\s+/g, ' ').trim() ?? null).catch(() => null);
    rows.push({ id, שורה: row, משויך: await el.inputValue().catch(() => '') });
  }
  logger.save('allocation.json', rows);
  console.log('\n  מסך שיוך החשבוניות:');
  for (const r of rows) console.log(`    ${r.id.padEnd(4)} ${(r.שורה ?? '').slice(0, 56).padEnd(58)} ${r.משויך ? `← ${r.משויך}` : ''}`);
  // ⚠️ Comax pre-fills nothing here — the opposite of a103. An empty grid is
  // the normal state, not a failure to load.
  if (!rows.some((r) => r.משויך)) console.log('    (שום שורה לא מולאה מראש — כך זה אמור להיראות כאן)');
}

if (allocate && grid) {
  const shell = frameFor(profile.allocation.shell);
  await human.click(profile.allocation.ok, { scope: shell ?? grid, label: 'אישור השיוך' });
  await human.settle('allocated');
  console.log('\n  השיוך אושר.');
} else {
  /**
   * ⚠️ Close it before doing anything else.
   *
   * The first code-driven run (6810058) filed correctly and then timed out
   * trying to type into the list's filter: `FrameShiuhIdxV` sits over the list
   * and intercepts every click, so the verification below cannot reach it.
   * `#Cancel` is also simply the right thing — an allocation left open is a
   * screen someone has to close by hand, and deferring it loses nothing:
   * select the receipt on the list, `#ShiuhHesh`, and it reopens on the same
   * document.
   */
  const shell = frameFor(profile.allocation.shell);
  if (shell) {
    await human.click(profile.allocation.cancel, { scope: shell, label: 'סגירת מסך השיוך (בלי לשייך)' });
    await human.settle('allocation closed');
  }
  console.log(`\n  ⚠️ קבלה ${docNo} נקלטה, ולא שויכה לשום חשבונית.`);
  console.log('  לשייך:  ברשימה — לסמן את הקבלה וללחוץ "שיוך לחשבוניות" (#ShiuhHesh),');
  console.log('          או להריץ מחדש עם --confirm --allocate על קבלה חדשה.\n');
}
await logger.shot(page, 'after-allocation');

/* ----------------------------------------------------------- verification -- */

if (docNo) {
  const l2 = frameFor(profile.frames.list);
  if (l2) {
    await human.type(profile.list.findDocNo, String(docNo), { scope: l2, label: `סינון לקבלה ${docNo}`, clear: true });
    await l2.locator(profile.list.findDocNo).press('Enter').catch(() => {});
    await human.settle('filtered');
    const grid2 = await l2.innerText('body').catch(() => '');
    const row = grid2.split('\n').map((x) => x.trim()).find((x) => x.includes(String(docNo)));
    console.log(row ? `\n  ✅ אומת ברשימה: ${row}\n` : `\n  ⚠️ קבלה ${docNo} לא נמצאה בסינון — לבדוק ידנית.\n`);
  }
}

await s.browser.close().catch(() => {});
logger.done();
