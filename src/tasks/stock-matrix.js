/**
 * ייצוא יתרות מלאי במטריצת מחסנים.
 *
 * The report itself is trivial to run — the whole point of this task is the two
 * checks a person does by eye and therefore eventually skips: that the date is
 * today, and that the warehouses selected are the ones we meant. A matrix that
 * ran against yesterday's date, or with a warehouse missing, produces a file
 * that looks completely normal. Nothing inside it says which date or which
 * warehouses were asked for, so the mistake is invisible after the fact.
 *
 * So this task sets both, reads them back out of the DOM, and refuses to press
 * אישור unless every field matches what was asked for.
 *
 * Screen recipe: knowledge/screens/stock-matrix.json
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { ensureLoggedIn } from '../session.js';
import { openProgram, closePrograms } from '../navigate.js';
import { captureSession, previousSerial, waitForSerial, buildWhenReady, fetchSpoolFile, readReportFromBrowser } from '../spool.js';

export const meta = {
  name: 'stock-matrix',
  description: 'מריץ את דוח מטריצת מחסנים ומוריד את הייצוא לאקסל',
  writes: false, // a report — reads only, so it runs without --confirm
  input: {
    warehouses: 'array of warehouse codes, optional — defaults to the config list',
    date: 'dd/mm/yyyy, optional — defaults to today in Israel',
    itemFrom: 'string, optional — item code range start (#PrtM)',
    itemTo: 'string, optional — item code range end (#PrtA)',
    excel: 'boolean, default true — false runs the report as HTML instead',
  },
};

/** The eight `Store` slots the "בחירה" mode offers. */
const SLOTS = 8;
const FRAME = /MlaiPrtStoreMatItra/i;

/**
 * Today in Israel, as Comax writes dates.
 *
 * Deliberately not `new Date()` formatted with the process locale: the agent
 * runs on a machine whose clock is UTC-shifted, and between midnight and 03:00
 * Israel time that difference lands the report on the wrong day — exactly the
 * silent error this task exists to prevent.
 */
function todayInIsrael(timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('day')}/${get('month')}/${get('year')}`;
}

/**
 * The warehouses Comax actually has, from the picker capture in
 * knowledge/lists.json.
 *
 * Needed because the `Store` inputs are free text: they accept "99" without a
 * murmur, and the report then runs and returns a file — one that is simply
 * missing a warehouse nobody notices is missing. Reading the field back proves
 * the value stuck, not that it means anything, so the codes are checked against
 * the real list before anything is typed.
 */
function knownWarehouses() {
  const file = resolve(ROOT, 'knowledge/lists.json');
  if (!existsSync(file)) return null;
  const list = JSON.parse(readFileSync(file, 'utf8')).warehouses ?? [];
  return new Map(list.map((w) => [String(w.code), w.name]));
}

/** Read every field the gate cares about, in one round trip. */
function readForm(frame) {
  return frame.evaluate((slots) => {
    const val = (id) => document.getElementById(id)?.value ?? null;
    const stores = {};
    for (let i = 1; i <= slots; i++) stores[`Store${i}`] = val(`Store${i}`) ?? '';
    return {
      TDate: val('TDate'),
      Swdisplay: val('Swdisplay'),
      SwSrak: val('SwSrak'),
      SwExcel: document.getElementById('SwExcel')?.checked ?? null,
      // The item range decides how much of the catalog the report covers. A
      // stale value left here by an earlier run would narrow it silently, and
      // the resulting file looks perfectly normal — so it is verified like
      // everything else.
      PrtM: val('PrtM') ?? '',
      PrtA: val('PrtA') ?? '',
      ...stores,
    };
  }, SLOTS);
}

export async function run({ page, human, logger, input, cfg }) {
  const conf = cfg.reports?.stockMatrix ?? {};
  const wanted = (input.warehouses ?? conf.warehouses ?? []).map(String);
  const date = input.date ?? todayInIsrael(cfg.timezone);

  if (!wanted.length) throw new Error('לא הוגדרו מחסנים — לא בקונפיג ולא בקלט.');
  if (wanted.length > SLOTS) {
    throw new Error(
      `ביקשת ${wanted.length} מחסנים, אבל במצב "בחירה" יש ${SLOTS} משבצות בלבד. ` +
      `ליותר מזה צריך "חיתוך" (Swdisplay=2) — לא עוברים מצב בשקט.`,
    );
  }

  const known = knownWarehouses();
  if (known) {
    const unknown = wanted.filter((c) => !known.has(c));
    if (unknown.length) {
      throw new Error(
        `מחסן לא קיים: ${unknown.join(', ')}. ` +
        `הקיימים: ${[...known].map(([c, n]) => `${c}=${n}`).join(' · ')}`,
      );
    }
    logger.step('warehouses', wanted.map((c) => `${c} ${known.get(c)}`).join(' · '));
  }

  await ensureLoggedIn({ page, human, logger, cfg });

  // By id, not by label: findShortcut throws on labels that appear twice, and
  // "מטריצת מחסנים" sits next to "מטריצת דגמים- יתרות מלאי" on the desktop.
  const { frame } = await openProgram({ page, human, logger, cfg }, 'a158', { expect: FRAME });
  if (!frame) throw new Error('מטריצת מחסנים לא נפתחה.');

  // The date and warehouse fields only exist on the שונות tab, and clicking it
  // is what runs chkdisplay() and reveals Store1..8. Typing before this fails.
  // The item range lives on the תחומים tab, which is the one the program opens
  // on — so set it before switching away to שונות.
  //
  // This is the only way to get past the report's hard ceiling of 1500 rows:
  // that limit is on item rows, not warehouses (two warehouses returned exactly
  // the same 1500 as five), so full coverage means running consecutive ranges
  // and concatenating them.
  if (input.itemFrom || input.itemTo) {
    await human.type('#PrtM', String(input.itemFrom ?? ''), { scope: frame, label: 'פריט מ-' });
    await human.press('Tab');
    await human.type('#PrtA', String(input.itemTo ?? ''), { scope: frame, label: 'פריט עד' });
    await human.press('Tab');
    await human.settle('טווח פריטים');
  }

  await human.click('#Shonot', { scope: frame, label: 'לשונית שונות' });
  await human.settle('שונות');

  await human.type('#TDate', date, { scope: frame, label: 'נכון לתאריך' });
  await human.select('#Swdisplay', '1', { scope: frame, label: 'תצוגה לפי — בחירה' });
  await human.settle('display mode');

  // Fill the requested slots, then blank the rest. Clearing is not tidiness: a
  // value left in slot 6 from a previous run silently joins the report.
  for (let i = 1; i <= SLOTS; i++) {
    const value = wanted[i - 1] ?? '';
    await human.type(`#Store${i}`, value, { scope: frame, label: `מחסן ${i}` });
  }

  if (conf.emptyWarehouses != null) {
    await human.select('#SwSrak', String(conf.emptyWarehouses), { scope: frame, label: 'מחסני סרק' });
  }
  // Unchecking this sends the report to the spool as a plain HTML document
  // instead of an Excel export. Worth having as an option: the Excel route is
  // the one that both crashes Chrome and is gated behind Spooler_Exl_EXE, while
  // an HTML report is just a page we can fetch and parse.
  const wantExcel = input.excel !== false;
  const box = frame.locator('#SwExcel').first();
  if (wantExcel) await box.check(); else await box.uncheck();
  logger.step('form', wantExcel ? 'יצוא לאקסל מסומן' : 'יצוא לאקסל כבוי — דוח HTML');

  // ---- the gate -------------------------------------------------------
  // Everything above asked the page to hold certain values. This reads back
  // what it is actually holding. Comax fields normalise, reject and revert on
  // their own, so "I typed it" is not evidence that it took.
  const actual = await readForm(frame);
  const expected = { TDate: date, Swdisplay: '1', SwExcel: wantExcel,
    PrtM: String(input.itemFrom ?? ''), PrtA: String(input.itemTo ?? '') };
  for (let i = 1; i <= SLOTS; i++) expected[`Store${i}`] = wanted[i - 1] ?? '';
  if (conf.emptyWarehouses != null) expected.SwSrak = String(conf.emptyWarehouses);

  const mismatches = Object.entries(expected)
    .filter(([k, v]) => String(actual[k] ?? '') !== String(v))
    .map(([k, v]) => `${k}: ביקשנו ${JSON.stringify(v)} אבל בשדה ${JSON.stringify(actual[k])}`);

  logger.save('form-check.json', { expected, actual, mismatches });

  if (mismatches.length) {
    await logger.shot(page, 'verify-failed');
    throw new Error(
      `הטופס לא תואם למה שביקשנו — לא מריץ את הדוח:\n  ${mismatches.join('\n  ')}`,
    );
  }
  logger.step('verify', `תאריך ${date} · מחסנים ${wanted.join(', ')} — אומת מול השדות`);
  await logger.shot(page, 'before-run');
  // ---------------------------------------------------------------------

  const outDir = resolve(ROOT, conf.exportDir ?? 'data/exports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Comax does not hand the report back as a download — pressing אישור only
  // queues it into the print spool. And letting Chrome fetch it is what has been
  // killing the window: every export attempt left a crash dump. So we click,
  // read the spool serial, and pull the bytes over HTTP from Node instead.
  page.on('crash', () => logger.step('crash', 'הדפדפן קרס — ממשיכים ב-HTTP'));

  // Take the session out of the page before starting the report. Chrome has
  // crashed on every completed export, and once these values are in hand the
  // build and download are plain HTTP that no longer need the window at all.
  const session = await captureSession({ page, context: page.context() });
  logger.step('session', `נלכדו ${session.cookie.split(';').length} cookies · SsID ${session.SessionID}`);

  // What the spool frame holds right now, so the wait below can require a
  // different number rather than accepting whatever is already there.
  const priorSerial = await previousSerial(page);

  await human.click('#OK', { scope: frame, label: 'אישור — הרצת הדוח' });
  console.log('הדוח רץ. זה לוקח בערך שתי דקות וחצי...');

  const serial = await waitForSerial(page, { logger, previous: priorSerial });
  if (!serial) {
    await logger.shot(page, 'no-serial').catch(() => {});
    throw new Error('הדוח לא קיבל מספר בספול תוך 6 דקות.');
  }

  // Pulling the file out over HTTP is not solved yet: Spooler_Exl_EXE answers
  // "בעיה בהפעלה ראשונית" even for a finished report on a live session, so it
  // needs some server-side state that only opening the viewer through the UI
  // seems to establish. Until that is worked out, a failure here is not a
  // failure of the run — the report is built and waiting in the spool, and the
  // part that actually protects you (right date, right warehouses) already
  // happened. Say where it is rather than throwing the whole run away.
  const [d, m, y] = date.split('/');
  const base = resolve(outDir, `מטריצת-מחסנים-${y}-${m}-${d}`);
  let file = null;
  let size = 0;
  try {
    if (wantExcel) {
      await buildWhenReady(session, serial, { logger, timeoutMs: 4 * 60_000 });
      ({ file, size } = await fetchSpoolFile(session, serial, base, { logger }));
    } else {
      ({ file, size } = await readReportFromBrowser(page, serial, `${base}.html`, { logger }));
    }
    logger.step('download', `${file} (${(size / 1024 / 1024).toFixed(2)} MB, ספול ${serial})`);
  } catch (e) {
    logger.step('spool', `המשיכה האוטומטית נכשלה: ${e.message.split('\n')[0]}`);
    console.log(
      `\nהדוח מוכן בקומקס תחת מספר ${serial}.\n` +
      `להורדה: כפתור "מאגר הדפסות" בסרגל, לבחור את השורה של ${serial}, ולהוריד.\n`,
    );
  }

  // A dialog that ran cleanly closes itself (OK_onclick ends in endProgram),
  // but leave nothing behind either way — an open program covers the desktop
  // icons and swallows the next double-click.
  await closePrograms({ page, human, logger, cfg }).catch(() => {});

  return { file, sizeBytes: size, date, warehouses: wanted, spoolSerial: serial, downloaded: !!file };
}
