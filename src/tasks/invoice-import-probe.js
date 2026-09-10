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

  // כלל 18: מספר מסמך חוזר בין שנים. כשנמסר לקוח — בוחרים לפיו.
  const rowSel = input.customer
    ? `td:text-is(${JSON.stringify(String(input.customer))})`
    : `td:text-is(${JSON.stringify(String(input.docNo))})`;
  await human.click(list.locator(rowSel).first(), { label: `פתיחת ${input.docNo}` });
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
