/**
 * מחיר סיטונאי — הלוגיקה, במקום אחד, לכל סוגי המסמכים.
 *
 * This used to live inside `src/tasks/quote-add-line.js`, bolted to
 * `Doc612LinesU`. That was fine while only the quote priced anything, and
 * became expensive the moment an invoice had to: `engine.addLine` writes
 * whatever `price`/`discount` it is handed and **never zeroes a discount**, so
 * a tax invoice on מחירון קבוצות took Comax's own offer instead of the rule.
 * Quotes 6120050 and 6120051 (06/09/2026) are what that looks like — 199.90 a
 * unit where the rule gives 140, 43% too expensive, and nothing on screen
 * saying anything is wrong.
 *
 * The rule (Dror, 01/09/2026, in force until price list 111 is populated):
 *
 *     wholesale net = round(gross list price / 2)     — whole shekels, pre-VAT
 *
 * The arithmetic itself lives in `src/catalog/pricing.js`. What lives here is
 * everything around it: when the rule applies at all, which of the two entry
 * routes to use, and the read-back that proves the money landed where it was
 * aimed.
 *
 * The selectors are deliberately absent — the caller reads the gross and hands
 * it in, and the caller writes the fields. `#Mhr`, `#AczDis` and `#Scm` happen
 * to be spelled the same on Doc612 and Doc650, but relying on that here would
 * put the coupling straight back.
 */
import { readFileSync } from 'node:fs';
import { readTotals } from '../document-totals.js';
import {
  wholesaleFromGross,
  wholesaleDiscountPct,
  WHOLESALE_FACTOR,
  DEFAULT_VAT_RATE,
} from '../catalog/pricing.js';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Price lists whose VAT behaviour we have actually observed — knowledge/lists.json. */
export function knownPriceLists() {
  try {
    return JSON.parse(readFileSync(new URL('../../knowledge/lists.json', import.meta.url), 'utf8')).priceLists ?? [];
  } catch {
    return [];
  }
}

/**
 * Does this document want wholesale pricing, and if so what goes in the fields?
 *
 * Returns `{ price, discount, plan }`. `plan` is `null` when the rule does not
 * apply, and then `price`/`discount` are simply what the caller passed — so the
 * result can go straight to the fields either way.
 *
 * Wholesale is the **default** under a price list marked `wholesale` in
 * `knowledge/lists.json`, not something the caller has to remember to ask for.
 * Dror, 06/09/2026: "מחירון קבוצות" and "מחיר סיטונאי" mean the same thing to
 * him — half the gross, every line, every item.
 *
 * Two ways to override, both deliberate:
 *   `item.wholesale === false`     — this document is not wholesale after all
 *   an explicit `price`/`discount` — "מחיר מפורש גובר" (MAP.md)
 *
 * The flag comes off the price list the **document** declares, read from its
 * footer, not from what the caller passed as `priceList` — the customer card
 * can override the header, and the money follows the document.
 */
export async function resolveWholesale({ logger, grid, gross, item = {} }) {
  const passthrough = { price: item.price, discount: item.discount, plan: null };

  const explicitPrice = item.price != null || item.discount != null;
  let wantWholesale = item.wholesale === true;
  let totals = null;

  if (!wantWholesale && item.wholesale !== false && !explicitPrice) {
    if (!grid) return passthrough; // no lines grid to ask — nothing to infer from
    totals = await readTotals(grid);
    const known = knownPriceLists().find((pl) => pl.name === totals.priceList);
    if (known?.wholesale === true) {
      wantWholesale = true;
      logger?.step('wholesale', `מחירון "${totals.priceList}" מסומן כסיטונאי — מחיר סיטונאי כברירת מחדל`);
    }
  }

  if (!wantWholesale) return passthrough;
  if (gross == null) throw new Error('לא הצלחתי לקרוא את מחיר הברוטו מקומקס.');

  // Ask the document, do not assume. Writing the halved price into a
  // VAT-inclusive document has Comax read 145 as gross — net 122.88 instead of
  // 145.00, ~15% under-charged, on a document that looks fine afterwards.
  totals = totals ?? await readTotals(grid);

  // The **price list** is what decides the regime — that is the mechanism, not
  // an inference from it. Reading it off the footer works on an empty document
  // too, where there are no totals to compare against yet.
  //
  // Comax's own label wins: the footer names the price list and says when it
  // includes VAT, which stays right for one nobody has catalogued.
  // knowledge/lists.json is the fallback for a price list that says nothing.
  const known = knownPriceLists().find((pl) => pl.name === totals.priceList);
  const declared = totals.vatIncludedLabel ?? known?.vatIncluded ?? null;
  const mode = declared === true ? 'included' : declared === false ? 'excluded' : 'unknown';

  // An empty document states no rate — there is nothing to derive it from until
  // a line exists. The default is used, and said out loud.
  const rate = totals.vatRate ?? DEFAULT_VAT_RATE * 100;
  if (totals.vatRate == null) {
    logger?.step('warn', `המסמך עוד לא מצהיר על שיעור מע"מ — מניח ${rate}% ומאמת מול הסיכום אחרי השמירה`);
  }

  if (mode === 'unknown') {
    throw new Error(
      `לא הצלחתי לקבוע אם המחירון "${totals.priceList ?? '?'}" כולל מע"מ.\n`
      + 'מחיר סיטונאי מוזן אחרת בכל אחד מהמקרים, והפער הוא כ-18% על מסמך אמיתי — '
      + 'אז אני עוצר במקום לנחש.\n'
      + 'תזין מחיר או הנחה מפורשים, או תוסיף vatIncluded למחירון ב-knowledge/lists.json '
      + 'אחרי שראית מסמך אמיתי שמוכיח את זה.',
    );
  }

  const target = wholesaleFromGross(gross);
  let price = item.price;
  let discount = item.discount;

  if (mode === 'included') {
    // Leave the price Comax offered; the discount does the work. This is how
    // Dror does it by hand, and it is what invoice 1014444 shows.
    discount = wholesaleDiscountPct(gross, rate);
    logger?.step('wholesale', `${totals.priceList ?? 'מחירון'} כולל מע"מ (${rate}%) — משאיר מחיר ${gross}, הנחה ${discount}% ⇒ נטו ${target}`);
  } else {
    price = target;
    discount = 0; // otherwise Comax applies its discount to the halved price
    logger?.step('wholesale', `מחירון לפני מע"מ — ברוטו ${gross} × ${WHOLESALE_FACTOR} → ${price} (הנחה מאופסת)`);
  }

  return { price, discount, plan: { mode, rate, gross, target, priceList: totals.priceList } };
}

/**
 * Prove the net landed on the target, from the fields as they now read.
 *
 * Everything above can be right and still land wrong — Comax recalculates on
 * Tab and can reinstate a standard discount — and a wholesale line that is 18%
 * off looks entirely normal in the document afterwards. So the arithmetic is
 * confirmed, not assumed.
 */
export function assertWholesaleLanded(plan, line, logger) {
  if (!plan) return;
  const p = num(line.price);
  const d = num(line.discount) ?? 0;
  if (p == null) throw new Error('לא הצלחתי לקרוא בחזרה את המחיר מהשורה.');

  const charged = p * (1 - d / 100);
  const net = plan.mode === 'included' ? charged / (1 + plan.rate / 100) : charged;
  if (Math.abs(net - plan.target) > 0.05) {
    throw new Error(
      `מחיר סיטונאי לא נחת נכון: יצא נטו ${net.toFixed(2)} במקום ${plan.target}.\n`
      + `בשדות: מחיר ${line.price} · הנחה ${line.discount} · משטר ${plan.mode} · מע"מ ${plan.rate}%`,
    );
  }
  logger?.step('wholesale', `אומת: נטו ${net.toFixed(2)} = היעד ${plan.target}`);
}
