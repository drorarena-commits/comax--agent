/**
 * פותח חשבונית מס **חדשה** ומשאיר אותה פתוחה במסך השורות — לצורך לימוד.
 *
 * למה זו משימה נפרדת ולא `document`: `document` מצפה לשורות ומנהל זרימה שלמה
 * עד העצירה שלפני הקליטה. כאן המטרה הפוכה — להגיע למסך השורות **בלי שורה
 * אחת**, ולעצור שם כדי שדרור יצלם את מסלול "יבוא מאקסל" צעד אחר צעד
 * (11/09/2026).
 *
 * ⛔ **לא קולט, ולא נוגע ב-`#OK` של מסך השורות** (כלל 4). היא מפעילה את `#OK`
 * של ה**כותרת** בלבד, דרך `commitHeader`, שמסרב לרוץ על frame שאינו כותרת.
 * היציאה נשארת בידיים של מי שעובד מול המסך: `#DoExit` ואז `#Cancel`, או
 * `npm run run -- invoice-open-new --close`.
 *
 * ⚠️ **היא משאירה טיוטה מאחור בכוונה.** טיוטה אינה ניתנת לחיפוש (כלל 15),
 * ולכן מספר המסמך מודפס ונשמר ב-`result.json` — זו הידית היחידה אליה.
 */
import { ensureLoggedIn } from '../session.js';
import * as registry from '../documents/registry.js';
import { openList, startNew, fillHeader, readHeader, commitHeader, readDocNumber } from '../documents/engine.js';

export const meta = {
  name: 'invoice-open-new',
  description: 'פותח חשבונית מס חדשה ועוצר במסך השורות — ללימוד מסלול "יבוא מאקסל"',
  // כותבת: היא יוצרת טיוטה בקומקס. אין קליטה, אך גם טיוטה היא עקבה.
  writes: true,
  input: {
    customer: 'string — קוד לקוח. חובה',
    store: 'string, אופציונלי — מחסן. בלעדיו נשאר מה שקומקס טען מכרטיס הלקוח',
    priceList: 'string, אופציונלי — מחירון. בלעדיו נשאר מה שקומקס טען',
    date: 'string dd/mm/yyyy, אופציונלי',
    details: 'string, אופציונלי — שדה פרטים',
    probeImport: 'boolean — גם לפתוח את דיאלוג "יבוא מאקסל" ולמפות את כל פקדיו',
  },
  precheck(input) {
    if (!input.customer) return 'חסר customer — לאיזה לקוח לפתוח את החשבונית?';
    return null;
  },
};

/** כל מה שלחיץ או נבחר בפריים — כך דיאלוג שלא מופה נעשה ידוע. */
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
        ? [...el.options].map((o) => `${norm(o.textContent) || o.title || ''}=${o.value}`).slice(0, 30)
        : null,
    }))
    .filter((c) => c.id || c.title || c.alt || c.text || c.onclick);
};

export async function run(ctx) {
  const { page, human, logger, cfg, input } = ctx;

  const agent = registry.get('חשבונית מס');
  registry.assertReady(agent);
  const profile = agent.profile;

  await ensureLoggedIn({ page, human, logger, cfg });
  const list = await openList(ctx, profile);
  const { frame: header } = await startNew(ctx, profile, list);

  await fillHeader(ctx, profile, header, input);
  const head = await readHeader(profile, header);
  for (const [k, v] of Object.entries(head)) {
    if (v != null && String(v).trim()) logger.step('header', `${k}: ${String(v).trim()}`);
  }
  await logger.shot(page, 'header');

  // `#OK` של הכותרת מתקדם לשורות. `commitHeader` מסרב לרוץ על frame שאינו
  // כותרת, ולכן הוא לא יכול להפוך בטעות לקליטה.
  await commitHeader(ctx, profile, header);
  const docNo = await readDocNumber(ctx, profile);
  logger.step('lines', `מסך השורות פתוח — מסמך ${docNo ?? '(המספר לא נקרא)'}`);
  await logger.shot(page, 'lines-empty');

  const out = { docNo, header: head, customer: input.customer, filed: false };

  // מיפוי דיאלוג היבוא. `#ImpExcel` נקרא מהסנפשוט הקיים — `button` עם
  // `onclick="ImpExcel_onclick()"` ב-`Doc650LinesV.asp` — ולא נוחש מצילום.
  if (input.probeImport) {
    const grid = page.frames().find((f) => /Doc650LinesV/i.test(f.url()));
    if (!grid) throw new Error('frame השורות לא נמצא — אי אפשר לפתוח את דיאלוג היבוא.');
    const before = new Set(page.frames().map((f) => f.url()));
    await human.click('#ImpExcel', { scope: grid, label: 'יבוא מאקסל' });
    await human.settle('import dialog');
    await human.think('dialog painting');

    out.importDialog = [];
    for (const f of page.frames()) {
      if (before.has(f.url())) continue;
      const controls = await f.evaluate(CONTROLS).catch(() => null);
      if (!controls?.length) continue;
      out.importDialog.push({ url: f.url(), controls });
      logger.step('frame', `${f.url().split('/').pop().split('?')[0]} — ${controls.length} פקדים`);
      for (const c of controls) {
        const label = [c.id && `#${c.id}`, c.tag, c.type, c.title, c.alt, c.value, c.text]
          .filter(Boolean).join(' · ').slice(0, 110);
        if (label) logger.step('ctl', label);
        if (c.options?.length) logger.step('opts', c.options.join(' | ').slice(0, 300));
      }
    }
    await logger.shot(page, 'import-dialog');
  }

  logger.save('result.json', out);

  // 💣 החלון נשאר פתוח **בכוונה**, וזו החריגה מכלל 10. סגירת התוכניות כאן
  // הייתה מוחקת בדיוק את המסך שנפתח כדי לצלם אותו.
  console.log('');
  console.log(`  מסך השורות של חשבונית ${docNo ?? '?'} פתוח וריק — מוכן לצילום.`);
  console.log('  ⛔ לא ללחוץ #OK במסך הזה — הוא קולט את החשבונית.');
  console.log('  ליציאה בלי קליטה: #DoExit ואז #Cancel, או npm run close -- all');
  console.log('');
  return out;
}
