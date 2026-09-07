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
 * מתכון המסך: knowledge/screens/items-import-dialog.json · items-import-types.json
 * הממצאים המלאים: knowledge/MAP.md, פרק "יבוא פריטים מאקסל".
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { ROOT } from '../config.js';
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';
import { readSheet, sheetNames } from '../../tools/xlsx.js';
import { IMPORT_HEADERS, comaxCatalog } from '../items/build-import.js';
import { masterGate } from '../items/master-gate.js';

export const meta = {
  name: 'items-import',
  description: 'מעלה קובץ אקסל של פריטים חדשים למסך היבוא של קומקס, ועוצר לפני הקליטה',
  writes: true,
  input: {
    file: 'נתיב לקובץ ההקמה (xlsx), יחסי ל-root או מוחלט',
    probe: 'true — למפות את הדיאלוג ולעצור בלי לגעת בכלום',
    columns: 'מיפוי ידני {chkId: "A"}, אופציונלי — ברירת המחדל נגזרת מכותרות הקובץ',
  },
};

const ITEMS = /Erp\/Prt\/PrtV/i;
const DIALOG = /Prt_ImpExl_New/i;
const PICKER = /MiunSwImp/i;
/** `#ImpExl` קיים בכל הלשוניות ונראה רק ב"נוספים". קליק על מוסתר לא נוחת. */
const EXTRAS_TAB = 'Row3';
/** `0 · פריטים` — הכרעת דרור 07/09/2026. שאר 19 הסוגים לא בשימוש. */
const IMP_TYPE = '0';

/**
 * כותרת בקובץ ההקמה ⇒ השדה במסך היבוא.
 *
 * הצד השמאלי הוא `IMPORT_HEADERS` מ-`src/items/build-import.js`; הצד הימני
 * הוא ה-id ב-`FMiun` כפי שנמדד בסוג יבוא 0. כותרת שאינה כאן פשוט לא מיובאת —
 * `שם מחלקה` · `מחיר עלות` · `מקור הסיווג` וכו' הן עמודות לקריאה אנושית.
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
  return { head, body: rows.slice(1), dataRows: rows.length - 1, sheet: sheets[0].name };
}

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

  // ---- סוג היבוא: פריטים ----------------------------------------------
  // הקוד ב-`title`, השם ב-`value`, ורק `SwImpType_onchange` טוען מחדש את FMiun.
  const currentType = await dlg.evaluate(() => document.getElementById('SwImpType')?.title ?? '');
  if (String(currentType) !== IMP_TYPE) {
    await dlg.evaluate((v) => {
      const el = document.getElementById('SwImpType');
      el.title = v;
      el.value = '';
      window.SwImpType_onchange?.();
    }, IMP_TYPE);
    await human.settle('טעינת רשימת השדות');
  }

  const picker = page.frames().find((f) => PICKER.test(f.url()));
  if (!picker) throw new Error('מסגרת השדות (MiunSwImp) לא נמצאה.');
  // השער: כתובת הפריים היא ההצהרה של קומקס עצמו על הסוג שנטען. השדה בדיאלוג
  // יכול להראות "פריטים" בזמן ש-FMiun עדיין מציג את הסוג הקודם.
  const loadedType = (picker.url().match(/SwImpType=(\d+)/) ?? [])[1];
  if (loadedType !== IMP_TYPE) {
    throw new Error(`רשימת השדות נטענה לסוג ${loadedType} ולא לסוג ${IMP_TYPE} (פריטים). לא ממשיכים.`);
  }
  logger.step('type', `סוג יבוא ${IMP_TYPE} · פריטים — אומת מכתובת FMiun`);

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
    const dest = resolve(ROOT, 'knowledge/screens/items-import-dialog.json');
    writeFileSync(dest, JSON.stringify({
      capturedAt: new Date().toISOString(), impType: IMP_TYPE,
      dialogUrl: dlg.url(), pickerUrl: picker.url(), options, fields,
    }, null, 2), 'utf8');
    await logger.shot(page, 'import-dialog');
    logger.step('probe', `${fields.length} שדות · ${options.length} אפשרויות → ${dest}`);
    return { probe: true, fields: fields.length, options: options.length, file: dest };
  }

  // ---- הקובץ ----------------------------------------------------------
  if (!input.file) throw new Error('חסר `file` — הנתיב לקובץ ההקמה.');
  const file = isAbsolute(input.file) ? input.file : resolve(ROOT, input.file);
  if (!existsSync(file)) throw new Error(`הקובץ לא קיים: ${file}`);
  const { head, body, dataRows, sheet } = readImportFile(file);
  logger.step('file', `${sheet} · ${dataRows} שורות · ${head.length} עמודות`);

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
    const chk = HEADER_TO_FIELD[h];
    if (chk) wanted.set(chk, { letter: colLetter(i), ordinal: i, header: h });
    else if (h) unmapped.push(h);
  });
  for (const [chk, letter] of Object.entries(input.columns ?? {})) {
    const i = head.findIndex((_, n) => colLetter(n) === letter);
    wanted.set(chk, { letter, ordinal: i >= 0 ? i : null, header: head[i] ?? '(ידני)' });
  }
  const missingHeaders = Object.keys(HEADER_TO_FIELD).filter((h) => !head.includes(h));
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

  // ---- תיבות ההתנהגות — נקראות, לא נוגעים ------------------------------
  // הכרעת דרור 07/09/2026: היבוא רץ עם מה שקומקס טעון בו. המשימה מדווחת,
  // וחוסמת רק על שתי ההגנות שבלעדיהן יבוא של פריטים חדשים הופך לעדכון של
  // פריטים קיימים.
  const opts = await dlg.evaluate(() => {
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
  if (opts.SwHkPrt?.value !== '2') {
    throw new Error(`"הקמת פריט" הוא "${opts.SwHkPrt?.text}" ולא "בלבד" — היבוא עלול לעדכן פריטים קיימים. עוצר.`);
  }
  if (!opts.SwNew) throw new Error('"פריט חדש" אינו מסומן — היבוא לא יקים פריטים. עוצר.');
  if (opts.del.length) logger.step('options', `⚠ תיבות איפוס מסומנות: ${opts.del.join(', ')}`);

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
  console.log(`  התנהגות: הקמת פריט=${opts.SwHkPrt?.text} · פריט לפי=${opts.SwPrtKod?.text} · הקמת מאפיינים=${opts.SwBiuldEfyun?.text}\n`);

  if (dryRun) {
    logger.step('dryrun', 'עוצר לפני הקליטה. להרצה אמיתית: הוסף --confirm');
    return { dryRun: true, file, rows: dataRows, columns: mapped, options: opts };
  }

  // ---- בלתי הפיך --------------------------------------------------------
  await human.click('#ok', { scope: dlg, label: 'אישור — קליטת היבוא' });
  await human.settle('הקליטה');
  await logger.shot(page, 'after-import');
  const report = await page.frames().reduce(async (accP, f) => {
    const acc = await accP;
    if (acc) return acc;
    const t = await f.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    return /שגיא|נקלט|הוקמ|שורות/.test(t) && t.length < 4000 ? t.trim() : null;
  }, Promise.resolve(null));
  if (report) logger.step('report', report.slice(0, 1500));

  return { ok: true, file, rows: dataRows, columns: mapped, report };
}
