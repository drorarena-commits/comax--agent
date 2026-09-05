/**
 * דו"ח תנועות מכירה ללקוח — מה הלקוח קנה, שורה לכל פריט.
 *
 * זו החלופה המהירה ל-`customer-history`. ההיא פותחת כל מסמך בנפרד (כותרת →
 * שורות → יציאה → ביטול, כ-70 שניות למסמך); זו מריצה דוח אחד ומקבלת את הכל
 * בבת אחת — 83 שורות ללקוח 429028 בפחות מדקה.
 *
 * התוכנית היא `a224` (דו"ח תנועות מכירה ללקוח → Erp/Nituah/MehirotLkTnuaP.aspx).
 * דרור הוסיף אותה לשולחן העבודה ב-02/09/2026, ולכן היא לא הופיעה בלכידת
 * הקיצורים של 01/09.
 *
 * שלוש עובדות שקבעו את הצורה של הקוד הזה:
 *
 * 1. **השדות זוכרים את ההרצה הקודמת.** מסך הסינון נפתח עם הערכים האחרונים
 *    עדיין בפנים. לכן כל שבעת טווחי הסינון נכתבים במפורש בכל הרצה, כולל ריקון
 *    של אלה שלא ביקשנו — בדיוק כמו שמטריצת המחסנים מרוקנת את משבצות המחסן
 *    שלא בשימוש. ערך שנשאר משדה קודם מצטרף לדוח בשקט.
 *
 * 2. **אין תיבת "יצוא לאקסל" במסך הזה.** הדוח נכנס לספול כמסמך רגיל, ולכן
 *    `Spooler_Exl_EXE` עונה "בעיה בהפעלה ראשונית" ומסלול ה-CSV של `spool.js`
 *    לא חל כאן. הטבלה כן מרונדרת במלואה ב-`Rpt_Html_G.asp` תחת `#tbl`, ומשם
 *    אנחנו קוראים אותה.
 *
 * 3. **יש שורות שליליות.** ביטול הזמנה מופיע ככמות וסכום שליליים על אותו
 *    ברקוד (למשל COBRA EDGE SWIPE, מסמך 3010006, ‎-2.00 / ‎-399.00). צבירה
 *    שסופרת שורות במקום לסכום כמויות תראה פריט מבוטל כאילו נקנה.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { ensureLoggedIn } from '../session.js';
import { openProgram, closePrograms } from '../navigate.js';
import { itemLabel, catalogWarning, catalogState } from '../catalog/enrich.js';

export const meta = {
  name: 'customer-movements',
  description: 'דו"ח תנועות מכירה ללקוח — כל מה שהלקוח קנה, שורה לפריט, עם תאריך ומסמך',
  writes: false, // reads only: fills a report form and reads the rendered result
  input: {
    customer: 'string — קוד לקוח. חובה',
    from: 'string dd/mm/yyyy — ברירת מחדל 01/01 של השנה הנוכחית',
    to: 'string dd/mm/yyyy — ברירת מחדל היום',
    item: 'string, אופציונלי — סינון אחרי הקריאה, לפי ברקוד או חלק משם',
    warehouse: 'string, אופציונלי — סינון מחסן בדוח עצמו',
    raw: 'boolean, אופציונלי — להחזיר גם את השורות הגולמיות בלי צבירה',
  },
};

const PROGRAM = 'a224';
const FILTER_FRAME = /MehirotLkTnuaP/i;
const RESULT_FRAME = /Rpt_Html_G/i;

/** שבעת טווחי הסינון בלשונית תחומים, כל אחד `<id>M` (החל מ-) ו-`<id>A` (ועד כולל). */
const RANGES = [
  { key: 'date', ids: ['DateM', 'DateA'], label: 'תאריך מסמך' },
  { key: 'customer', ids: ['LkM', 'LkA'], label: 'לקוח' },
  { key: 'warehouse', ids: ['StrM', 'StrA'], label: 'מחסן' },
  { key: 'item', ids: ['PrtM', 'PrtA'], label: 'פריט' },
  { key: 'department', ids: ['DepM', 'DepA'], label: 'מחלקה' },
  { key: 'customerGroup', ids: ['GrpM', 'GrpA'], label: 'ק. לקוחות' },
  { key: 'agent', ids: ['SohenM', 'SohenA'], label: 'סוכן' },
];

const COLUMNS = {
  barcode: 'פריט',
  name: 'שם פריט',
  date: 'תאריך',
  doc: 'מסמך',
  qty: 'כמות',
  price: 'מחיר',
  discount: '% הנחה',
  total: 'סכום',
  note: 'פרטים ממסמך',
};

/* --------------------------------------------------------------- helpers -- */

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** "1,016.42" → 1016.42 · "-399.00" → -399 · "" → null */
function num(s) {
  const t = clean(s).replace(/,/g, '');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function today() {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function startOfYear() {
  return `01/01/${new Date().getFullYear()}`;
}

/** dd/mm/yyyy → משהו שאפשר למיין לפיו. */
function sortableDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean(s));
  return m ? `${m[3]}${m[2]}${m[1]}` : '';
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * הפרדת הטבלה הגולמית לשורות נתונים ולשורות סיכום.
 *
 * שורות הסיכום אינן מיושרות לעמודות — הכותרת רחבה תשעה תאים, ושורת הסה"כ
 * מחזיקה שישה, עם המספרים במקומות אחרים לגמרי. לכן הן מזוהות לפי הטקסט
 * ("סה''כ" / "לקוח <קוד>:") והמספרים נשלפים מהן בסריקה, לא לפי אינדקס.
 */
export function parseGrid(rows) {
  if (!rows.length) return { lines: [], totals: null, headers: [] };

  const headers = rows[0].map(clean);
  const index = {};
  for (const [key, label] of Object.entries(COLUMNS)) {
    const at = headers.indexOf(label);
    if (at === -1) throw new Error(`עמודה "${label}" לא נמצאה בדוח. כותרות: ${headers.join(' | ')}`);
    index[key] = at;
  }

  const lines = [];
  let totals = null;

  for (const row of rows.slice(1)) {
    const cells = row.map(clean);
    const joined = cells.join(' ');

    // כותרת קיבוץ ("לקוח: 429028 שחייני על בע'מ") — תא בודד, לא נתונים.
    if (cells.length < headers.length && !/סה'?'?כ|^לקוח\s+\d+:/.test(joined)) continue;

    if (/סה'?'?כ/.test(joined) || /^לקוח\s+\d+:/.test(cells[0] ?? '')) {
      const nums = cells.map(num).filter((n) => n != null);
      // שני המספרים בשורת הסיכום הם הכמות ואז הסכום, בסדר הזה.
      if (nums.length >= 2) totals = { qty: nums[0], total: nums[nums.length - 1] };
      continue;
    }

    const barcode = cells[index.barcode];
    if (!barcode) continue;

    lines.push({
      barcode,
      name: cells[index.name],
      date: cells[index.date],
      doc: cells[index.doc],
      qty: num(cells[index.qty]),
      price: num(cells[index.price]),
      discount: num(cells[index.discount]),
      total: num(cells[index.total]),
      note: cells[index.note],
    });
  }

  return { lines, totals, headers };
}

/**
 * צבירה לפי ברקוד.
 *
 * `qty` מסוכם ולא נספר, כדי שביטול (כמות שלילית) יקזז את הרכישה שלו. פריט
 * שנקנה ובוטל במלואו יוצא עם 0 ומסומן `netZero`, ולא נעלם — השאלה "מה הוא
 * לקח" צריכה להראות גם את זה.
 */
export function aggregate(lines) {
  const byBarcode = new Map();

  for (const l of lines) {
    let e = byBarcode.get(l.barcode);
    if (!e) {
      e = { barcode: l.barcode, name: l.name, qty: 0, lines: 0, returns: 0, docs: [], prices: [] };
      byBarcode.set(l.barcode, e);
    }
    e.qty += l.qty ?? 0;
    e.lines += 1;
    if ((l.qty ?? 0) < 0) e.returns += 1;
    // השם ברשת נחתך; שומרים את הארוך ביותר שראינו.
    if ((l.name ?? '').length > (e.name ?? '').length) e.name = l.name;
    // `price` בדוח הוא **מחיר המחירון**, ו-`total` הוא אחרי הנחה. מה שדרור
    // צריך לראות הוא מה שהלקוח שילם בפועל — וזה היחס ביניהם, לא העמודה.
    // כובע ים: 100 × 149 = 14,900 אבל הסכום 9,576.80, כלומר 95.77 ליחידה.
    const paid = l.qty ? Math.round((l.total / l.qty) * 100) / 100 : null;
    e.docs.push({ doc: l.doc, date: l.date, qty: l.qty, price: l.price, discount: l.discount, total: l.total, paid, note: l.note });
    e.total = (e.total ?? 0) + (l.total ?? 0);
    if (l.price != null) e.prices.push(l.price);
  }

  return [...byBarcode.values()]
    .map((e) => {
      const sorted = [...e.docs].sort((a, b) => sortableDate(a.date).localeCompare(sortableDate(b.date)));
      const last = sorted[sorted.length - 1];
      // ממוצע משוקלל ולא ממוצע של מחירים: פריט שנקנה 6 יחידות בהנחה אחת
      // ו-3 באחרת צריך לשקף את מה ששולם, לא את אמצע שתי ההנחות.
      const paidAvg = e.qty ? Math.round((e.total / e.qty) * 100) / 100 : null;
      const { label: altCode, enriched } = itemLabel(e.barcode);
      return {
        ...e,
        altCode,
        enriched,
        total: Math.round((e.total ?? 0) * 100) / 100,
        paidAvg,
        lastPaid: last?.paid ?? null,
        qty: Math.round(e.qty * 1000) / 1000,
        netZero: Math.abs(e.qty) < 1e-9,
        docs: sorted,
        lastDate: last?.date ?? null,
        lastDoc: last?.doc ?? null,
        lastPrice: last?.price ?? null,
        lastDiscount: last?.discount ?? null,
      };
    })
    .sort((a, b) => sortableDate(b.lastDate).localeCompare(sortableDate(a.lastDate)));
}

/* ------------------------------------------------------------------ run -- */

export async function run({ page, human, logger, input, cfg }) {
  const customer = clean(input.customer);
  if (!customer) throw new Error('חסר קוד לקוח. דוגמה: --json \'{"customer":"429028"}\'');

  const from = clean(input.from) || startOfYear();
  const to = clean(input.to) || today();

  // מה שנכתב לכל שבעת הטווחים. מה שלא ביקשנו נכתב כמחרוזת ריקה בכוונה —
  // ראה הערה 1 בראש הקובץ.
  const wanted = {
    DateM: from, DateA: to,
    LkM: customer, LkA: customer,
    StrM: clean(input.warehouse), StrA: clean(input.warehouse),
    PrtM: '', PrtA: '',
    DepM: '', DepA: '',
    GrpM: '', GrpA: '',
    SohenM: '', SohenA: '',
  };

  await ensureLoggedIn({ page, human, logger, cfg });

  // שולחן נקי: התוכנית הזו נפתחת עם הערכים של ההרצה הקודמת, וחלון ישן שנשאר
  // פתוח מחזיר אותנו אליו במקום להתחיל מחדש.
  await closePrograms({ page, human, logger, cfg }).catch(() => {});

  const { frame } = await openProgram({ page, human, logger, cfg }, PROGRAM, { expect: FILTER_FRAME });
  if (!frame) throw new Error('דו"ח תנועות מכירה ללקוח לא נפתח.');

  // What the form already holds, read before touching it.
  //
  // Every range is still written explicitly — rule 3 stands, and a value left
  // over from a previous run must never join the report in silence. But a
  // field that already holds exactly what we want does not need retyping, and
  // each retype costs about 6.6s of human pace (click, clear, type, Tab, and
  // two 2s gates). Ten of the fourteen fields are usually blanks we are asking
  // to stay blank.
  //
  // This cannot loosen the rule, because the verification gate below reads
  // every field back and compares it to `wanted` — off the very same
  // `.value` this check reads. A field skipped here is still proven there.
  const before = await frame.evaluate((idList) => {
    const out = {};
    for (const id of idList) out[id] = document.getElementById(id)?.value ?? null;
    return out;
  }, Object.keys(wanted));

  let typed = 0;
  let kept = 0;
  for (const { ids, label } of RANGES) {
    for (const [i, id] of ids.entries()) {
      if (clean(before[id]) === clean(wanted[id])) {
        kept++;
        continue;
      }
      await human.type(`#${id}`, wanted[id], {
        scope: frame,
        label: `${label} ${i === 0 ? 'מ-' : 'עד'}`,
      });
      await human.press('Tab');
      typed++;
    }
  }
  logger.step('filter', `${typed} שדות הוקלדו · ${kept} כבר החזיקו את הערך הנכון`);
  await human.settle('טווחי הסינון');

  // ---- השער -----------------------------------------------------------
  // מה שביקשנו מול מה שהשדות באמת מחזיקים. קומקס מנרמלת תאריכים, דוחה ערכים
  // ומחזירה אותם לקדמותם בשקט, ו"הקלדתי את זה" אינו הוכחה שזה נקלט.
  const actual = await frame.evaluate((idList) => {
    const out = {};
    for (const id of idList) out[id] = document.getElementById(id)?.value ?? null;
    return out;
  }, Object.keys(wanted));

  const mismatches = Object.entries(wanted)
    .filter(([k, v]) => clean(actual[k]) !== clean(v))
    .map(([k, v]) => `${k}: ביקשנו ${JSON.stringify(v)} אבל בשדה ${JSON.stringify(actual[k])}`);

  logger.save('form-check.json', { expected: wanted, actual, mismatches });

  if (mismatches.length) {
    await logger.shot(page, 'verify-failed');
    throw new Error(`הטופס לא תואם למה שביקשנו — לא מריץ את הדוח:\n  ${mismatches.join('\n  ')}`);
  }
  logger.step('verify', `לקוח ${customer} · ${from} — ${to} — אומת מול השדות`);
  await logger.shot(page, 'before-run');
  // ---------------------------------------------------------------------

  await human.click('#OK', { scope: frame, label: 'אישור — הרצת הדוח' });

  const result = await waitForResult(page, logger);
  const rows = await readAllRows(result, logger);
  await logger.shot(page, 'result');

  const { lines, totals } = parseGrid(rows);
  logger.step('rows', `${lines.length} שורות נקראו`);

  // ---- אימות שלמות ----------------------------------------------------
  // הדוח מדפיס את הסכומים שלו עצמו בתחתית. אם מה שאספנו לא מסתכם לאותו דבר,
  // קראנו רק חלק מהעמודים — עדיף להיכשל מאשר להחזיר תמונה חלקית בשקט.
  if (totals) {
    const sum = (f) => Math.round(lines.reduce((a, l) => a + (l[f] ?? 0), 0) * 100) / 100;
    const gotQty = sum('qty');
    const gotTotal = sum('total');
    const off = Math.abs(gotQty - totals.qty) > 0.01 || Math.abs(gotTotal - totals.total) > 0.5;
    logger.save('totals-check.json', { reported: totals, collected: { qty: gotQty, total: gotTotal } });
    if (off) {
      throw new Error(
        `הסכומים לא מסתדרים — כנראה לא נקראו כל השורות.\n` +
        `  הדוח מדווח: כמות ${totals.qty} · סכום ${totals.total}\n` +
        `  אספנו:      כמות ${gotQty} · סכום ${gotTotal}\n` +
        `  צמצם את טווח התאריכים ונסה שוב.`,
      );
    }
    logger.step('verify', `סכומי הביקורת תואמים — כמות ${gotQty} · סכום ${gotTotal}`);
  }
  // ---------------------------------------------------------------------

  const filter = clean(input.item).toLowerCase();
  const picked = filter
    ? lines.filter((l) => `${l.barcode} ${l.name}`.toLowerCase().includes(filter))
    : lines;
  if (filter) logger.step('filter', `"${input.item}" — ${picked.length} שורות מתוך ${lines.length}`);

  const items = aggregate(picked);

  const outDir = resolve(ROOT, cfg?.reports?.stockMatrix?.exportDir ?? 'data/exports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const csvPath = resolve(outDir, `תנועות-${customer}-${stamp}.csv`);
  // 'מחיר' הוא המחירון ו-'שולם ליחידה' הוא מה שהלקוח באמת שילם — ההפרש הוא
  // ההנחה, וזה מה שמסתכם לסך הדוח.
  const header = ['מק"ט', 'ברקוד', 'שם פריט', 'תאריך', 'מסמך', 'כמות', 'מחירון', '% הנחה', 'שולם ליחידה', 'סכום', 'פרטים ממסמך'];
  const body = picked.map((l) => [
    itemLabel(l.barcode).label,
    l.barcode,
    l.name,
    l.date,
    l.doc,
    l.qty,
    l.price,
    l.discount,
    l.qty ? Math.round((l.total / l.qty) * 100) / 100 : null,
    l.total,
    l.note,
  ]);
  writeFileSync(csvPath, '﻿' + [header, ...body].map((r) => r.map(csvCell).join(',')).join('\n'), 'utf8');
  logger.step('export', csvPath);

  // כלל 5: בלי הקטלוג הדוח מציג ברקודים. אומרים את זה בקול ולא בשקט.
  const catWarn = catalogWarning();
  if (catWarn) {
    logger.step('warn', 'הקטלוג לא נטען — הפריטים מוצגים לפי ברקוד');
    console.log(`
${catWarn}
`);
  }

  await closePrograms({ page, human, logger, cfg }).catch(() => {});

  return {
    customer,
    from,
    to,
    lineCount: picked.length,
    itemCount: items.length,
    totals,
    csv: csvPath,
    catalog: catalogState(),
    items,
    ...(input.raw ? { lines: picked } : {}),
  };
}

/* ---------------------------------------------------------- result frame -- */

async function waitForResult(page, logger, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => RESULT_FRAME.test(f.url()));
    if (frame) {
      const ready = await frame.evaluate(() => !!document.getElementById('tbl')).catch(() => false);
      if (ready) {
        logger.step('report', 'הדוח מוצג');
        return frame;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('הדוח לא הוצג בזמן.');
}

/**
 * קריאת כל השורות מהרשת.
 *
 * `#MaxRows` מגיע עם אפשרויות קבועות (50…2000) ובנוסף אפשרות אחת ששווה למספר
 * השורות בפועל — כך קומקס מציעה "הכל". בוחרים את הגדולה מביניהן, וכך דוח
 * שנכנס בעמוד אחד נקרא בקריאה אחת. אם הדוח גדול מהתקרה, בדיקת הסכומים
 * למעלה תיפול ותאמר לצמצם את הטווח — ולא נחזיר חצי דוח בשקט.
 */
async function readAllRows(frame, logger) {
  const grew = await frame.evaluate(() => {
    const sel = document.getElementById('MaxRows');
    if (!sel) return null;
    const best = [...sel.options].map((o) => Number(o.value)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (best == null || String(best) === sel.value) return { value: sel.value, changed: false };
    sel.value = String(best);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof sel.onchange === 'function') sel.onchange();
    return { value: String(best), changed: true };
  });

  if (grew?.changed) {
    logger.step('report', `שורות בדף → ${grew.value}`);
    await new Promise((r) => setTimeout(r, 4000));
  }

  return frame.evaluate(() => {
    const tbl = document.getElementById('tbl');
    if (!tbl) return [];
    return [...tbl.rows].map((tr) => [...tr.cells].map((td) => td.innerText.replace(/\s+/g, ' ').trim()));
  });
}
