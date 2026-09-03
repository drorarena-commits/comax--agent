/**
 * Drives a cash receipt end to end — the first time this code, rather than a
 * person, runs the flow that 6800005 proved by hand.
 *
 *   node tools/_smoke/receipt-drive.mjs runs/receipt.json            # fills, stops before filing
 *   node tools/_smoke/receipt-drive.mjs runs/receipt.json --confirm  # ⚠️ files
 *   node tools/_smoke/receipt-drive.mjs runs/receipt.json --allocate # ⚠️ also confirms the allocation
 *
 * Three separate gates on purpose, because filing sets off three irreversible
 * things in a row: the document, then the allocation screen it opens by itself,
 * then an invoice closing in the ledger. `--confirm` files and STOPS at the
 * allocation, reporting which invoice Comax pre-filled. `--allocate` is what
 * confirms that, and per Dror's rule it should only follow an explicit yes to
 * "האם לסגור חשבונית מספר X מתאריך Y".
 *
 * Cash only. Cheques (`#goLines`) and credit (`#goAshrai`) have never been
 * opened, and this refuses any payment type but מזומן.
 */
import { readFileSync } from 'node:fs';
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { openProgram, fillLookup, dismissPopups } from '../../src/navigate.js';
import { profile, FILL_ORDER } from '../../src/documents/agents/receipt/index.js';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
const confirm = args.includes('--confirm');
const allocate = args.includes('--allocate');

const input = { method: 'מזומן', details: 'קבלה לבדיקת סוכן', ...(path ? JSON.parse(readFileSync(path, 'utf8')) : {}) };
if (input.method !== 'מזומן') {
  console.log(`סירוב: רק מזומן מומש. שיקים ואשראי לא נפתחו מעולם. ביקשת: ${input.method}`);
  process.exit(1);
}
if (!input.customer || input.amount == null) {
  console.log('חסר customer או amount. דוגמה: {"customer":"112001","amount":"1"}');
  process.exit(1);
}

const logger = new RunLogger('receipt-drive');
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

await human.click(profile.list.new, { scope: list, label: 'הוספה (קבלה חדשה)' });
await human.settle('header');
const header = frameFor(profile.frames.header);
if (!header) throw new Error('הכותרת לא נפתחה.');
if (!/ADD/i.test(header.url())) throw new Error(`הכותרת נפתחה במצב ${header.url().match(/DocMode=%?2?7?(\w+)/i)?.[1]}, לא ADD.`);

const nextNo = (await header.locator(H.docNo).getAttribute('title').catch(() => null))
  ?? (await header.innerText('body').catch(() => '')).match(/\((\d{6,})\)/)?.[1] ?? null;
logger.step('receipt', `מספר מוצע: ${nextNo ?? '(לא נקרא)'}`);

// FILL_ORDER is not cosmetic: choosing the customer resets `Sug` to credit and
// takes #Mezuman off the page with it, so an amount typed first is discarded.
logger.step('receipt', `סדר מילוי: ${FILL_ORDER.join(' → ')}`);

await fillLookup(ctx, { frame: header, field: H.customer, value: String(input.customer), what: 'לקוח' });
await dismissPopups(ctx);

// The label is not clickable — no <label for>. The radio itself is the target.
await human.click(`input[name="Sug"][value="${H.paymentTypes['מזומן']}"]`, { scope: header, label: 'סוג תשלום = מזומן' });
await human.settle('cash block');

const cash = await header.locator(H.cashAmount).count().catch(() => 0);
if (!cash) throw new Error('#Mezuman לא על הדף — המעבר למזומן לא תפס. לא ממשיך.');

await human.type(H.cashAmount, String(input.amount), { scope: header, label: 'סכום' });
if (input.details) await human.type(H.details, input.details, { scope: header, label: 'פרטים' });
if (input.ref) await human.type(H.ref, input.ref, { scope: header, label: 'אסמכתא' });
await dismissPopups(ctx);

const read = async (sel) => header.locator(sel).inputValue().catch(() => null);
const filled = {
  לקוח: await read(H.customer),
  סכום: await read(H.cashAmount),
  פרטים: await read(H.details),
  תאריך: await read(H.date),
  'מספר מוצע': nextNo,
};
logger.save('header.json', filled);
await logger.shot(page, 'receipt-ready');

console.log('\n  הקבלה מוכנה לקליטה:');
for (const [k, v] of Object.entries(filled)) console.log(`    ${k.padEnd(12)} ${v ?? ''}`);
console.log(`    ${'אמצעי'.padEnd(12)} מזומן  (בלוק האשראי לא על הדף)`);

if (!confirm) {
  console.log('\n  DRY RUN — לא נקלט. הקבלה פתוחה על המסך.');
  console.log('  לקלוט:  node tools/_smoke/receipt-drive.mjs <קובץ> --confirm');
  console.log('  לצאת :  node tools/_smoke/receipt-backout.mjs\n');
  await s.browser.close().catch(() => {});
  logger.done();
  process.exit(0);
}

/* ------------------------------------------------------------- the filing -- */

await human.click(H.ok, { scope: header, label: 'אישור הכותרת (פותח את דיאלוג הקליטה)' });
await human.settle('close dialog');

const dlg = frameFor(profile.frames.closeDialog);
if (!dlg) throw new Error('דיאלוג הקליטה (KabalaCloseNU) לא נפתח — לא לוחץ כלום.');
await human.select(profile.closeDialog.copies, profile.printCopies, { scope: dlg, label: `עותקים = ${profile.printCopies}` })
  .catch(() => logger.step('receipt', 'לא הצלחתי לקבוע עותקים — ממשיך עם ברירת המחדל'));
await human.click(profile.closeDialog.ok, { scope: dlg, label: profile.finalizeLabel });
await human.settle('filed');
await logger.shot(page, 'after-filing');

/* ---------------------------------------------------------- the allocation -- */

const orders = frameFor(profile.frames.allocateOrders);
if (orders) logger.step('receipt', 'נפתח גם מסך הזמנות — ללקוח יש הזמנות פתוחות. מתעלם.');

const alloc = page.frames().find((f) => /ShiuhIdx_Fr\.aspx?$/i.test(f.url().split('?')[0]));
let rows = [];
if (alloc) {
  const inputs = await alloc.locator(profile.allocation.rows).all();
  for (const el of inputs) {
    const id = await el.getAttribute('id').catch(() => null);
    if (!/^I\d+$/.test(id ?? '')) continue;
    rows.push({ id, סכום: await el.getAttribute('title').catch(() => null), משויך: await el.inputValue().catch(() => '') });
  }
  logger.save('allocation.json', rows);
  const picked = rows.filter((r) => r.משויך);
  console.log('\n  מסך השיוך נפתח. קומקס מילא מראש:');
  for (const r of picked) console.log(`    ${r.id}  ${r.סכום ?? ''}  ← ${r.משויך}`);
  if (!picked.length) console.log('    (שום שורה לא מולאה מראש)');
}

const docNo = nextNo;
if (!allocate) {
  console.log('\n  ⚠️ הקבלה נקלטה. מסך השיוך פתוח ולא אושר.');
  console.log('  לאשר את השיוך:  node tools/_smoke/receipt-drive.mjs <קובץ> --confirm --allocate');
  console.log('  להשאיר כיתרת זכות: ללחוץ #ZeroSh ואז #OK ידנית\n');
} else if (alloc) {
  const shell = frameFor(/ShiuhIdxV\.aspx?/i);
  await human.click(profile.allocation.ok, { scope: shell ?? alloc, label: 'אישור השיוך' });
  await human.settle('allocated');
  console.log('\n  השיוך אושר.');
}

await logger.shot(page, 'after-allocation');

/* ----------------------------------------------------------- verification -- */

if (docNo) {
  await openProgram(ctx, profile.shortcut, { expect: profile.frames.list }).catch(() => {});
  const l2 = frameFor(profile.frames.list);
  if (l2) {
    // A hand-filed receipt is in the 68000xx series and is NOT in the default
    // grid — 6800005 was filed and verified while the grid showed only 70100xx.
    await human.type(profile.list.findDocNo, String(docNo), { scope: l2, label: `סינון לקבלה ${docNo}` });
    await l2.locator(profile.list.findDocNo).press('Enter').catch(() => {});
    await human.settle('filtered');
    const body = await l2.innerText('body').catch(() => '');
    const row = body.split('\n').map((x) => x.trim()).find((x) => x.includes(String(docNo)));
    console.log(row ? `\n  ✅ אומת ברשימה: ${row}\n` : `\n  ⚠️ קבלה ${docNo} לא נמצאה בסינון — לבדוק ידנית.\n`);
  }
}

await s.browser.close().catch(() => {});
logger.done();
