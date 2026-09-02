/**
 * סוכן תעודת העברה — `a111`.
 *
 * The odd one out, and the reason a per-document agent beats a shared form
 * filler: a transfer has **no customer, no price list and no prices**. Its
 * header is two warehouses — from and to — and its lines are item + quantity.
 * Everything the sales documents care about (מחירון, הנחה, מע"מ, סוכן) is
 * absent, and the one thing it does care about — that the source warehouse
 * actually holds the stock — none of them check.
 *
 * ⚠️ NOT MAPPED YET. `a111` has never been opened by the agent: it appears in
 * `knowledge/screens/*.json` only because every snapshot captures all 52 desktop
 * icons, and `knowledge/MAP.md` has no section on it (`grep "העבר"` → 0 hits).
 * The ids below are the sales-document names and are almost certainly wrong for
 * this screen. `mapped: false` keeps the engine from acting on them; mapping is
 * one `npm run open-program -- a111` plus a snapshot away.
 */
import * as engine from '../../engine.js';

export const profile = {
  name: 'transfer',
  label: 'תעודת העברה',
  shortcut: 'a111',
  doc: 'Doc?', // unknown until the screen is opened once
  movesStock: true,

  mapped: { list: false, header: false, lines: false },

  frames: {
    list: /תעודות-העברה-לא-מופה/i,
    header: /תעודות-העברה-לא-מופה/i,
    linesGrid: /תעודות-העברה-לא-מופה/i,
    lineForm: /תעודות-העברה-לא-מופה/i,
  },

  // Guesses, kept only so the shape is visible. Replace from a real snapshot.
  header: { new: '#newRec', ok: '#OK', cancel: '#Cancel', docId: '#DocId', storeFrom: '#StoreM', storeTo: '#StoreA', date: '#DateDoc', details: '#Pratim' },
  line: { item: '#Prt', qty: '#Cmt', ok: '#OK', okNew: '#OkNew' },
  totals: {},
  finalizeLabel: 'קליטת תעודת העברה',
};

/** How to map this screen, printed instead of guessing at it. */
export const HOW_TO_MAP = [
  'npm run open-program -- a111',
  'npm run snapshot -- transfer-list',
  '# ואז, אחרי לחיצה על הוספה:',
  'npm run snapshot -- transfer-header',
].join('\n  ');

function refuse(what) {
  throw new Error(
    `תעודת העברה: ${what} — המסך לא מופה עדיין, ואני לא מנחש שדות במסמך שמזיז מלאי.\n` +
    `  למפות:\n  ${HOW_TO_MAP}`,
  );
}

export async function create(ctx, input) {
  if (!input.storeFrom || !input.storeTo) {
    throw new Error('תעודת העברה דורשת storeFrom ו-storeTo — אין כאן לקוח.');
  }
  refuse('create');
}

export async function addLines() { refuse('addLines'); }
export async function finalize() { refuse('finalize'); }
export const backOut = (ctx) => engine.backOut(ctx, profile);
