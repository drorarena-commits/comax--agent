/**
 * ייצוא מלאי פר מחסן — קובץ אקסל לכל מחסן.
 *
 * Uses "פריטים" → לשונית נוספים → יצוא לאקסל, which is the route that actually
 * hands back a file. The matrix report (`stock-matrix`) does not: it queues the
 * report into Comax's print spool and returns nothing, which is why runs of it
 * sat for 151 seconds and produced no download.
 *
 * The same rule as the matrix task applies here and is the reason this exists
 * as a task rather than a click-through: a stock export for the wrong warehouse
 * looks exactly like a correct one. Nothing inside the file names the warehouse
 * it was filtered to. So each warehouse is typed in, read back out of the form,
 * and only then exported.
 *
 * Screen recipe: knowledge/screens/items-export.json
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { ROOT } from '../config.js';
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';

export const meta = {
  name: 'stock-export',
  description: 'מוריד קובץ מלאי אקסל לכל מחסן ברשימה',
  writes: false, // read-only export
  input: {
    warehouses: 'array of warehouse codes, optional — defaults to the config list',
  },
};

const ITEMS = /Erp\/Prt\/PrtV/i;
const DIALOG = /Prt_ExcelP/i;
/** The items screen hides יצוא לאקסל behind its third tab, "נוספים". */
const EXTRAS_TAB = 'Row3';

function knownWarehouses() {
  const file = resolve(ROOT, 'knowledge/lists.json');
  if (!existsSync(file)) return null;
  const list = JSON.parse(readFileSync(file, 'utf8')).warehouses ?? [];
  return new Map(list.map((w) => [String(w.code), w.name]));
}

/** Today in Israel, for the filename — not a filter; stock is always current. */
function todayInIsrael(timeZone) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** A filename that survives being looked at a month later. */
const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '-').trim();

/** Open the export dialog, returning its frame. */
async function openDialog({ page, human, logger }, itemsFrame) {
  const existing = page.frames().find((f) => DIALOG.test(f.url()));
  if (existing) return existing;

  // The button exists on every tab but is only visible on "נוספים", and a
  // click on a hidden button never lands — it just times out looking visible.
  await itemsFrame.evaluate((t) => document.getElementById(t)?.click(), EXTRAS_TAB);
  await human.settle('לשונית נוספים');
  await human.click('#ExpExl', { scope: itemsFrame, label: 'יצוא לאקסל' });
  await human.settle('דיאלוג הייצוא');

  const dlg = page.frames().find((f) => DIALOG.test(f.url()));
  if (!dlg) throw new Error('דיאלוג הייצוא לא נפתח.');
  logger.step('dialog', 'דיאלוג הייצוא פתוח');
  return dlg;
}

/**
 * Put one warehouse into both ends of the stock-warehouse range, which is how
 * this screen expresses "only this warehouse".
 */
async function setWarehouse({ human }, dlg, code) {
  for (const id of ['Store_MlayM', 'Store_MlayA']) {
    await human.type(`#${id}`, code, { scope: dlg, label: id });
    // These are lookup combos; without leaving the field Comax never resolves
    // the code, and the value can revert the moment the export starts.
    await human.press('Tab');
  }
}

export async function run({ page, human, logger, input, cfg }) {
  const conf = cfg.reports?.stockMatrix ?? {};
  const wanted = (input.warehouses ?? conf.warehouses ?? []).map(String);
  if (!wanted.length) throw new Error('לא הוגדרו מחסנים — לא בקונפיג ולא בקלט.');

  const known = knownWarehouses();
  if (known) {
    const unknown = wanted.filter((c) => !known.has(c));
    if (unknown.length) {
      throw new Error(
        `מחסן לא קיים: ${unknown.join(', ')}. ` +
        `הקיימים: ${[...known].map(([c, n]) => `${c}=${n}`).join(' · ')}`,
      );
    }
  }
  const nameOf = (c) => known?.get(c) ?? c;
  logger.step('warehouses', wanted.map((c) => `${c} ${nameOf(c)}`).join(' · '));

  await ensureLoggedIn({ page, human, logger, cfg });

  let items = page.frames().find((f) => ITEMS.test(f.url()));
  if (!items) {
    const opened = await openProgram({ page, human, logger, cfg }, 'a84', { expect: ITEMS });
    items = opened.frame;
  } else {
    logger.step('program', 'מסך הפריטים כבר פתוח');
  }
  if (!items) throw new Error('מסך הפריטים לא נפתח.');

  const outDir = resolve(ROOT, conf.exportDir ?? 'data/exports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const spoolDir = resolve(ROOT, 'runs', 'downloads');
  if (!existsSync(spoolDir)) mkdirSync(spoolDir, { recursive: true });

  const date = todayInIsrael(cfg.timezone);
  const done = [];
  const failed = [];

  for (const code of wanted) {
    const label = `${code} ${nameOf(code)}`;
    logger.step('warehouse', `--- ${label} ---`);
    try {
      const dlg = await openDialog({ page, human, logger }, items);
      await setWarehouse({ human }, dlg, code);

      // The gate. Reading the field back is the only evidence the code took —
      // a lookup combo that rejected the value reverts it silently.
      const got = await dlg.evaluate(() => ({
        from: document.getElementById('Store_MlayM')?.value ?? '',
        to: document.getElementById('Store_MlayA')?.value ?? '',
      }));
      if (String(got.from) !== code || String(got.to) !== code) {
        await logger.shot(page, `verify-failed-${code}`);
        throw new Error(`המחסן לא נקבע נכון: בשדות ${got.from}–${got.to}, ביקשנו ${code}`);
      }
      logger.step('verify', `מחסן ${label} — אומת בשני קצות הטווח`);

      const before = new Set(readdirSync(spoolDir));
      const downloadPromise = page
        .context()
        .waitForEvent('download', { timeout: 6 * 60_000 })
        .catch(() => null);

      await human.click('#OK', { scope: dlg, label: `הרצת הייצוא — ${label}` });
      console.log(`  מייצא ${label}...`);

      const target = (ext) => resolve(outDir, `מלאי-${safe(nameOf(code))}-${date}${ext || '.xls'}`);
      let file = null;

      const dl = await downloadPromise;
      if (dl) {
        try {
          file = target(extname(dl.suggestedFilename()));
          await dl.saveAs(file);
        } catch (e) {
          // Comax can close the window that owns the download before we pull
          // the bytes through it. Chrome has already written the file, so fall
          // back to disk rather than lose the export.
          logger.step('download', `saveAs נכשל (${e.message.split('\n')[0]}) — מחפש בדיסק`);
          file = null;
        }
      }

      if (!file) {
        const deadline = Date.now() + 3 * 60_000;
        let last = -1;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          const fresh = readdirSync(spoolDir).filter((f) => !before.has(f) && !f.endsWith('.crdownload'));
          if (fresh.length) {
            const size = statSync(resolve(spoolDir, fresh[0])).size;
            // A stalled transfer keeps growing or sits at zero; only a size
            // that has stopped changing means the file is complete.
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
      logger.step('download', `${label}: ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      done.push({ code, name: nameOf(code), file, sizeBytes: size });
    } catch (e) {
      // One warehouse failing should not throw away the ones that worked.
      logger.step('error', `${label}: ${e.message.split('\n')[0]}`);
      failed.push({ code, name: nameOf(code), error: e.message.split('\n')[0] });
    }
  }

  console.log(`\nהורדו ${done.length} מתוך ${wanted.length} מחסנים.`);
  for (const d of done) console.log(`  ✓ ${d.name} — ${(d.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
  for (const f of failed) console.log(`  ✗ ${f.name} — ${f.error}`);

  if (!done.length) throw new Error('אף מחסן לא יוצא בהצלחה.');
  return { date, done, failed };
}
