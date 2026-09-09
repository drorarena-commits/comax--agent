/**
 * Pricing for a new parent item.
 *
 * Two of the three numbers are fixed and hold across every batch we have:
 *
 *   מחירון 1 (סיטונאי קטלוגי) = מחיר בסיס × 0.5
 *   מחירון 3 (צרכן רשת)       = מחיר בסיס
 *
 * The base price itself is Dror's rule: cost in EUR × 20, rounded to a retail
 * X9.9. Note it does **not** reproduce the FW26 batch, where the same ×20 came
 * out 82 · 200 · 321 · 314 · 267 — whole shekels, not 79.9 · 199.9 · 319.9.
 * That is why `mode` exists and why every run prints the price table for
 * approval before anything is written: the multiplier is settled, the rounding
 * is the part that still gets a human look.
 */
export const MULTIPLIER = 20;

/** Nearest price ending in 9.9 — 82.2 → 79.9, 200.4 → 199.9, 320.6 → 319.9. */
export function roundX99(v) {
  return Math.max(9.9, Math.round(v / 10) * 10 - 0.1);
}

/** Plain whole shekels, which is what the FW26 batch actually used. */
export function roundInt(v) {
  return Math.round(v);
}

export const ROUNDING = { x99: roundX99, int: roundInt };

/**
 * @param {number} costEur  `Net unit price` off the Arena invoice
 * @param {'x99'|'int'} mode
 */
export function priceFromCost(costEur, mode = 'x99') {
  const round = ROUNDING[mode];
  if (!round) throw new Error(`עיגול לא מוכר: ${mode} (x99 או int)`);
  const raw = Number(costEur) * MULTIPLIER;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const base = round(raw);
  return {
    costEur: Number(costEur),
    raw: Number(raw.toFixed(2)),
    base,                              // T  — מחיר בסיס / צרכן קטלוגי
    wholesale: Number((base / 2).toFixed(2)), // Z  — מחירון 1
    chain: base,                       // AB — מחירון 3
    mode,
  };
}
