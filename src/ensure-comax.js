/**
 * מוודא שיש חלון כרום חי, עם סשן קומקס פעיל, לפני שמשימה נוגעת במשהו.
 *
 * הרקע: עד עכשיו המודל היה `npm run open` שרץ בטרמינל פתוח ומחזיק את החלון —
 * כרום היה תהליך-בן של node ומת איתו. מהאייפון אין טרמינל להשאיר פתוח, ולכן
 * כאן משגרים את כרום **מנותק** (detached), כך שהוא שורד את סיום התהליך ובקשות
 * עוקבות מתחברות לאותו חלון בלי לשלם לוגין מחדש.
 *
 * שחרור המושב לא מטופל כאן ובכוונה: קומקס מנתק לבד אחרי כ-10 דקות חוסר פעילות
 * ומשחרר את קוד המשתמש. ראה את האזהרה ב-knowledge/MAP.md — אסור להוסיף בדיקת
 * בריאות תקופתית, כי היא נחשבת פעילות ותמנע את השחרור לנצח.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadConfig } from './config.js';
import { attachBrowser } from './browser.js';
import { isLoggedIn, login } from './session.js';
import { comaxCredentials } from './env.js';

const BLOCK_PATH = resolve(ROOT, 'runs', '.login-blocked');
const ENV_PATH = resolve(ROOT, '.env');
const BLOCK_MINUTES = 30;

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
];

const chromeExe = (cfg) => {
  const candidates = cfg.chromePath ? [cfg.chromePath, ...CHROME_PATHS] : CHROME_PATHS;
  return candidates.find((p) => p && existsSync(p)) ?? null;
};

/** האם יש CDP שמקשיב על הפורט? */
async function portAlive(port, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * האם כרום כבר רץ על הפרופיל הייעודי?
 *
 * זה המקרה שאחרת עולה 30 שניות של המתנה לשווא: כרום שכבר פתוח על אותו
 * `user-data-dir` בלי פורט דיבאג לא ייפתח שוב — ההשקה החדשה רק מעבירה פוקוס
 * לחלון הקיים ויוצאת, והפורט לעולם לא יעלה.
 *
 * הסינון הוא לפי שורת הפקודה של הפרופיל **בלבד**. סינון לפי שם התהליך היה תופס
 * גם את הכרום האישי של דרור על כל הלשוניות שלו.
 */
function chromeOnProfile(profileDir) {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
          `Where-Object { $_.CommandLine -like '*${profileDir.replace(/'/g, "''")}*' } | ` +
          'Measure-Object | Select-Object -ExpandProperty Count',
      ],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return Number(out.trim()) > 0;
  } catch {
    // אם הבדיקה עצמה נכשלה, לא לחסום את הזרימה — ההמתנה לפורט תכריע.
    return false;
  }
}

/**
 * משגר כרום מנותק.
 *
 * הדגלים מועתקים מ-`openBrowser` ב-src/browser.js, כולל הנימוקים שם: מופע אחד
 * בלבד של `--disable-features` (שני מופעים דורסים זה את זה), בלי `--no-sandbox`
 * (הוא הפיל את החלון באמצע ייצוא), ובלי
 * `--disable-blink-features=AutomationControlled` (הוא מוסיף באנר שמזיז כל
 * אלמנט על המסך, והסוכן לוחץ לפי קואורדינטות).
 */
function spawnChrome(exe, profileDir, port) {
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,OptimizationHints,InsecureDownloadWarnings,DownloadBubble,DownloadBubbleV2',
      '--safebrowsing-disable-download-protection',
    ],
    { detached: true, stdio: 'ignore', windowsHide: false },
  );
  // בלי unref התהליך שלנו לא ייצא כל עוד כרום חי — וזו כל הנקודה של detached.
  child.unref();
}

async function waitForPort(port, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await portAlive(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ── בלימת ניסיונות לוגין בין הרצות ──────────────────────────────────────────
/**
 * `login()` כבר חסום מבפנים — הוא חוזר רק על "קוד משתמש בשימוש" ונכשל מיד על
 * סיסמה שגויה. אבל `ensureComax` נקרא בכל משימה, אז .env שגוי היה מייצר ניסיון
 * טרי בכל הפעלה: עשר בקשות מהטלפון, עשרה ניסיונות כושלים מול קומקס.
 */
function loginBlocked() {
  if (!existsSync(BLOCK_PATH)) return null;
  let block;
  try {
    block = JSON.parse(readFileSync(BLOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
  const at = Date.parse(block.at ?? '');
  if (!at) return null;

  // .env שנערך אחרי החסימה מבטל אותה. בלי זה, תיקון הסיסמה במחשב היה משאיר
  // אותך חסום חצי שעה — ומהאייפון אין דרך נוחה להריץ --reset.
  try {
    if (statSync(ENV_PATH).mtimeMs > at) {
      clearBlock();
      return null;
    }
  } catch {
    /* אין .env — החסימה נשארת בתוקף */
  }

  if (Date.now() - at > BLOCK_MINUTES * 60_000) {
    clearBlock();
    return null;
  }
  return block;
}

const setBlock = (reason) =>
  writeFileSync(BLOCK_PATH, JSON.stringify({ at: new Date().toISOString(), reason }, null, 2), 'utf8');

export function clearBlock() {
  try {
    unlinkSync(BLOCK_PATH);
    return true;
  } catch {
    return false;
  }
}

// ── למה אין כאן בדיקת חיות מול השרת ─────────────────────────────────────────
/**
 * היה כאן probe שמוודא מול השרת שהסשן חי, כי `isLoggedIn()` בודק frame S +
 * `#Start` — DOM בלבד — וימשיך להחזיר "מחובר" גם אחרי שהשרת שכח מאיתנו.
 *
 * הוא נמחק כי הוא לא ניתן לבנייה. נמדדו **37 כתובות** — כל ה-frames של
 * הפריים-סט — פעם על סשן חי ופעם על סשן שנהרג בוודאות (`CloseSession.ashx`
 * החזיר 200). **0 מתוך 37 היו שונות; כולן 200 וזהות בייט.** הכתובות נושאות את
 * כל המצב כפרמטרים (`SwSQL=113&Odbc=Max2000_4396&Lk=4396`) ולכן לא מתייעצות עם
 * שום סשן. הפירוט המלא ב-knowledge/MAP.md, ממצא 4.
 *
 * probe שמחזיר "חי" תמיד גרוע מכלום: הוא היה נותן ביטחון שקרי בדיוק במקום שבו
 * צריך זהירות. במקומו, ההתאוששות עברה לנקודת הכישלון האמיתית ב-tools/run.js —
 * אם פעולה נזרקת למסך התחברות, שם מתחברים מחדש.
 *
 * זה גם פחות דחוף משנראה: כל עוד חלון הסוכן פתוח הוא מתשאל את השרת בעצמו כל
 * ~90 שניות (ממצא 3 ב-MAP.md), כך שסשן מת הוא אירוע נדיר ולא שגרה.
 */

// ── הזרימה ──────────────────────────────────────────────────────────────────
const fail = (reason) => ({ status: 'FAILED', reason });
const needsLogin = (reason) => ({ status: 'NEEDS_LOGIN', reason });

/**
 * מחזיר `{ status, reason, session }` כאשר status הוא READY / NEEDS_LOGIN / FAILED.
 *
 * ב-READY ה-session מוחזר כדי שהקורא ישתמש בו — פתיחת חיבור CDP שני לאותו חלון
 * הייתה רושמת `handleDialogs` פעמיים, כלומר שני `accept()` לכל דיאלוג של קומקס
 * שהשני שבהם נכשל ומלכלך את הלוג. הקורא אחראי לניתוק.
 */
export async function ensureComax({ logger = null } = {}) {
  const cfg = loadConfig();
  const port = cfg.debugPort;
  const profileDir = resolve(ROOT, cfg.profileDir);

  // 1-3. פורט חי, אחרת להשיק ולחכות
  if (!(await portAlive(port))) {
    if (chromeOnProfile(profileDir)) {
      return fail(
        'כרום כבר פתוח על הפרופיל הייעודי בלי פורט דיבאג. ' +
          'סגור את החלון הזה ונסה שוב — השקה נוספת רק מעבירה אליו פוקוס.',
      );
    }
    const exe = chromeExe(cfg);
    if (!exe) return fail(`לא נמצא chrome.exe. נבדקו: ${CHROME_PATHS.join(' · ')}`);

    logger?.step('chrome', 'משגר חלון כרום מנותק');
    spawnChrome(exe, profileDir, port);
    if (!(await waitForPort(port))) return fail('כרום לא ענה על פורט הדיבאג תוך 30 שניות.');
  }

  // 4. חיבור
  const session = await attachBrowser({ logger });
  if (!session) return fail('הפורט עונה אבל לא הצלחתי להתחבר ב-CDP.');

  const { page } = session;
  const disconnect = () => session.browser?.close().catch(() => {});

  // 5. סשן חי? רק ה-DOM — ראה את ההסבר למעלה למה אין כאן אימות מול השרת.
  if (await isLoggedIn(page, cfg)) {
    logger?.step('session', 'הסשן נראה פעיל — ממשיכים בלי לוגין');
    return { status: 'READY', reason: 'הסשן כבר פעיל', session };
  }

  const blocked = loginBlocked();
  if (blocked) {
    await disconnect();
    return needsLogin(
      `ההתחברות נחסמה לאחר כישלון (${blocked.reason}). ` +
        `החסימה תתבטל תוך ${BLOCK_MINUTES} דקות, או מיד עם עריכת .env.`,
    );
  }

  if (!comaxCredentials()) {
    await disconnect();
    return needsLogin('אין .env — צריך התחברות ידנית בחלון הסוכן.');
  }

  try {
    const ok = await login({ ...session, logger });
    if (!ok) {
      setBlock('ההתחברות נדחתה');
      await disconnect();
      return needsLogin('ההתחברות מ-.env נכשלה — בדוק את הפרטים.');
    }
  } catch (e) {
    setBlock(e.message);
    await disconnect();
    return needsLogin(`ההתחברות נכשלה: ${e.message}`);
  }

  clearBlock();
  return { status: 'READY', reason: 'התחברנו מ-.env', session };
}
