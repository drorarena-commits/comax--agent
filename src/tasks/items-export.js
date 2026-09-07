/**
 * ייצוא כל הפריטים לאקסל — קטלוג מלא, לא לפי מחסן.
 *
 * Same route as `stock-export` (פריטים → לשונית נוספים → יצוא לאקסל), with two
 * differences that matter:
 *
 *   1. No warehouse is typed in, so the export covers the whole catalog rather
 *      than one warehouse's slice.
 *   2. The column picker (frame FMiun, Excel/Prt/MiunSw.asp) is set explicitly.
 *      Comax remembers the last selection per user, so an export that "worked"
 *      can silently carry whatever columns the previous run left behind —
 *      the field list is read back after being set, and reported.
 *
 * Read-only: it downloads a file and touches nothing in Comax.
 *
 *   npm run run -- items-export --json '{"probe":true}'   מיפוי בלבד, בלי ייצוא
 *   npm run run -- items-export                          ברירת מחדל רזה — רק עמודות עם מידע
 *   npm run run -- items-export --json '{"fields":"all"}' כל 97 העמודות
 *
 * Screen recipe: knowledge/screens/items-export-fields.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { ROOT } from '../config.js';
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';

export const meta = {
  name: 'items-export',
  description: 'מוריד קובץ אקסל של כל הפריטים בקטלוג, עם בחירת עמודות מפורשת',
  writes: false, // read-only export
  input: {
    fields: 'omitted = the lean default set | "all" = 97 columns | array of ids | "keep" = last run',
    probe: 'true — map the dialog and stop without exporting',
    out: 'output filename, optional',
  },
};

/**
 * ברירת המחדל: רק העמודות שנושאות מידע.
 *
 * Measured, not guessed. The 07/09/2026 run took all 97 boxes and produced a
 * 58 MB file whose columns were mostly dead weight — 45 of them empty in every
 * one of the 13,107 rows. Three rules cut the list, and each is a thing the
 * dialog cannot tell you:
 *
 *   - empty everywhere (יצרן · משקל · נפח · פקדון · מרלוג · ימי תוקף · דגלי
 *     קופה · הערות): the field exists in Comax and nobody fills it.
 *   - one constant value (שקיל · מעדניה · נמכר באילת — "לא" in all 13,107):
 *     100% filled and worth nothing.
 *   - an exact copy of another column (יתרת מלאי and יתרת מלאי לחברות are
 *     character-for-character `מלאי`; שם חלופי equals שם פריט in 98.7% of the
 *     rows that have it).
 *
 * Result: 36 boxes ⇒ ~40 columns instead of 101. `{"fields":"all"}` still
 * exists for the rare field, and re-measuring is `{"probe":true}` plus a run.
 */
const DEFAULT_FIELDS = [
  // זהות
  'SwPrtC', 'SwPrtKod', 'SwPrtNm', 'SwHalufiKod', 'SwEngPrtNm', 'SwBarkod',
  // סיווג
  'SwDepKod', 'SwDepNm', 'SwGrpKod', 'SwGrpNm', 'SwTtGrp', 'SwTtGrpNm',
  'SwSpkKod', 'SwSpkNm', 'SwDegem', 'SwDegemNm',
  'SwSize', 'SwSizeNm', 'SwColor', 'SwColorNm',
  'SwShonot', 'SwShonotNm', 'SwNosaf', 'SwNosaf2', 'SwNosaf2Nm', 'SwNosaf3', 'SwNosaf3Nm',
  // מחיר ועלות
  'SwMhrSell', 'SwMhrAlutSpk', 'SwNetoSpk',
  // מלאי ואתר
  'SwMlay', 'SwView',
  // עקבות
  'SwDateOpen', 'SwOpenKod', 'SwOpenNm', 'SwUpdateNm',
];

const ITEMS = /Erp\/Prt\/PrtV/i;
const DIALOG = /Prt_ExcelP/i;
const PICKER = /MiunSw/i;
/** The items screen hides יצוא לאקסל behind its third tab, "נוספים". */
const EXTRAS_TAB = 'Row3';

/** Today in Israel, for the filename. */
function todayInIsrael(timeZone) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Read every checkbox in the column picker, with its label and state. */
async function readPicker(picker) {
  return picker.evaluate(() => {
    const labelOf = (el) => {
      const byFor = el.id && document.querySelector(`label[for="${el.id}"]`);
      if (byFor) return byFor.textContent.trim();
      const td = el.closest('td');
      const next = td?.nextElementSibling?.textContent?.trim();
      if (next) return next;
      return (td?.textContent ?? '').trim();
    };
    return [...document.querySelectorAll('input[type=checkbox]')].map((el) => ({
      id: el.id,
      name: el.name,
      checked: el.checked,
      disabled: el.disabled,
      label: labelOf(el),
    }));
  });
}

export async function run({ page, human, logger, input, cfg }) {
  await ensureLoggedIn({ page, human, logger, cfg });

  let items = page.frames().find((f) => ITEMS.test(f.url()));
  if (!items) {
    const opened = await openProgram({ page, human, logger, cfg }, 'a84', { expect: ITEMS });
    items = opened.frame;
  } else {
    logger.step('program', 'מסך הפריטים כבר פתוח');
  }
  if (!items) throw new Error('מסך הפריטים לא נפתח.');

  // ---- open the export dialog ----------------------------------------
  let dlg = page.frames().find((f) => DIALOG.test(f.url()));
  if (!dlg) {
    // The button exists on every tab but is only visible on "נוספים", and a
    // click on a hidden button never lands — it just times out looking visible.
    await items.evaluate((t) => document.getElementById(t)?.click(), EXTRAS_TAB);
    await human.settle('לשונית נוספים');
    await human.click('#ExpExl', { scope: items, label: 'יצוא לאקסל' });
    await human.settle('דיאלוג הייצוא');
    dlg = page.frames().find((f) => DIALOG.test(f.url()));
  }
  if (!dlg) throw new Error('דיאלוג הייצוא לא נפתח.');
  logger.step('dialog', 'דיאלוג הייצוא פתוח');

  const picker = page.frames().find((f) => PICKER.test(f.url()));
  if (!picker) throw new Error('מסגרת בחירת העמודות (MiunSw) לא נמצאה.');

  // ---- probe: map and stop -------------------------------------------
  if (input.probe) {
    const boxes = await readPicker(picker);
    const dialogFields = await dlg.evaluate(() =>
      [...document.querySelectorAll('input,select')].map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.type ?? null,
        id: el.id,
        name: el.name,
        value: el.value,
        options: el.tagName === 'SELECT'
          ? [...el.options].map((o) => `${o.value}=${o.text.trim()}`)
          : undefined,
      })));
    const frames = page.frames().map((f) => ({ name: f.name(), url: f.url() }));
    const dest = resolve(ROOT, 'knowledge/screens/items-export-dialog.json');
    writeFileSync(dest, JSON.stringify({ capturedAt: new Date().toISOString(), frames, dialogFields, boxes }, null, 2), 'utf8');
    await logger.shot(page, 'export-dialog');
    logger.step('probe', `${boxes.length} תיבות · ${dialogFields.length} שדות בדיאלוג → ${dest}`);
    return { probe: true, checkboxes: boxes.length, dialogFields: dialogFields.length, file: dest };
  }

  // ---- clear the range filters ----------------------------------------
  // Comax remembers the last export's ranges per user. A leftover
  // `מחסן מלאי 15–15` from a warehouse export produces a file that looks
  // complete and is silently one warehouse wide, so the ranges are cleared
  // and read back rather than assumed empty.
  const RANGES = ['Store_MlayM', 'Store_MlayA', 'Store_prtM', 'Store_prtA', 'StoreM', 'StoreA',
    'PrtM', 'PrtA', 'GrpM', 'GrpA', 'GrpTtM', 'GrpTtA', 'DegemM', 'DegemA', 'GimorM', 'GimorA',
    'GodelM', 'GodelA', 'ShonotM', 'ShonotA', 'NosafM', 'NosafA', 'SpkM', 'SpkA',
    'wSpkGrpM', 'wSpkGrpA', 'DepM', 'DepA', 'IzranM', 'IzranA', 'DateM', 'DateA', 'Mida'];
  const leftover = await dlg.evaluate((ids) => {
    const had = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.value !== '') had[id] = el.value;
      el.value = '';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return had;
  }, RANGES);
  if (Object.keys(leftover).length) {
    logger.step('ranges', `נוקו סינונים שנשארו מהרצה קודמת: ${Object.entries(leftover).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  }
  const stillSet = await dlg.evaluate((ids) =>
    ids.filter((id) => (document.getElementById(id)?.value ?? '') !== ''), RANGES);
  if (stillSet.length) throw new Error(`סינונים לא התנקו: ${stillSet.join(', ')}`);
  logger.step('ranges', 'כל תחומי הסינון ריקים — הייצוא מכסה את כל הקטלוג');

  // ---- choose the columns --------------------------------------------
  const all = await readPicker(picker);
  const wanted = input.fields === 'all'
    ? all.filter((b) => !b.disabled).map((b) => b.id)
    : Array.isArray(input.fields) && input.fields.length
      ? input.fields
      : input.fields === 'keep'
        ? null // leave whatever the last run selected
        : DEFAULT_FIELDS;

  if (wanted) {
    const known = new Set(all.map((b) => b.id));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`עמודות לא קיימות בדיאלוג: ${unknown.join(', ')}`);

    await picker.evaluate((ids) => {
      const want = new Set(ids);
      for (const el of document.querySelectorAll('input[type=checkbox]')) {
        if (el.disabled) continue;
        const should = want.has(el.id);
        if (el.checked !== should) el.click(); // click, not .checked — the page has onclick handlers
      }
    }, wanted);
    await human.settle('בחירת עמודות');

    // The gate: read the state back. A checkbox whose handler refused the
    // change looks identical to one that took it.
    const after = await readPicker(picker);
    const on = after.filter((b) => b.checked).map((b) => b.id);
    const missing = wanted.filter((id) => !on.includes(id));
    const extra = on.filter((id) => !wanted.includes(id));
    logger.step('columns', `נבחרו ${on.length} עמודות${missing.length ? ` · לא נדלקו: ${missing.join(',')}` : ''}${extra.length ? ` · נשארו דלוקות: ${extra.join(',')}` : ''}`);

    // The checkbox is only the visible half. What the export actually sends is
    // a text field of the same id in the dialog frame, and the two are joined
    // only by `GetMiunVal()`, which OK_onclick calls on its way out. The
    // checkboxes carry no onclick of their own, so ticking them changes
    // nothing until that function runs. Calling it here — it only copies
    // values, it does not submit — makes the selection verifiable *before* the
    // irreversible click rather than after the file has already been built.
    await dlg.evaluate(() => GetMiunVal());
    const dropped = await dlg.evaluate((ids) =>
      ids.filter((id) => String(document.getElementById(id)?.value) !== 'true'), on);
    if (dropped.length) {
      // Not fatal, but never silent: GetMiunVal does not copy every checkbox,
      // so a column can be ticked on screen and absent from the file.
      logger.step('columns', `⚠ ${dropped.length} עמודות סומנו ולא נרשמו בטופס — לא יופיעו בקובץ: ${dropped.join(', ')}`);
    }
    logger.step('columns', `אומת מול הטופס: ${on.length - dropped.length} עמודות`);
  }

  // The mirrors, not the checkboxes, are what the server receives.
  const byId = new Map(all.map((b) => [b.id, b]));
  const effective = await dlg.evaluate((ids) =>
    ids.filter((id) => String(document.getElementById(id)?.value) === 'true'), all.map((b) => b.id));
  const columns = effective.map((id) => ({ id, label: byId.get(id)?.label ?? id }));
  logger.step('columns-final', `${columns.length}: ${columns.map((c) => c.label || c.id).join(' · ')}`);
  await logger.shot(page, 'before-export');

  // ---- export ---------------------------------------------------------
  const outDir = resolve(ROOT, 'data/exports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const spoolDir = resolve(ROOT, 'runs', 'downloads');
  if (!existsSync(spoolDir)) mkdirSync(spoolDir, { recursive: true });

  const date = todayInIsrael(cfg.timezone);
  const base = input.out ?? `פריטים-מלא-${date}`;
  const before = new Set(readdirSync(spoolDir));
  const downloadPromise = page.context().waitForEvent('download', { timeout: 10 * 60_000 }).catch(() => null);

  await human.click('#OK', { scope: dlg, label: 'הרצת הייצוא' });
  console.log('  מייצא את כל הפריטים... (יכול לקחת כמה דקות)');

  const target = (ext) => resolve(outDir, `${base}${ext || '.xls'}`);
  let file = null;

  const dl = await downloadPromise;
  if (dl) {
    try {
      file = target(extname(dl.suggestedFilename()));
      await dl.saveAs(file);
    } catch (e) {
      // Comax can close the window that owns the download before we pull the
      // bytes through it; Chrome has already written the file, so fall back.
      logger.step('download', `saveAs נכשל (${e.message.split('\n')[0]}) — מחפש בדיסק`);
      file = null;
    }
  }

  if (!file) {
    const deadline = Date.now() + 5 * 60_000;
    let last = -1;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const fresh = readdirSync(spoolDir).filter((f) => !before.has(f) && !f.endsWith('.crdownload'));
      if (fresh.length) {
        const size = statSync(resolve(spoolDir, fresh[0])).size;
        // A stalled transfer keeps growing or sits at zero; only a size that
        // has stopped changing means the file is complete.
        if (size > 0 && size === last) {
          file = target(extname(fresh[0]));
          renameSync(resolve(spoolDir, fresh[0]), file);
          break;
        }
        last = size;
      }
    }
  }

  if (!file) throw new Error('לא ירד קובץ.');
  const size = statSync(file).size;
  logger.step('download', `${file} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  // ---- the .xls is HTML, and it does not open on a phone ---------------
  // Comax names the file .xls and sets "אקסל 2007 ומעלה", but what arrives is
  // an HTML <TABLE> in windows-1255 — 58 MB for the full catalog. Excel on the
  // desktop opens it; the iPhone does not. The CSV is the deliverable.
  const html = new TextDecoder('windows-1255').decode(readFileSync(file));
  const trs = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const cellsOf = (tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((c) => c[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim());
  if (!trs.length) throw new Error('הקובץ שירד אינו טבלת HTML — הפורמט השתנה.');

  const table = trs.map((t) => cellsOf(t[1]));
  const header = table[0];
  const body = table.slice(1);
  // Rule 16: a partial read is the one failure that looks like success. Every
  // row must be as wide as the header, or the file is not what it claims.
  const ragged = body.filter((r) => r.length !== header.length).length;
  if (ragged) throw new Error(`${ragged} שורות ברוחב שונה מהכותרת — הקריאה חלקית.`);

  const esc = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csvFile = target('.csv');
  writeFileSync(csvFile, `﻿${table.map((r) => r.map(esc).join(',')).join('\r\n')}`, 'utf8');
  const csvSize = statSync(csvFile).size;
  logger.step('csv', `${body.length} פריטים × ${header.length} עמודות → ${csvFile} (${(csvSize / 1024 / 1024).toFixed(2)} MB)`);

  console.log(`\nנשמר: ${file}`);
  console.log(`CSV לאייפון: ${csvFile}`);
  console.log(`${body.length} פריטים · ${header.length} עמודות`);

  return {
    file,
    csvFile,
    sizeBytes: size,
    items: body.length,
    columnCount: header.length,
    columns: columns.map((c) => ({ id: c.id, label: c.label })),
    headers: header,
  };
}
