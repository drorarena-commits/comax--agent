/**
 * Pricing rules, in one place so a change is a one-line change.
 *
 * Wholesale ("סיטונאי") — interim rule agreed 01/09/2026, in force until the
 * real price list 111 is populated in Comax:
 *
 *   wholesale net = round(gross list price / 2)   — whole shekels, before VAT
 *
 * Three things this rule depends on, each learned the hard way:
 *
 * 1. The base is the **gross** list price — what Comax puts in `#Mhr` before it
 *    applies the standard discount. For the test item that is 289.90.
 *    It is NOT the catalog's price, which is the *net* after that discount
 *    (239.89 = 289.90 × 0.8275). Halving the net would under-quote by ~17%.
 * 2. Any standard discount must be zeroed, or Comax applies it again on top of
 *    the already-halved price.
 * 3. **The target is the net.** How it is entered depends on the document's
 *    price list, which is where the earlier version of this file was wrong —
 *    it declared "quoting under this price list is always pre-VAT".
 *
 * The two entry routes, both landing on the same money (Dror, 02/09/2026):
 *
 *   price list excludes VAT   `#Mhr` = round(gross/2), `#AczDis` = 0
 *   price list includes VAT   `#Mhr` untouched, `#AczDis` = the percentage that
 *                             lands on the same net — see below
 *
 * Entering the halved price into a VAT-inclusive document would have Comax read
 * 145 as gross: net 122.88 instead of 145.00, ~15% under-charged, on a document
 * that looks perfectly ordinary afterwards.
 */

export const WHOLESALE_FACTOR = 0.5;
export const WHOLESALE_SINCE = '2026-09-01';

/**
 * Only for display when no document is open to read the real rate from. The
 * rate moved from 17% to 18% inside the span of documents we read, so anything
 * that computes money takes it from the document — `readTotals().vatRate` in
 * `src/document-totals.js`.
 */
export const DEFAULT_VAT_RATE = 0.18;

/** Whole shekels — Dror asked for the agorot to be rounded away. */
export function wholesaleFromGross(gross) {
  const g = Number(gross);
  if (!Number.isFinite(g)) return null;
  return Math.round(g * WHOLESALE_FACTOR);
}

/**
 * The discount to type into a document whose price list already includes VAT,
 * so that the net comes out at the wholesale target.
 *
 * Derived from the **rounded** target rather than fixed at "half plus VAT":
 * the rule rounds to whole shekels, so a flat 41% would land on 144.95 while
 * the other route lands on 145.00 — six agorot apart on the bottom line, for
 * no reason. The net is the target; the percentage is only how we get there.
 *
 *   target   = round(gross / 2)
 *   discount = (1 − target × (1 + rate) / gross) × 100
 *
 * For 289.90 at 18%: 1 − 171.10/289.90 → 40.98%.
 */
export function wholesaleDiscountPct(gross, vatRate) {
  const g = Number(gross);
  const rate = Number(vatRate);
  if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(rate)) return null;
  const target = wholesaleFromGross(g);
  const pct = (1 - (target * (1 + rate / 100)) / g) * 100;
  return Math.round(pct * 100) / 100;
}

/** What the customer ends up paying, for showing alongside a draft. */
export function withVat(amount, vatRate = DEFAULT_VAT_RATE * 100) {
  const n = Number(amount);
  const rate = Number(vatRate);
  if (!Number.isFinite(n) || !Number.isFinite(rate)) return null;
  return Math.round(n * (1 + rate / 100) * 100) / 100;
}
