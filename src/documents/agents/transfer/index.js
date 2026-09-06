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

  /**
   * How Comax itself launches a111 — and why this line had to exist.
   *
   * Measured 06/09/2026: the icon is **gone from the desktop**, exactly as
   * `a157` went on 04/09 and `a146` the day before. With no path here,
   * `openProgram` had nothing to fall back to and every transfer flow died on
   * "לא נמצא בשולחן העבודה, ואין נתיב חלופי".
   *
   * The query string is not decoration. `top.S.runProgram(path)` adds the
   * environment parameters (`SwPG`, `CurrYear`, `SSID_p`…) but **not** the
   * screen-specific ones the icon passes — the lesson a164 taught, where the
   * missing `SwLk=1` left `#IdxLk` hidden until timeout, three steps after a
   * launch that looked perfect. So this is copied from the URL the *icon*
   * produced, captured live on 02/09/2026 in
   * `knowledge/screens/transfer-list.txt`:
   *
   *   Doc470V.asp?SwVO=0&MCGLOBAL=927&SwPG=0&swVisit=0&…
   *
   * `SwVO=0` is kept. `MCGLOBAL=927` is deliberately omitted, as it was for the
   * quote: it looks like a menu-instance id, nothing needs it, and guessing at
   * it is what rule 9 forbids. There is **no `SwLk` here at all** — and that is
   * consistent rather than suspicious, because this is the one document with no
   * customer field to reveal.
   */
  program: 'Erp/Mlay/TeydatAv/Doc/Doc470V.asp?SwVO=0',

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
   * The list's own filter boxes — `Doc470V.asp`.
   *
   * 💣 **`#wFindLkNm` is the destination WAREHOUSE here, not a customer.**
   * On `Doc650V` / `Doc652V` / `Doc612V` that same id is the customer filter,
   * and every reader in this project (`customer-history`, `duplicate-check`,
   * `invoice-presence-check`) types a customer code into it. Do that here and
   * Comax filters by a warehouse that does not exist, returns nothing, and the
   * caller reads "this document has no lines". A transfer has **no customer at
   * all** — its header is two warehouses — so there is nothing to look one up
   * by, and the only textual hook to a customer is whatever was written into
   * `#Pratim` by hand.
   *
   * `findDocNo` is the way in: **filter, never scan.** Two numbering series
   * live in this one list — the current `470xxxx` and the old `601xxxx` — and
   * the default sort is by number descending, so 6010294 from 31/08 floats
   * above 4700238 from 01/09 and the first page looks a week stale.
   */
  list: {
    findDocNo: '#wFindDocNo',
    findStoreFrom: '#wFindLkNmFrom', // ממחסן
    findStoreTo: '#wFindLkNm', // ⚠️ למחסן — NOT a customer
    findRemarks: '#wFindRemarks', // פרטים
    findDate: '#wFindDate', // מתאריך
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
   * 🚫 המחיר בתעודת העברה הוא עניין של קומקס, לא שלנו.
   *
   * `engine.addLine` gained wholesale pricing on 06/09/2026, driven off the
   * price list the document declares in its footer. That is right for a sales
   * document and wrong for this one: a transfer moves goods between two
   * warehouses of the same business, and the number in its price column is
   * bookkeeping Comax fills in — nobody is charged it.
   *
   * ⚠️ And the old comment above ("אין מחירון, המחיר נכנס 0.00") turned out to
   * be true only of the empty draft this agent was mapped on. Read live from
   * 6010295 on 06/09/2026, a real filed transfer declares
   * `לפי מחירון: מכירה ראשי ( כולל מע"מ )` and carries real prices — 69.00 a
   * bag, 289.90 less 17.25% for a pair of goggles. מכירה ראשי is not flagged
   * `wholesale`, so nothing would have happened today; but the day a company
   * default points at מחירון קבוצות, the engine would start halving prices
   * inside a stock document. This flag closes that door rather than relying on
   * a price list staying where it is.
   */
  priced: false,

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
  if (input.details) await human.type(H.details, input.details, { scope: frame, label: 'פרטים', paste: true });
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

/* ── קריאת תעודה קיימת ─────────────────────────────────────────────────── */

/**
 * Advance a document *header* to its lines — and refuse anywhere else.
 *
 * 🚨 On `Doc470LinesV` the very same `#OK` is labelled
 * "(Alt+e) קליטת תעודת העברה" and it **files the document**: stock moves out of
 * one warehouse and into another, in one irreversible click, and there is no
 * unfiling. A reader that is one frame off does not read a document — it ships
 * one. So the guard is code, not a comment, and it is the same guard
 * `customer-history.js` puts in front of the sales documents.
 */
async function pressHeaderOk(ctx, frame, label) {
  const url = frame.url();
  if (!/U\.aspx?/i.test(url) || /LinesV/i.test(url)) {
    throw new Error(
      `סירוב ללחוץ #OK מחוץ למסך כותרת — ה-frame הוא ${url.split('/').pop()?.split('?')[0]}.\n`
      + 'במסך השורות של תעודת העברה #OK הוא "קליטת תעודת העברה" — הוא מזיז מלאי, ואין ביטול.',
    );
  }
  await ctx.human.click(profile.header.ok, { scope: frame, label });
}

/**
 * The lines of a transfer that already exists, read off its grid.
 *
 * Columns by label, never by position — the grid carries twenty of them
 * (`פריט · שם פריט · במארז · מארזים · י"ח · סריאלי · כמות · מחיר · הנחה % ·
 * סכום · ת.תוקף · משור · מטור · מקומה · …`) and their order is not something
 * to bet a document on. Only `פריט` and `כמות` are actually needed: the price
 * on a transfer is 0.00, because there is no price list.
 */
async function readGridPage(grid) {
  return grid.evaluate(() => {
    const txt = (c) => (c.innerText || '').replace(/\s+/g, ' ').trim();
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
    // The row number column renders as "ש." and comes out of innerText as ".ש"
    // depending on how the RTL cell serialises — accept either. It is the only
    // stable identity a row has across pages.
    const cols = {
      no: at('ש.', '.ש'), code: at('פריט'), name: at('שם פריט'), qty: at('כמות'), amount: at('סכום'),
    };

    return {
      head,
      lines: rows.slice(hi + 1)
        .filter((r) => cols.name >= 0 && r[cols.name])
        .map((r) => ({
              no: cols.no >= 0 ? (r[cols.no] ?? '') : '',
          code: cols.code >= 0 ? (r[cols.code] ?? '') : '',
          name: r[cols.name] ?? '',
          qty: cols.qty >= 0 ? (r[cols.qty] ?? '') : '',
          amount: cols.amount >= 0 ? (r[cols.amount] ?? '') : '',
        })),
    };
  });
}

/**
 * Every line of the document — not every line that happens to be on screen.
 *
 * 💣 **The grid is paged, and page one looks exactly like a whole document.**
 * Measured 06/09/2026 on 6010295: eight rows visible, numbered 1–8, summing to
 * 8 units and 722.89 — while the document's own footer said `סה"כ כמות: 20.00`
 * and `סה"כ: 2,665.80`. Nothing was missing, nothing errored, and an invoice
 * built from that read would have billed less than a third of the goods.
 *
 * So this walks the pages, keyed on the `ש.` column, and then **checks its own
 * work against the document's total quantity**. A reader that cannot prove it
 * saw everything refuses rather than returning a plausible subset: partial is
 * the one failure that looks identical to success.
 */
async function readAllGridLines(ctx, grid, { maxPages = 40 } = {}) {
  const { human, logger } = ctx;

  /*
   * ⚠️ The paging controls are `<img>` elements with **ids** — `#first`,
   * `#prev`, `#next`, `#last`, `#nextRec`, `#prevRec`.
   *
   * `knowledge/screens/*.txt` prints them as `img:text-is("דף הבא")`, and that
   * selector can never match: an `<img>` has no text content, so the label the
   * snapshot shows comes from an attribute. Measured 06/09/2026 — the text
   * selector matched nothing, `count()` returned 0, the loop concluded "no next
   * page" and read one page of a twenty-unit document. Take ids from the
   * `.json` snapshot, not the pretty-printed `.txt`.
   */
  if (await grid.locator('#first').count().catch(() => 0)) {
    await human.click('#first', { scope: grid, label: 'לדף הראשון' }).catch(() => {});
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
    logger.step('grid', `דף ${page + 1}: ${got.lines.length} שורות (${byNo.size} מצטבר)`);

    // No new rows means the last page just repeated itself — Max2000 keeps
    // showing the final page when "דף הבא" has nowhere to go.
    if (byNo.size === before && page > 0) break;

    if (!(await grid.locator('#next').count().catch(() => 0))) break;
    await human.click('#next', { scope: grid, label: 'לדף הבא' });
    await human.settle(`page ${page + 2}`);
  }

  return { head, lines: [...byNo.values()], pages: page + 1 };
}

/**
 * פותח תעודת העברה קיימת, קורא את שורותיה, ויוצא בלי לקלוט.
 *
 * Read-only by construction: the only click that could commit anything is
 * fenced behind `pressHeaderOk`, and the way out is `engine.backOut` —
 * `#DoExit` on the grid then `#Cancel` on the header. Never `#OK`.
 *
 * The exit raises the browser's own "האם ברצונך לצאת ללא שמירה?" confirm;
 * `browser.js` answers it and logs that it did.
 */
export async function read(ctx, docNo) {
  const { page, human, logger } = ctx;
  const wanted = String(docNo ?? '').trim();
  if (!wanted) throw new Error('חסר מספר תעודה — אין דרך לחפש תעודת העברה לפי לקוח, כי אין בה לקוח.');

  const listFrame = await engine.openList(ctx, profile);

  // The URL the list actually opened with, logged because a path-launched
  // program can be missing a flag the icon passes and still look perfect —
  // that is how a164 lost `#IdxLk` three steps later. Cheap to record, and it
  // is the only evidence available if a later screen misbehaves.
  logger.step('program', `רשימת ההעברות נפתחה: ${listFrame.url().split('/').at(-1).split('&').slice(0, 3).join('&')}`);

  // ⚠️ Every other filter box first. They are cumulative, and a leftover
  // "ממחסן" or "מתאריך" from an earlier run turns a document that exists into
  // an empty grid — which reads exactly like "there is no such document".
  const L = profile.list;
  for (const sel of [L.findStoreFrom, L.findStoreTo, L.findRemarks, L.findDate]) {
    await listFrame.locator(sel).fill('').catch(() => {});
  }

  // Typing + Enter applies the filter. NOT `#Find` — that opens the חיתוכים
  // dialog and leaves it hanging over the list.
  await human.type(L.findDocNo, wanted, { scope: listFrame, label: `סינון לתעודה ${wanted}`, clear: true });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.think('filter applied');

  await human.doubleClick(`td:text-is(${JSON.stringify(wanted)})`, {
    scope: listFrame,
    label: `פתיחת תעודה ${wanted}`,
  });
  await human.settle('header opening');

  const F = (re) => page.frames().find((f) => re.test(f.url()));
  const hdr = F(profile.frames.header);
  if (!hdr) throw new Error(`כותרת התעודה ${wanted} לא נפתחה. יכול להיות שהמספר לא קיים ברשימה.`);
  const header = await readHeader(hdr);

  let lines = [];
  let head = [];
  let stores = null;
  let totals = {};
  try {
    await dismissPopups(ctx);
    await pressHeaderOk(ctx, hdr, 'אישור כותרת — מעבר לשורות (קריאה)');
    await human.settle('lines loading');

    let grid = null;
    for (let i = 0; i < 6 && !grid; i++) {
      grid = F(profile.frames.linesGrid);
      if (!grid) await human.think(`waiting for lines of ${wanted}`);
    }
    if (!grid) throw new Error(`מסך השורות של ${wanted} לא נפתח`);

    ({ head, lines } = await readAllGridLines(ctx, grid));
    stores = await readStores(ctx).catch(() => null);
    // Read off the grid directly, **not** through `engine.readTotals` — that one
    // returns only beforeVat/vat/total and has no idea `quantity` exists. It
    // handed back `undefined`, `Number('')` turned that into a confident `0`,
    // and the gate below reported "the document says 0 units" about a document
    // that says 20. Silence must not arrive dressed as a number.
    totals = {
      quantity: await grid.locator(profile.totals.quantity).inputValue().catch(() => null),
      total: await grid.locator(profile.totals.total).inputValue().catch(() => null),
    };
    await logger.shot(page, `transfer-${wanted}-lines`);
  } finally {
    // Out through the door, not through קליטה — whatever happened above.
    await engine.backOut(ctx, profile).catch(() => {});
  }

  /*
   * 🚨 השער שהיה חסר: מה שנקרא חייב להסתכם למה שהמסמך מצהיר.
   *
   * `#Scm_Cmt` is the document's own quantity total, and it is the one witness
   * that is independent of how many rows the grid felt like painting. Without
   * this check a paged grid returns page one and every downstream number is
   * quietly too small — measured on 6010295: 8 units read, 20 units real.
   *
   * A missing total is also a refusal. "Could not verify" is not "fine" —
   * that is rule 9, and this is a document about to become an invoice.
   */
  // `Number('')` is 0, not NaN — so an empty field would otherwise become a
  // perfectly confident "the document holds zero units". Empty is null here.
  const money = (v) => {
    const t = String(v ?? '').replace(/,/g, '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const expected = money(totals.quantity);
  const got = lines.reduce((s, l) => s + (money(l.qty) ?? 0), 0);

  if (expected == null) {
    throw new Error(
      `תעודה ${wanted}: לא הצלחתי לקרוא את "סה"כ כמות" מהמסמך (#Scm_Cmt).\n`
      + `  נקראו ${lines.length} שורות בסך ${got} יחידות, ואין מול מה לאמת אותן.\n`
      + '  לא מחזיר שורות שלא הוכחתי שהן כל השורות.',
    );
  }
  if (Math.abs(expected - got) > 0.005) {
    throw new Error(
      `תעודה ${wanted}: קראתי ${got} יחידות ב-${lines.length} שורות, אבל המסמך אומר סה"כ כמות ${expected}.\n`
      + '  הרשת מחולקת לדפים, וכנראה לא הגעתי לסופה — חשבונית שתיבנה מזה תחייב חלק מהסחורה.\n'
      + '  צילום המסך של הרשת נמצא בתיקיית ההרצה.',
    );
  }

  logger.step(profile.name, `תעודה ${wanted} · ${header.תאריך ?? '?'} · ${lines.length} שורות · ${got} יחידות = סה"כ המסמך ✓ · נקראה ולא נקלטה`);
  return { docNo: wanted, header, stores, totals, head, lines };
}

export const readTotals = (ctx) => engine.readTotals(ctx, profile);
export const backOut = (ctx) => engine.backOut(ctx, profile);
