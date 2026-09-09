/**
 * תעודת העברה קיימת → חשבונית מס סיטונאית לאותו לקוח.
 *
 * The two documents have nothing in common in Comax: a transfer is two
 * warehouses and a list of quantities, an invoice is a customer, a price list
 * and money. **A transfer carries no customer at all** — so the customer is
 * something the caller states, never something this task infers from the
 * document. That is also why the transfer is addressed by number: there is no
 * "the transfer of customer X" to search for.
 *
 * Three modes, and `--confirm` deliberately does **not** file:
 *
 *   (no flag)              read the transfer, show the items, stop
 *   --confirm              + open the invoice and fill every line, stop before
 *                            קליטה, print price · discount · net per line
 *   file:true --confirm    file the invoice **already on screen** — reads no
 *                            transfer and creates nothing
 *
 * Splitting `file` off `--confirm` is Dror's rules 2 and 3 taken literally: a
 * write task fills the form, screenshots, and stops before the save button, and
 * the amounts are on screen before approval is asked for. Filing a tax invoice
 * moves stock the moment it is pressed and there is no unfiling — so it gets
 * its own word.
 *
 * ⚠️ And `file` is a **separate mode, not an extra step** — כלי אחד ממלא, כלי
 * אחד קולט. The first version re-ran the whole flow with `file:true`, which
 * would have created a second invoice, filed that, and left the approved one
 * abandoned. `expectTotal` carries the approval across the two runs.
 *
 *   node tools/run.js transfer-to-invoice --json '{"transfer":"6010295","customer":"112447"}'
 *   node tools/run.js transfer-to-invoice --json '{...}' --confirm
 *   node tools/run.js transfer-to-invoice --json '{"file":true,"expectTotal":1867}' --confirm
 */
import { ensureLoggedIn } from '../session.js';
import { closePrograms } from '../navigate.js';
import * as transfer from '../documents/agents/transfer/index.js';
import * as invoice from '../documents/agents/invoice/index.js';
import * as engine from '../documents/engine.js';
import { itemLabel, catalogWarning } from '../catalog/enrich.js';

export const meta = {
  name: 'transfer-to-invoice',
  description: 'העתקת שורות מתעודת העברה קיימת לחשבונית מס סיטונאית',
  writes: true,
  input: {
    transfer: 'string — מספר תעודת ההעברה (470xxxx או 601xxxx). חובה',
    customer: 'string — קוד או שם לקוח לחשבונית. חובה — לתעודת ההעברה אין לקוח',
    store: 'string, אופציונלי — מחסן החשבונית. ברירת המחדל "מחסן קבוצות"',
    date: 'string dd/mm/yyyy, אופציונלי',
    details: 'string, אופציונלי — שדה פרטים. ברירת המחדל מפנה לתעודה',
    agent: 'string, אופציונלי — סוכן',
    consolidate: 'boolean, אופציונלי — לאחד שורות של אותו מק\"ט לכמות אחת. ברירת המחדל true',
    expectTotal: 'number, אופציונלי — הסכום שאושר. הקליטה תסרב אם המסמך שעל המסך שונה ממנו',
    file: 'boolean — לקלוט את החשבונית **שכבר פתוחה על המסך**. לא קורא תעודה ולא יוצר מסמך. דורש גם --confirm',
  },
};

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * The item code as Comax hands it back from a resolved lookup:
 * `"3468337082118 - משקפת קוברה..."`. Only the part before the first " - " is
 * the code, and that is what goes back into `#Prt` — feeding the whole string
 * back would fail the lookup on a document that otherwise looked fine.
 */
const codeOf = (cell) => String(cell ?? '').split(' - ')[0].trim();

export async function run(ctx) {
  const { page, human, logger, cfg, input, dryRun } = ctx;

  // Only the read-and-fill path needs these; filing acts on what is on screen.
  if (!input.file && !input.transfer) {
    throw new Error(
      'חסר transfer — מספר תעודת ההעברה.\n'
      + 'אין דרך לחפש תעודת העברה לפי לקוח: המסמך הוא בין שני מחסנים ואין בו שדה לקוח כלל.',
    );
  }
  if (!input.file && !input.customer) {
    throw new Error('חסר customer — לתעודת ההעברה אין לקוח, אז הלקוח לחשבונית חייב להימסר במפורש.');
  }
  if (input.file && dryRun) {
    throw new Error('file: true בלי --confirm. קליטת חשבונית מזיזה מלאי ואין לה ביטול — צריך את שניהם.');
  }

  await ensureLoggedIn({ page, human, logger, cfg });

  /* ── 0. קליטה בלבד — המסמך שכבר על המסך ────────────────────────────── */

  /*
   * 💣 `file: true` must **not** re-run stages 1–2.
   *
   * The first version did, and it was a loaded gun: it would have read the
   * transfer again, opened a *second* invoice, filled it, and filed that —
   * leaving the invoice Dror had just approved (6500086) abandoned and unfiled,
   * while a number he never saw went out to the customer. The printed
   * "next command" pointed straight at it.
   *
   * This is the same lesson `transfer-add-lines` / `transfer-file` already
   * carry: **כלי אחד מוסיף, כלי אחד קולט.** Filing acts on the document that is
   * on screen, and reads nothing.
   *
   * `expectTotal` is how approval is carried across the two runs: Dror approved
   * a number, so the click refuses unless the document still shows that number.
   */
  if (input.file) {
    const grid = engine.linesFrame(ctx, invoice.profile);
    if (!grid) {
      throw new Error(
        'אין חשבונית פתוחה על מסך השורות — אין מה לקלוט.\n'
        + '  file: true קולט את המסמך שכבר על המסך; הוא לא קורא תעודה ולא יוצר חשבונית.\n'
        + '  אם החלון נסגר: לפתוח את החשבונית מהרשימה, או להריץ שוב בלי file ולמלא מחדש.',
      );
    }

    const open = await invoice.readTotals(ctx).catch(() => ({}));
    const docNo = await engine.readDocNumber(ctx, invoice.profile).catch(() => null);
    logger.step('file', `קולט את החשבונית הפתוחה${docNo ? ` (${docNo})` : ''} · סה"כ ${open.total ?? '?'}`);

    if (input.expectTotal != null) {
      const seen = num(open.total);
      const want = num(input.expectTotal);
      if (seen == null || want == null || Math.abs(seen - want) > 0.005) {
        throw new Error(
          `החשבונית שעל המסך מסתכמת ב-${open.total ?? '(לא נקרא)'} ואישרת ${input.expectTotal}.\n`
          + '  לא קולט מסמך שאינו זה שאושר.',
        );
      }
      logger.step('file', `הסכום תואם לאישור (${want}) ✓`);
    }

    const done = await invoice.finalize(ctx, { confirm: true, lines: [] });
    console.log(done.filed
      ? `\n  החשבונית${docNo ? ` ${docNo}` : ''} נקלטה. סה"כ ${done.totals?.total ?? '?'}\n`
      : '\n  לא נקלטה.\n');
    return { filedOnly: true, docNo, ...done };
  }

  await closePrograms(ctx).catch(() => {});

  /* ── 1. קריאת תעודת ההעברה ─────────────────────────────────────────── */

  const source = await transfer.read(ctx, input.transfer);
  logger.save('transfer.json', source);

  if (!source.lines.length) {
    throw new Error(
      `תעודה ${source.docNo} נפתחה אבל לא נקראו ממנה שורות.\n`
      + '  לא ממציא שורות לחשבונית — לבדוק את התעודה על המסך.',
    );
  }

  const raw = source.lines.map((l) => ({ code: codeOf(l.code), qty: num(l.qty), name: l.name }));

  /*
   * איחוד לפי מק"ט — ברירת המחדל, לבקשת דרור (06/09/2026).
   *
   * A transfer is built by scanning each physical unit, so the same item comes
   * back as several rows of ×1 rather than one row with a quantity: 6010295
   * held 20 rows over 14 distinct items. Copied one-for-one, the customer's
   * invoice shows the same product twice — which reads as a mistake even though
   * it is faithful to the source.
   *
   * Same rule Dror stated for barcodes sent by hand: a repeat is a quantity,
   * not another line. `consolidate: false` keeps the 1:1 shape.
   *
   * The unit total is asserted below, because merging is exactly the kind of
   * step that can quietly lose one.
   */
  const items = input.consolidate === false ? raw : (() => {
    const by = new Map();
    for (const i of raw) {
      if (by.has(i.code)) by.get(i.code).qty += i.qty;
      else by.set(i.code, { ...i });
    }
    return [...by.values()];
  })();

  const unitsBefore = raw.reduce((s, i) => s + (i.qty ?? 0), 0);
  const unitsAfter = items.reduce((s, i) => s + (i.qty ?? 0), 0);
  if (Math.abs(unitsBefore - unitsAfter) > 0.005) {
    throw new Error(`האיחוד שינה את סך היחידות: ${unitsBefore} → ${unitsAfter}. עוצר.`);
  }
  if (items.length !== raw.length) {
    logger.step('איחוד', `${raw.length} שורות בתעודה → ${items.length} שורות בחשבונית, ${unitsAfter} יחידות (ללא שינוי)`);
  }

  const missing = items.filter((i) => !i.code || !i.qty);
  if (missing.length) {
    throw new Error(
      `${missing.length} שורות בתעודה ${source.docNo} בלי קוד או בלי כמות — עוצר.\n`
      + missing.map((i) => `    ${i.name || '(בלי שם)'} · קוד "${i.code}" · כמות "${i.qty}"`).join('\n'),
    );
  }

  // כלל 5 — מק"ט חלופי או דגם+צבע, לעולם לא ברקוד על המסך.
  const warn = catalogWarning();
  if (warn) console.log(`\n${warn}`);

  console.log(`\n  תעודת העברה ${source.docNo} · ${source.header.תאריך ?? '?'}`);
  console.log(`  ${source.header.ממחסן || '?'} → ${source.header.למחסן || '?'}${source.header.פרטים ? ` · ${source.header.פרטים}` : ''}`);
  console.log(`\n  ${items.length} שורות להעתקה:\n`);
  for (const i of items) {
    const { label } = itemLabel(i.code);
    console.log(`    ${String(label).padEnd(22)} ${String(i.name).slice(0, 34).padEnd(36)} ×${i.qty}`);
  }
  console.log(`\n  סה"כ יחידות: ${items.reduce((s, i) => s + i.qty, 0)}`);

  if (dryRun) {
    logger.step('dryrun', 'נקראה התעודה בלבד. החשבונית לא נפתחה.');
    console.log('\n  DRY RUN — לא נוצרה חשבונית. למילוי הטופס: --confirm\n');
    return { dryRun: true, transfer: source, items };
  }

  /* ── 2. החשבונית ───────────────────────────────────────────────────── */

  // The transfer's own program is still on screen and a covered frame swallows
  // clicks — four open programs once failed a run outright.
  await closePrograms(ctx).catch(() => {});

  const created = await invoice.create(ctx, {
    customer: input.customer,
    store: input.store ?? 'מחסן קבוצות',
    date: input.date,
    agent: input.agent,
    details: input.details ?? `תעודת העברה ${source.docNo} -`,
    // priceList is not passed on purpose: the invoice profile forces
    // מחירון קבוצות and reads it back before committing the header. Passing
    // anything here would only produce a "נדרס" line in the log.
  });

  // No `price`/`discount` on the items: under מחירון קבוצות the engine reads the
  // gross off each line and applies the wholesale rule itself. Passing a price
  // would be read as "מחיר מפורש גובר" and switch the rule off.
  const lines = await invoice.addLines(ctx, items.map((i) => ({ code: i.code, qty: i.qty })));

  const filed = await invoice.finalize(ctx, { confirm: !!input.file, lines });

  /* ── 3. הדיווח ─────────────────────────────────────────────────────── */

  const t = filed.totals ?? {};
  console.log(`\n  חשבונית מס ${created.docNo ?? ''} · לקוח ${input.customer} · מחסן ${input.store ?? 'מחסן קבוצות'}`);
  console.log(`  מחירון: ${t.priceList ?? '?'}\n`);
  for (const [i, l] of lines.entries()) {
    const { label } = itemLabel(items[i].code);
    const gross = l.gross ? `ברוטו ${l.gross} → ` : '';
    console.log(`    ${String(label).padEnd(22)} ×${l.qty}  ${gross}${l.price}  -${l.discount ?? 0}%  = ${l.amount ?? '?'}`);
  }
  console.log(`\n  לפני מע"מ: ${t.beforeVat ?? '?'}   מע"מ: ${t.vat ?? '?'}   סה"כ: ${t.total ?? '?'}`);

  if (filed.filed) {
    console.log('\n  החשבונית נקלטה.\n');
  } else {
    console.log(
      '\n  החשבונית מלאה ופתוחה על המסך — לא נקלטה.\n'
      + `  לקליטה, אחרי אישור:\n    node tools/run.js transfer-to-invoice --json '{"file":true,"expectTotal":${t.total ?? 0}}' --confirm\n`,
    );
  }

  return { transfer: source, ...created, lines, ...filed };
}
