/**
 * סוכן תעודת העברה — Doc470 (`a111`).
 *
 * The odd one out, and the reason a per-document agent beats a shared form
 * filler: a transfer has **no customer, no price list and no VAT**. Its header
 * is two warehouses — `#Store` (ממחסן) and `#Store1` (למחסן) — and its lines
 * are item + quantity. Everything the sales documents gate on (מחירון, מע"מ,
 * סוכן) is either absent or inert here, and the one thing this document turns
 * on — that the *source* warehouse actually holds the goods, and that the arrow
 * points the way it was meant to — none of them check.
 *
 * So the specialist swaps the gates rather than dropping them:
 *
 * - **Direction is to a transfer what the VAT regime is to an invoice.** Get it
 *   backwards and the stock still moves, just the wrong way, and there is no
 *   "unfile". `assertDirection` reads both warehouses back off the *committed*
 *   lines screen — not off the form it just typed into — and refuses on a
 *   mismatch or on from == to.
 * - **The source balance is checked before the stock moves**, from the local
 *   export in `content/`, and a source warehouse that export does not cover
 *   (מחסן קבוצות is not one of its columns) is reported as unverifiable rather
 *   than assumed fine.
 *
 * Mapped live on 02/09/2026 against document 4700239: list, header and both
 * line screens read off the real thing. **Filing was never run** — 4700239 was
 * backed out — so `finalize` past its gates is the one step still unproven.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as engine from '../../engine.js';
import { ROOT } from '../../../config.js';
import { dismissPopups, fillLookup } from '../../../navigate.js';

export const profile = {
  name: 'transfer',
  label: 'תעודת העברה',
  shortcut: 'a111',
  doc: 'Doc470',
  path: 'Erp/Mlay/TeydatAv/Doc',
  movesStock: true,

  // All three verified live on 4700239 (02/09/2026): Doc470V read off the
  // screen, #newRec opened Doc470U, and committing it opened Doc470LinesV with
  // the Doc470LinesU dialog already up.
  mapped: { list: true, header: true, lines: true },

  frames: {
    list: /Doc470V\.aspx?/i,
    header: /Doc470U\.aspx?/i,
    linesGrid: /Doc470LinesV\.aspx?/i,
    lineForm: /Doc470LinesU\.aspx?/i,
    /**
     * Named exactly, and the engine's `/Close|Kbl|Ishur/i` fallback must never
     * be allowed to stand in for it here: the header URL carries `SwNoClose=0`
     * in its query string, so on 4700239 that fallback matched **the header**,
     * found no `#PrintCopies` in it, pressed the header's own `#OK`, and then
     * reported the document unfiled while `Doc470CloseU` sat open on screen.
     * `frameFor` now matches on path only, which is the real fix; this is the
     * belt to that pair of braces.
     */
    closeDialog: /Doc470CloseU\.asp$/i,
  },

  /**
   * `#DocId` is a span holding the number (4700239); `#DocNo` is an input that
   * stays empty — the number is automatic. Same shape as the sales documents.
   * `#OKNot` ("אישור ללא הזמנות") sits beside `#OK`; both only advance to the
   * lines.
   */
  header: {
    new: '#newRec', ok: '#OK', okNoOrders: '#OKNot', cancel: '#Cancel',
    docId: '#DocId',
    storeFrom: '#Store', storeTo: '#Store1',
    date: '#DateDoc', details: '#Pratim', ref: '#Ref', refB: '#RefA',
    countType: '#SvgSfira', agent: '#Sochen', supplier: '#IdxSpk',
  },

  /**
   * `#OkNew` in a lower-case k — the Doc612 spelling, not Doc650's `#OKNew`.
   * There is a fourth tick here the sales documents do not have: `#OkCopy`
   * (אישור+שיכפול). `#Siba` (סיבת העברה) has no codes defined in this company —
   * its picker answers "אין נתונים" — so nothing writes to it.
   */
  line: {
    item: '#Prt', qty: '#Cmt', price: '#Mhr', discount: '#AczDis',
    remark: '#Remark', amount: '#Scm', reason: '#Siba',
    ok: '#OK', okNew: '#OkNew', okCopy: '#OkCopy',
  },

  /**
   * No VAT block at all — there is no `#Scm_Maam` and no `#ScmBeforeMaam` on
   * this grid, because a transfer has no price list (`#strMhr` reads
   * "לפי מחירון: לא נבחר"). What it does carry is a quantity total, which is
   * the number that actually matters here.
   */
  totals: { total: '#ScmBeforeDis', quantity: '#Scm_Cmt' },
  finalizeLabel: 'קליטת תעודת העברה',

  /**
   * **תעודת העברה תמיד 0** — כלל של דרור, 02/09/2026.
   *
   * Not the invoice's value: Doc650 refuses 0 outright ("חובת הדפסה לפחות עותק
   * אחד !") and this document does not. It is an internal stock movement, so
   * there is nothing to hand anybody — a printed copy of it is waste paper.
   * The first filing here went out with 1 because the number had been copied
   * across from the invoice before the rule was stated.
   */
  printCopies: 0,
};

/* ── the local stock export ────────────────────────────────────────────── */

/**
 * Per-warehouse balances from the newest full export in `content/`.
 *
 * Read from disk rather than from Comax on purpose (Dror's rule): a stock
 * question is answered from the export, not by running a fresh report. The
 * catch that matters here is that the export does **not** carry every
 * warehouse — its columns are ראשי / מכולה וינגייט / רמת גן / ספורט & מור רמלה
 * / WIX — and מחסן קבוצות, the destination of the transfer this agent exists
 * for, is not among them. A missing column is reported as unverifiable; it is
 * never read as zero.
 */
let stockCache = null;
function localStock() {
  if (stockCache) return stockCache;
  const dir = resolve(ROOT, 'content');
  const file = existsSync(dir)
    ? readdirSync(dir)
      .filter((f) => /^מלאי-מלא-.*\.csv$/.test(f))
      .map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]?.f
    : null;
  if (!file) return (stockCache = { file: null, warehouses: [], by: new Map() });

  const path = resolve(dir, file);
  const rows = parseCsv(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  const head = rows[0] ?? [];
  const iCode = head.indexOf('פריט');
  const iName = head.indexOf('תיאור פריט');
  const first = head.indexOf('סה"כ מלאי') + 1;
  const last = head.indexOf('קוד דגם');
  const warehouses = first > 0 && last > first ? head.slice(first, last) : [];

  const by = new Map();
  for (const r of rows.slice(1)) {
    const code = (r[iCode] ?? '').trim();
    if (!code) continue;
    const per = {};
    warehouses.forEach((w, i) => { per[w] = Number(r[first + i] ?? '') || 0; });
    by.set(code, { name: r[iName] ?? '', per });
  }
  return (stockCache = { file: path, warehouses, by });
}

/** Minimal RFC-4180 reader — the export quotes its fields and doubles quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * What the source warehouse holds for each requested item, and whether that is
 * knowable at all.
 *
 * `have: null` — the warehouse is not a column in the export, or the item is
 * not in it — is `unknown`, which is a different answer from 0 and is never
 * quietly rounded into "enough". The first version scored an unknown line as
 * not-short and would have waved through exactly the case the gate exists for.
 *
 * Codes are taken as Comax hands them back. `#Prt` reads out as
 * "3468337082118 - משקפת קוברה..." after the lookup resolves, so the code is
 * the part before the first " - ".
 */
export function checkSourceStock(storeFrom, items) {
  const { file, warehouses, by } = localStock();
  const name = String(storeFrom ?? '').trim();
  const covered = warehouses.includes(name);
  return {
    source: file,
    warehouse: name,
    covered,
    warehouses,
    lines: items.map((it) => {
      const code = String(it.code ?? it.name ?? '').trim().split(' - ')[0].trim();
      const rec = covered ? by.get(code) : null;
      const have = rec ? rec.per[name] : null;
      const want = Number(it.qty ?? 1);
      return {
        code,
        name: rec?.name ?? null,
        want,
        have,
        unknown: have == null,
        short: have != null && have < want,
      };
    }),
  };
}

/* ── the document ──────────────────────────────────────────────────────── */

/** Fill the header. Two warehouses and no customer — nothing else is required. */
async function fillHeader(ctx, frame, input) {
  const { human } = ctx;
  const H = profile.header;

  await fillLookup(ctx, { frame, field: H.storeFrom, value: String(input.storeFrom), what: 'ממחסן' });
  await fillLookup(ctx, { frame, field: H.storeTo, value: String(input.storeTo), what: 'למחסן' });
  if (input.date) await human.type(H.date, input.date, { scope: frame, label: 'תאריך' });
  if (input.details) await human.type(H.details, input.details, { scope: frame, label: 'פרטים' });
  if (input.ref) await human.type(H.ref, input.ref, { scope: frame, label: 'אסמכתא' });
  await dismissPopups(ctx);
}

/** What the header holds — for the log, and for the human to review. */
async function readHeader(frame) {
  const H = profile.header;
  const read = async (sel) => frame.locator(sel).inputValue().catch(() => null);
  return {
    מסמך: (await frame.locator(H.docId).innerText().catch(() => null))?.trim() ?? null,
    תאריך: await read(H.date),
    ממחסן: await read(H.storeFrom),
    למחסן: await read(H.storeTo),
    פרטים: await read(H.details),
    אסמכתא: await read(H.ref),
  };
}

/**
 * The two warehouses as the *committed document* reports them.
 *
 * The lines grid prints them in its own header — `#wrkStore`/`#wrkStoreKod` for
 * the source and `#wrkStoreTo`/`#wrkStoreKodTo` for the destination — and that
 * is the only reading taken after Comax has accepted the header, rather than
 * while a lookup field was still being typed into.
 */
export async function readStores(ctx) {
  const grid = engine.linesFrame(ctx, profile);
  if (!grid) return null;
  const txt = async (sel) => (await grid.locator(sel).innerText().catch(() => null))?.trim() ?? null;
  return {
    from: await txt('#wrkStore'), fromCode: await txt('#wrkStoreKod'),
    to: await txt('#wrkStoreTo'), toCode: await txt('#wrkStoreKodTo'),
  };
}

/**
 * The document number, off the lines grid.
 *
 * The shared `readDocNumber` looks for "מספר:" and this screen writes
 * ":תעודה מספר" with the colon leading, so it never matches. `#DocId` carries
 * the bare number and is read directly.
 *
 * The number follows the house pattern — the Doc prefix plus a serial, so
 * 4700239 is transfer 239 of Doc470 — and it really is the number the list
 * filters on: `#wFindDocNo` finds 4700238 and 4700237. What confuses a reading
 * of that list is that it also holds a **legacy 601xxxx series** (everything up
 * to 31/08/2026), and its default sort is by number descending, so 6010294
 * floats above today's 47000xx and page one looks a week stale. Filter, do not
 * skim.
 */
export async function readDocNumber(ctx) {
  const grid = engine.linesFrame(ctx, profile);
  if (!grid) return null;
  const n = await grid.locator('#DocId').innerText().catch(() => null);
  return n?.trim() || null;
}

/** Refuse a direction that is not the one that was asked for. */
async function assertDirection(ctx, input) {
  const got = await readStores(ctx);
  if (!got) throw new Error('תעודת העברה: מסך השורות לא נפתח — אין ממה לקרוא את כיוון ההעברה.');

  const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
  if (same(got.from, got.to) || same(got.fromCode, got.toCode)) {
    throw new Error(
      `תעודת העברה: ממחסן ולמחסן זהים (${got.from}) — אין העברה כזאת. היציאה: #DoExit ואז #Cancel.`,
    );
  }
  for (const [what, want, name, code] of [
    ['ממחסן', input.storeFrom, got.from, got.fromCode],
    ['למחסן', input.storeTo, got.to, got.toCode],
  ]) {
    const w = String(want ?? '').trim();
    if (!w || same(w, name) || same(w, code)) continue;
    throw new Error(
      `תעודת העברה: ${what} התבקש "${w}" והמסמך אומר "${name}" (${code}).\n` +
      '  כיוון הוא כל מה שיש למסמך הזה — לא ממשיך על כיוון שלא אומת. היציאה: #DoExit ואז #Cancel.',
    );
  }
  ctx.logger.step('כיוון', `ממחסן ${got.from} (${got.fromCode}) → למחסן ${got.to} (${got.toCode})`);
  return got;
}

/**
 * Open a new transfer and fill its header. Stops before committing when
 * `dryRun`, so the whole thing is testable without burning a number.
 */
export async function create(ctx, input) {
  const { logger, page, dryRun } = ctx;

  if (!input.storeFrom || !input.storeTo) {
    throw new Error('תעודת העברה דורשת storeFrom ו-storeTo — אין כאן לקוח ואין מחירון.');
  }
  if (String(input.storeFrom).trim() === String(input.storeTo).trim()) {
    throw new Error(`תעודת העברה: ממחסן ולמחסן זהים ("${input.storeFrom}") — אין מה להעביר.`);
  }

  const listFrame = await engine.openList(ctx, profile);
  const { frame, preview } = await engine.startNew(ctx, profile, listFrame);
  await fillHeader(ctx, frame, input);

  const header = await readHeader(frame);
  logger.save('header.json', header);
  await logger.shot(page, 'header-ready');

  if (!header.ממחסן || !header.למחסן) {
    throw new Error(
      `תעודת העברה: ממחסן="${header.ממחסן || '(ריק)'}" למחסן="${header.למחסן || '(ריק)'}" — ` +
      'אחד המחסנים לא נקלט בשדה. היציאה הבטוחה: #Cancel בכותרת.',
    );
  }

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני אישור הכותרת. התעודה לא נוצרה.');
    return { dryRun: true, preview, header };
  }

  await engine.commitHeader(ctx, profile, frame);
  const stores = await assertDirection(ctx, input);
  const docNo = await readDocNumber(ctx);
  logger.step(profile.name, `תעודת העברה ${docNo ?? preview} נפתחה`);
  return { docNo: docNo ?? preview, preview, header, stores };
}

/** Add every line in one pass; `#OkNew` reopens the dialog between them. */
export async function addLines(ctx, items) {
  const out = [];
  for (const [i, item] of items.entries()) {
    out.push(await engine.addLine(ctx, profile, item, { index: i + 1, last: i === items.length - 1 }));
  }
  return out;
}

/**
 * קליטת תעודת העברה — irreversible, and it moves stock in both directions.
 *
 * Three gates, all read fresh off the screen immediately before the click:
 *
 *   1. the direction must still be the one that was asked for;
 *   2. the quantity total must be readable and non-zero — a transfer that moves
 *      nothing is a transfer nobody checked;
 *   3. the source warehouse must be able to cover every line. When the local
 *      export does not carry that warehouse (מחסן קבוצות is not one of its
 *      columns) the answer is "לא ידוע", and unknown is a refusal, not a pass.
 *
 * `allowShort: true` is the only way past gate 3, and it is a deliberate
 * statement by the caller — "I know the source cannot be verified, or cannot
 * cover it; move it anyway" — logged as such. Comax itself permits negative
 * stock, so this is a decision, not an error.
 */
export async function finalize(ctx, { confirm = false, lines = [], items = [], allowShort = false, expect = null } = {}) {
  const { logger, page } = ctx;

  const grid = engine.linesFrame(ctx, profile);
  if (!grid) throw new Error(`${profile.label}: מסך השורות לא פתוח — אין מה לקלוט.`);

  if (expect) await assertDirection(ctx, expect);
  const stores = await readStores(ctx);

  const read = async (sel) => grid.locator(sel).inputValue().catch(() => null);
  const totals = {
    quantity: await read(profile.totals.quantity),
    total: await read(profile.totals.total),
    docNo: await readDocNumber(ctx),
  };

  // What was asked for, or failing that what the lines actually came back
  // holding. The engine hands `finalize` its line read-back under `lines`, and
  // a caller that went through `document`/`chain` passes `items` — the gate has
  // to work either way, or it silently checks nothing.
  const wanted = items.length ? items : lines.map((l) => ({ code: l.item, qty: l.qty }));
  const stock = wanted.length ? checkSourceStock(stores?.from ?? '', wanted) : null;
  logger.save('before-filing.json', { stores, totals, stock });
  await logger.shot(page, 'before-filing');

  const qty = Number(String(totals.quantity ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(qty) || qty === 0) {
    throw new Error(
      `תעודת העברה ${totals.docNo ?? ''}: סה"כ הכמות "${totals.quantity ?? '(לא נקרא)'}" — ` +
      'לא קולט תעודה שלא מזיזה כלום, או שלא הצלחתי לקרוא. היציאה: #DoExit ואז #Cancel.',
    );
  }

  if (stock && !allowShort) {
    if (!stock.covered) {
      throw new Error(
        `לא ידוע מה יש ב"${stock.warehouse}" — הייצוא המקומי מכסה רק ${stock.warehouses.join(' · ')}.\n` +
        '  לא מזיז מלאי ממחסן שאני לא יכול לקרוא את היתרה שלו. לקרוא אותה בקומקס ואז allowShort:true,\n' +
        '  או להעביר מכיוון שכן מכוסה. היציאה הבטוחה: #DoExit ואז #Cancel.',
      );
    }
    const unknown = stock.lines.filter((l) => l.unknown);
    if (unknown.length) {
      throw new Error(
        `${unknown.length} פריטים לא נמצאו בייצוא המלאי — לא ידוע מה יש מהם ב"${stock.warehouse}":\n` +
        unknown.map((l) => `  ${l.code} — מבקש ${l.want}`).join('\n') +
        `\n  (לפי ${stock.source?.split(/[\\/]/).pop() ?? 'אין ייצוא ב-content/'})\n` +
        '  לרענן את הייצוא, או allowShort:true אם ידוע שהמלאי קיים. היציאה הבטוחה: #DoExit ואז #Cancel.',
      );
    }
    const short = stock.lines.filter((l) => l.short);
    if (short.length) {
      throw new Error(
        `ב"${stock.warehouse}" אין מספיק מלאי ל-${short.length} שורות:\n` +
        short.map((l) => `  ${l.code} ${l.name ?? ''} — מבקש ${l.want}, יש ${l.have}`).join('\n') +
        `\n  (לפי ${stock.source?.split(/[\\/]/).pop()})\n` +
        '  אם זה בכוונה — allowShort:true. היציאה הבטוחה: #DoExit ואז #Cancel.',
      );
    }
    logger.step('מלאי', `${stock.warehouse} מכסה את כל ${stock.lines.length} השורות`);
  } else if (stock) {
    logger.step('מלאי', `allowShort — לא נבדק מלאי מקור ב"${stock.warehouse}"`);
  } else {
    logger.step('מלאי', 'לא הועברו שורות לבדיקה — מלאי המקור לא נבדק');
  }

  if (!confirm) {
    logger.step('dryrun', `עוצר לפני קליטה. ממחסן ${stores?.from} → למחסן ${stores?.to}, סה"כ כמות ${totals.quantity}. להרצה אמיתית: --confirm`);
    return { filed: false, stores, totals, stock };
  }

  await engine.finalize(ctx, profile);
  return { filed: true, stores, totals, stock };
}

export const readTotals = (ctx) => engine.readTotals(ctx, profile);
export const backOut = (ctx) => engine.backOut(ctx, profile);
