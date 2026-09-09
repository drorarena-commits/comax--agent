/**
 * מה לקוח רכש בעבר.
 *
 * Dror's rule (02/09/2026): a customer's purchase history lives in exactly three
 * programs, and nothing else counts —
 *
 *   חשבונית מס        a157 → Doc650
 *   חשבונית מס/קבלה   a132 → Doc652
 *   הצעת מחיר         a164 → Doc612   (only to see whether he was already quoted the item)
 *
 * תעודות משלוח and every other document type are out of scope. This exists
 * because the first time the question was asked the answer came back missing
 * a132 and padded with תעודות משלוח — a wrong shape, quietly.
 *
 * SAFETY — read this before touching the navigation below:
 * Opening a document from the list lands on `<Doc>U.asp` with `DocMode='UPDATE'`.
 * Its `#OK` is "continue to the lines". But on the *lines* screen
 * (`<Doc>LinesV.asp`) the very same `#OK` is labelled "(Alt+e) קליטת חשבונית" —
 * it commits the document. So `pressOk()` refuses to click unless the frame it
 * is aimed at is a `U.asp` header. The way out of a document is `#DoExit` on the
 * lines screen followed by `#Cancel` on the header, never `#OK`.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram, closePrograms, dismissPopups } from '../navigate.js';
import { readTotals, vatRegime } from '../document-totals.js';
import { itemIndex, catalogWarning, catalogState } from '../catalog/enrich.js';

export const meta = {
  name: 'customer-history',
  description: 'מה לקוח רכש בעבר — חשבונית מס, חשבונית מס/קבלה, והצעת מחיר',
  writes: false, // reads only: opens documents and backs out without committing
  input: {
    customer: 'string — קוד או שם לקוח. חובה',
    item: 'string, אופציונלי — ברקוד / מק"ט חלופי / חלק משם, לסינון הפלט',
    programs: 'array, אופציונלי — דריסה של שלוש התוכניות. ברירת המחדל היא השלוש',
    maxDocs: 'number, אופציונלי — תקרת מסמכים לתוכנית. ברירת המחדל 25',
  },
};

/**
 * The three programs, in the order a person would check them. `doc` is only a
 * hint for `openProgram`; the real prefix is read back off the frame URL, so a
 * program that moves does not silently open the wrong screen.
 */
/**
 * `program` הוא נתיב הנפילה אחורה כשהאייקון לא בשולחן העבודה.
 *
 * קומקס מסדר מחדש את השולחן בלי להודיע. נמדד 04/09/2026: מתוך 51 אייקונים,
 * `a157` פשוט **לא קיים** יותר — בזמן ש-`a132`, `a164` ו-`a224` כן. בלי הנתיב
 * הזה `openProgram` היה מחכה 30 שניות לאייקון שלא יגיע ואז נופל.
 */
const PROGRAMS = [
  { id: 'a157', label: 'חשבונית מס', doc: 'Doc650', program: 'Erp/Mehirot/Doc650/Inv_Mlay/Doc650V.asp' },
  { id: 'a132', label: 'חשבונית מס/קבלה', doc: 'Doc652', program: 'Erp/Mehirot/Doc650/InvKab_Mlay/Doc652V.asp' },
  { id: 'a164', label: 'הצעת מחיר', doc: 'Doc612', program: 'Erp/Mehirot/Doc612/AzaaMhr/Doc612V.asp' },
];

/** Header labels that carry the document number, across the three programs. */
const DOC_NO_HEADERS = ['חשבונית', 'הצעה', 'תעודה', 'מסמך'];

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* ---------------------------------------------------------------- catalog -- */

// ההעשרה עברה ל-src/catalog/enrich.js — כלל 5 במקום אחד, משותף עם
// customer-movements. היה כאן עותק פרטי, והדוח השני לא העשיר בכלל.

/** Does this line match what the caller asked about? Code, alt code, or name. */
function lineMatches(line, needle) {
  if (!needle) return true;
  const q = clean(needle).toLowerCase();
  const hay = [line.code, line.altCode, line.name, line.model].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

/* ------------------------------------------------------------------ grids -- */

/**
 * Read a Max2000 list grid as records rather than a wall of cells.
 *
 * The three lists do not share a column order (`חשבונית` sits in a different
 * place in each), so nothing here may be positional: the header row is located
 * by the "שם לקוח" column every document list has, and every other column is
 * found by its label.
 */
async function readList(frame) {
  return frame.evaluate((docHeaders) => {
    const txt = (c) => (c.innerText || '').replace(/\s+/g, ' ').trim();
    const tables = [...document.querySelectorAll('table')];
    for (const t of tables) {
      const rows = [...t.rows].map((tr) => [...tr.cells].map(txt));
      const hi = rows.findIndex((r) => r.includes('שם לקוח'));
      if (hi < 0) continue;
      const head = rows[hi];
      const at = (label) => head.indexOf(label);
      const docCol = docHeaders.map(at).find((i) => i >= 0);
      if (docCol === undefined) continue;
      const out = [];
      for (const r of rows.slice(hi + 1)) {
        const docNo = r[docCol];
        if (!docNo || !/^\d+$/.test(docNo)) continue;
        out.push({
          docNo,
          date: r[at('מתאריך')] ?? '',
          customer: r[at('שם לקוח')] ?? '',
          customerCode: r[at('לקוח')] ?? '',
          amount: r[at('סכום')] ?? '',
          store: at('מחסן') >= 0 ? r[at('מחסן')] : '',
        });
      }
      return { header: head, rows: out };
    }
    return { header: [], rows: [] };
  }, DOC_NO_HEADERS);
}

/**
 * Read a document's lines. Same rule as above — columns by label, never by
 * position. `מחיר` appears twice in an invoice (unit and per-י"ח); the one that
 * matters is the one immediately before `כמות`, which holds in all three.
 */
async function readLines(frame) {
  return frame.evaluate(() => {
    const txt = (c) => (c.innerText || '').replace(/\s+/g, ' ').trim();
    // Column labels are not spelled identically across document types — the
    // discount reads "הנחה %" on an invoice and "הנחה%" on a cash-register
    // invoice. Matching the literal string silently dropped every Doc652
    // discount, which is exactly where discounts are large.
    const key = (s) => String(s ?? '').replace(/\s/g, '');
    const at = (head, label) => head.findIndex((h) => key(h) === key(label));

    const t = [...document.querySelectorAll('table')].find((t) =>
      [...t.rows].some((r) => [...r.cells].some((c) => txt(c) === 'שם פריט')));
    if (!t) return { head: [], lines: [] };
    const rows = [...t.rows].map((tr) => [...tr.cells].map(txt));
    const hi = rows.findIndex((r) => r.includes('שם פריט'));
    const head = rows[hi];
    const qty = at(head, 'כמות');
    const cols = {
      name: at(head, 'שם פריט'),
      code: at(head, 'פריט'),
      qty,
      // `מחיר` appears twice (unit and per-י"ח); the one that matters sits
      // immediately before `כמות` in all three document types.
      price: qty > 0 && key(head[qty - 1]) === 'מחיר' ? qty - 1 : head.map(key).lastIndexOf('מחיר'),
      discount: at(head, 'הנחה %'),
      total: at(head, 'סכום'),
    };

    return {
      head,
      lines: rows.slice(hi + 1)
        .filter((r) => r[cols.name])
        .map((r) => ({
          name: r[cols.name] ?? '',
          code: r[cols.code] ?? '',
          qty: r[cols.qty] ?? '',
          price: r[cols.price] ?? '',
          discount: cols.discount >= 0 ? (r[cols.discount] ?? '') : '',
          total: r[cols.total] ?? '',
        })),
    };
  });
}

/* -------------------------------------------------------------- documents -- */

/**
 * Click `#OK`, but only on a document *header*. On the lines screen the same id
 * commits the document, so aiming this at the wrong frame would issue a real
 * invoice. The check is here, in code, rather than in a comment someone reads
 * once.
 */
async function pressOk(ctx, frame, label) {
  const url = frame.url();
  if (!/U\.asp/i.test(url) || /LinesV/i.test(url)) {
    throw new Error(`סירוב ללחוץ #OK מחוץ למסך כותרת — ה-frame הוא ${url.split('/').pop()}. במסך השורות #OK קולט את המסמך.`);
  }
  await ctx.human.click('#OK', { scope: frame, label });
}

/** Open one document, read header + lines, and back out without committing. */
async function peek(ctx, { list, prefix, docNo, listAmount = null }) {
  const { page, human, logger } = ctx;
  const F = (re) => page.frames().find((f) => re.test(f.url()));
  const HEADER = new RegExp(`${prefix}U\\.asp`, 'i');
  const LINES = new RegExp(`${prefix}LinesV`, 'i');

  await human.doubleClick(`td:text-is(${JSON.stringify(docNo)})`, { scope: list, label: `פתיחת מסמך ${docNo}` });
  await human.settle('header opening');

  const hdr = F(HEADER);
  if (!hdr) throw new Error(`כותרת המסמך ${docNo} לא נפתחה`);
  const header = await hdr.evaluate(() => {
    const g = (id) => document.getElementById(id)?.value ?? '';
    return { docNo: g('DocNo'), date: g('DateDoc'), customer: g('IdxLk'), store: g('Store'), priceList: g('Mhr'), pratim: g('Pratim') };
  });

  let lines = [];
  let lineHead = [];
  let summary = null;
  try {
    // A self-opening dialog (the customer remarks popup is the usual one) sits
    // on top of the header and swallows the אישור click: the click reports
    // success, the header never advances, and the failure surfaces later as
    // "the lines screen did not open". Clear it before pressing anything.
    await dismissPopups(ctx);

    // The lines frame does not always paint inside one settle, so wait for it
    // the way `openProgram` does, and give the click one more chance — a single
    // check turns a slow screen, or a swallowed click, into a failed run.
    let linesFrame = null;
    for (let attempt = 0; attempt < 2 && !linesFrame; attempt++) {
      if (attempt) {
        logger.step('retry', `אישור הכותרת של ${docNo} לא קידם — מנקה חלונות קופצים ומנסה שוב`);
        await dismissPopups(ctx);
      }
      await pressOk(ctx, hdr, 'אישור כותרת — מעבר לשורות');
      await human.settle('lines loading');
      for (let i = 0; i < 4 && !linesFrame; i++) {
        linesFrame = F(LINES);
        if (!linesFrame) await human.think(`waiting for lines of ${docNo}`);
      }
    }
    if (!linesFrame) throw new Error(`מסך השורות של ${docNo} לא נפתח`);
    ({ head: lineHead, lines } = await readLines(linesFrame));
    summary = await readTotals(linesFrame);
    // Out through the door, not through קליטה.
    await human.click('#DoExit', { scope: linesFrame, label: 'יציאה מהשורות בלי קליטה' });
    await human.settle('left lines');
  } finally {
    const back = F(HEADER);
    if (back) {
      await human.click('#Cancel', { scope: back, label: `ביטול — סגירת ${docNo}` }).catch(() => {});
      await human.settle('document closed');
    }
  }
  const vat = vatRegime(lines, summary, listAmount);
  logger.step('doc', `${docNo} · ${header.date} · ${lines.length} שורות · ${vat.mode === 'included' ? 'שורות כולל מע"מ' : vat.mode === 'excluded' ? 'שורות לפני מע"מ' : 'משטר מע"מ לא ידוע'}${vat.rate ? ` ${vat.rate}%` : ''}`);
  return { ...header, docNo: header.docNo || docNo, lines, lineHead, summary, vat };
}

/* ------------------------------------------------------------------- task -- */

export async function run(ctx) {
  const { page, human, logger, input } = ctx;
  if (!input.customer) throw new Error('חסר customer — על איזה לקוח לבדוק?');

  const wanted = input.programs?.length
    ? PROGRAMS.filter((p) => input.programs.includes(p.id) || input.programs.includes(p.label))
    : PROGRAMS;
  const maxDocs = input.maxDocs ?? 25;

  await ensureLoggedIn({ ...ctx, logger });

  const found = [];
  for (const prog of wanted) {
    // Windows stack, and a covered frame swallows clicks — four open programs
    // once failed a run with "iframe intercepts pointer events".
    await closePrograms(ctx).catch(() => {});

    const { frame: list } = await openProgram(ctx, prog.id, {
      expect: new RegExp(`${prog.doc}V\\.asp`, 'i'),
      program: prog.program,
    });
    const prefix = (/\/(Doc\d+)V\.asp/i.exec(list.url()) ?? [])[1];
    if (!prefix) throw new Error(`${prog.label}: לא זיהיתי את קידומת המסמך מתוך ${list.url()}`);
    if (prefix !== prog.doc) logger.step('warn', `${prog.label}: ציפיתי ל-${prog.doc} וקיבלתי ${prefix}`);

    // Typing + Enter applies the filter. NOT #Find — that opens the חיתוכים
    // dialog and leaves it hanging over the list.
    await human.type('#wFindLkNm', String(input.customer), { scope: list, label: `לקוח בסינון (${prog.label})` });
    await human.press('Enter', { label: 'החלת הסינון' });
    await human.think('filter applied');

    const { rows } = await readList(list);
    logger.step('list', `${prog.label}: ${rows.length} מסמכים`);
    if (rows.length > maxDocs) logger.step('warn', `${prog.label}: ${rows.length} מסמכים, נקראים ${maxDocs} הראשונים`);

    const docs = [];
    for (const row of rows.slice(0, maxDocs)) {
      docs.push({ ...(await peek(ctx, { list, prefix, docNo: row.docNo, listAmount: row.amount })), amount: row.amount });
    }
    found.push({ program: prog.label, id: prog.id, prefix, docs });
  }

  await closePrograms(ctx).catch(() => {});
  await logger.shot(page, 'done');

  /* ---- report ---------------------------------------------------------- */

  const cat = itemIndex();
  const num = (s) => Number(String(s ?? '').replace(/,/g, '')) || 0;

  /**
   * The unit price actually charged, and its net equivalent.
   *
   * `מחיר` in the line is the price list figure; what was really charged is
   * `סכום / כמות`. And that amount carries VAT or not depending on the document
   * (see `vatRegime`), so a second figure — `net` — strips it when present. Only
   * `net` is ever compared across documents; showing the raw charge next to a
   * price list from the other side of the VAT line is how "41% הנחה" got reported
   * for what was actually the plain half-of-gross wholesale price.
   */
  const enrich = (doc) => (l) => {
    const c = cat.get(String(l.code));
    const qty = num(l.qty);
    const charged = qty ? num(l.total) / qty : num(l.price);
    const rate = doc.vat?.rate ?? null;
    const net = doc.vat?.mode === 'included' && rate ? charged / (1 + rate / 100) : charged;
    return {
      ...l,
      altCode: c?.altCode ?? '',
      model: c?.model ?? '',
      desc: c?.name ?? l.name,
      charged: charged.toFixed(2),
      net: net.toFixed(2),
      vatMode: doc.vat?.mode ?? 'unknown',
      vatRate: rate,
      comparable: doc.vat?.mode !== 'unknown',
      // The list price and the charge only line up when no discount applied and
      // both sit on the same side of VAT.
      offList: Math.abs(net - num(l.price)) > 0.01,
    };
  };

  const VAT_TAG = { included: 'כולל מע"מ', excluded: 'לפני מע"מ', unknown: 'מע"מ לא ידוע' };
  const priceText = (l) => {
    const head = `${l.charged} ${VAT_TAG[l.vatMode]}`;
    const extra = [];
    if (l.vatMode === 'included') extra.push(`${l.net} לפני מע"מ`);
    if (l.offList && num(l.price)) extra.push(`מחירון ${l.price}`);
    if (l.discount) extra.push(`הנחה ${l.discount}%`);
    return extra.length ? `${head}  (${extra.join(' · ')})` : head;
  };

  const summaryText = (d) => {
    const s = d.summary;
    if (!s) return '   סיכום המסמך לא נקרא';
    const bits = [];
    if (s.subtotal != null) bits.push(`סכום ${s.subtotal.toFixed(2)}`);
    if (s.discount) bits.push(`הנחה ${s.discount.toFixed(2)}`);
    if (s.beforeVat != null) bits.push(`לפני מע"מ ${s.beforeVat.toFixed(2)}`);
    if (s.vat != null) bits.push(`מע"מ ${s.vat.toFixed(2)}${s.vatRate ? ` (${s.vatRate}%)` : ''}`);
    if (s.total != null) bits.push(`כולל מע"מ ${s.total.toFixed(2)}`);
    return `   סיכום קומקס: ${bits.join(' · ')}`;
  };

  console.log(`\n════ היסטוריית רכש — ${input.customer} ════`);

  // כלל 5: פריטים מוצגים לפי מק"ט חלופי, לעולם לא ברקוד. אם הקטלוג לא נטען,
  // הדוח מפר את הכלל — ואומר את זה בקול, במקום להדפיס ברקודים בשקט.
  itemIndex();
  const catWarn = catalogWarning();
  if (catWarn) {
    logger.step('warn', `הקטלוג לא נטען — הפריטים מוצגים לפי ברקוד (${catalogState().reason})`);
    console.log(`\n${catWarn}`);
  }
  for (const p of found) {
    console.log(`\n── ${p.program} (${p.id})`);
    if (!p.docs.length) { console.log('   אין מסמכים'); continue; }
    for (const d of p.docs) {
      const tag = VAT_TAG[d.vat?.mode ?? 'unknown'];
      console.log(`\n   ${d.docNo} · ${d.date} · ${d.amount}${d.store ? ` · ${d.store}` : ''}${d.priceList ? ` · ${d.priceList}` : ''}`);
      console.log(`   שורות ${tag}${d.vat?.rate ? ` · מע"מ ${d.vat.rate}%` : ''}${d.vat?.source === 'inferred' ? ' (הוסק מהיחס, לא מהסיכום)' : ''}`);
      console.log(summaryText(d));
      if (d.pratim) console.log(`   פרטים: ${d.pratim}`);
      for (const l of d.lines.map(enrich(d))) {
        console.log(`     ${(l.altCode || l.code).padEnd(18)} ${l.desc}  —  ${l.qty} × ${priceText(l)} = ${l.total}`);
      }
    }
  }

  // The focused answer: every line for one item, oldest first, so "same price as
  // last time" is a single glance rather than a diff of two documents.
  let matches = [];
  if (input.item) {
    matches = found.flatMap((p) => p.docs.flatMap((d) =>
      d.lines.map(enrich(d)).filter((l) => lineMatches(l, input.item))
        .map((l) => ({ program: p.program, docNo: d.docNo, date: d.date, store: d.store, priceList: d.priceList, ...l }))));
    matches.sort((a, b) => {
      const key = (s) => String(s).split('/').reverse().join('');
      return key(a.date).localeCompare(key(b.date));
    });

    console.log(`\n════ "${input.item}" אצל הלקוח ════`);
    if (!matches.length) {
      console.log('   לא נמצא באף מסמך — אין מחיר קודם להשוות אליו.');
    } else {
      for (const m of matches) {
        console.log(`   ${m.date}  ${m.program} ${m.docNo}  ${m.altCode || m.code}  ${m.desc}  ${m.qty} × ${priceText(m)}${m.store ? ` · ${m.store}` : ''}${m.priceList ? ` · ${m.priceList}` : ''}`);
      }

      // Compare net prices only. The documents sit on different sides of the VAT
      // line, so comparing what each one displays would report a difference that
      // is nothing but the 18%.
      const usable = matches.filter((m) => m.comparable);
      const skipped = matches.length - usable.length;
      if (skipped) console.log(`\n   ${skipped} שורות לא נכללות בהשוואה — משטר המע"מ שלהן לא זוהה.`);

      const prices = [...new Set(usable.map((m) => m.net))];
      const mixed = new Set(usable.map((m) => m.vatMode)).size > 1;
      if (mixed) console.log('   (המסמכים אינם באותו משטר מע"מ — ההשוואה היא על המחיר לפני מע"מ)');

      // One line is not "the same price every time" — it is the first time, and
      // saying otherwise would answer "did we repeat the price" with a yes.
      console.log(!usable.length
        ? '\n   אין שורה שאפשר להשוות.'
        : usable.length === 1
          ? `\n   פעם אחת בלבד — ${prices[0]} לפני מע"מ. אין מחיר קודם להשוות אליו.`
          : prices.length === 1
            ? `\n   אותו מחיר בכל ${usable.length} הפעמים: ${prices[0]} לפני מע"מ`
            : `\n   מחירים שונים לאורך הזמן (לפני מע"מ): ${prices.join(' → ')}`);
    }
  }

  return { customer: input.customer, item: input.item ?? null, programs: found, matches };
}
