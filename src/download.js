/**
 * הורדת קובץ מקומקס — הדלת היחידה.
 *
 * 💣 **למה זה קובץ משלו, ולא עוד לולאה בתוך כל משימת ייצוא.** ב-15/09/2026
 * הייצוא הלילי "רץ" 27 דקות ונכשל ב"לא ירד קובץ", בזמן שהקובץ היה מוכן:
 * בפרופיל של הסוכן הייתה דלוקה ההגדרה `prompt_for_download`, כרום פתח **דיאלוג
 * שמירה של ווינדוס** על `%USERPROFILE%\Downloads`, וחיכה לאדם. דרור מצא אותו
 * תקוע ולחץ "שמור" ביד — הקובץ נחת בתיקיית ההורדות של המשתמש, `saveAs` חזר
 * `canceled`, והחיפוש בדיסק סרק **רק** את `runs/downloads` והכריז שלא ירד כלום.
 *
 * שלוש מסקנות, וכולן כאן:
 *
 *   1. **מונעים את הדיאלוג** — `armDownloads` רגע לפני הקליק, לא רק בחיבור.
 *   2. **מאמצים קובץ שנחת במקום אחר** — סורקים גם את תיקיית ההורדות של המשתמש,
 *      כי ברגע שאדם לחץ "שמור" הקובץ תקין לגמרי ואין שום סיבה לזרוק אותו.
 *   3. **נכשלים עם הסיבה האמיתית** — "לא ירד קובץ" שלח לחפש תקלת רשת, בזמן
 *      שהתשובה הייתה הגדרה בפרופיל. הודעת הכישלון אומרת את זה עכשיו במפורש.
 *
 * ⛔ דיאלוג של מערכת ההפעלה **אינו נראה לסוכן**: אין `page.on('dialog')` שיתפוס
 * אותו, אי אפשר לצלם אותו ואי אפשר לסגור אותו. לכן ההגנה היא מניעה מראש
 * (`silenceDownloadPrompt`, לפני הפעלת כרום) ואימוץ בדיעבד — לא "נזהה ונלחץ".
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { homedir } from 'node:os';
import { ROOT, loadConfig } from './config.js';
import { SPOOL_DIR, armDownloads, downloadPromptOn } from './browser.js';

/** Where a download can legitimately end up, in priority order. */
function watchedDirs() {
  const dirs = [SPOOL_DIR, resolve(homedir(), 'Downloads')];
  return [...new Set(dirs)].filter((d) => existsSync(d));
}

function snapshot(dirs) {
  const seen = new Map();
  for (const d of dirs) seen.set(d, new Set(readdirSync(d)));
  return seen;
}

/** Newly appeared, fully written files across every watched directory. */
function freshFiles(dirs, before) {
  const out = [];
  for (const d of dirs) {
    const had = before.get(d) ?? new Set();
    for (const name of readdirSync(d)) {
      if (had.has(name) || name.endsWith('.crdownload')) continue;
      const full = resolve(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) continue;
      out.push({ full, name, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** renameSync fails across volumes; the user's Downloads may be one. */
function moveInto(from, to) {
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    try { unlinkSync(from); } catch { /* the copy is what matters */ }
  }
  return to;
}

/**
 * מריץ את הקליק שמוריד, ומחזיר את הנתיב שבו הקובץ נחת בפרויקט.
 *
 * @param {object}   o
 * @param {object}   o.session  מה ש-`getBrowser` החזיר — page/context/browser
 * @param {object}   o.logger
 * @param {Function} o.target   (ext) => נתיב היעד המלא, כולל הסיומת
 * @param {Function} o.trigger  הפעולה שמתחילה את ההורדה (הקליק)
 * @param {number}  [o.waitMs]  כמה לחכות לאירוע ההורדה
 * @param {number}  [o.scanMs]  כמה לסרוק את הדיסק אחרי שהאירוע לא הספיק
 */
export async function captureDownload({ session, logger, target, trigger, waitMs = 10 * 60_000, scanMs = 5 * 60_000 }) {
  const { page, context, browser = null } = session;
  if (!existsSync(SPOOL_DIR)) mkdirSync(SPOOL_DIR, { recursive: true });

  // Re-assert the download target at the last possible moment. Anything that
  // attached to this browser in between — Playwright's own context init
  // included — may have set a different behavior, and the order is not ours.
  const armed = await armDownloads({ browser, context: context ?? page.context(), page }, SPOOL_DIR, logger);
  if (armed.ok.length) logger?.step('downloads', `יעד ההורדה נקבע ל-runs/downloads (${armed.ok.join(' · ')})`);

  const dirs = watchedDirs();
  const before = snapshot(dirs);
  const downloadPromise = (context ?? page.context())
    .waitForEvent('download', { timeout: waitMs })
    .catch(() => null);

  await trigger();

  let file = null;
  const dl = await downloadPromise;
  if (dl) {
    try {
      file = target(extname(dl.suggestedFilename()));
      await dl.saveAs(file);
    } catch (e) {
      // Comax can close the window that owns the download before we pull the
      // bytes through it, and a native save dialog answered by hand lands the
      // file outside the spool. Both leave a real file on disk — go find it.
      logger?.step('download', `saveAs נכשל (${e.message.split('\n')[0]}) — מחפש בדיסק`);
      file = null;
    }
  }

  if (!file) {
    const deadline = Date.now() + scanMs;
    let last = -1;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const fresh = freshFiles(dirs, before);
      if (!fresh.length) continue;
      const cand = fresh[0];
      // A stalled transfer keeps growing or sits at zero; only a size that has
      // stopped changing means the file is complete.
      if (cand.size > 0 && cand.size === last) {
        file = moveInto(cand.full, target(extname(cand.name)));
        if (!cand.full.startsWith(SPOOL_DIR)) {
          logger?.step('download', `הקובץ נחת מחוץ לפרויקט (${cand.full}) — הועבר פנימה`);
        }
        break;
      }
      last = cand.size;
    }
  }

  if (!file) {
    const profileDir = resolve(ROOT, loadConfig().profileDir);
    const hint = downloadPromptOn(profileDir)
      ? ' — ההגדרה "שאל איפה לשמור כל קובץ" דלוקה בפרופיל, וכרום כנראה ממתין לדיאלוג שמירה של ווינדוס שהסוכן אינו רואה. לסגור את חלון הסוכן ולהריץ שוב; הכיבוי נכנס לתוקף בהפעלה הבאה.'
      : '';
    throw new Error(`לא ירד קובץ${hint}`);
  }
  return file;
}
