/**
 * ממפה את דיאלוג **"יבוא מאקסל"** שבמסך שורות החשבונית.
 *
 * למה זו משימה ולא סקריפט חד-פעמי: חשבונית של 188 שורות בהזנה שורה-אחר-שורה
 * נמדדה ב-~36 שניות לשורה — כשעתיים, ושעתיים שבהן המושב תפוס והמסמך פתוח.
 * דרור, 10/09/2026: "אל תעשה אחד אחד, לא נעשה מסמך שעתיים, לא הגיוני". הוא
 * גם ידע שהמנגנון קיים ("נדמה לי רק ברקוד, כמות וסכום") — וזה אכן בסנפשוט
 * שלנו מ-02/09: `frame f3` ⇒ `Doc650LinesV.asp`, כפתור "יבוא מאקסל", לצד
 * "העתקת פריטים ממסמך אחר" ו"הוספה מתעודות העברה".
 *
 * ⛔ **קריאה בלבד, ובכוונה.** היא נכנסת לחשבונית **קיימת** — לא פותחת חדשה —
 * כדי שלא תישאר טיוטה מאחור, ויוצאת ב-`#DoExit` ואז `#Cancel`. במסך השורות
 * `#OK` הוא "קליטת חשבונית" (כלל 4), ולכן הוא לא נלחץ כאן לעולם.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram, closePrograms, dismissPopups } from '../navigate.js';

export const meta = {
  name: 'invoice-import-probe',
  description: 'ממפה את דיאלוג "יבוא מאקסל" במסך שורות החשבונית — קריאה בלבד',
  writes: false,
  input: {
    docNo: 'string — מספר חשבונית קיימת להיכנס אליה. חובה',
    customer: 'string, אופציונלי — קוד הלקוח, לבחירת השורה כשהמספר חוזר בין שנים',
  },
  precheck(input) {
    if (!input.docNo) return 'חסר docNo — לאיזו חשבונית קיימת להיכנס כדי למפות?';
    return null;
  },
};

const HEADER = /Doc650U\.asp/i;
const LINES = /Doc650LinesV\.asp/i;

/** כל מה שלחיץ בפריים — כך מסך שלא מופה נעשה ידוע. */
const CONTROLS = () => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('button, input, select, img, a, td[onclick], div[onclick]')]
    .filter((el) => el.offsetParent)
    .map((el) => ({
      tag: el.tagName,
      type: el.type || null,
      id: el.id || null,
      name: el.name || null,
      title: norm(el.title) || null,
      alt: norm(el.alt) || null,
      value: el.value ?? null,
      text: norm(el.textContent).slice(0, 60) || null,
      onclick: norm(el.getAttribute('onclick')).slice(0, 120) || null,
      options: el.tagName === 'SELECT'
        ? [...el.options].map((o) => `${o.title || ''}=${o.value}`).slice(0, 30)
        : null,
    }))
    .filter((c) => c.id || c.title || c.alt || c.text || c.onclick);
};

/**
 * רשימת החשבוניות כרשומות. העמודות **לפי תווית** ולא לפי מיקום — סדר העמודות
 * ב-`a157` אינו זהה לזה של `a164`, וקריאה מיקומית נשברת בשקט.
 * `rowClass` הוא הידית היחידה שהרשת נותנת לשורה בודדת (כלל 18).
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
      const docCol = ['חשבונית', 'מסמך', 'תעודה'].map(at).find((i) => i >= 0);
      if (docCol === undefined) continue;
      const out = [];
      for (const tr of [...t.rows].slice(hi + 1)) {
        const r = [...tr.cells].map(txt);
        const docNo = r[docCol];
        if (!docNo || !/^\d+$/.test(docNo)) continue;
        out.push({
          docNo,
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

export async function run(ctx) {
  const { page, human, logger, cfg, input } = ctx;
  const F = (re) => page.frames().find((f) => re.test(f.url()));

  await ensureLoggedIn({ page, human, logger, cfg });
  const { frame: list } = await openProgram(ctx, 'a157', {
    expect: /Doc650V\.asp/i,
    program: 'Erp/Mehirot/Doc650/Inv_Mlay/Doc650V.asp',
  });

  // הסינון מצטבר: תיבה ישנה שנשארה מחזירה "לא נמצא" בשקט.
  for (const sel of ['#wFindLkNm', '#wFindDateM', '#wFindDateA']) {
    await list.locator(sel).fill('').catch(() => {});
  }
  await human.type('#wFindDocNo', String(input.docNo), { scope: list, label: 'מספר חשבונית', free: true });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.settle('filtered');

  // 💣 שתי מלכודות בשורה אחת, ושתיהן הפילו את ההרצה הראשונה (10/09/2026):
  //   1. **רשת Max2000 נפתחת בדאבל-קליק, לא בקליק.** קליק בודד רק מסמן את
  //      השורה, ואז `F(HEADER)` מחזיר undefined ונראה כאילו המסמך לא קיים.
  //   2. כלל 18 — מספר מסמך חוזר בין שנים ובין לקוחות. פותחים לפי **השורה**
  //      (`td[class="<מספר השורה>"]`), כמו ב-`quote-read`, ולא לפי הטקסט.
  const grid = await readList(list);
  let match = grid.rows.filter((r) => String(r.docNo) === String(input.docNo));
  if (input.customer) {
    match = match.filter(
      (r) => r.customerCode === String(input.customer) || r.customer === String(input.customer),
    );
  }
  if (!match.length) {
    throw new Error(`חשבונית ${input.docNo} לא נמצאה ברשימה אחרי הסינון.`);
  }
  if (match.length > 1) {
    for (const r of match) logger.step('ambiguous', `${r.docNo} · ${r.date} · ${r.customer}`);
    throw new Error(
      `מספר ${input.docNo} החזיר ${match.length} חשבוניות שונות — יש למסור customer כדי להכריע.`,
    );
  }
  const row = match[0];
  logger.step('row', `${row.docNo} · ${row.date} · ${row.customer} · ${row.amount}`);
  const rowSel = row.rowClass
    ? `td[class=${JSON.stringify(row.rowClass)}]:text-is(${JSON.stringify(String(input.docNo))})`
    : `td:text-is(${JSON.stringify(String(input.docNo))})`;
  await human.doubleClick(list.locator(rowSel).first(), { label: `פתיחת ${input.docNo}` });
  await human.settle('document opening');

  const out = { docNo: input.docNo, frames: [] };
  let linesFrame = null;
  try {
    const hdr = F(HEADER);
    if (!hdr) throw new Error(`כותרת החשבונית ${input.docNo} לא נפתחה.`);
    await dismissPopups(ctx);

    // `#OK` על **הכותרת** מתקדם לשורות; זה שבמסך השורות קולט. כאן זו הכותרת.
    await human.click('#OK', { scope: hdr, label: 'אישור כותרת — מעבר לשורות' });
    await human.settle('lines loading');
    for (let i = 0; i < 5 && !linesFrame; i++) {
      linesFrame = F(LINES);
      if (!linesFrame) await human.think('waiting for lines');
    }
    if (!linesFrame) throw new Error('מסך השורות לא נפתח.');
    logger.step('lines', `מסך השורות של ${input.docNo} פתוח`);

    const before = new Set(page.frames().map((f) => f.url()));
    await human.click(
      linesFrame.locator('button:has-text("יבוא מאקסל"), input[value="יבוא מאקסל"], [title="יבוא מאקסל"]').first(),
      { label: 'יבוא מאקסל' },
    );
    await human.settle('import dialog');
    await human.think('dialog painting');

    for (const f of page.frames()) {
      if (before.has(f.url()) && !/Imp/i.test(f.url())) continue;
      const controls = await f.evaluate(CONTROLS).catch(() => null);
      if (!controls?.length) continue;
      out.frames.push({ url: f.url(), controls });
      logger.step('frame', `${f.url().split('/').pop().slice(0, 70)} — ${controls.length} פקדים`);
      for (const c of controls.slice(0, 40)) {
        const label = [c.id && `#${c.id}`, c.title, c.alt, c.value, c.text].filter(Boolean).join(' · ').slice(0, 100);
        if (label) logger.step('ctl', label);
        if (c.options?.length) logger.step('opts', c.options.join(' | ').slice(0, 200));
      }
    }
    logger.save('import-dialog.json', out);
    await logger.shot(page, 'import-dialog');
  } finally {
    // היציאה היא הדלת, לא הקליטה.
    if (linesFrame) {
      await human.click('#DoExit', { scope: linesFrame, label: 'יציאה מהשורות בלי קליטה' }).catch(() => {});
      await human.settle('left lines');
    }
    const back = F(HEADER);
    if (back) {
      await human.click('#Cancel', { scope: back, label: 'ביטול — סגירת המסמך' }).catch(() => {});
      await human.settle('document closed');
    }
    await closePrograms(ctx).catch(() => {});
  }
  return out;
}
