/**
 * יבוא מחירון מקובץ CSV — `a6` → "יבוא מאקסל" → `Imp_MhrTogether_Exl.asp`.
 *
 *   npm run run -- cost-import --json '{"probe":true}'              מיפוי בלבד
 *   npm run run -- cost-import --json '{"file":"...","list":9}'     ממלא, מצלם, עוצר
 *   npm run run -- cost-import --json '{"file":"...","list":9}' --confirm
 *
 * **זה לא אותו מסך כמו יבוא הפריטים.** `a84` → `#ImpExl` יושב ב-
 * `Max2000_NET_2022` ובוחר עמודות דרך 119 תיבות `chkN` בפריים `FMiun`. המסך
 * הזה יושב ב-`Max2000`, אין בו `chkN`, ומבנה הקובץ נקבע בשלוש תיבות בלבד —
 * `SwMhrKod` מחירון · `SwBarCode` ברקוד · `SwMhr` מחיר — שמסומנות כברירת
 * מחדל. הוא גם **דורש CSV**, וכותב את זה על עצמו: "יבוא מחירונים מקובץ CSV",
 * "חובת כותרת לכל עמודה בקובץ".
 *
 * ⛔ **שלוש תיבות שהורסות נתונים אם הן דלוקות, וכולן כבויות כברירת מחדל:**
 *
 *   1. **`SwStop_Sell` "חסימה למכר (פריטים שלא בקובץ)"** — חוסם למכירה כל
 *      פריט שאינו בקובץ. בקובץ של 719 שורות מול קטלוג של 13,282, זה 12,563
 *      פריטים חסומים. הנזק אינו שגיאה — הוא פריטים שפשוט מפסיקים להימכר.
 *   2. **`swDeleteFuturePrices` "מחיקת מחירים עתידיים"** — מוחק כל מחיר
 *      בתאריך מאוחר מזה שבקובץ.
 *   3. **`swWithMhrZero` "כולל מחיר 0"** — מאפשר לשורה עם 0 לאפס מחיר קיים.
 *
 * המשימה **קוראת את שלושתן ומאמתת שהן כבויות** לפני הקליק הבלתי-הפיך. לא
 * מסמנת, לא מכבה — אם אחת דלוקה, עוצרת. מי שידליק אותן במכוון בעתיד יצטרך
 * דגל מפורש, וזה בדיוק הרעיון.
 *
 * ⚠️ **`מחירון` בעמודה הראשונה אינו קוד הספק.** אצל MGS, אוני ספורט וטלבר
 * המספרים זהים במקרה; אצל ספורט אנד מור קוד הספק `121012` והמחירון
 * `1210012`. `PRICE_LISTS` ב-`src/items/build-cost.js` מחזיק את הרשימה
 * כפי שנקראה מהמסך.
 *
 * מתכון המסך: knowledge/screens/pricelists-a6.json · cost-import-dialog.json
 * הממצאים המלאים: knowledge/MAP.md, פרק "מחירונים — a6".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { ROOT } from '../config.js';
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';
import { PRICE_LISTS } from '../items/build-cost.js';

export const meta = {
  name: 'cost-import',
  description: 'מייבא מחירון (מחיר קניה/עלות) מקובץ CSV למסך המחירונים של קומקס',
  writes: true,
  input: {
    file: 'נתיב ל-CSV — תוצר של npm run cost-file. שלוש עמודות: מחירון,ברקוד,מחיר',
    list: 'מספר המחירון הצפוי. חובה — נבדק מול העמודה הראשונה בקובץ',
    probe: 'true — למפות את הדיאלוג ולעצור בלי לגעת בכלום',
    fromDate: 'נכון מתאריך, dd/mm/yyyy. ברירת המחדל: היום',
  },
};

const LISTS = /Erp\/Mhr\/MhrV/i;
const DIALOG = /Imp_MhrTogether_Exl/i;

/** `1=רגיל` — הקובץ שלנו אינו מטריצה. */
const IMP_TYPE = '1';
/** `1=ברקוד` — המפתח בקובץ. */
const SUG = '1';

/** התיבות שמגדירות את מבנה הקובץ. חייבות להיות בדיוק אלה — לא פחות ולא יותר. */
const WANTED_COLUMNS = ['SwMhrKod', 'SwBarCode', 'SwMhr'];
/** שאר תיבות "שדות ליבוא" — כל אחת מהן דלוקה מזיזה את משמעות העמודות. */
const OTHER_COLUMNS = ['SwAczDic', 'SwAczDic2', 'SwMhrCmt', 'SwDate', 'SwNeto', 'SwMt'];
/** התיבות ההרסניות. ראה הכותרת. */
const DESTRUCTIVE = {
  SwStop_Sell: 'חסימה למכר (פריטים שלא בקובץ)',
  swDeleteFuturePrices: 'מחיקת מחירים עתידיים',
  swWithMhrZero: 'כולל מחיר 0',
};

const todayInIsrael = (timeZone = 'Asia/Jerusalem') => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date()).reduce((m, x) => ({ ...m, [x.type]: x.value }), {});
  return `${p.day}/${p.month}/${p.year}`;
};

/**
 * קורא את ה-CSV ומאמת אותו מול המחירון המבוקש.
 *
 * ⛔ **השער הזה קיים כי מספר מחירון שגוי אינו שגיאה בקומקס** — הוא פשוט
 * יוצר מחירים במחירון אחר, ואף דוח לא יצעק. הבדיקה היא על **כל** שורה,
 * לא על הראשונה.
 */
function readCsv(file, expectedList) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error(`הקובץ ${file} ריק או מכיל כותרת בלבד.`);

  const head = lines[0].split(',').map((h) => h.trim());
  if (head.length !== 3) {
    throw new Error(`הקובץ חייב שלוש עמודות (מחירון,ברקוד,מחיר) — נמצאו ${head.length}: ${head.join(' · ')}`);
  }

  const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim()));
  const badList = rows.filter((r) => r[0] !== String(expectedList));
  if (badList.length) {
    throw new Error(`${badList.length} שורות נושאות מחירון שאינו ${expectedList}: `
      + `${[...new Set(badList.map((r) => r[0]))].slice(0, 5).join(', ')}`);
  }
  // ⛔ ברקוד שאיבד ספרות בדרך (תא מספרי, 3.46834E+12) יידחה בקומקס בשקט
  //    כ"פריט לא נמצא" — וזו דחייה שנראית כמו נתון חסר, לא כמו באג בקובץ.
  const badBarcode = rows.filter((r) => !/^\d{13}$/.test(r[1]));
  if (badBarcode.length) {
    throw new Error(`${badBarcode.length} ברקודים שאינם 13 ספרות: ${badBarcode.slice(0, 5).map((r) => r[1]).join(', ')}`);
  }
  const badPrice = rows.filter((r) => !(Number(r[2]) > 0));
  if (badPrice.length) {
    throw new Error(`${badPrice.length} מחירים שאינם מספר חיובי: ${badPrice.slice(0, 5).map((r) => `${r[1]}→"${r[2]}"`).join(' · ')}`);
  }
  return { head, rows };
}

export async function run({ page, human, logger, input, cfg, dryRun }) {
  await ensureLoggedIn({ page, human, logger, cfg });

  // ---- מסך המחירונים --------------------------------------------------
  let lists = page.frames().find((f) => LISTS.test(f.url()));
  if (!lists) {
    const opened = await openProgram({ page, human, logger, cfg }, 'a6', { expect: LISTS });
    lists = opened.frame;
  } else {
    logger.step('program', 'מסך המחירונים כבר פתוח');
  }
  if (!lists) throw new Error('מסך המחירונים לא נפתח.');

  // ---- דיאלוג היבוא ---------------------------------------------------
  let dlg = page.frames().find((f) => DIALOG.test(f.url()));
  if (!dlg) {
    // `human.#loc` מקבל סלקטור CSS או Locator — לא מחרוזת `getByRole(...)`.
    await human.click(lists.getByRole('button', { name: 'יבוא מאקסל' }), { label: 'יבוא מאקסל' });
    await human.settle('דיאלוג יבוא המחירונים');
    dlg = page.frames().find((f) => DIALOG.test(f.url()));
  }
  if (!dlg) throw new Error('דיאלוג יבוא המחירונים לא נפתח.');
  logger.step('dialog', 'דיאלוג יבוא המחירונים פתוח');

  const readState = () => dlg.evaluate(() =>
    [...document.querySelectorAll('input,select,button')].filter((el) => el.id).map((el) => ({
      id: el.id,
      tag: el.tagName.toLowerCase(),
      type: el.type ?? '',
      value: (el.value ?? '').toString(),
      title: (el.title ?? '').toString(),
      checked: el.type === 'checkbox' ? el.checked : undefined,
      options: el.tagName === 'SELECT' ? [...el.options].map((o) => `${o.value}=${o.text.trim()}`) : undefined,
    })));

  // ---- probe ----------------------------------------------------------
  if (input.probe) {
    const state = await readState();
    const text = await dlg.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n'));
    const dest = resolve(ROOT, 'knowledge/screens/cost-import-dialog.json');
    writeFileSync(dest, JSON.stringify({
      capturedAt: new Date().toISOString(), dialogUrl: dlg.url(), text, fields: state,
    }, null, 2), 'utf8');
    await logger.shot(page, 'cost-import-dialog');
    logger.step('probe', `${state.length} שדות → ${dest}`);
    return { probe: true, fields: state.length, file: dest };
  }

  // ---- הקובץ ----------------------------------------------------------
  if (!input.file) throw new Error('חסר `file`. להריץ קודם: npm run cost-file -- --import');
  if (!input.list) throw new Error('חסר `list` — מספר המחירון. אין ברירת מחדל בכוונה.');
  const file = isAbsolute(input.file) ? input.file : resolve(ROOT, input.file);
  if (!existsSync(file)) throw new Error(`הקובץ לא נמצא: ${file}`);
  if (!/\.csv$/i.test(file)) throw new Error(`המסך דורש CSV, וקיבל: ${file}`);

  const known = Object.entries(PRICE_LISTS).find(([, v]) => String(v) === String(input.list));
  const { rows } = readCsv(file, input.list);
  logger.step('file', `${rows.length} שורות · מחירון ${input.list}`
    + `${known ? ` (${known[0]})` : ' — ⚠ אינו ברשימה שנקראה מ-a6'}`);

  // ---- הבוררים --------------------------------------------------------
  await human.select('#SwImpType', IMP_TYPE, { scope: dlg, label: 'מבנה: רגיל' });
  await human.select('#Sug', SUG, { scope: dlg, label: 'לפי: ברקוד' });
  const fromDate = input.fromDate ?? todayInIsrael(cfg?.timeZone);
  await human.type('#FromDate', fromDate, { scope: dlg, label: 'נכון מתאריך' });
  await dlg.evaluate(() => document.getElementById('FromDate')?.blur());
  await human.settle('אחרי התאריך');

  // ---- הקובץ לשדה -----------------------------------------------------
  await dlg.locator('#File').setInputFiles(file);
  await human.settle('אחרי בחירת הקובץ');

  // ---- השערים, אחרי שהמסך במצבו הסופי ---------------------------------
  const state = await readState();
  const byId = Object.fromEntries(state.map((s) => [s.id, s]));

  const missing = WANTED_COLUMNS.filter((id) => !byId[id]?.checked);
  if (missing.length) {
    throw new Error(`תיבות מבנה הקובץ אינן מסומנות: ${missing.join(', ')}. `
      + 'הקובץ הוא מחירון,ברקוד,מחיר — בלי שלושתן העמודות ייקראו לשדות אחרים.');
  }
  const extra = OTHER_COLUMNS.filter((id) => byId[id]?.checked);
  if (extra.length) {
    throw new Error(`תיבות מבנה נוספות מסומנות: ${extra.join(', ')}. `
      + 'כל אחת מהן מוסיפה עמודה שהמסך מצפה לה, והקובץ שלנו נושא שלוש בלבד.');
  }
  const armed = Object.entries(DESTRUCTIVE).filter(([id]) => byId[id]?.checked);
  if (armed.length) {
    throw new Error(`תיבות הרסניות דלוקות: ${armed.map(([id, l]) => `${id} (${l})`).join(' · ')}. `
      + 'עוצרים. אין לכבות אותן אוטומטית — מי שהדליק אותן התכוון למשהו.');
  }
  const type = byId.SwImpType?.value;
  const sug = byId.Sug?.value;
  if (type !== IMP_TYPE || sug !== SUG) {
    throw new Error(`הבוררים לא נקלטו: מבנה=${type} (צפוי ${IMP_TYPE}) · לפי=${sug} (צפוי ${SUG}).`);
  }
  const loaded = byId.File?.value ?? '';
  if (!loaded) throw new Error('שדה הקובץ ריק אחרי ההעלאה.');

  logger.step('gates', 'מבנה: מחירון·ברקוד·מחיר ✅ · אין תיבות נוספות ✅ · '
    + 'חסימה למכר / מחיקת עתידיים / מחיר 0 — כבויות ✅');

  // ---- העצירה ---------------------------------------------------------
  await logger.shot(page, 'before-import');
  console.log('');
  console.log(`  קובץ    : ${file}`);
  console.log(`  שורות   : ${rows.length}`);
  console.log(`  מחירון  : ${input.list}${known ? ` — ${known[0]}` : ''}`);
  console.log(`  תאריך   : ${fromDate}`);
  console.log(`  טווח    : ${Math.min(...rows.map((r) => +r[2]))} – ${Math.max(...rows.map((r) => +r[2]))} ₪`);
  console.log('');

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני הקליטה. להרצה אמיתית: הוסף --confirm');
    return { dryRun: true, rows: rows.length, list: input.list, file };
  }

  // ---- שלב 1: תצוגה מקדימה --------------------------------------------
  //
  // ⚠️ **`#button1` הוא `DoHelp`, לא יבוא.** נמדד: שני ה-`<button>` היחידים
  //    בטופס הם `onclick="DoExit.click()"` (בלי id) ו-`button1` שהוא
  //    `DoHelp.click()` — מדריך ההמרה ל-CSV, מאיפה שהגיע ה-PDF של דרור.
  //    הקליטה היא **`#OK`** (IMG, `title="אישור"`), כמו בכל מסך בקומקס.
  //
  // ⚠️ **וה-`#OK` הראשון אינו קולט** — הוא בונה מסך תוצאה עם שתי רשתות,
  //    "יבוא תקין" ו"יבוא לא תקין", ובו `#OK` משלו. אותה מלכודת בדיוק כמו
  //    `#ok` מול `#OK` ביבוא הפריטים, בלבוש אחר. **הרשת של "לא תקין"
  //    (`..._Fr2.asp`) היא הסמכות היחידה על דחיות.**
  await human.click('#OK', { scope: dlg, label: 'אישור — בניית התצוגה המקדימה' });
  await human.settle('מסך התוצאה');

  // הפריים מזוהה לפי **התוכן** ולא לפי הכתובת: הכתובת של מסך התוצאה נושאת
  // חותמת זמן משתנה, והיא זהה בתחילתה לזו של הדיאלוג שהחליף אותו.
  const preview = await (async () => {
    for (const f of page.frames()) {
      const ok = await f.evaluate(() =>
        !!document.getElementById('OK') && /יבוא תקין/.test(document.body.innerText)).catch(() => false);
      if (ok) return f;
    }
    return null;
  })();
  if (!preview) throw new Error('מסך התוצאה לא נמצא — לא קולטים.');

  // ⛔ **התצוגה המקדימה נבנית אסינכרונית, ורשת ריקה נראית בדיוק כמו "אפס
  //    דחיות".** נמדד ב-07/09/2026 על 719 שורות: שלוש שניות אחרי הקליק
  //    המונה הראה `30 מתוך 719` והרשתות היו כמעט ריקות, ולכן שער שקרא אותן
  //    מיד דיווח `תקין: 0 · לא תקין: 0` **ועבר**. זה הכשל היחיד כאן שנראה
  //    זהה להצלחה — ולכן ממתינים למונה, ולא לזמן.
  const readCounter = () => preview.evaluate(() => {
    const m = document.body.innerText.replace(/\s+/g, ' ').match(/סה"כ פריטים:\s*(\d+)\s*מתוך\s*(\d+)/);
    return m ? { done: +m[1], total: +m[2] } : null;
  }).catch(() => null);

  let counter = null;
  for (let i = 0; i < 120; i++) {
    counter = await readCounter();
    if (counter && counter.done >= counter.total) break;
    await page.waitForTimeout(2000);
  }
  if (!counter) throw new Error('לא נמצא מונה "סה"כ פריטים" במסך התוצאה — לא קולטים בלי לדעת כמה נקראו.');
  if (counter.done < counter.total) {
    throw new Error(`התצוגה המקדימה לא הסתיימה: ${counter.done} מתוך ${counter.total} אחרי 4 דקות. לא קולטים.`);
  }
  if (counter.total !== rows.length) {
    throw new Error(`קומקס קרא ${counter.total} שורות והקובץ מכיל ${rows.length}. לא קולטים.`);
  }

  const countGrid = async (re) => {
    const f = page.frames().find((x) => re.test(x.url()));
    if (!f) return 0;
    return f.evaluate(() => document.body.innerText.trim().split('\n').filter((l) => l.trim()).length - 1)
      .catch(() => 0);
  };
  const good = await countGrid(/Imp_MhrTogether_Exl_Fr\.asp/i);
  const rejected = await countGrid(/Imp_MhrTogether_Exl_Fr2\.asp/i);
  await logger.shot(page, 'preview');
  logger.step('preview', `נקראו ${counter.done}/${counter.total} · תקין: ${good} · לא תקין: ${rejected}`);

  if (rejected > 0) {
    const f = page.frames().find((x) => /_Fr2\.asp/i.test(x.url()));
    const sample = await f.evaluate(() => document.body.innerText.trim().split('\n').slice(0, 11).join('\n'));
    throw new Error(`${rejected} שורות נדחו — לא קולטים.\n${sample}`);
  }
  if (good === 0) {
    throw new Error('רשת "יבוא תקין" ריקה. לא קולטים — אפס שורות תקינות אינו מצב שמותר להמשיך ממנו.');
  }

  // ---- שלב 2: הקליטה, בלתי הפיכה --------------------------------------
  await human.click('#OK', { scope: preview, label: 'אישור — קליטת המחירון' });
  await human.settle('אחרי הקליטה');
  await logger.shot(page, 'after-import');

  const stillOpen = page.frames().some((f) => /Imp_Mhr/i.test(f.url()));
  if (stillOpen) logger.step('warn', '⚠ מסך היבוא עדיין פתוח — לבדוק שהקליטה הושלמה');

  return { ok: true, rows: rows.length, imported: good, list: input.list };
}
