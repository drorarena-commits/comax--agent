/**
 * קריאת שורות של מסמך קיים — כל השורות, ובהוכחה.
 *
 * This exists because the same paged-grid reader was written twice: once inside
 * `src/documents/agents/transfer/index.js` (where rule 16 was discovered on
 * 06/09/2026) and once, from scratch and at the cost of ten minutes of a live
 * session, when someone asked to read a quote on 08/09/2026. The second time is
 * the reason this file is shared rather than local: a document reader that only
 * one agent can reach is a reader the next agent will rewrite.
 *
 * 💣 **הרשת מחולקת לדפים — 10 שורות בעמוד — ועמוד ראשון נראה כמו מסמך שלם.**
 * Measured on transfer 6010295: eight rows, numbered 1–8, summing to 8 units
 * and 722.89, while the document's own footer said `סה"כ כמות: 20.00` and
 * `סה"כ: 2,665.80`. No error, no warning, nothing missing on screen. An invoice
 * built from that read would have billed under a third of the goods.
 *
 * So `readAllGridLines` walks the pages and then **proves its own work against
 * the document's declared total quantity**. A reader that cannot prove it saw
 * everything throws instead of returning a plausible subset — partial reading is
 * the one failure mode that looks exactly like success.
 */

/**
 * ⚠️ The paging controls are `<img>` elements carrying **ids** — `#first`,
 * `#prev`, `#next`, `#last`, `#nextRec`, `#prevRec`.
 *
 * NOT `img:text-is("דף הבא")`. `knowledge/screens/*.txt` pretty-prints that
 * selector and it can never match: an `<img>` has no text content, so the label
 * in the snapshot comes from an attribute. Measured 06/09/2026 — the text
 * selector matched nothing, `count()` returned 0, the loop concluded "no next
 * page", and a twenty-unit document was read as eight. Take ids from the
 * `.json` snapshot, never from the pretty `.txt`.
 */
const PAGE_FIRST = '#first';
const PAGE_NEXT = '#next';

/** `סה"כ כמות` under the grid — the only figure that can falsify a partial read. */
export const TOTAL_QTY_FIELD = '#Scm_Cmt';

export const money = (s) => Number(String(s ?? '').replace(/,/g, '')) || 0;

/**
 * One visible page of a document's line grid, as records.
 *
 * Columns by label, never by position. The grid carries about twenty of them
 * (`ש. · פריט · שם פריט · במארז · מארזים · י"ח · סריאלי · כמות · מחיר ·
 * הנחה % · סכום · ת.תוקף · …`) and the order is not something to bet a
 * document on — it differs between document types and Comax reorders it.
 */
export async function readGridPage(grid) {
  return grid.evaluate(() => {
    const txt = (c) => (c.innerText || '').replace(/\s+/g, ' ').trim();
    // Labels are not spelled identically across document types — the discount
    // reads "הנחה %" on an invoice and "הנחה%" on a cash-register invoice.
    // Matching the literal string silently dropped every Doc652 discount, which
    // is exactly where discounts are large.
    const key = (s) => String(s ?? '').replace(/\s/g, '');

    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.rows].some((r) => [...r.cells].some((c) => txt(c) === 'שם פריט')));
    if (!table) return { head: [], lines: [] };

    const rows = [...table.rows].map((tr) => [...tr.cells].map(txt));
    const hi = rows.findIndex((r) => r.includes('שם פריט'));
    const head = rows[hi];
    const at = (...labels) => {
      for (const label of labels) {
        const i = head.findIndex((h) => key(h) === key(label));
        if (i >= 0) return i;
      }
      return -1;
    };

    const qty = at('כמות');
    const cols = {
      // The row-number column renders as "ש." and comes out of innerText as
      // ".ש" depending on how the RTL cell serialises — accept either. It is
      // the only stable identity a row has across pages, and the key that stops
      // page two from overwriting page one.
      no: at('ש.', '.ש'),
      code: at('פריט'),
      name: at('שם פריט'),
      qty,
      // `מחיר` appears twice on some documents (unit price and price per י"ח).
      // The one that matters sits immediately before `כמות`; fall back to the
      // last one rather than the first, which is the per-unit-of-measure figure.
      price: qty > 0 && key(head[qty - 1]) === 'מחיר' ? qty - 1 : head.map(key).lastIndexOf('מחיר'),
      discount: at('הנחה %', 'הנחה%'),
      amount: at('סכום'),
    };

    const cell = (r, i) => (i >= 0 ? (r[i] ?? '') : '');
    return {
      head,
      lines: rows.slice(hi + 1)
        .filter((r) => cols.name >= 0 && r[cols.name])
        .map((r) => ({
          no: cell(r, cols.no),
          code: cell(r, cols.code),
          name: cell(r, cols.name),
          qty: cell(r, cols.qty),
          price: cell(r, cols.price),
          discount: cell(r, cols.discount),
          amount: cell(r, cols.amount),
        })),
    };
  });
}

/**
 * כל שורות המסמך — לא כל השורות שבמקרה על המסך.
 *
 * Returns `{ head, lines, pages }`. Verification is the caller's job via
 * `assertQuantityMatches`, so a caller that genuinely wants one page (a preview)
 * can have it — but it has to say so out loud rather than get it by accident.
 */
export async function readAllGridLines(ctx, grid, { maxPages = 40 } = {}) {
  const { human, logger } = ctx;

  // Start from page one. The grid keeps whatever page the previous interaction
  // left it on, so a reader that does not rewind can miss the opening rows of a
  // document it never touched.
  if (await grid.locator(PAGE_FIRST).count().catch(() => 0)) {
    await human.click(PAGE_FIRST, { scope: grid, label: 'לדף הראשון' }).catch(() => {});
    await human.settle('first page');
  }

  const byNo = new Map();
  let head = [];
  let page = 0;

  for (; page < maxPages; page++) {
    const got = await readGridPage(grid);
    if (got.head.length) head = got.head;

    const before = byNo.size;
    for (const l of got.lines) byNo.set(l.no || `${l.code}#${byNo.size}`, l);
    logger?.step('grid', `דף ${page + 1}: ${got.lines.length} שורות (${byNo.size} מצטבר)`);

    // No new rows means the last page just repeated itself — Max2000 keeps
    // showing the final page when "דף הבא" has nowhere left to go, so the
    // absence of `#next` is not the only way a walk ends.
    if (byNo.size === before && page > 0) break;

    if (!(await grid.locator(PAGE_NEXT).count().catch(() => 0))) break;
    await human.click(PAGE_NEXT, { scope: grid, label: 'לדף הבא' });
    await human.settle(`page ${page + 2}`);
  }

  return { head, lines: [...byNo.values()], pages: page + 1 };
}

/** The document's own declared total quantity, or null when the field is absent. */
export async function readDeclaredQuantity(grid) {
  const raw = await grid.locator(TOTAL_QTY_FIELD).inputValue().catch(() => null);
  return raw == null || raw === '' ? null : money(raw);
}

/**
 * מה שקראנו חייב להסתכם למה שהמסמך מצהיר (כלל 16).
 *
 * Throws on a mismatch **and** on an unreadable total: lines nobody can check
 * are not a smaller answer, they are an unknown one, and rule 9 says an unknown
 * is a refusal rather than a guess.
 */
export async function assertQuantityMatches(grid, lines, what) {
  const got = lines.reduce((a, l) => a + money(l.qty), 0);
  const expected = await readDeclaredQuantity(grid);

  if (expected == null) {
    throw new Error(
      `${what}: לא הצלחתי לקרוא את "סה"כ כמות" מהמסמך (${TOTAL_QTY_FIELD}).\n`
      + `  נקראו ${lines.length} שורות בסך ${got} יחידות, ואין מול מה לאמת אותן.\n`
      + '  לא מחזיר שורות שלא הוכחתי שהן כל השורות.',
    );
  }
  if (Math.abs(expected - got) > 0.005) {
    throw new Error(
      `${what}: קראתי ${got} יחידות ב-${lines.length} שורות, אבל המסמך אומר סה"כ כמות ${expected}.\n`
      + '  הרשת מחולקת לדפים (10 בעמוד), וכנראה לא הגעתי לסופה.\n'
      + '  צילום המסך של הרשת נמצא בתיקיית ההרצה.',
    );
  }
  return { quantity: got, declared: expected };
}

/**
 * ההוכחה שקראנו את כל השורות — בכל סוג מסמך (כלל 16).
 *
 * `סה"כ כמות` (`#Scm_Cmt`) exists on a תעודת העברה, where it is the natural
 * check because a transfer has no prices. **It does not exist on a הצעת מחיר.**
 * Measured 08/09/2026 on quote 6120029: the footer carries סה"כ · הנחה ·
 * סה"כ לפני מע"מ · מע"מ · סה"כ כולל מע"מ, and no quantity total at all — so the
 * quantity check refused a document it had actually read correctly.
 *
 * A priced document proves itself the other way: the line amounts must sum to
 * what the document says its lines sum to (`ScmBeforeDis`). Either proof is
 * sufficient; having neither is still a refusal, because unverified lines are
 * an unknown answer rather than a smaller one (כלל 9).
 */
export async function assertLinesComplete(grid, lines, what, { totals = null } = {}) {
  const declaredQty = await readDeclaredQuantity(grid);
  if (declaredQty != null) {
    const { quantity } = await assertQuantityMatches(grid, lines, what);
    return { by: 'quantity', quantity, declared: declaredQty };
  }

  const sum = lines.reduce((a, l) => a + money(l.amount), 0);
  const declared = totals?.subtotal;
  if (declared == null) {
    throw new Error(
      `${what}: אין במסמך לא "סה"כ כמות" ולא סיכום שורות שאפשר לאמת מולו.\n`
      + `  נקראו ${lines.length} שורות בסך ${sum.toFixed(2)}, ואין מול מה להוכיח שהן כל השורות.\n`
      + '  לא מחזיר שורות שלא הוכחתי שהן כל השורות.',
    );
  }
  // Relative tolerance, like `vatRegime`: a rounded line can shift the sum by
  // an agora or two without meaning a page was missed.
  if (Math.abs(declared - sum) > Math.max(0.05, Math.abs(declared) * 0.005)) {
    throw new Error(
      `${what}: קראתי ${lines.length} שורות בסך ${sum.toFixed(2)}, אבל המסמך אומר סה"כ ${declared.toFixed(2)}.\n`
      + '  הרשת מחולקת לדפים (10 בעמוד), וכנראה לא הגעתי לסופה.\n'
      + '  צילום המסך של הרשת נמצא בתיקיית ההרצה.',
    );
  }
  return {
    by: 'amount',
    quantity: lines.reduce((a, l) => a + money(l.qty), 0),
    amount: sum,
    declared,
  };
}
