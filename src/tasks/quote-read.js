/**
 * מציאת הצעת מחיר קיימת וקריאתה — a164 / Doc612.
 *
 * WHY THIS FILE EXISTS (08/09/2026)
 * ---------------------------------
 * Everything under `src/tasks/` that touched a quote was a *write* flow —
 * `quote-new`, `quote-add-line`, `quote-finalize`, `quote-email`, `quote-full`.
 * Asking "find me the quote we sent them" had no entry point, so the agent
 * started authoring one live, mid-session, and burned about ten minutes writing
 * code that already existed in `src/documents/engine.js` and in the transfer
 * agent. Comax itself cost roughly seventy seconds of that.
 *
 * So: reading an existing quote is now a task, not an improvisation.
 *
 * SAFETY — read before touching the navigation below:
 * Opening a document from the list lands on `Doc612U.asp` with `DocMode='UPDATE'`,
 * whose `#OK` means "continue to the lines". On the *lines* screen
 * (`Doc612LinesV.asp`) the very same `#OK` is "קליטת המסמך" — it commits.
 * `pressHeaderOk` therefore refuses to click unless the frame it is aimed at is
 * a `U.asp` header. The way out of a document is `#DoExit` on the lines screen
 * followed by `#Cancel` on the header. Never `#OK`.
 *
 * Rule 16 is enforced here, not described: every line is read across pages and
 * then proved against the document's own summary. A quote has no `סה"כ כמות`,
 * so the proof is the line amounts summing to `סה"כ` — see `assertLinesComplete`.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram, closePrograms, dismissPopups } from '../navigate.js';
import { readTotals, vatRegime, money } from '../document-totals.js';
import { readAllGridLines, assertLinesComplete } from '../documents/read-lines.js';
import { itemIndex, catalogWarning, catalogState } from '../catalog/enrich.js';

export const meta = {
  name: 'quote-read',
  description: 'מוצא הצעת מחיר קיימת (a164 / Doc612) וקורא את שורותיה — קריאה בלבד',
  writes: false, // opens documents and backs out without committing
  input: {
    customer: 'string, אופציונלי — קוד או שם לקוח לסינון הרשימה',
    docNo: 'string/number, אופציונלי — מספר הצעה מדויק. אחד מהשניים חובה',
    item: 'string, אופציונלי — ברקוד / מק"ט חלופי / חלק משם, לאיתור ההצעה הנכונה מבין כמה',
    year: 'string/number, אופציונלי — להגביל לשנה אחת (2026). המספור הרץ מתאפס בין שנים, וזה מה שמכריע כפילות. "all" = בלי סינון',
    all: 'boolean, אופציונלי — לקרוא את שורות כל ההצעות ברשימה ולא רק לרשום אותן',
    maxDocs: 'number, אופציונלי — תקרת מסמכים שנפתחים. ברירת המחדל 10',
  },
};

const PROGRAM = {
  id: 'a164',
  label: 'הצעת מחיר',
  doc: 'Doc612',
  program: 'Erp/Mehirot/Doc612/AzaaMhr/Doc612V.asp',
};

/**
 * תיבות הסינון מצטברות.
 *
 * A filter left over from an earlier run silently narrows the next one, and the
 * result is "אין לו הצעות" on a customer who has several — the same failure
 * mode that rule 11's duplicate check clears its boxes to avoid. So both boxes
 * are emptied before either is filled, every time.
 */
const FILTERS = ['#wFindDocNo', '#wFindLkNm'];

async function clearFilters(list) {
  for (const sel of FILTERS) {
    await list.locator(sel).fill('').catch(() => {});
  }
}

/**
 * The quote list as records. Columns by label — `הצעה` does not sit in the same
 * place as `חשבונית` does in the invoice list, and nothing here may be positional.
 */
async function readList(frame) {
  return frame.evaluate(() => {
    const txt = (c) => (c.innerText || '').replace(/\s+/g, ' ').trim();
    for (const t of [...document.querySelectorAll('table')]) {
      const rows = [...t.rows].map((tr) => [...tr.cells].map(txt));
      const hi = rows.findIndex((r) => r.includes('שם לקוח'));
      if (hi < 0) continue;
      const head = rows[hi];
      const at = (label) => head.indexOf(label);
      const docCol = ['הצעה', 'מסמך', 'תעודה'].map(at).find((i) => i >= 0);
      if (docCol === undefined) continue;
      const out = [];
      for (const tr of [...t.rows].slice(hi + 1)) {
        const r = [...tr.cells].map(txt);
        const docNo = r[docCol];
        if (!docNo || !/^\d+$/.test(docNo)) continue;
        out.push({
          docNo,
          // 💣 מספר הצעה אינו ייחודי — ראה ההערה מעל `peek`. The row has to be
          // addressable on its own, and Max2000 stamps each data row's cells
          // with `class="<row number>"`, which is the only per-row handle the
          // grid offers.
          rowClass: [...tr.cells][docCol]?.className ?? '',
          date: at('מתאריך') >= 0 ? r[at('מתאריך')] : '',
          customer: at('שם לקוח') >= 0 ? r[at('שם לקוח')] : '',
          customerCode: at('לקוח') >= 0 ? r[at('לקוח')] : '',
          amount: at('סכום') >= 0 ? r[at('סכום')] : '',
        });
      }
      return { head, rows: out };
    }
    return { head: [], rows: [] };
  });
}

/**
 * `#OK`, but only on a document header.
 *
 * On the lines screen the identical id files the document. The guard lives in
 * code rather than in a comment someone reads once, because the cost of getting
 * it wrong is a committed quote on a real customer.
 */
async function pressHeaderOk(ctx, frame, label) {
  const url = frame.url();
  if (!/U\.asp/i.test(url) || /LinesV/i.test(url)) {
    throw new Error(
      `סירוב ללחוץ #OK מחוץ למסך כותרת — ה-frame הוא ${url.split('/').pop()}.\n`
      + '  במסך השורות אותו #OK קולט את המסמך.',
    );
  }
  await ctx.human.click('#OK', { scope: frame, label });
}

/**
 * Open one quote, read header + every line, verify, and back out without filing.
 *
 * 💣 **מספר הצעה אינו ייחודי בקומקס.** Measured 08/09/2026: filtering `#wFindDocNo`
 * on 6120029 returned two unrelated documents — 20/05/2026 for 112079 עמותת בני
 * הרצליה at 16,284.00, and 16/07/2025 for 429052 עיריית רמלה at 531.00. The
 * numbering repeats across customers and years.
 *
 * So the row is opened by its **grid row**, never by `td:text-is(<number>)`:
 * that selector matched both rows and Playwright's strict mode threw — which
 * was lucky. Without strict mode it would have opened whichever came first and
 * read a stranger's document under the right heading, with nothing on screen to
 * say so.
 */
async function peek(ctx, { list, docNo, rowClass, listAmount = null }) {
  const { page, human, logger } = ctx;
  const F = (re) => page.frames().find((f) => re.test(f.url()));
  const HEADER = /Doc612U\.asp/i;
  const LINES = /Doc612LinesV/i;

  const target = rowClass
    ? `td[class=${JSON.stringify(rowClass)}]:text-is(${JSON.stringify(String(docNo))})`
    : `td:text-is(${JSON.stringify(String(docNo))})`;
  await human.doubleClick(target, {
    scope: list,
    label: `פתיחת הצעה ${docNo}`,
  });
  await human.settle('header opening');

  const hdr = F(HEADER);
  if (!hdr) throw new Error(`כותרת ההצעה ${docNo} לא נפתחה`);
  const header = await hdr.evaluate(() => {
    const g = (id) => document.getElementById(id)?.value ?? '';
    return {
      docNo: g('DocNo'), date: g('DateDoc'), customer: g('IdxLk'),
      store: g('Store'), priceList: g('Mhr'), pratim: g('Pratim'),
    };
  });

  let lines = [];
  let head = [];
  let summary = null;
  let counted = null;
  let pages = 1;

  try {
    // A self-opening dialog — the customer-remarks popup is the usual one —
    // sits on top of the header and swallows the אישור click: the click reports
    // success, the header never advances, and the failure surfaces later as
    // "the lines screen did not open".
    await dismissPopups(ctx);

    let linesFrame = null;
    for (let attempt = 0; attempt < 2 && !linesFrame; attempt++) {
      if (attempt) {
        logger.step('retry', `אישור הכותרת של ${docNo} לא קידם — מנקה חלונות קופצים ומנסה שוב`);
        await dismissPopups(ctx);
      }
      await pressHeaderOk(ctx, hdr, 'אישור כותרת — מעבר לשורות');
      await human.settle('lines loading');
      for (let i = 0; i < 4 && !linesFrame; i++) {
        linesFrame = F(LINES);
        if (!linesFrame) await human.think(`waiting for lines of ${docNo}`);
      }
    }
    if (!linesFrame) throw new Error(`מסך השורות של ${docNo} לא נפתח`);

    // כלל 16 — כל הדפים, ואז הוכחה מול הסיכום של המסמך עצמו.
    ({ head, lines, pages } = await readAllGridLines(ctx, linesFrame));
    summary = await readTotals(linesFrame);
    await logger.shot(page, `quote-${docNo}-lines`).catch(() => {});
    counted = await assertLinesComplete(linesFrame, lines, `הצעה ${docNo}`, { totals: summary });

    // Out through the door, never through קליטה.
    await human.click('#DoExit', { scope: linesFrame, label: 'יציאה מהשורות בלי קליטה' });
    await human.settle('left lines');
  } finally {
    const back = F(HEADER);
    if (back) {
      await human.click('#Cancel', { scope: back, label: `ביטול — סגירת ${docNo}` }).catch(() => {});
      await human.settle('document closed');
    }
  }

  const vat = vatRegime(lines.map((l) => ({ ...l, total: l.amount })), summary, listAmount);
  logger.step(
    'doc',
    `${docNo} · ${header.date} · ${lines.length} שורות ב-${pages} דפים · ${counted.quantity} יחידות = סה"כ המסמך ✓`,
  );
  return { ...header, docNo: header.docNo || docNo, lines, head, summary, vat, counted, pages };
}

const lineMatches = (line, needle) => {
  if (!needle) return true;
  const q = String(needle).replace(/\s+/g, ' ').trim().toLowerCase();
  return [line.code, line.altCode, line.name, line.model].filter(Boolean).join(' ').toLowerCase().includes(q);
};

export async function run(ctx) {
  const { page, human, logger, input } = ctx;
  if (!input.customer && !input.docNo) {
    throw new Error('חסר customer או docNo — על איזו הצעה מדובר?');
  }
  const maxDocs = input.maxDocs ?? 10;

  await ensureLoggedIn({ ...ctx, logger });
  // Windows stack, and a covered frame swallows clicks — four open programs once
  // failed a run with "iframe intercepts pointer events".
  await closePrograms(ctx).catch(() => {});

  const { frame: list } = await openProgram(ctx, PROGRAM.id, {
    expect: /Doc612V\.asp/i,
    program: PROGRAM.program,
  });

  await clearFilters(list);
  if (input.docNo) {
    await human.type('#wFindDocNo', String(input.docNo), { scope: list, label: 'מספר הצעה בסינון' });
  } else {
    // Typing + Enter applies the filter. NOT #Find — that opens the חיתוכים
    // dialog and leaves it hanging over the list.
    await human.type('#wFindLkNm', String(input.customer), { scope: list, label: 'לקוח בסינון' });
  }
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.think('filter applied');

  const { rows: allRows } = await readList(list);
  logger.step('list', `${allRows.length} הצעות תואמות`);
  await logger.shot(page, 'quote-list').catch(() => {});

  /*
   * סינון לפי שנה — הפתרון לשורש הכפילות.
   *
   * The running document number **restarts each year**, so 6120029 exists both
   * as a 2026 quote and as a 2025 one. What makes that visible here rather than
   * harmless is an asymmetry Dror pointed out (08/09/2026): the quote list
   * shows documents from 2025 while the working year is 2026, whereas seeing an
   * invoice of the same age needs a company switch. So this screen, uniquely,
   * hands back two different documents under one number.
   *
   * `year` is opt-in rather than a default, because filtering by default would
   * silently hide a genuinely old quote — which is the same class of mistake as
   * reading page one and calling it the document. Filtered rows are counted and
   * reported, never dropped in silence.
   */
  const yearOf = (d) => (String(d ?? '').split('/')[2] ?? '').trim();
  const wantYear = input.year == null || String(input.year).toLowerCase() === 'all'
    ? null
    : String(input.year).trim();
  const rows = wantYear ? allRows.filter((r) => yearOf(r.date) === wantYear) : allRows;
  const hidden = allRows.length - rows.length;
  if (hidden) {
    const years = [...new Set(allRows.filter((r) => yearOf(r.date) !== wantYear).map((r) => yearOf(r.date)))];
    logger.step('year', `סינון שנת ${wantYear} — ${hidden} הצעות הוסתרו (${years.join(' · ')})`);
  }

  /* -- which of them to actually open ---------------------------------- */

  // Opening a document costs about 25 seconds. One match, an explicit number, or
  // an explicit request are the only reasons to pay it; otherwise the list comes
  // back fast and the choice stays with Dror rather than being guessed (כלל 9).
  const scanAll = Boolean(input.all || input.item);

  // A document number is not a unique key (see `peek`). When one was asked for
  // and the grid came back with more than one, the customer is what separates
  // them — and with no customer to separate them, this stops. Opening "the
  // first 6120029" would have read עיריית רמלה's document as if it were בני
  // הרצליה's, and nothing in the output would have looked wrong (כלל 9).
  let candidates = rows;
  if (input.docNo && rows.length > 1) {
    const q = String(input.customer ?? '').trim();
    candidates = q
      ? rows.filter((r) => r.customer.includes(q) || String(r.customerCode) === q)
      : [];
    if (!candidates.length) {
      logger.step('warn', `מספר ${input.docNo} אינו חד-משמעי — ${rows.length} מסמכים נושאים אותו`);
    }
  }

  const targets = input.docNo || candidates.length === 1 || scanAll
    ? candidates.slice(0, input.docNo || candidates.length === 1 ? 1 : maxDocs)
    : [];

  if (candidates.length > maxDocs && scanAll) {
    logger.step('warn', `${candidates.length} הצעות, נקראות ${maxDocs} הראשונות`);
  }

  const docs = [];
  for (const row of targets) {
    docs.push({
      ...(await peek(ctx, { list, docNo: row.docNo, rowClass: row.rowClass, listAmount: row.amount })),
      amount: row.amount,
    });
  }

  await closePrograms(ctx).catch(() => {});

  /* -- report ----------------------------------------------------------- */

  const cat = itemIndex();
  const warn = catalogWarning();
  // כלל 5: פריטים מוצגים לפי מק"ט חלופי, לעולם לא ברקוד. אם הקטלוג לא נטען
  // הדוח מפר את הכלל — ואומר את זה בקול במקום להדפיס ברקודים בשקט.
  if (warn) {
    logger.step('warn', `הקטלוג לא נטען — הפריטים מוצגים לפי ברקוד (${catalogState().reason})`);
  }

  const VAT_TAG = { included: 'כולל מע"מ', excluded: 'לפני מע"מ', unknown: 'מע"מ לא ידוע' };
  const enrich = (doc) => (l) => {
    const c = cat.get(String(l.code));
    const qty = money(l.qty);
    const charged = qty ? money(l.amount) / qty : money(l.price);
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
    };
  };

  console.log(`\n════ הצעות מחיר — ${input.docNo ? `מסמך ${input.docNo}` : input.customer} ════`);
  if (warn) console.log(`\n${warn}`);

  if (!rows.length) {
    console.log('\n   לא נמצאו הצעות מחיר בסינון הזה.');
    if (hidden) console.log(`   ⚠️ שים לב: ${hidden} הצעות סוננו החוצה על ידי year=${wantYear}. בלי הסינון היו תוצאות.`);
    console.log('   שים לב: טיוטה שלא נקלטה אינה מופיעה בחיפוש (כלל 15), והצעה משנת כספים קודמת לא תיראה בלי שינוי שנת העבודה.');
  } else {
    console.log(`\n── ${rows.length} הצעות ברשימה${wantYear ? ` (שנת ${wantYear})` : ''}`);
    for (const r of rows) {
      console.log(`   ${r.docNo}  ${r.date}  ${r.customerCode} ${r.customer}  ${r.amount}`);
    }
    // Never a silent filter: a hidden row is stated, with its year, so "אין לו
    // הצעות" can't be an artefact of the filter the caller forgot they passed.
    if (hidden) {
      const older = allRows.filter((r) => yearOf(r.date) !== wantYear);
      console.log(`\n   (${hidden} הצעות נוספות הוסתרו על ידי סינון השנה: ${older.map((r) => `${r.docNo}/${r.date}`).join(' · ')})`);
    }
  }

  if (!targets.length && rows.length > 1) {
    if (input.docNo) {
      const years = [...new Set(rows.map((r) => yearOf(r.date)))];
      console.log(`\n   ⚠️  מספר ${input.docNo} אינו חד-משמעי — ${rows.length} מסמכים נושאים אותו, ללקוחות שונים.`);
      console.log('   המספור הרץ מתאפס בין שנים, ורשימת ההצעות מציגה גם שנים קודמות.');
      console.log(`   להוסיף customer, או year (${years.join(' · ')}), כדי להכריע.`);
    } else {
      console.log('\n   יותר מהצעה אחת — לא בוחר לבד.');
      console.log('   להריץ שוב עם docNo מדויק (יחד עם customer), או עם item כדי לסנן לפי פריט, או all:true לקרוא את כולן.');
    }
  }

  for (const d of docs) {
    console.log(`\n── הצעה ${d.docNo} · ${d.date} · ${d.customer}${d.priceList ? ` · מחירון ${d.priceList}` : ''}`);
    console.log(`   ${d.lines.length} שורות ב-${d.pages} דפים · ${d.counted.quantity} יחידות = סה"כ המסמך ✓`);
    console.log(`   שורות ${VAT_TAG[d.vat?.mode ?? 'unknown']}${d.vat?.rate ? ` · מע"מ ${d.vat.rate}%` : ''}`);
    if (d.summary) {
      const s = d.summary;
      const bits = [];
      if (s.priceList) bits.push(`לפי מחירון ${s.priceList}`);
      if (s.subtotal != null) bits.push(`סכום ${s.subtotal.toFixed(2)}`);
      if (s.discount) bits.push(`הנחה ${s.discount.toFixed(2)}`);
      if (s.beforeVat != null) bits.push(`לפני מע"מ ${s.beforeVat.toFixed(2)}`);
      if (s.vat != null) bits.push(`מע"מ ${s.vat.toFixed(2)}`);
      if (s.total != null) bits.push(`כולל מע"מ ${s.total.toFixed(2)}`);
      console.log(`   סיכום קומקס: ${bits.join(' · ')}`);
    }
    if (d.pratim) console.log(`   פרטים: ${d.pratim}`);
    for (const l of d.lines.map(enrich(d))) {
      console.log(`     ${(l.altCode || l.code).padEnd(18)} ${l.desc}  —  ${l.qty} × ${l.charged}${l.discount ? ` (הנחה ${l.discount}%)` : ''} = ${l.amount}`);
    }
  }

  // The focused answer when Dror named an item: which quote actually holds it.
  let matches = [];
  if (input.item) {
    matches = docs.flatMap((d) => d.lines.map(enrich(d))
      .filter((l) => lineMatches(l, input.item))
      .map((l) => ({ docNo: d.docNo, date: d.date, priceList: d.priceList, ...l })));
    console.log(`\n════ "${input.item}" בהצעות ════`);
    if (!matches.length) console.log('   לא נמצא באף הצעה שנקראה.');
    for (const m of matches) {
      console.log(`   הצעה ${m.docNo} · ${m.date}  ${m.altCode || m.code}  ${m.desc}  ${m.qty} × ${m.charged} = ${m.amount}`);
    }
  }

  await logger.shot(page, 'done').catch(() => {});
  return { customer: input.customer ?? null, docNo: input.docNo ?? null, year: wantYear, list: rows, hiddenByYear: hidden, docs, matches };
}
