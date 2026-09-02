/**
 * Session handling for Max2000 (the classic-ASP frameset that Comax serves
 * after login).
 *
 * Two things make this app awkward, and both are handled here:
 *   1. The run URL carries a per-session token
 *      (`Max2000_run_G.asp?p=0|<token>|<code>|<date>`), so bookmarking a screen
 *      is impossible. Everything is reached by navigating the live frameset.
 *   2. The UI lives across ~56 frames. The toolbar is always frame "S".
 *
 * The Comax session does not survive closing the browser, so `ensureLoggedIn`
 * has two routes back in: sign in from .env if it is configured, otherwise wait
 * for a human to type the password into the visible window.
 */
import { comaxCredentials } from './env.js';

/** The always-present toolbar frame. Throws if we are not inside the app. */
export function navFrame(page, cfg) {
  const f = page.frames().find((fr) => fr.name() === cfg.app.navFrame);
  if (!f) throw new Error('לא נמצא frame הניווט "S" — כנראה לא מחוברים למקס.');
  return f;
}

/** Is the app loaded and logged in right now? */
export async function isLoggedIn(page, cfg) {
  if (page.url().includes(cfg.loginMarker.urlContains)) return false;
  const frame = page.frames().find((fr) => fr.name() === cfg.loggedInMarker.frame);
  if (!frame) return false;
  try {
    return await frame.locator(cfg.loggedInMarker.selector).first().isVisible({ timeout: 5000 });
  } catch {
    return false;
  }
}

/** Poll until the app frameset is up, or the deadline passes. */
async function waitForApp(page, cfg, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await isLoggedIn(page, cfg)) return true;
  }
  return false;
}

/**
 * Comax allows one live session per user code. If the previous session was not
 * signed off — the window was closed, or the process was killed — the server
 * keeps holding it and refuses the next login with this alert, telling you to
 * wait up to three minutes. It is the single biggest cause of "the connection
 * is flaky": nothing is wrong with the credentials or the network, the seat is
 * simply still taken by our own dead session.
 */
const BUSY_RE = /קוד משתמש בשימוש|אין אפשרות להתחבר/;

/** The alert Comax raised since `mark`, if any. */
function dialogSince(page, mark) {
  const d = page.__lastDialog;
  return d && d.at >= mark ? d : null;
}

/** One sign-in attempt. Returns 'ok' | 'busy' | 'failed'. */
async function loginOnce({ page, human, logger, cfg, creds, fresh = false }) {
  // `fresh` forces a reload even though we are already on the login URL. After
  // a refused login the page stays put but half its fields go hidden — the user
  // field resolves to `hidden` and the retry dies waiting for it to be visible.
  // Only a reload puts the form back into a state that can be typed into.
  if (fresh || !page.url().includes(cfg.loginMarker.urlContains)) {
    await human.goto(cfg.loginUrl);
  }

  await human.type(cfg.login.orgField, creds.org, { label: 'ארגון' });
  await human.type(cfg.login.userField, creds.user, { label: 'משתמש' });
  // `secret` keeps the value out of runs/<run>/steps.log, which is a plain file
  // that stays on disk. Without it the password would be written in the clear.
  await human.type(cfg.login.passField, creds.pass, { label: 'סיסמה', secret: true });

  // Anything the page said before this click is stale; only alerts raised by
  // the submit itself tell us how this attempt went.
  const mark = Date.now();
  await human.click(cfg.login.submitButton, { label: 'כניסה' });

  // Check for the refusal alert before settling in for the long wait — it
  // arrives within a second of the click, and waiting 45s on it is pure delay.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const d = dialogSince(page, mark);
    if (d && BUSY_RE.test(d.message)) return 'busy';
  }

  if (await waitForApp(page, cfg, 45_000)) return 'ok';
  return dialogSince(page, mark) && BUSY_RE.test(page.__lastDialog.message) ? 'busy' : 'failed';
}

/**
 * Signs in using the credentials in .env — a file you write by hand and that is
 * never committed. The values are typed at human speed and never logged; the
 * log records only that a login was attempted.
 *
 * A "user code in use" refusal is retried rather than reported as a failure:
 * the seat frees itself once the server times the stale session out, so the
 * fix is to wait it out. `login.busyRetries` / `login.busyWaitMs` in the config
 * bound how long.
 */
export async function login({ page, human, logger, cfg }) {
  const creds = comaxCredentials();
  if (!creds) return false;

  const retries = cfg.login.busyRetries ?? 4;
  const waitMs = cfg.login.busyWaitMs ?? 45_000;

  logger?.step('login', 'מתחבר עם הפרטים מ-.env');
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await loginOnce({ page, human, logger, cfg, creds, fresh: attempt > 0 });
    if (result === 'ok') {
      logger?.step('login', 'ההתחברות הצליחה');
      return true;
    }
    if (result === 'failed') {
      logger?.step('login', 'ההתחברות נכשלה — בדוק את הפרטים ב-.env');
      return false;
    }
    if (attempt === retries) break;
    const secs = Math.round(waitMs / 1000);
    logger?.step('login', `קוד המשתמש עדיין תפוס — ממתין ${secs}ש׳ ומנסה שוב (${attempt + 1}/${retries})`);
    console.log(`  הסשן הקודם עדיין פתוח בשרת. ממתין ${secs} שניות ומנסה שוב...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  logger?.step('login', 'ההתחברות נכשלה — קוד המשתמש נשאר תפוס');
  return false;
}

/**
 * Releases the user's seat on the Comax server.
 *
 * Not by clicking the toolbar's התנתקות button: that runs
 * `top.Cs.LOGOFF_Prog()`, whose entire body is a confirm followed by
 * `top.window.close()` — which Chrome refuses for a window a script did not
 * open, and which sends the server nothing anyway.
 *
 * The request that actually frees the seat is `CloseSession.ashx`, fired by
 * Comax's own `top.onUnload('fset')`. Comax sends it **asynchronously from the
 * unload handler**, and browsers routinely kill in-flight async requests as the
 * window goes away — so on a normal close it never leaves. That is the whole
 * reason the next login is refused with "קוד משתמש בשימוש" for three minutes.
 *
 * Calling it ourselves, while the page is still alive, and waiting for the
 * response is what makes the release actually happen.
 */
export async function logoff({ page, logger, cfg }) {
  if (!(await isLoggedIn(page, cfg))) return true;
  try {
    const frame = navFrame(page, cfg);

    // Arm the listener before firing, or a fast response is missed.
    const released = page
      .waitForResponse((r) => /CloseSession\.ashx/i.test(r.url()), { timeout: 20_000 })
      .then((r) => r.status())
      .catch(() => null);

    const fired = await frame.evaluate(() => {
      if (typeof top.onUnload !== 'function') return false;
      top.onUnload('fset');
      return true;
    });

    if (!fired) {
      logger?.step('session', 'לא נמצאה onUnload — לא ניתן לשחרר את הסשן מסודר');
      return false;
    }

    const status = await released;
    if (status === null) {
      logger?.step('session', 'בקשת שחרור הסשן לא חזרה — ייתכן שהמושב עוד תפוס');
      return false;
    }
    logger?.step('session', `הסשן שוחרר (CloseSession ${status})`);

    // Leave the frameset so the window is not sitting on a session that no
    // longer exists — the next run then starts from a clean login page.
    await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    return true;
  } catch (e) {
    logger?.step('session', `ההתנתקות נכשלה: ${e.message}`);
    return false;
  }
}

/**
 * Guarantees we are inside a live Max2000 session.
 *
 * Order: already in → auto-login from .env → wait for you to sign in by hand.
 */
export async function ensureLoggedIn({ page, human, logger, cfg, waitMinutes = 5 }) {
  if (await isLoggedIn(page, cfg)) {
    logger?.step('session', 'מחובר — ממשיכים');
    return true;
  }

  if (comaxCredentials()) {
    if (await login({ page, human, logger, cfg })) {
      await human.think('after login');
      return true;
    }
    logger?.step('session', 'ההתחברות האוטומטית נכשלה — עובר להתחברות ידנית');
  }

  logger?.step('session', 'לא מחובר — פותח מסך התחברות ומחכה לך');
  if (!page.url().includes(cfg.loginMarker.urlContains)) {
    await human.goto(cfg.loginUrl);
  }
  console.log('\n  >> הסשן פג. תתחבר בחלון של הסוכן ואני אמשיך אוטומטית.\n');

  if (await waitForApp(page, cfg, waitMinutes * 60_000)) {
    logger?.step('session', 'ההתחברות הצליחה');
    await human.think('after login');
    return true;
  }
  throw new Error(`לא בוצעה התחברות תוך ${waitMinutes} דקות.`);
}

/** Which company / year the session is working against, for the run log. */
export async function sessionInfo(page, cfg) {
  const info = { title: await page.title().catch(() => null), url: page.url() };
  const m = /LogInC=(\d+)/.exec(page.url());
  if (m) info.loginId = m[1];
  try {
    const company = page.frames().find((fr) => fr.name() === 'FrameCompany');
    if (company) {
      const vals = await company
        .locator('input[type="text"]')
        .evaluateAll((els) => els.map((e) => e.value.trim()).filter(Boolean));
      info.company = vals.find((v) => !/^\d{4}$/.test(v)) ?? null;
      info.year = vals.find((v) => /^\d{4}$/.test(v)) ?? null;
    }
  } catch { /* frame may not be loaded */ }
  return info;
}
