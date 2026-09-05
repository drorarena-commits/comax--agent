/**
 * Navigation for Max2000.
 *
 * The run URL carries a per-session token, so no screen can be reached by URL.
 * Everything goes through the live frameset. The fastest route is the desktop
 * shortcut strip in frame "S" — 52 one-click entries covering invoices, quotes,
 * customers, stock and reports. They are <a> elements with an onclick handler
 * and no href, so they are targeted by exact text (or by id when two shortcuts
 * share a label — see knowledge/desktop-shortcuts.json).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';
import { navFrame } from './session.js';

let catalogCache = null;

export function shortcuts() {
  catalogCache ??= JSON.parse(readFileSync(resolve(ROOT, 'knowledge/desktop-shortcuts.json'), 'utf8'));
  return catalogCache;
}

/** Look a shortcut up by exact label, or by id when the label is ambiguous. */
export function findShortcut(nameOrId) {
  const cat = shortcuts();
  const byId = cat.shortcuts.find((s) => s.id === nameOrId);
  if (byId) return byId;

  const matches = cat.shortcuts.filter((s) => s.label === nameOrId);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `"${nameOrId}" מופיע ${matches.length} פעמים בשולחן העבודה (${matches.map((m) => m.id).join(', ')}). ` +
      `תשתמש ב-id במקום בשם.`,
    );
  }

  const near = cat.shortcuts.filter((s) => s.label.includes(nameOrId)).map((s) => `${s.label} (${s.id})`);
  throw new Error(
    `לא נמצא קיצור "${nameOrId}".` + (near.length ? ` אולי התכוונת ל: ${near.join(' | ')}` : ''),
  );
}

/** Frames that hold a running program, in the order Max2000 tends to use. */
const PROGRAM_FRAMES = ['G', 'C', 'M', 'B', 'L', 'R', 'frm', 'ifr'];

/** Frames carrying real content right now, for figuring out where a program landed. */
export async function activeFrames(page, { minElements = 3 } = {}) {
  const out = [];
  for (const fr of page.frames()) {
    if (fr === page.mainFrame()) continue;
    try {
      const n = await fr.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        return [...document.querySelectorAll('input,select,textarea,button,a,td[onclick]')].filter(vis).length;
      });
      if (n >= minElements) out.push({ name: fr.name() || '(anon)', url: fr.url(), elements: n });
    } catch { /* frame torn down mid-read */ }
  }
  return out.sort((a, b) => b.elements - a.elements);
}

/**
 * Brings the icon desktop to the front. Open programs float above it, and a
 * click aimed at a covered icon is swallowed — which looks exactly like the
 * program failing to launch.
 */
export async function showDesktop({ page, human, logger, cfg }) {
  const nav = navFrame(page, cfg);
  try {
    await human.click(cfg.app.desktopButton, { scope: nav, label: 'הצג שולחן עבודה' });
    await human.settle('desktop shown');
    return true;
  } catch (e) {
    logger?.step('desktop', `לא הצלחתי להציג את שולחן העבודה: ${e.message}`);
    return false;
  }
}

/**
 * Opens a program from the desktop shortcut strip and waits for it to render.
 * Returns the frames that came alive, so a task can pick its working frame.
 *
 * `program` is an optional Max2000 path (e.g. `Kupa/Kab/Osh/Kabala_OshV.aspx`)
 * to fall back to when the icon is not on the desktop. Comax rearranges the
 * desktop without warning — `a146` was there at 13:26 on 03/09/2026 and gone by
 * 14:44, when the view switched to categories — and a caller that knows the
 * path should not have to wait out `actionTimeoutMs` to discover that.
 */
export async function openProgram({ page, human, logger, cfg }, nameOrId, { expect = null, program = null } = {}) {
  const sc = findShortcut(nameOrId);
  const nav = navFrame(page, cfg);
  const wanted = expect ?? (sc.urlPattern ? new RegExp(sc.urlPattern, 'i') : null);

  const before = new Set((await activeFrames(page)).map((f) => f.name + f.url));

  // Prefer the id when we have one — it survives two shortcuts sharing a label.
  const selector = sc.id ? `#${sc.id}` : sc.selector;

  // Max2000 programs can take a few seconds to paint into their frame. When the
  // program was already open, nothing new appears — so a URL match counts as
  // ready too.
  const settled = (frames) =>
    frames.some((f) => !before.has(f.name + f.url)) ||
    (wanted && frames.some((f) => wanted.test(f.url)));

  const waitForProgram = async () => {
    await human.settle(`program "${sc.label}" loading`);
    let frames = await activeFrames(page);
    for (let i = 0; i < 4 && !settled(frames); i++) {
      await human.think(`waiting for "${sc.label}"`);
      frames = await activeFrames(page);
    }
    return frames;
  };

  /**
   * The fast path: when the caller knows the program's own path, ask Max2000
   * to run it directly.
   *
   * This skips raising the desktop and hunting for an icon — three clicks with
   * their gates and settles, measured 05/09/2026 at ~18s of an 87s run. The
   * mechanism is not new: `top.S.runProgram` was already here as the fallback
   * for when Comax takes an icon off the desktop. It is only being promoted.
   *
   * The desktop route stays as the fallback rather than being deleted, because
   * a path can go stale exactly the way an icon can, and failing over costs one
   * settle while failing outright costs the whole task.
   */
  let after = null;
  if (program) {
    logger?.step('program', `${sc.label} (${sc.id}) — לפי נתיב, בלי מעבר בשולחן`);
    await nav.evaluate((path) => top.S.runProgram(path), program);
    after = await waitForProgram();
    if (!settled(after)) {
      logger?.step('program', `הנתיב לא פתח את ${sc.label} — נופל חזרה לשולחן העבודה`);
      after = null;
    }
  }

  if (!after) {
    // An open program covers the desktop, and a double-click aimed at an icon
    // underneath simply never lands. Raise the desktop first.
    await showDesktop({ page, human, logger, cfg });

    // `count()` asks the DOM as it stands rather than waiting for the element to
    // appear, so an icon Comax has taken off the desktop costs nothing to rule
    // out. Measured 04/09/2026 — `a157` is gone from a 51-icon desktop, and
    // `customer-history` died on 30s of "waiting for locator('#a157')" with
    // nothing saying the icon simply is not there any more.
    if ((await nav.locator(selector).count()) > 0) {
      // Desktop icons select on a single click; only a double-click launches them.
      await human.doubleClick(selector, { scope: nav, label: `${sc.label} (${sc.id})` });
    } else if (program) {
      throw new Error(
        `"${sc.label}" (${sc.id}) לא נפתח: הנתיב ${program} לא הביא תוכנית, והאייקון לא בשולחן.\n` +
          'שני המסלולים נוסו. בדוק את הנתיב, או הרץ `node tools/_smoke/desktop-probe.mjs`.',
      );
    } else {
      throw new Error(
        `"${sc.label}" (${sc.id}) לא נמצא בשולחן העבודה, ואין נתיב חלופי.\n` +
          'קומקס מסדר מחדש את השולחן בלי להודיע. הוסף `program` לקריאה ל-openProgram,\n' +
          'או הרץ `node tools/_smoke/desktop-probe.mjs` כדי לראות אילו אייקונים כן קיימים.',
      );
    }
    after = await waitForProgram();
  }
  const opened = after.filter((f) => !before.has(f.name + f.url));

  // Program slots are named f0, f1, ... — never the chrome frames around them
  // (calendar, company picker, print spool), which are always "active".
  const isSlot = (f) => /^f\d+$/.test(f.name);
  const main =
    (wanted ? after.find((f) => wanted.test(f.url)) : null) ?? // the program we asked for
    opened.find(isSlot) ??                                     // a slot that just opened
    opened[0] ??
    after.find(isSlot) ??
    null;

  if (!main) throw new Error(`"${sc.label}" לא נפתח — לא נמצא frame של תוכנית.`);

  logger?.step('program', `נפתח: ${sc.label} → ${main.name}`);
  for (const f of opened) {
    logger?.step('frame', `${f.name} — ${f.elements} אלמנטים — ${f.url.replace('https://www.comax.co.il/Max2000/', '')}`);
  }
  return {
    shortcut: sc,
    opened,
    frameName: main?.name ?? null,
    frame: main ? page.frames().find((fr) => (fr.name() || '(anon)') === main.name) : null,
  };
}

/** A program window's path, e.g. `Erp/Mehirot/Doc612/AzaaMhr/Doc612V.asp`. */
export function framePath(url) {
  const m = /comax\.co\.il\/(?:Max2000[^/]*)\/(.+?)(?:\?|$)/i.exec(url);
  return m ? m[1] : url;
}

/**
 * The "תוכניות בעבודה" panel — Max2000's own list of open programs.
 *
 * Dror pointed this out: the flashing double-arrow in the toolbar (`#Run`)
 * opens a panel listing every open program, with a switch-to and a close action
 * per row. It is the system's own bookkeeping, so it is far more reliable than
 * hunting for #DoClose inside each frame — which is what previously shut the
 * wrong window.
 *
 * Each row exposes `parent.onClickTable(i)` (switch to) and
 * `parent.ExitProgram(i)` (close), where `i` is the row index.
 */
export async function listPrograms(page) {
  const panel = page.frames().find((f) => /RunPgm\/TablePrograms\.asp/i.test(f.url()));
  if (!panel) return [];
  return panel.evaluate(() => {
    // Each program contributes more than one cell carrying onClickTable(i) —
    // the label and the icon. Keep one row per index, preferring the cell whose
    // text is the readable program name rather than the internal frame name.
    const byIndex = new Map();
    for (const td of document.querySelectorAll('td[onclick]')) {
      const m = /onClickTable\((\d+)\)/.exec(td.getAttribute('onclick') || '');
      if (!m) continue;
      const index = Number(m[1]);
      const name = (td.innerText || '').trim();
      const prev = byIndex.get(index);
      const better = !prev || (name && !/^Frame/.test(name) && /^Frame/.test(prev.name));
      if (better) byIndex.set(index, { index, name, frameName: td.title || prev?.frameName || null });
    }
    return [...byIndex.values()].sort((a, b) => a.index - b.index);
  });
}

/** Bring the "תוכניות בעבודה" panel up so its rows are clickable. */
async function openProgramsPanel({ page, human, cfg }) {
  const nav = navFrame(page, cfg);
  await human.click('#Run', { scope: nav, label: 'מעבר בין תוכניות בעבודה' });
  await human.settle('programs panel');
  return page.frames().find((f) => /RunPgm\/TablePrograms\.asp/i.test(f.url())) ?? null;
}

/**
 * Close the "תוכניות בעבודה" panel itself. It is a window like any other and
 * stays on screen after the programs it listed are gone, so whatever opens it
 * is responsible for putting it away.
 */
export async function closeProgramsPanel({ page, human, logger }) {
  const shell = page.frames().find((f) => /RunPgm\/RunPrograms_G\.asp/i.test(f.url()));
  if (!shell) return false;
  try {
    const btn = shell.locator('#DoExit').first();
    if (!(await btn.isVisible({ timeout: 1500 }))) return false;
    await human.click(btn, { label: 'סגירת פאנל התוכניות' });
    await human.settle('panel closed');
    return true;
  } catch (e) {
    logger?.step('close', `פאנל התוכניות לא נסגר: ${e.message}`);
    return false;
  }
}

/**
 * Closes open programs through the system's own panel.
 *
 * `patterns` match the program's Hebrew name as shown in the panel (or `all`).
 * Rows are closed from the highest index down, because `ExitProgram(i)`
 * renumbers the remaining rows.
 */
export async function closePrograms(ctx, patterns = [/./]) {
  const { page, human, logger } = ctx;
  const wanted = patterns.map((p) => (p instanceof RegExp ? p : new RegExp(p, 'i')));

  const panel = await openProgramsPanel(ctx);
  if (!panel) { logger?.step('close', 'פאנל התוכניות לא נפתח'); return []; }

  const rows = (await listPrograms(page)).filter((r) => wanted.some((re) => re.test(r.name)));
  if (!rows.length) {
    logger?.step('close', 'אין תוכניות פתוחות לסגירה');
    await closeProgramsPanel(ctx);
    return [];
  }
  logger?.step('close', `סוגר ${rows.length}: ${rows.map((r) => r.name).join(' · ')}`);

  const closed = [];
  for (const row of [...rows].sort((a, b) => b.index - a.index)) {
    await human.gate();
    await panel.evaluate((i) => window.parent.ExitProgram(i), row.index);
    logger?.step('close', `נסגר: ${row.name}`);
    closed.push(row.name);
    await human.think('program closing');
  }
  // The panel is a window too — put it away rather than leaving it on screen.
  await closeProgramsPanel(ctx);
  return closed;
}

/**
 * Closes program windows whose path matches one of `patterns`, by clicking the
 * close control inside each frame. Kept as a fallback for when the programs
 * panel is unavailable; prefer `closePrograms()`.
 */
export async function closeWindows({ page, human, logger }, patterns, { max = 8 } = {}) {
  const wanted = patterns.map((p) => (p instanceof RegExp ? p : new RegExp(p, 'i')));
  const closed = [];
  const stuck = new Set();

  for (let round = 0; round < max; round++) {
    // Windows stack, and only the topmost takes clicks — so work from the
    // highest slot down. `#DoClose` calls top.S.closeProgram; `#Cancel` is the
    // form's own cancel and does not close a program window, so it comes last.
    const target = page
      .frames()
      .filter((f) => /^f\d+$/.test(f.name() || ''))
      .filter((f) => !/Blank_Screen|Blank\.asp/i.test(f.url()))
      .filter((f) => !stuck.has(f.name()))
      .filter((f) => wanted.some((re) => re.test(framePath(f.url()))))
      .sort((a, b) => Number(b.name().slice(1)) - Number(a.name().slice(1)))[0];
    if (!target) break;

    const name = target.name();
    const path = framePath(target.url());
    let done = false;
    for (const sel of ['#DoClose', '#DoExit', '#Cancel']) {
      try {
        const btn = target.locator(sel).first();
        if (!(await btn.isVisible({ timeout: 1500 }))) continue;
        await human.click(btn, { label: `סגירת ${path.split('/').pop()} (${sel})` });
        await human.settle('window closed');
        // Only count it if the frame really went away.
        const after = page.frames().find((f) => f.name() === name);
        if (!after || /Blank_Screen|Blank\.asp/i.test(after.url())) { done = true; break; }
      } catch { /* next control */ }
    }
    if (!done) {
      stuck.add(name);
      logger?.step('close', `לא נסגר: ${name} (${path}) — ממשיך לבא בתור`);
      continue;
    }
    closed.push(path);
  }

  if (closed.length) logger?.step('close', `נסגרו: ${closed.join(', ')}`);
  return closed;
}

/**
 * Popups that appear on their own and block the form underneath. The customer
 * remarks dialog (`_IdxRemarksU.aspx`) is the one we hit first; the list is
 * matched on frame URL so new ones are cheap to add.
 */
// Matched on frame URL. `Hov_MsgScreen.asp` is deliberately absent: it is a
// permanent hidden frame, not a popup, and matching it produced false alarms.
const BLOCKING_POPUPS = [/_IdxRemarksU\.aspx/i, /Remarks.*U\.aspx/i];

/**
 * Closes any self-opening dialog sitting on top of the current form.
 * Returns what it dismissed, so a task can log it rather than silently swallow.
 */
export async function dismissPopups({ page, human, logger }, { max = 3 } = {}) {
  const closed = [];
  for (let round = 0; round < max; round++) {
    const popup = page.frames().find((fr) => {
      const url = fr.url();
      return BLOCKING_POPUPS.some((re) => re.test(url));
    });
    if (!popup) break;

    let dismissed = false;
    for (const sel of ['#Cancel', '#OK', '#DoClose']) {
      try {
        const btn = popup.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await human.click(btn, { label: `סגירת חלון קופץ (${sel})` });
          await human.settle('popup closed');
          closed.push(popup.url().split('/').pop().split('?')[0]);
          dismissed = true;
          break;
        }
      } catch { /* try the next control */ }
    }
    if (!dismissed) {
      logger?.step('popup', `לא הצלחתי לסגור: ${popup.url()}`);
      break;
    }
  }
  if (closed.length) logger?.step('popup', `נסגרו: ${closed.join(', ')}`);
  return closed;
}

/**
 * The generic picker, but only when it is actually on screen.
 *
 * Max2000 keeps `Select_G.htm` loaded in a permanent 2x2 `visibility:hidden`
 * frame that retains the URL of the last search. Matching on URL alone reports
 * a picker that closed minutes ago — so visibility is checked in the parent
 * document, where the frame element lives.
 */
async function isPickerVisible(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const walk = (doc) => {
      for (const fr of doc.querySelectorAll('iframe,frame')) {
        if (seen.has(fr)) continue;
        seen.add(fr);
        if (/Select_G\.htm/i.test(fr.src || '')) {
          const r = fr.getBoundingClientRect();
          const st = getComputedStyle(fr);
          if (r.width > 40 && r.height > 40 && st.visibility !== 'hidden' && st.display !== 'none') {
            return true;
          }
        }
        try {
          if (fr.contentDocument && walk(fr.contentDocument)) return true;
        } catch { /* cross-origin */ }
      }
      return false;
    };
    return walk(document);
  }).catch(() => false);
}

/** The picker frame handle, or null when no picker is showing. */
async function pickerFrame(page) {
  if (!(await isPickerVisible(page))) return null;
  return page.frames().find((fr) => /System\/Select\/Select_G\.htm/i.test(fr.url())) ?? null;
}

/**
 * Dismiss a picker left open by an earlier action. A stale picker holds rows
 * from a previous search, and clicking one of those silently selects the wrong
 * record — which is exactly what happened the first time this ran.
 */
export async function closePicker({ page, human, logger }) {
  const picker = await pickerFrame(page);
  if (!picker) return false;
  try {
    await picker.evaluate(() => window.close?.());
  } catch { /* not closeable that way */ }
  await human.press('Escape', { label: 'סגירת בורר ישן' });
  await human.think('picker closing');
  const still = !!(await pickerFrame(page));
  logger?.step('picker', still ? 'בורר ישן נשאר פתוח' : 'בורר ישן נסגר');
  return !still;
}

/** Read the rows currently offered by the generic `Select_G.htm` picker. */
export async function readPickerRows(page) {
  const picker = await pickerFrame(page);
  if (!picker) return null;
  const rows = await picker.evaluate(() =>
    [...document.querySelectorAll('tr')]
      .filter((tr) => {
        const r = tr.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && tr.cells.length >= 2;
      })
      .map((tr) => [...tr.cells].map((c) => (c.innerText || '').trim()))
      .filter((cells) => cells.some(Boolean)),
  );
  return { frame: picker, rows };
}

/**
 * Fills a Max2000 lookup field (customer, item, supplier).
 *
 * Two routes, because the app offers two and only the pair is reliable:
 *   1. Type a partial name and press Enter — the field resolves itself when the
 *      match is unambiguous.
 *   2. If it does not resolve, open the arrow picker (`Select_G.htm`) and click
 *      the matching row. One click selects; a double-click is wrong here.
 *
 * When the picker offers several candidates and none is an exact match, this
 * throws with the full list rather than guessing which customer you meant.
 */
export async function fillLookup(ctx, { frame, field, arrow, value, what = 'ערך' }) {
  const { page, human, logger } = ctx;
  const id = field.replace(/^#/, '');
  // Every Max2000 combo exposes its arrow as #CcomboBut<FieldId>. Do NOT reach
  // for #chg here — that one switches the customer *type* and swaps the field
  // out from under you.
  const arrowSel = arrow ?? `#CcomboBut${id}`;

  // A picker left over from an earlier action still shows the old result set.
  await closePicker(ctx);

  await human.type(field, value, { scope: frame, label: what });
  await human.press('Enter', { label: `Enter על ${what}` });
  await human.think(`${what} lookup`);

  // Comax opens the picker itself when the text is ambiguous. If it did not,
  // and the field holds a value, the lookup resolved — including the case where
  // the typed name was already exact and so did not visibly change.
  if (!(await pickerFrame(page))) {
    const resolved = await frame.locator(field).inputValue().catch(() => '');
    if (resolved) {
      logger?.step('lookup', `${what}: "${resolved}"${resolved === value ? '' : ` (הושלם מ-"${value}")`}`);
      return { value: resolved, via: 'enter' };
    }
    // Nothing resolved and nothing offered — open the picker ourselves.
    logger?.step('lookup', `${what}: "${value}" לא נפתר, פותח בורר`);
    try {
      await human.click(arrowSel, { scope: frame, label: `בורר ${what}` });
      await human.settle('picker open');
    } catch {
      throw new Error(`לא נמצא ${what} בשם "${value}", ולא הצלחתי לפתוח את הבורר (${arrowSel}).`);
    }
  } else {
    logger?.step('lookup', `${what}: "${value}" עמום — המערכת פתחה בורר`);
  }

  const picker = await readPickerRows(page);
  if (!picker || !picker.rows.length) {
    throw new Error(`לא נמצא ${what} בשם "${value}", והבורר לא נפתח.`);
  }

  // Items come back as "CODE - NAME" while customers are just the name, so a
  // row matches on the whole label, on the code column, or on the code prefix.
  const norm = (x) => String(x ?? '').trim();
  const target = norm(value);
  const matches = picker.rows.filter((r) => {
    const label = norm(r[0]);
    if (label === target) return true;
    if (r.slice(1).some((c) => norm(c) === target)) return true;
    const [code] = label.split(' - ');
    return norm(code) === target;
  });
  const chosen = matches.length === 1 ? matches[0] : null;
  const picker_rows_for_error = matches.length > 1 ? matches : picker.rows;

  if (!chosen) {
    const rows = picker_rows_for_error;
    const list = rows.slice(0, 15).map((r) => `  ${r[0]}  (${r[1] ?? ''})`).join('\n');
    throw new Error(
      `"${value}" מתאים ל-${rows.length} אפשרויות ב${what}. תגיד לי במדויק באיזו:\n${list}` +
      (rows.length > 15 ? `\n  ...ועוד ${rows.length - 15}` : ''),
    );
  }

  // One click selects in this picker.
  await human.click(`td:text-is(${JSON.stringify(chosen[0])})`, {
    scope: picker.frame,
    label: `${what}: ${chosen[0]}`,
  });
  await human.settle('picker closed');
  logger?.step('lookup', `${what}: נבחר "${chosen[0]}" (${chosen[1] ?? ''}) מהבורר`);
  return { value: chosen[0], code: chosen[1] ?? null, via: 'picker' };
}

export { PROGRAM_FRAMES, BLOCKING_POPUPS, pickerFrame };
