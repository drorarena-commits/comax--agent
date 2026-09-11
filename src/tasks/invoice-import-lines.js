/**
 * חשבונית מס — הזנת השורות **ביבוא מאקסל** במקום אחת-אחת.
 *
 * הזנה שורה-אחר-שורה נמדדה ב-~36 שניות לשורה: חשבונית וויקס של 188 שורות =
 * כשעתיים עם המושב תפוס. דרור, 10/09/2026: "אל תעשה אחד אחד, לא נעשה מסמך
 * שעתיים, לא הגיוני".
 *
 * הזרימה, כפי שנלמדה מצילומיו ואומתה חי על 6500088 (11/09/2026):
 *
 *   כותרת → `#OKNot` → מסך שורות → `#ImpExcel` → דיאלוג יבוא
 *   → `#SwFormat` + `#File` → `#ok` → **תצוגה מקדימה** → ✓ שני → שורות במסמך
 *
 * ⛔ **המשימה עוצרת בתצוגה המקדימה ולא קולטת את החשבונית.** היא מכניסה שורות
 * לטיוטה; הקליטה נשארת בזרימת `document`/`finalize` עם השערים שלה.
 */
import { ensureLoggedIn } from '../session.js';
import * as registry from '../documents/registry.js';
import { openList, startNew, fillHeader, readHeader, commitHeader, readDocNumber, readTotals } from '../documents/engine.js';

export const meta = {
  name: 'invoice-import-lines',
  description: 'יוצר חשבונית ומייבא את שורותיה מאקסל — עוצר אחרי התצוגה המקדימה',
  writes: true,
  input: {
    customer: 'string — קוד לקוח. חובה',
    file: 'string — נתיב לקובץ האקסל/CSV. חובה',
    store: 'string, אופציונלי — מחסן. לוויקס: "WIX"',
    priceList: 'string, אופציונלי — מחירון. קובע אם הסכומים בקובץ נקראים ככוללי מע"מ',
    date: 'string dd/mm/yyyy, אופציונלי',
    details: 'string, אופציונלי',
    format: 'string, ברירת מחדל "ברקוד/קוד-כמות-סכום" — המבנה ב-#SwFormat',
    hasHeader: 'boolean, אופציונלי — לקובץ שיש בו שורת כותרת (#SwKoteret)',
    allowExisting: 'boolean — לייבא גם למסמך שכבר יש בו שורות. ברירת המחדל היא סירוב',
  },
  precheck(input) {
    if (!input.customer) return 'חסר customer.';
    if (!input.file) return 'חסר file — איזה קובץ לייבא?';
    return null;
  },
};

/**
 * 💣 `#ok` בדיאלוג היבוא **אינו מייבא** — הוא בונה תצוגה מקדימה.
 *
 * זה הדפוס השלישי מאותו סוג בקומקס: `Prt_ImpExl_New.asp` (יבוא פריטים),
 * `Imp_MhrTogether_Exl` (יבוא מחירונים), וכאן. בכל השלושה הוי הראשון בונה
 * מסך עם "יבוא תקין"/"יבוא לא תקין", והוי ה**שני** הוא שמבצע. ושים לב
 * לרישיות: כאן זה `#ok` קטן, לא `#OK`.
 */
const IMPORT_DIALOG = { file: '#File', format: '#SwFormat', header: '#SwKoteret', sort: '#SwSort', ok: '#ok', cancel: '#cancel' };

/**
 * מסך התצוגה המקדימה — שלושה פריימים, ולא אחד (מופה 11/09/2026).
 *
 *   `Doc650Lines_ExlU.asp`    — המסגרת. כאן `#OK` (`onOK()`) שמבצע את היבוא
 *   `Doc650Lines_Exl_Fr.asp`  — רשת **"יבוא תקין"**
 *   `Doc650Lines_Exl_Fr2.asp` — רשת **"יבוא לא תקין"**
 *
 * זה תאום מדויק של `Prt_ImpExl_Fr` / `Prt_ImpExl2_Fr` ביבוא הפריטים. **הסמכות
 * על דחיות היא רשת ה-`Fr2`, והיא בלבד** — רשת ריקה שם היא ההוכחה היחידה
 * שכלום לא נדחה.
 */
const PREVIEW = { shell: /Doc650Lines_ExlU\.asp/i, ok: /Doc650Lines_Exl_Fr\.asp/i, bad: /Doc650Lines_Exl_Fr2\.asp/i };

/**
 * 💣 **שני המונים יושבים ב-shell, לא ברשתות.**
 *
 * `Doc650Lines_Exl_Fr` ו-`_Fr2` מחזיקים את השורות בלבד; `סה"כ רשומות:` מודפס
 * במסגרת שמסביבן, פעמיים, לפי הסדר שעל המסך — קודם "יבוא תקין", אחריו
 * "יבוא לא תקין". הגרסה הראשונה של הקוד חיפשה אותם בתוך הרשתות, לא מצאה,
 * והדפיסה `לא תקין: 0` — **אפס שנולד מכישלון קריאה ולא מהיעדר דחיות**. זה
 * בדיוק הכשל שנראה זהה להצלחה, ולכן כאן היעדר מונה הוא **סירוב**.
 *
 * המונה השני מודפס **ריק** כשאין דחיות — וזה 0 לגיטימי, כי התווית נמצאה.
 */
const READ_COUNTS = () => {
  const body = (document.body.innerText || '').replace(/\s+/g, ' ');
  const found = [...body.matchAll(/סה"כ\s*רשומות\s*:\s*(\d*)/g)].map((m) => (m[1] === '' ? 0 : Number(m[1])));
  return { found, body: body.slice(0, 400) };
};

/** שורות רשת אחת — לדיווח על מה נדחה. המונה, לא אורך המערך, הוא הסמכות. */
const READ_ROWS = () => {
  const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const rows = [];
  for (const t of document.querySelectorAll('table')) {
    for (const tr of t.rows) {
      const cells = [...tr.cells].map(txt);
      if (cells.some(Boolean)) rows.push(cells);
    }
  }
  return rows.slice(0, 60);
};

export async function run(ctx) {
  const { page, human, logger, cfg, input, confirm } = ctx;

  const agent = registry.get('חשבונית מס');
  registry.assertReady(agent);
  const profile = agent.profile;
  const wantFormat = input.format ?? 'ברקוד/קוד-כמות-סכום';

  await ensureLoggedIn({ page, human, logger, cfg });
  const list = await openList(ctx, profile);
  const { frame: header } = await startNew(ctx, profile, list);
  await fillHeader(ctx, profile, header, input);
  const head = await readHeader(profile, header);
  for (const [k, v] of Object.entries(head)) {
    if (v != null && String(v).trim()) logger.step('header', `${k}: ${String(v).trim()}`);
  }

  // 💣 המחירון קובע מה המספרים בקובץ אומרים, לא רק איך הם מוצגים. תחת
  // "מכירה ראשי (כולל מע''מ)" עמודת הסכום נבלעת **ככוללת מע"מ** — נמדד על
  // 6500088: 290 בקובץ ⇒ 245.76 לפני מע"מ. תחת מחירון קבוצות אותו קובץ היה
  // נותן 342.20. לכן המחירון מודפס לפני כל דבר אחר, לפי כלל 3.
  logger.step('vat', `⚠ מחירון "${head.מחירון}" — הסכומים בקובץ ייקראו לפיו`);

  await commitHeader(ctx, profile, header);
  const docNo = await readDocNumber(ctx, profile);
  logger.step('lines', `מסמך ${docNo ?? '(לא נקרא)'} — מסך השורות`);

  const grid = page.frames().find((f) => /Doc650LinesV/i.test(f.url()));
  if (!grid) throw new Error('frame השורות לא נמצא.');

  // 💣 **טיוטה נתפסת מחדש, והיבוא מוסיף — לא מחליף.** כלל 15: מסמך שנוצר ולא
  // נקלט אינו ניתן לחיפוש, ו"מסמך חדש לאותו לקוח" נכנס אליו בחזרה. נמדד
  // 11/09/2026: הרצה שנייה של המשימה הזאת על 112001 נכנסה שוב ל-6500089
  // ויִיבאה את אותן שלוש השורות בשנית — 290.00 הפכו ל-**580.00**, בלי שגיאה
  // ובלי סימן. על חשבונית וויקס זה 376 שורות במקום 188.
  //
  // לכן: מסמך שאינו ריק הוא **עצירה**, לא הערה.
  const existing = await readTotals(ctx, profile).catch(() => null);
  const already = Number(String(existing?.total ?? '0').replace(/,/g, '')) || 0;
  if (already > 0 && !input.allowExisting) {
    throw new Error(
      `המסמך ${docNo} כבר מכיל שורות (סה"כ ${existing.total}).\n`
      + '  זו כנראה טיוטה קודמת שנתפסה מחדש, ויבוא נוסף יכפיל אותה.\n'
      + '  לקלוט או למחוק אותה קודם, או להעביר allowExisting אם ההוספה מכוונת.',
    );
  }

  const seen = new Set(page.frames().map((f) => f.url()));
  await human.click('#ImpExcel', { scope: grid, label: 'יבוא מאקסל' });
  await human.settle('import dialog');
  const dlg = page.frames().find((f) => !seen.has(f.url()) && /Imp/i.test(f.url()))
    ?? page.frames().find((f) => !seen.has(f.url()));
  if (!dlg) throw new Error('דיאלוג היבוא לא נפתח.');

  // ---- המבנה — ולא ברירת המחדל ------------------------------------------
  // ברירת המחדל היא `ברקוד/קוד-כמות` (value 1), **בלי סכום**. יבוא עליה מושך
  // מחירים מהמחירון במקום מהקובץ — 188 שורות תקינות למראה עם סכומים שגויים,
  // בלי שגיאה אחת. לכן בוחרים לפי **תווית** ומאמתים בקריאה חוזרת.
  const chose = await dlg.evaluate((args) => {
    const el = document.getElementById(args.id);
    if (!el) return { ok: false, why: 'השדה לא נמצא' };
    const opt = [...el.options].find((o) => (o.textContent || '').replace(/\s+/g, ' ').trim() === args.label);
    if (!opt) {
      return { ok: false, why: 'התווית לא קיימת', have: [...el.options].map((o) => o.textContent.trim()) };
    }
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: el.value, text: opt.textContent.trim() };
  }, { id: IMPORT_DIALOG.format.slice(1), label: wantFormat });
  if (!chose.ok) {
    throw new Error(`מבנה "${wantFormat}" לא נבחר: ${chose.why}.${chose.have ? '\n  קיימים: ' + chose.have.join(' · ') : ''}`);
  }
  logger.step('format', `מבנה: ${chose.text} (value ${chose.value})`);

  // שורת כותרת בקובץ. נקרא **ונרשם** ולא מונח — קובץ בלי כותרת שהתיבה
  // מסומנת עבורו מאבד את שורתו הראשונה בשקט, וזו שורה חסרה בחשבונית.
  if (input.hasHeader !== undefined) {
    await dlg.locator(IMPORT_DIALOG.header).setChecked(!!input.hasHeader).catch(() => {});
  }
  const hasHeader = await dlg.locator(IMPORT_DIALOG.header).isChecked().catch(() => null);
  logger.step('header-row', `"שורת כותרת בקובץ" = ${hasHeader === null ? '(לא נקרא)' : hasHeader ? 'מסומן' : 'לא מסומן'}`);

  // ---- הקובץ — כתיבה ישירה ל-input, לא לחיצה על הכפתור -------------------
  // לחיצה על "בחירת קובץ" פותחת את חלון הקבצים של Windows, מחוץ לדפדפן,
  // ותוקעת את ההרצה עד שאדם ניגש למסך.
  await dlg.locator(IMPORT_DIALOG.file).setInputFiles(input.file);
  await human.settle('file loaded');
  const chosen = await dlg.evaluate((id) => document.getElementById(id)?.value ?? '', IMPORT_DIALOG.file.slice(1));
  if (!chosen) throw new Error('הקובץ לא נבחר בשדה ההעלאה.');
  logger.step('upload', `נבחר: ${chosen}`);
  await logger.shot(page, 'import-dialog-ready');

  // ---- הוי הראשון: תצוגה מקדימה בלבד ------------------------------------
  const beforePreview = new Set(page.frames().map((f) => f.url()));
  await human.click(IMPORT_DIALOG.ok, { scope: dlg, label: 'אישור — בניית תצוגה מקדימה' });
  await human.settle('preview building');
  await human.think('preview painting');

  const F = (re) => page.frames().find((f) => re.test(f.url()));
  const shell = F(PREVIEW.shell);
  if (!shell) throw new Error('מסך התצוגה המקדימה לא נפתח — היבוא לא בוצע.');
  const counts = await shell.evaluate(READ_COUNTS).catch(() => null);
  const badRows = F(PREVIEW.bad) ? await F(PREVIEW.bad).evaluate(READ_ROWS).catch(() => []) : [];
  await logger.shot(page, 'import-preview');

  // ⛔ שני המונים, או סירוב. "לא מצאתי דחיות" אינו "אין דחיות".
  if (!counts || counts.found.length < 2) {
    throw new Error(
      `לא נקראו שני המונים "סה"כ רשומות" במסך התצוגה המקדימה (נמצאו ${counts?.found.length ?? 0}).\n`
      + '  בלעדיהם אי אפשר לדעת כמה שורות נקלטו וכמה נדחו — עוצר לפני ההכנסה.',
    );
  }
  const [valid, invalid] = counts.found;
  logger.step('preview', `תקין: ${valid}   לא תקין: ${invalid}`);
  for (const r of badRows.slice(1, 11)) logger.step('rejected', r.join(' · ').slice(0, 140));

  const out = {
    docNo, header: head, format: chose.text, hasHeader, file: input.file,
    valid, invalid, rejected: badRows.slice(1),
    filed: false, imported: false,
  };

  console.log('');
  console.log(`  מסמך:    ${docNo ?? '?'}   לקוח ${input.customer}`);
  console.log(`  מחירון:  ${head.מחירון}   מחסן: ${head.מחסן}`);
  console.log(`  מבנה:    ${chose.text}`);
  console.log(`  תקין:    ${valid}      לא תקין: ${invalid}`);
  console.log('');

  // ---- הוי השני: זה שמכניס באמת -----------------------------------------
  if (!confirm) {
    console.log('  ⛔ עצירה בתצוגה המקדימה — בלי --confirm השורות לא נכנסות למסמך.');
    console.log('');
    logger.save('result.json', out);
    return out;
  }
  if (invalid) {
    throw new Error(`${invalid} שורות ברשת "יבוא לא תקין" — עוצר לפני הכנסה חלקית. תקן את הקובץ או אשר במפורש.`);
  }

  await human.click('#OK', { scope: shell, label: 'אישור התצוגה המקדימה — הכנסת השורות' });
  await human.settle('lines inserted');
  out.imported = true;

  // ההוכחה אינה הלחיצה אלא הסיכום שקומקס עצמו מציג.
  const totals = await readTotals(ctx, profile).catch(() => null);
  out.totals = totals;
  if (totals) for (const [k, v] of Object.entries(totals)) logger.step('totals', `${k}: ${v}`);
  await logger.shot(page, 'lines-imported');
  logger.save('result.json', out);

  console.log('  השורות נכנסו למסמך. **החשבונית לא נקלטה** — הקליטה היא צעד נפרד.');
  console.log('');
  return out;
}
