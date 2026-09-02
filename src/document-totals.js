/**
 * The totals block under a Max2000 document's line grid, and what it tells us
 * about VAT.
 *
 * Shared deliberately between the reading side (`customer-history`) and the
 * writing side (`quote-add-line`): if the two ever disagreed about whether a
 * document's lines carry VAT, one of them would be quietly off by the whole
 * rate — 18% of a real document.
 *
 * Comax paints these totals into **readonly inputs**, and the labels render
 * right-to-left (`:סה"כ לפני מע"מ`) with the value on the far side of the row,
 * so reading the frame's text yields labels and no numbers. The ids are the way:
 *
 *   ScmBeforeDis   סכום              Scm_Dis / Acz_Dis   הנחה + %
 *   ScmBeforeMaam  סה"כ לפני מע"מ    Scm_Maam / AczM     מע"מ + %
 *   Scm            סה"כ כולל מע"מ
 */

export const money = (s) => Number(String(s ?? '').replace(/,/g, '')) || 0;

/** Read the totals block out of a document's lines frame. */
export async function readTotals(frame) {
  const raw = await frame.evaluate(() => {
    const fields = {};
    for (const el of document.querySelectorAll('input,textarea')) {
      const v = (el.value ?? '').trim();
      if (el.id && v) fields[el.id] = v;
    }
    return { fields, body: (document.body?.innerText || '').slice(0, 1200) };
  });

  const num = (s) => (s == null || s === '' ? null : Number(String(s).replace(/,/g, '')));
  const f = (id) => num(raw.fields[id]);

  const beforeVat = f('ScmBeforeMaam');
  const vat = f('Scm_Maam');
  const total = f('Scm');

  const { priceList, vatIncludedLabel } = priceListFrom(raw.body);

  return {
    priceList,
    vatIncludedLabel,
    subtotal: f('ScmBeforeDis'),
    discount: f('Scm_Dis'),
    discountRate: f('Acz_Dis'),
    beforeVat,
    vat,
    // `AczM` holds the rate on a חשבונית מס but is absent on a חשבונית מס/קבלה,
    // where it has to come from the amounts. Leaving it null there made every
    // VAT-inclusive line skip its own conversion and report the gross price as
    // if it were net.
    vatRate: f('AczM') ?? deriveRate(beforeVat, vat, total),
    total,
    fields: raw.fields,
    // Kept so a document that parses badly is diagnosable from result.json
    // rather than by opening it again — each read costs about 25 seconds.
    raw: raw.body,
  };
}

/**
 * The price list named in the footer — the signal that decides whether the
 * lines carry VAT, and the only one available on a document with no lines yet.
 *
 * The label and its value sit on the same visual row, but which comes first in
 * `innerText` depends on how the RTL table serialises: an invoice gives
 * "מחירון קבוצות\t:לפי מחירון" and a quote gives ":לפי מחירון\tמכירה ראשי".
 * A regex anchored to either order picks up the neighbouring row on the other,
 * which is how ":סה\"כ כולל מע\"מ" once came back as the price list name.
 * So: take the line the label is on, remove the label, keep the remainder.
 */
function priceListFrom(body) {
  const line = String(body ?? '').split(/\r?\n/).find((l) => l.includes('לפי מחירון'));
  if (!line) return { priceList: null, vatIncludedLabel: null };
  const value = line.replace(/:?\s*לפי מחירון\s*:?/, ' ').replace(/\s+/g, ' ').trim();

  // Comax states the regime right there in the label — "מכירה ראשי (כולל מע"מ)".
  // That is the price list declaring what it is, which beats any table we keep
  // on the side: it is right for a price list nobody has told us about yet.
  //
  // The quote mark inside מע"מ is not one character but whichever Comax felt
  // like: a gershayim, a straight double quote, or — as this screen actually
  // renders it — two apostrophes. So any run of quote-ish characters counts.
  const VAT = 'מע[\'"״׳`]*\\s*מ';
  const vatIncludedLabel = new RegExp(`\\(\\s*כולל\\s*${VAT}\\s*\\)`).test(line) ? true
    : new RegExp(`\\(\\s*לא\\s*כולל\\s*${VAT}\\s*\\)`).test(line) ? false
      : null;

  // The name without the "(כולל מע"מ)" note, so it still matches lists.json.
  const name = value
    .replace(new RegExp(`\\(\\s*(?:לא\\s*)?כולל\\s*${VAT}\\s*\\)`), '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    priceList: name && name !== 'לא נבחר' ? name : null,
    vatIncludedLabel,
  };
}

/** The rate implied by the amounts, for documents that do not state it. */
function deriveRate(beforeVat, vat, total) {
  const base = beforeVat;
  if (!base) return null;
  const amount = vat ?? (total != null ? total - base : null);
  if (amount == null) return null;
  const pct = (amount / base) * 100;
  // Israeli VAT has been 17-18% over the span these documents cover. A ratio
  // outside that neighbourhood means the fields were not what we thought.
  if (pct < 5 || pct > 30) return null;
  return Math.round(pct * 100) / 100;
}

/**
 * Whether a document's line amounts already carry VAT.
 *
 * On מחירון קבוצות the lines are net and Comax adds VAT at the total
 * (570 → 673). On the general price list the line amount is already gross and
 * the document total equals the plain sum of the lines (1,038.14 → 1,038.14).
 *
 * Decided from the totals block; only if that could not be read does it fall
 * back to the ratio against the list grid's סכום column.
 */
export function vatRegime(lines, totals, listAmount = null) {
  const lineSum = lines.reduce((a, l) => a + money(l.total), 0);
  // Relative, not absolute: a document-level discount shifts the total slightly
  // away from the sum of the lines (4,207.00 vs 4,206.78 on invoice 6500022),
  // and a fixed one-agora window rejected that correct match. The two candidates
  // are ~18% apart, so half a percent is nowhere near ambiguous.
  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.005);

  if (totals?.beforeVat != null || totals?.total != null) {
    if (near(lineSum, totals.beforeVat)) return { mode: 'excluded', rate: totals.vatRate, source: 'summary', lineSum };
    if (near(lineSum, totals.total)) return { mode: 'included', rate: totals.vatRate, source: 'summary', lineSum };
  }
  const total = money(listAmount);
  if (total && lineSum) {
    const ratio = total / lineSum;
    if (ratio > 1.02) return { mode: 'excluded', rate: Math.round((ratio - 1) * 10000) / 100, source: 'inferred', lineSum };
    if (Math.abs(ratio - 1) <= 0.02) return { mode: 'included', rate: totals?.vatRate ?? null, source: 'inferred', lineSum };
  }
  return { mode: 'unknown', rate: totals?.vatRate ?? null, source: 'none', lineSum };
}
