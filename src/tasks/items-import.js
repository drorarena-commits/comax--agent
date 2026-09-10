/**
 * יבוא פריטים מאקסל — `a84` → לשונית "נוספים" → `#ImpExl`.
 *
 * זו הדרך שבה פריט חדש נכנס לקומקס. אותו מסלול כמו `items-export`, עם כפתור
 * שכן ברשת (`#ImpExl` במקום `#ExpExl`), אבל בכיוון ההפוך ולכן **בלתי הפיך**:
 * הקמת פריט בקומקס אינה מתבטלת בקליק.
 *
 *   npm run items-import -- --json '{"probe":true}'          מיפוי בלבד
 *   npm run items-import -- --json '{"file":"..."}'          ממלא, מצלם, עוצר
 *   npm run items-import -- --json '{"file":"..."}' --confirm  קולט בפועל
 *
 * ⚠️ שתי מלכודות שנמדדו במסך הזה (07/09/2026), ושתיהן נראות בדיוק כמו הצלחה:
 *
 *   1. **`chkN.title` הוא מה שנשלח, לא `chkN.value`.** בפריים `FMiun` כל שדה
 *      מחזיק שני ערכים — `.value` היא **אות** העמודה שרואים על המסך, ו-`.title`
 *      היא המספר הסידורי שלה. `getList()`, שמרכיבה את מה שהשרת מקבל, עוברת
 *      **לפי `.title` בלבד**. כתיבה ל-`.value` בלבד מציגה `M` ליד "מחיר מכירה"
 *      ושולחת עמודה אחרת, או כלום. זו משפחת הכשל של `GetMiunVal()` בדיאלוג
 *      הייצוא, בלבוש חדש.
 *
 *   2. **בורר `SwImpType` מחזיק את הקוד ב-`title` ואת השם ב-`value`.** כתיבה
 *      ל-`.value` לא מזיזה כלום; רק `SwImpType_onchange()` (שקורא ל-`ShowMivne()`)
 *      טוען מחדש את `FMiun`. נמדד: בקשה ל"פריטים" החזירה את רשימת השדות של
 *      "נתוני אתר לפריט" בלי שגיאה.
 *
 * ⛔ 💣 **מלכודת שלישית, נמדדה 08/09/2026 על באצ' של 10 — היחידה שהגיעה עד
 *    שלב הקליטה בפועל ונכשלה בשקט.** מסך התוצאה (`Prt_ImpExlU.asp`) נבנה
 *    **אסינכרונית**, כמו ב-`cost-import`. קריאת הרשתות מיד אחרי `settle`
 *    דיווחה `shown=0 · rejected=0`, הקוד לא בדק שזה סביר, ולחץ על `#OK`
 *    השני בזמן שה-DOM עדיין ברינדור — קומקס החזיר "כפילות בנתונים !" וסירב.
 *    ה-`stillOpen` שכבר היה בקוד תפס את זה נכון אבל רק **הזהיר** ודיווח
 *    `ok: true`; `items-export` בהרצה חוזרת אישרה **0 מתוך 10** פריטים
 *    נוצרו. עכשיו: ממתינים שהמונים יתייצבו לפני שממשיכים, וכל סטייה —
 *    כולל `stillOpen` וכולל "כפילות בנתונים" בטקסט העמוד — **עוצרת בזריקת
 *    שגיאה**, לא מזהירה. **הלקח הרחב: `ok: true` אינו הוכחה. ההוכחה היחידה
 *    להקמת פריט היא לראות אותו מחוץ לאשף היבוא** — `items-export` ואז
 *    `grep` על הברקוד, בדיוק כמו כלל האימות של הפרויקט.
 *
 *
 * ⛔ 💣 **מלכודת רביעית, ותיקון של השלישית — 08/09/2026, חמש הרצות רצופות.**
 *    אחרי שנוספה ההמתנה לעיל, כל הרצה נכשלה ב-`0 תקין + 0 לא תקין` מול קובץ
 *    בן 10 שורות. **הסיבה לא הייתה זמן ההמתנה** אלא ש-`page.frames()` נקרא
 *    **פעם אחת**, לפני ההמתנה: פריימי הרשתות עדיין לא היו קיימים באותו רגע,
 *    שני ה-`Frame` יצאו `undefined`, והספירה החזירה `0` בכל סיבוב. 6 שניות
 *    ו-60 שניות נכשלו זהה. הפריימים מאותרים עכשיו **אחרי** שהמונה
 *    `סה"כ פריטים: N מתוך M` התייצב, בדיוק כמו ב-`cost-import`.
 *
 *    ⚠️ **ומה שנראה מהצד כ"הסוכן עשה logoff במקום ללחוץ על ה-V השני" הוא
 *    ההתאוששות, לא הסיבה:** `tools/run.js` עושה לוגין מחדש על כל כישלון
 *    במשימת כתיבה, ולכן הדפדפן ניווט למסך ההתחברות באותו רגע שבו היה אמור
 *    ללחוץ. כשרואים לוגין פתאומי באמצע זרימה — לחפש את השגיאה שקדמה לו.
 *
 *
 *    ⚠️ **והמונה כאן אינו בפורמט של `cost-import`.** נמדד חי: מסך התוצאה
 *    כתוב `יבוא תקין: סה"כ פריטים: 10 · יבוא לא תקין: סה"כ פריטים: 0` —
 *    **בלי "מתוך"**. `מתוך` מופיע רק כשנחצתה תקרת התצוגה ("100 מתוך 175").
 *    ביטוי שדורש `מתוך` תמיד, כפי שהועתק מ-`cost-import`, לא מתאים לעולם.
 *    ⚠️ **ואסור לדרוש `shown + rejected === dataRows`.** שער כזה נוסף כאן
 *    בטעות באותו יום והוא סותר ממצא מדוד: רשת "יבוא תקין" חוסמת ב-100 שורות
 *    תצוגה ("100 מתוך 175"), ולכן הוא היה נכשל תמיד מעל 100 שורות. הסמכות
 *    על הכמות היא המונה; הסמכות על דחיות היא רשת "יבוא לא תקין" בלבד.
 * מתכון המסך: knowledge/screens/items-import-dialog.json · items-import-types.json
 * הממצאים המלאים: knowledge/MAP.md, פרק "יבוא פריטים מאקסל".
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { ROOT } from '../config.js';
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';
import { readSheet, sheetNames, numericCells } from '../../tools/xlsx.js';
import { IMPORT_HEADERS, comaxCatalog } from '../items/build-import.js';
import { masterGate } from '../items/master-gate.js';

export const meta = {
  name: 'items-import',
  description: 'מעלה קובץ אקסל של פריטים חדשים למסך היבוא של קומקס, ועוצר לפני הקליטה',
  writes: true,
  input: {
    file: 'נתיב לקובץ ההקמה (xlsx), יחסי ל-root או מוחלט',
    probe: 'true — למפות את הדיאלוג ולעצור בלי לגעת בכלום',
    impType: 'קוד סוג היבוא בבורר SwImpType. ברירת המחדל "0" — פריטים. סוג אחר נתמך ב-probe בלבד עד שהמיפוי שלו נמדד',
    columns: 'מיפוי ידני {chkId: "A"}, אופציונלי — ברירת המחדל נגזרת מכותרות הקובץ',
    allowUpdate: 'true — לאפשר גם עדכון פריטים קיימים ("הקמת פריט" ריק). ברירת המחדל: הקמה בלבד',
    priceDate: 'תאריך "מחיר מכירה נכון לתאריך" בפורמט dd/mm/yyyy. ברירת המחדל: היום',
    previewOnly: 'true — לוחץ רק על הכפתור הירוק הראשון (בניית התצוגה המקדימה), ועוצר. לא נוגע בכפתור השני, הקליטה. דורש --confirm כדי בכלל להגיע למסך הזה',
  },
};

const ITEMS = /Erp\/Prt\/PrtV/i;
const DIALOG = /Prt_ImpExl_New/i;
const PICKER = /MiunSwImp/i;
/** `#ImpExl` קיים בכל הלשוניות ונראה רק ב"נוספים". קליק על מוסתר לא נוחת. */
const EXTRAS_TAB = 'Row3';
/** `0 · פריטים` — הכרעת דרור 07/09/2026. שאר 19 הסוגים לא בשימוש. */
const DEFAULT_IMP_TYPE = '0';

/**
 * כותרת בקובץ ההקמה ⇒ השדה במסך היבוא.
 *
 * הצד השמאלי הוא `IMPORT_HEADERS` מ-`src/items/build-import.js`; הצד הימני
 * הוא ה-id ב-`FMiun` כפי שנמדד בסוג יבוא 0.
 *
 * **תשע העמודות שאינן כאן — לא שכחה, החלטה** (הכרעות דרור, 07/09/2026):
 *
 * | עמודה | למה לא |
 * |---|---|
 * | `שם מחלקה` `שם קבוצה` `שם קבוצת משנה` `שם ספק` | רק התיאור הקריא של קוד שכן מייבאים; קומקס שולף אותו מהמאסטר |
 * | `מקור הסיווג` `הועתק מפריט` | עמודות ביקורת שלנו — אין להן שדה בקומקס |
 * | `מחיר עלות` | **נכנס דרך יבוא מחירונים — מסך אחר וקובץ אחר.** היבוא הזה תופס מחיר מכירה ראשי (צרכן) בלבד |
 * | `מחיר סיטונאי` | אין שדה בסוג 0 — מחירון אחד להרצה. `מחיר מחירון 2` ריק ב-0/13,107 בקטלוג |
 * | `עונה` | **אין שדה כזה בטופס היבוא בכלל.** `נוסף 2` מחזיק `FW22` ב-2 מתוך 375 פריטי ספורט אנד מור — שריד, לא מוסכמה |
 */
export const HEADER_TO_FIELD = {
  'מק"ט': 'chk0',            // פריט
  'שם פריט': 'chk1',
  'ברקוד': 'chk3',
  'מחלקה': 'chk5',
  'קבוצה': 'chk6',
  'ספק': 'chk7',
  'קבוצת משנה': 'chk8',
  'שם פריט באנגלית': 'chk40', // שם לועזי
  'קוד חלופי': 'chk41',
  'דגם': 'chk76',
  'צבע': 'chk77',
  'מידה': 'chk78',
  'מחיר צרכן': 'chk113',      // מחיר מכירה
};

/** היום בישראל בפורמט שקומקס מצפה לו — `dd/mm/yyyy`, `maxlength=10`. */
function todayInIsrael(timeZone) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('day')}/${g('month')}/${g('year')}`;
}

/** מיקום 0-בסיס ⇒ אות עמודה באקסל: 0⇒A, 25⇒Z, 26⇒AA. */
export function colLetter(n) {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** קורא את הגיליון הראשון של קובץ ההקמה — כותרות ושורות. */
function readImportFile(file) {
  const sheets = sheetNames(file);
  if (!sheets.length) throw new Error(`אין גיליונות ב-${file}`);
  const rows = readSheet(file, sheets[0].path);
  const head = (rows[0] ?? []).map((c) => String(c ?? '').trim());
  if (!head.length) throw new Error(`שורת הכותרות ריקה ב-${file}`);
  return { head, body: rows.slice(1), dataRows: rows.length - 1, sheet: sheets[0].name, path: sheets[0].path };
}

/**
 * העמודות שקומקס משתמש בהן כמזהה, ושתא מספרי הורס בשקט.
 * `002507` בתא מספרי מוצג `2507`, ו-`3468337939436` מוצג `3.46834E+12`.
 */
const IDENTIFIER_HEADERS = ['מק"ט', 'ברקוד', 'קוד חלופי', 'דגם', 'צבע', 'מידה'];

/**
 * סוג יבוא **3 — "נתוני אתר לפריט"**. נמדד חי 08/09/2026 ב-`probe`, לא נוחש:
 * הבורר החזיר `title="3"` · `value="נתוני אתר לפריט"`, וכתובת `FMiun` אישרה
 * `SwImpType=3` עם 36 שדות. המתכון המלא: `knowledge/screens/items-import-type3.json`.
 *
 * ⛔ **המזהים כאן אינם המזהים של סוג 0, וגם אינם רציפים לפי הסדר שנראה במסך.**
 * בין `ברקוד` ל`לא להציג פריט` יושב **`chk3` — "פריט בקרור(0/1)"**, ולכן מי
 * שינחש ש"לא להציג" הוא השדה הרביעי ויכתוב `chk3` ידרוס שדה אחר לגמרי.
 *
 * העמודות הן מה שדרור הכתיב: `B` (דרוג תצוגה) נשארת ריקה, ו-`D` היא `0` —
 * לדבריו ריק ו-0 שקולים בשדה הזה. `chk3` מכוון **לא ממופה**.
 */
export const SITE_HEADER_TO_FIELD = {
  'פריט(קוד)': 'chk0',
  'דרוג תצוגה': 'chk1',
  'ברקוד': 'chk2',
  'לא להציג פריט': 'chk4',
};

/** עמודות המזהה בסוג 3 — אותה סיבה בדיוק: תא מספרי הורס ברקוד בשקט. */
const SITE_IDENTIFIER_HEADERS = ['פריט(קוד)', 'ברקוד'];

/**
 * סוג יבוא ⇒ המיפוי, עמודות המזהה, **ושלושת מסכי התוצאה שלו**.
 *
 * ⛔ 💣 **מסכי התוצאה שונים בין סוגי היבוא, וזה לא נראה מהמסך.** נמדד
 * 08/09/2026: סוג 3 לא פותח `Prt_ImpExlU` בכלל אלא `Prt_Imp_WebExlU`, והרשתות
 * שלו הן `_Fr`/`_Fr2` — תבנית של `cost-import`, לא של סוג 0 (`_Fr`/`2_Fr`).
 * קוד שמחפש את שמות סוג 0 נכשל ב"מסך התוצאה לא נפתח" בלי לרמוז למה.
 *
 * **סוג שאינו כאן אינו נתמך לכתיבה** — `probe:true` קודם, ואז מוסיפים שורה
 * ממה שנמדד. הדמפ בנקודת הכישלון הוא שחשף את השמות האלה.
 */
const TYPES = {
  '0': {
    name: 'פריטים',
    fields: HEADER_TO_FIELD,
    ids: IDENTIFIER_HEADERS,
    result: /Prt_ImpExlU/i,
    okGrid: /Prt_ImpExl_Fr\.asp/i,
    badGrid: /Prt_ImpExl2_Fr\.asp/i,
  },
  '3': {
    name: 'נתוני אתר לפריט',
    fields: SITE_HEADER_TO_FIELD,
    ids: SITE_IDENTIFIER_HEADERS,
    result: /Prt_Imp_WebExlU/i,
    okGrid: /Prt_Imp_WebExl_Fr\.asp/i,
    badGrid: /Prt_Imp_WebExl_Fr2\.asp/i,
  },
};


/** כל שורה ב-FMiun: ה-id, התווית, אות העמודה (`value`) והסידורי (`title`). */
async function readPicker(picker) {
  return picker.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input[id^="chk"]')) {
      const td = el.closest('td');
      const label = (td?.previousElementSibling ?? el.closest('tr')?.cells?.[0])?.innerText ?? '';
      out.push({ id: el.id, letter: el.value ?? '', ordinal: el.title ?? '', label: label.trim() });
    }
    return out;
  });
}

export async function run({ page, human, logger, input, cfg, dryRun }) {
  await ensureLoggedIn({ page, human, logger, cfg });

  // ---- מסך הפריטים ----------------------------------------------------
  let items = page.frames().find((f) => ITEMS.test(f.url()));
  if (!items) {
    const opened = await openProgram({ page, human, logger, cfg }, 'a84', { expect: ITEMS });
    items = opened.frame;
  } else {
    logger.step('program', 'מסך הפריטים כבר פתוח');
  }
  if (!items) throw new Error('מסך הפריטים לא נפתח.');

  // ---- דיאלוג היבוא ---------------------------------------------------
  let dlg = page.frames().find((f) => DIALOG.test(f.url()));
  if (!dlg) {
    await items.evaluate((t) => document.getElementById(t)?.click(), EXTRAS_TAB);
    await human.settle('לשונית נוספים');
    await human.click('#ImpExl', { scope: items, label: 'יבוא מאקסל' });
    await human.settle('דיאלוג היבוא');
    dlg = page.frames().find((f) => DIALOG.test(f.url()));
  }
  if (!dlg) throw new Error('דיאלוג היבוא לא נפתח.');
  logger.step('dialog', 'דיאלוג היבוא פתוח');

  // ⚠️ **שער הסוג מאמת את הסוג שנתבקש, לא את 0 קשיח.** נמדד 07/09/2026:
  //    בקשה ל"פריטים" החזירה את רשימת השדות של "נתוני אתר לפריט" בלי
  //    שגיאה, ולכן הכתובת של `FMiun` — ולא השדה בדיאלוג — היא ההצהרה
  //    הקובעת. פרמוט השער אינו ריכוך שלו: הוא עדיין משווה מה שנטען למה
  //    שביקשנו, רק שעכשיו "מה שביקשנו" יכול להיות גם סוג אחר מ-0.
  const impType = String(input.impType ?? DEFAULT_IMP_TYPE);

  // ---- סוג היבוא: פריטים ----------------------------------------------
  // הקוד ב-`title`, השם ב-`value`, ורק `SwImpType_onchange` טוען מחדש את FMiun.
  const currentType = await dlg.evaluate(() => document.getElementById('SwImpType')?.title ?? '');
  if (String(currentType) !== impType) {
    await dlg.evaluate((v) => {
      const el = document.getElementById('SwImpType');
      el.title = v;
      el.value = '';
      window.SwImpType_onchange?.();
    }, impType);
    await human.settle('טעינת רשימת השדות');
  }

  const picker = page.frames().find((f) => PICKER.test(f.url()));
  if (!picker) throw new Error('מסגרת השדות (MiunSwImp) לא נמצאה.');
  // השער: כתובת הפריים היא ההצהרה של קומקס עצמו על הסוג שנטען. השדה בדיאלוג
  // יכול להראות "פריטים" בזמן ש-FMiun עדיין מציג את הסוג הקודם.
  const loadedType = (picker.url().match(/SwImpType=(\d+)/) ?? [])[1];
  if (loadedType !== impType) {
    throw new Error(`רשימת השדות נטענה לסוג ${loadedType} ולא לסוג ${impType}. לא ממשיכים.`);
  }
  logger.step('type', `סוג יבוא ${impType} — אומת מכתובת FMiun`);

  // ---- probe: למפות ולעצור --------------------------------------------
  if (input.probe) {
    const fields = await readPicker(picker);
    const options = await dlg.evaluate(() =>
      [...document.querySelectorAll('input,select')].filter((el) => el.id).map((el) => ({
        id: el.id, tag: el.tagName.toLowerCase(), type: el.type ?? '',
        value: (el.value ?? '').toString(), title: (el.title ?? '').toString(),
        checked: el.type === 'checkbox' ? el.checked : undefined,
        options: el.tagName === 'SELECT' ? [...el.options].map((o) => `${o.value}=${o.text.trim()}`) : undefined,
      })));
    const dest = resolve(ROOT, impType === DEFAULT_IMP_TYPE ? 'knowledge/screens/items-import-dialog.json' : `knowledge/screens/items-import-type${impType}.json`);
    writeFileSync(dest, JSON.stringify({
      capturedAt: new Date().toISOString(), impType,
      dialogUrl: dlg.url(), pickerUrl: picker.url(), options, fields,
    }, null, 2), 'utf8');
    await logger.shot(page, 'import-dialog');
    logger.step('probe', `${fields.length} שדות · ${options.length} אפשרויות → ${dest}`);
    return { probe: true, fields: fields.length, options: options.length, file: dest };
  }

  // הסוג קובע גם את מיפוי העמודות וגם את עמודות המזהה. סוג שאין לו שורה
  // ב-`TYPES` לא נתמך לכתיבה — `probe:true` קודם, ואז מוסיפים אותו ממדידה.
  const spec = TYPES[impType];
  if (!spec && !input.probe) {
    throw new Error(`מיפוי העמודות לסוג יבוא ${impType} טרם נמדד. הרץ probe:true עם אותו impType, והוסף את הטבלה ל-TYPES.`);
  }

  // ---- הקובץ ----------------------------------------------------------
  if (!input.file) throw new Error('חסר `file` — הנתיב לקובץ ההקמה.');
  const file = isAbsolute(input.file) ? input.file : resolve(ROOT, input.file);
  if (!existsSync(file)) throw new Error(`הקובץ לא קיים: ${file}`);
  const { head, body, dataRows, sheet, path: sheetPath } = readImportFile(file);
  logger.step('file', `${sheet} · ${dataRows} שורות · ${head.length} עמודות`);

  // ---- ⛔ שער סוג התא ---------------------------------------------------
  // הכשל היחיד שאף בדיקת ערכים לא תופסת. `readSheet` קורא את ה-XML הגולמי
  // ומחזיר `"002507"` גם מתא **מספרי**, ולכן שער המאסטר עובר בשמחה — בזמן
  // שאקסל, וכל מי שקורא דרכו, רואה `2507`. נמדד 07/09/2026: כל 175 השורות
  // נשאו דגם כזה. מה שבודקים כאן הוא **סוג התא**, לא הערך.
  const idCols = spec.ids.map((h) => head.indexOf(h)).filter((i) => i >= 0);
  const numeric = numericCells(file, sheetPath, idCols);
  if (numeric.length) {
    const byCol = new Map();
    for (const c of numeric) (byCol.get(c.col) ?? byCol.set(c.col, []).get(c.col)).push(c.value);
    const detail = [...byCol].map(([col, vals]) =>
      `${head[col]}: ${vals.length} תאים (${[...new Set(vals)].slice(0, 5).join(' ')}…)`).join(' · ');
    throw new Error(
      `שער סוג התא נפל: ${numeric.length} תאי מזהה נכתבו כמספר ולא כטקסט.\n  ${detail}\n` +
      `  אקסל ידרוס אפסים מובילים ויציג ברקוד כ-3.46834E+12. תבנה מחדש: npm run items-file`,
    );
  }
  logger.step('cell-types', `כל ${idCols.length} עמודות המזהה הן טקסט — אפסים מובילים וברקודים שלמים`);

  // ---- ⛔ שער המאסטר ----------------------------------------------------
  // `דגם` ו`צבע` הם ישויות מאסטר נפרדות מהפריט. שורה שנוגעת בקוד שלא הוקם
  // תידחה או תיצור ערך יתום שאיש לא יחפש. `items-import-file` כבר מריץ את
  // השער בזמן הבנייה, אבל הקובץ יכול להיות ישן, ידני, או משכבת עריכה אחרת —
  // ולכן הוא רץ שוב על מה שעומדים באמת להעלות.
  if (head.join('|') === IMPORT_HEADERS.join('|')) {
    const gate = masterGate(body, comaxCatalog());
    if (gate.affectedRows) {
      const m = gate.missingModels.map((x) => x.code).join(' ');
      const c = gate.missingColors.map((x) => x.code).join(' ');
      throw new Error(
        `שער המאסטר נפל: ${gate.affectedRows}/${gate.totalRows} שורות נוגעות בערך שלא קיים בקומקס.` +
        (m ? `\n  דגמים חסרים: ${m}` : '') + (c ? `\n  צבעים חסרים: ${c}` : '') +
        `\n  להקים קודם: color-create · model-create. לא מעלים.`,
      );
    }
    logger.step('master-gate', `0/${gate.totalRows} שורות נוגעות בערך חסר — הדגמים והצבעים קיימים בקומקס`);
  } else {
    logger.step('master-gate', '⚠ סדר הכותרות אינו IMPORT_HEADERS — שער המאסטר לא רץ על הקובץ הזה');
  }

  // המיפוי נגזר **מהכותרות של הקובץ הזה**, לא מהמיפוי ששמור בקומקס מהפעם
  // הקודמת. המיפוי השמור (A–M) הוא של קובץ אחר, ולהעתיק אותו זה לשלוח את
  // העמודה הלא נכונה לכל שדה.
  const wanted = new Map(); // chkId → {letter, ordinal, header}
  const unmapped = [];
  head.forEach((h, i) => {
    const chk = spec.fields[h];
    if (chk) wanted.set(chk, { letter: colLetter(i), ordinal: i, header: h });
    else if (h) unmapped.push(h);
  });
  for (const [chk, letter] of Object.entries(input.columns ?? {})) {
    const i = head.findIndex((_, n) => colLetter(n) === letter);
    wanted.set(chk, { letter, ordinal: i >= 0 ? i : null, header: head[i] ?? '(ידני)' });
  }
  const missingHeaders = Object.keys(spec.fields).filter((h) => !head.includes(h));
  if (missingHeaders.length) {
    throw new Error(`כותרות חסרות בקובץ: ${missingHeaders.join(' · ')}. הקובץ אינו תוצר של items-import-file.`);
  }
  logger.step('columns', `${wanted.size} עמודות ימופו · ${unmapped.length} לקריאה בלבד: ${unmapped.join(' · ')}`);

  // ---- כתיבת המיפוי ל-FMiun -------------------------------------------
  const known = new Set((await readPicker(picker)).map((f) => f.id));
  const unknown = [...wanted.keys()].filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`שדות שאינם קיימים במסך: ${unknown.join(', ')}`);

  await picker.evaluate((pairs) => {
    // מנקים הכול קודם — המיפוי דביק בין הרצות, ושדה שנשאר מהפעם הקודמת
    // ימשוך עמודה מקובץ אחר בלי שום סימן.
    for (const el of document.querySelectorAll('input[id^="chk"]')) { el.value = ''; el.title = ''; }
    for (const [id, letter, ordinal] of pairs) {
      const el = document.getElementById(id);
      el.value = letter;    // מה שרואים
      el.title = ordinal;   // מה שנשלח
    }
  }, [...wanted].map(([id, v]) => [id, v.letter, String(v.ordinal)]));
  await human.settle('כתיבת המיפוי');

  // ---- ⛔ שער העמודות ---------------------------------------------------
  // נקרא דרך אותו `getList()` שקומקס עצמו ישלח, ולא מהמסך. שדה עם `.value`
  // ובלי `.title` נראה על המסך בדיוק כמו שדה תקין, ונופל כאן.
  const after = await readPicker(picker);
  const byId = new Map(after.map((f) => [f.id, f]));
  const bad = [];
  for (const [id, v] of wanted) {
    const got = byId.get(id);
    if (got?.letter !== v.letter) bad.push(`${id} (${got?.label}): אות "${got?.letter}" במקום "${v.letter}"`);
    else if (String(got?.ordinal) !== String(v.ordinal)) bad.push(`${id} (${got?.label}): סידורי "${got?.ordinal}" במקום "${v.ordinal}" — מה שנשלח הוא הסידורי`);
  }
  const stray = after.filter((f) => f.letter && !wanted.has(f.id));
  if (stray.length) bad.push(`שדות שנשארו ממופים ולא ביקשנו: ${stray.map((f) => `${f.id}=${f.letter}`).join(', ')}`);
  if (bad.length) throw new Error(`שער העמודות נפל:\n  ${bad.join('\n  ')}`);
  const mapped = [...wanted].map(([id, v]) => `${v.letter}=${byId.get(id).label}`);
  logger.step('columns-final', `אומת: ${mapped.join(' · ')}`);

  // ---- שדות של סוג 0 בלבד ----------------------------------------------
  // ⚠️ "מחיר מכירה נכון לתאריך", "הקמת פריט" ו"פריט חדש" הם שדות של יבוא
  //    **פריטים**. במסך "נתוני אתר לפריט" הם אינם קיימים — ולגעת בהם שם
  //    ייכשל, או גרוע יותר, ייגע בשדה אחר שיושב באותו id.
  let priceDate = null;
  let opts = null;
  if (impType === DEFAULT_IMP_TYPE) {
    // ---- שני השדות שדרור כן ביקש לגעת בהם --------------------------------
    // כלל הבסיס נשאר "היבוא רץ עם מה שקומקס טעון בו", ומהמעבר המשותף על המסך
    // (07/09/2026) יצאו בדיוק שני חריגים — כאן, ורק כאן.

    // 1. `מחיר מכירה נכון לתאריך` — היום. הוא נטען ריק בכל פתיחה, וזה השדה
    //    שמתאים ליבוא שלנו: הקובץ מזין `מחיר צרכן` לשדה `מחיר מכירה` (chk113)
    //    ואין בו עמודת מחיר קניה, ולכן `#MhrNachonL` נשאר ריק בכוונה.
    priceDate = input.priceDate ?? todayInIsrael(cfg.timezone);
    await human.type('#MhrNachonM', priceDate, { scope: dlg, label: 'מחיר מכירה נכון לתאריך', clear: true });
    await dlg.evaluate(() => document.getElementById('MhrNachonM')?.blur()); // onblur הוא שמאמת
    await human.settle('אימות התאריך');
    const dateBack = await dlg.evaluate(() => document.getElementById('MhrNachonM')?.value ?? '');
    if (dateBack !== priceDate) throw new Error(`שדה התאריך מחזיק "${dateBack}" ולא "${priceDate}". עוצר.`);
    logger.step('date', `מחיר מכירה נכון לתאריך = ${priceDate}`);

    // 2. `הקמת פריט` — "בלבד" הוא ברירת המחדל וההגנה: מק"ט שגוי בשורה אחת
    //    יידחה במקום לדרוס בשקט פריט קיים. `allowUpdate` הוא הבקשה המפורשת
    //    של דרור להרצת תיקון על פריטים שכבר קיימים (מאפיינים, קבוצות), ואז
    //    השדה נשאר ריק — כלומר הקמה **ו/או** עדכון. שתי פעולות נפרדות בכוונה.
    if (input.allowUpdate) {
      await dlg.evaluate(() => {
        const el = document.getElementById('SwHkPrt');
        el.value = '0';                       // הערך הריק — הקמה ו/או עדכון
        el.dispatchEvent(new Event('change', { bubbles: true }));
        window.SwHkPrt_onclick?.();
      });
      await human.settle('הקמת פריט = ריק');
      logger.step('mode', '⚠ allowUpdate — "הקמת פריט" ריק: היבוא יעדכן גם פריטים קיימים');
    }

    // ---- שאר תיבות ההתנהגות — נקראות, לא נוגעים ---------------------------
    // המשימה מדווחת, וחוסמת רק על ההגנות שבלעדיהן היבוא עושה משהו אחר ממה
    // שביקשנו.
    opts = await dlg.evaluate(() => {
      const g = (id) => document.getElementById(id);
      const sel = (id) => { const e = g(id); return e ? { value: e.value, text: e.options?.[e.selectedIndex]?.text.trim() } : null; };
      const chk = (id) => g(id)?.checked ?? null;
      return {
        SwHkPrt: sel('SwHkPrt'), SwPrtKod: sel('SwPrtKod'), SwByGrp: sel('SwByGrp'),
        SwBiuldEfyun: sel('SwBiuldEfyun'), Kupa_SwDis: sel('Kupa_SwDis'),
        Snif: g('Snif')?.value ?? '',
        SwNew: chk('SwNew'), SwUpBarKod: chk('SwUpBarKod'), SwHavaraSpk: chk('SwHavaraSpk'),
        build: { Dep: chk('SwBuildDep'), Grp: chk('SwBuildGrp'), GrpTt: chk('SwBuildGrpTt'), Spk: chk('SwBuildSpk') },
        del: [...document.querySelectorAll('input[id^="SwDel_"]')].filter((e) => e.checked).map((e) => e.id),
      };
    });
    logger.step('options', `הקמת פריט=${opts.SwHkPrt?.text} · פריט לפי=${opts.SwPrtKod?.text} · פריט חדש=${opts.SwNew ? 'V' : '—'} · הקמת מאפיינים=${opts.SwBiuldEfyun?.text} · סניף=${opts.Snif}`);
    const wantHk = input.allowUpdate ? '0' : '2';
    if (opts.SwHkPrt?.value !== wantHk) {
      throw new Error(input.allowUpdate
        ? `"הקמת פריט" הוא "${opts.SwHkPrt?.text}" ולא ריק — allowUpdate לא נתפס. עוצר.`
        : `"הקמת פריט" הוא "${opts.SwHkPrt?.text}" ולא "בלבד" — היבוא עלול לדרוס פריטים קיימים. עוצר, או הוסף allowUpdate אם זו הכוונה.`);
    }
    if (!opts.SwNew) throw new Error('"פריט חדש" אינו מסומן — היבוא לא יקים פריטים. עוצר.');
    if (opts.del.length) logger.step('options', `⚠ תיבות איפוס מסומנות: ${opts.del.join(', ')}`);

  }

  // ---- בחירת הקובץ ------------------------------------------------------
  await dlg.locator('#File').setInputFiles(file);
  await human.settle('טעינת הקובץ');
  const chosen = await dlg.evaluate(() => document.getElementById('File')?.value ?? '');
  if (!chosen) throw new Error('הקובץ לא נבחר בשדה ההעלאה.');
  logger.step('upload', `נבחר: ${chosen}`);

  await logger.shot(page, 'before-import');
  console.log(`\n  קובץ:    ${file}`);
  console.log(`  שורות:   ${dataRows}`);
  console.log(`  עמודות:  ${mapped.join(' · ')}`);
  console.log(`  סוג:     ${impType} · ${spec.name}`);
  if (opts) {
    console.log(`  התנהגות: הקמת פריט=${opts.SwHkPrt?.text || '(ריק — גם עדכון)'} · פריט לפי=${opts.SwPrtKod?.text} · הקמת מאפיינים=${opts.SwBiuldEfyun?.text}`);
    console.log(`  תאריך:   מחיר מכירה נכון ל-${priceDate}`);
  }
  console.log('');

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני הקליטה. להרצה אמיתית: הוסף --confirm');
    return { dryRun: true, file, rows: dataRows, columns: mapped, options: opts };
  }

  // ---- שלב 1: תצוגה מקדימה, לא קליטה ------------------------------------
  // ⚠️ `#ok` בדיאלוג **אינו קולט**. הוא בונה מסך תוצאה (`Prt_ImpExlU.asp`)
  //    עם שתי רשתות — "יבוא תקין" ו"יבוא לא תקין" — ו-`#OK` משלו. זה כלל 4
  //    ב-CLAUDE.md בלבוש של יבוא: הקליטה היא הכפתור השני. נמדד 07/09/2026:
  //    המשימה חשבה שסיימה, ובקומקס לא נוצר עדיין דבר.
  await human.click('#ok', { scope: dlg, label: 'אישור — בניית התצוגה המקדימה' });
  await human.settle('מסך התוצאה');
  // ⚠️ **מסך התוצאה של סוג 0 אינו בהכרח מסך התוצאה של סוג אחר.** נמדד
  //    08/09/2026: יבוא "נתוני אתר לפריט" (סוג 3) לא פתח `Prt_ImpExlU`
  //    בכלל. לכן כשהמסך לא נמצא — מצלמים ומדפיסים את הפריימים שכן פתוחים,
  //    במקום להיכשל בלי ראיה. `tools/run.js` יעשה לוגין מחדש מיד אחרי
  //    הזריקה והמסך ילך לאיבוד, ולכן הראיה נאספת **כאן**.
  let result = page.frames().find((f) => spec.result.test(f.url()));
  if (!result) {
    for (let i = 0; i < 5 && !result; i++) {
      await page.waitForTimeout(2000);
      result = page.frames().find((f) => spec.result.test(f.url()));
    }
  }
  if (!result) {
    await logger.shot(page, 'no-result-screen');
    const frames = page.frames().map((f) => '  ' + f.url().replace(/\?.*/, '')).join('\n');
    const body = await page.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()).catch(() => '');
    throw new Error(
      `מסך תוצאת היבוא (${spec.result}) לא נפתח בסוג יבוא ${impType} — גם אחרי 10 שניות.\n` +
      `הפריימים שהיו פתוחים:\n${frames}\n` +
      `טקסט העמוד: ${body.slice(0, 300)}`,
    );
  }

  // ⛔ 💣 **מסך התוצאה נבנה אסינכרונית, ופריימי הרשתות נולדים אחרי הקליק.**
  //    נמדד 08/09/2026 על באצ' של 10: חמש הרצות רצופות נכשלו כאן עם
  //    `0 תקין + 0 לא תקין`. **השורש אינו זמן ההמתנה** — הקוד קרא את
  //    `page.frames()` פעם אחת, מיד אחרי `settle`, שמר שני `Frame` ואז המתין
  //    בלולאה; אבל באותו רגע הרשתות עוד לא היו קיימות, שני המשתנים היו
  //    `undefined`, ו-`count()` החזירה `0` לנצח. 6 שניות המתנה ו-60 שניות
  //    המתנה נכשלו **זהה** — אין מה לרענן כשלא מחפשים מחדש.
  //
  //    ⚠️ וזה גם מה שנראה מהצד כ"הסוכן עשה logoff במקום ללחוץ על ה-V השני":
  //    השגיאה נזרקה כאן, ו-`tools/run.js` עושה **לוגין מחדש על כל כישלון
  //    במשימת כתיבה** — הדפדפן ניווט למסך ההתחברות בדיוק ברגע שהיה אמור
  //    ללחוץ. הלוגין הוא ההתאוששות, לא הסיבה.
  //
  //    התיקון, בדיוק כמו ב-`cost-import` שעובד: ממתינים ל**מונה** שבמסך
  //    התוצאה (`סה"כ פריטים: N מתוך M`), שנקרא מחדש בכל סיבוב, ורק אז
  //    מחפשים את פריימי הרשתות — גם אותם מחדש, ולא מ-snapshot ישן.
  // ⛔ 💣 **אין לשייך מונה לרשת לפי סדר הטקסט בעמוד. נמדד 08/09/2026 והוביל
  //    למסקנה הפוכה לחלוטין.** במסך של סוג 3 הטקסט השטוח קורא
  //    `יבוא תקין … סה"כ שורות: 0 · יבוא לא תקין: סה"כ שורות: 10`, בעוד
  //    **התמונה מראה את ההפך** — 10 תקינות ו-0 דחיות. הקוד "זיהה" 10 דחיות,
  //    עצר, והדגימה מרשת הדחיות חזרה ריקה — כי הרשת באמת הייתה ריקה. אילו
  //    השער היה בכיוון ההפוך, הוא היה מאשר קליטה על סמך קריאה שגויה.
  //
  //    לכן **הסמכות היא ספירת השורות בתוך פריים כל רשת**, שהוא מסמך נפרד
  //    ואינו תלוי בסדר טקסט או בכיוון כתיבה. הטקסט נשמר ללוג כראיה בלבד.
  //
  //    ⚠️ והפריימים נשלפים **מחדש בכל סיבוב** — הם נולדים אחרי הקליק, וזו
  //    בדיוק המלכודת שעלתה כאן קודם.
  const countFrame = async (re) => {
    const f = page.frames().find((x) => re.test(x.url()));
    if (!f) return null;
    return f.evaluate(() => {
      const tr = [...document.querySelectorAll("tr")];
      const cell = (r) => [...r.cells].map((c) => c.innerText.trim()).join(" | ");
      /**
       * The header row is a `<tr>` like any other, and counting it inflated
       * every grid by one.
       *
       * Measured 10/09/2026 on a 32-row file: Comax's own counter said
       * "יבוא תקין: 31 · יבוא לא תקין: 1" — exactly 32 — while `tr.length` gave
       * 32 and 2, and the `shown + rejected === dataRows` gate then refused a
       * preview that was perfectly fine. The mismatch was two header rows.
       *
       * Detected by content rather than position: the header is the row whose
       * cells are the column labels, and `פריט` with `ברקוד` in the same row is
       * what no data row can look like (a data row holds values there).
       */
      const isHeader = (r) => {
        const t = cell(r);
        return /(^|\|)\s*פריט\s*(\||$)/.test(t) && /ברקוד/.test(t);
      };
      const body = tr.filter((r) => !isHeader(r));
      return {
        rows: body.length,
        headers: tr.length - body.length,
        first: tr[0] ? cell(tr[0]) : "",
        last: body.at(-1) ? cell(body.at(-1)) : "",
      };
    }).catch(() => null);
  };

  // התייצבות = אותה ספירה פעמיים ברציפות, ולפחות שורה אחת באחת הרשתות.
  let shown = null, rejected = null, okG = null, badG = null, prev = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500);
    okG = await countFrame(spec.okGrid);
    badG = await countFrame(spec.badGrid);
    shown = okG?.rows ?? null;
    rejected = badG?.rows ?? null;
    const now = `${shown}/${rejected}`;
    if (shown !== null && rejected !== null && shown + rejected > 0 && now === prev) break;
    prev = now;
  }

  const frameDump = () => page.frames().map((f) => '  ' + f.url().replace(/\?.*/, '')).join('\n');
  const summary = (await result.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()).catch(() => '')).slice(0, 400);
  logger.step('preview', summary || '(מסך התוצאה עדיין ריק)');

  if (shown === null || rejected === null) {
    throw new Error(`⛔ רשת תוצאה לא נמצאה (תקין=${shown} · לא תקין=${rejected}). לא קולטים בלי לראות את שתי הרשתות.\nהפריימים שהיו פתוחים:\n${frameDump()}`);
  }
  logger.step('grids', `נספר מתוך הפריימים — יבוא תקין: ${shown} · יבוא לא תקין: ${rejected} · בקובץ: ${dataRows} (כותרות שהוחסרו: ${(okG?.headers ?? 0) + (badG?.headers ?? 0)})`);
  logger.step('grid-rows', `תקין[0]: ${okG?.first ?? '—'}`);
  logger.step('grid-rows', `תקין[N]: ${okG?.last ?? '—'}`);

  // ⚠️ "סה"כ פריטים: 100 מתוך 175" הוא **תקרת תצוגה** ברשת התקינה, ולכן
  //    ההשוואה למספר השורות בקובץ תקפה רק עד 100. מעל זה — הסמכות היחידה
  //    שנשארת היא רשת הדחיות.
  if (dataRows <= 100 && shown + rejected !== dataRows) {
    throw new Error(`⛔ הרשתות מציגות ${shown} תקין + ${rejected} לא תקין = ${shown + rejected}, והקובץ מכיל ${dataRows}. התצוגה לא התייצבה — לא קולטים.`);
  }

  // הצילום לפני השערים, לא אחריהם: אחרי הזריקה run.js עושה לוגין
  // מחדש ומסך התוצאה נעלם. תמונה של הדחיות היא לרוב הראיה היחידה.
  await logger.shot(page, 'import-preview');
  if (rejected > 0) {
    const bad = page.frames().find((x) => spec.badGrid.test(x.url()));
    const rows = bad
      ? await bad.evaluate(() => (document.body?.innerText ?? '').trim().split('\n').filter((l) => l.trim()).slice(0, 11).join('\n')).catch(() => '')
      : '(רשת "יבוא לא תקין" לא נמצאה כדי לדגום ממנה)';
    throw new Error(`⛔ ${rejected} שורות ב"יבוא לא תקין". לא קולטים חלקית — עוצר.\n${rows}`);
  }
  if (shown === 0) {
    throw new Error('⛔ "יבוא תקין" מראה 0 פריטים. לא קולטים — אפס שורות תקינות אינו מצב שמותר להמשיך ממנו.');
  }
  logger.step('preview', `יבוא תקין: ${shown} · יבוא לא תקין: 0 · מול ${dataRows} שורות בקובץ — התייצב`);


  // ---- previewOnly: עוצרים כאן, לפני הכפתור השני -------------------------
  // בקשה מפורשת של דרור (08/09/2026): לראות רק את מסך התצוגה המקדימה
  // (כמה תקין/לא תקין) ולא לגעת בקליטה בפועל. `#OK` השני, בהמשך הפונקציה
  // הזו, הוא הבלתי-הפיך — אין לו נגיעה כאן בשום מסלול.
  if (input.previewOnly) {
    logger.step('previewOnly', 'עוצר לפי בקשה — לא לוחצים על כפתור הקליטה השני');
    return { previewOnly: true, file, rows: dataRows, shown, rejected, columns: mapped, summary };
  }

  // ---- שלב 2: הקליטה עצמה, בלתי הפיכה ------------------------------------
  await human.click('#OK', { scope: result, label: 'אישור — קליטה בפועל' });
  await human.settle('אחרי הקליטה');
  await logger.shot(page, 'after-import');
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const dupError = /כפילות בנתונים/.test(bodyText);
  const stillOpen = page.frames().some((f) => spec.result.test(f.url()));
  if (dupError) {
    throw new Error('⛔ קומקס הציג "כפילות בנתונים !" אחרי הקליק על אישור — הקליטה נדחתה. לא נוצר דבר (מאומת ב-08/09/2026 מול items-export). אל תריץ שוב עם אותו קובץ בלי לבדוק למה — כנראה נלחץ אישור לפני שהתצוגה התייצבה.');
  }
  // ⚠️ **`stillOpen` לבדו אינו עדות לכישלון — נמדד 08/09/2026 והתברר כהתראת
  //    שווא.** אחרי קליטה שהצליחה במלואה (10/10 פריטים נוצרו, אומת מול
  //    `items-export` טרי: 13,292 מול 13,282) מסך התוצאה **נשאר פתוח**
  //    בדיוק כמו אחרי הכישלון של אותו בוקר. ההבדל היחיד בין השניים הוא
  //    **רצועת השגיאה**: בכישלון הופיע "כפילות בנתונים !", ובהצלחה המסך
  //    היה נקי ו-10 השורות סומנו "חדש". לכן הבאנר זורק, ו-`stillOpen`
  //    מזהיר בלבד — שער שעוצר על הצלחה מאמן אותנו להתעלם ממנו.
  //
  //    ⛔ ובכל מקרה: `ok: true` כאן **אינו הוכחה שנוצר משהו**. ההוכחה
  //    היחידה היא `items-export` טרי ו-`grep` על הברקודים, מחוץ לאשף.
  if (stillOpen) {
    logger.step('report', '⚠ מסך התוצאה עדיין פתוח — זה תקין גם אחרי קליטה מוצלחת. ההוכחה היא items-export, לא המסך.');
  }

  return { ok: true, filed: stillOpen ? 'לא ודאי מהמסך — לאמת ב-items-export' : true, file, rows: dataRows, shown, rejected, columns: mapped, summary };
}
