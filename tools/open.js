/**
 * Learning mode: opens the agent's Chrome window and just waits.
 *
 * Use this to log in to Comax by hand the first time, and to navigate to a
 * screen you want mapped. Leave it running; press Ctrl+C to close.
 *
 *   npm run open              -> opens the configured portal (or a blank tab)
 *   npm run open -- <url>     -> opens that url instead
 *   npm run open -- --no-login -> skips the automatic sign-in
 */
import { attachBrowser, openBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';
import { writeFileSync } from 'node:fs';
import { CONFIG_PATH } from '../src/config.js';
import { isLoggedIn, login, logoff } from '../src/session.js';
import { comaxCredentials } from '../src/env.js';

const logger = new RunLogger('open');

// Reuse the window that is already up. Launching a second one would sign in a
// second time against a user code that only has one seat, and Comax then
// refuses both — which reads as a flaky connection but is self-inflicted.
const existing = await attachBrowser({ logger });
if (existing) {
  logger.step('info', 'חלון סוכן כבר פתוח — מתחבר אליו במקום לפתוח עוד אחד');
}
const { context, page, human, cfg } = existing ?? (await openBrowser({ logger }));

const target = process.argv[2] || cfg.portalUrl || cfg.loginUrl;
const noLogin = process.argv.includes('--no-login');
const alreadyIn = await isLoggedIn(page, cfg);

if (alreadyIn) {
  logger.step('session', 'הסשן כבר פעיל — לא נוגע בו');
} else if (target) {
  await human.goto(target);
} else {
  logger.step('info', 'No portalUrl configured yet - opening a blank tab.');
  logger.step('info', 'Navigate to Comax in the window, log in, then come back here.');
}

// Sign in automatically when .env holds credentials. The file is written by
// hand and never read into the conversation — the password is typed straight
// from disk into the field and is not written to the run log.
let signedIn = alreadyIn;
if (alreadyIn) {
  // nothing to do
} else if (!noLogin && comaxCredentials()) {
  try {
    signedIn = await login({ page, human, logger, cfg });
  } catch (e) {
    logger.step('login', `ההתחברות האוטומטית נכשלה: ${e.message}`);
  }
} else if (!noLogin) {
  logger.step('login', 'אין .env — התחברות ידנית');
}

console.log('\n─────────────────────────────────────────────────────────────');
if (signedIn) {
  console.log('  מחובר. חלון הסוכן מוכן לעבודה.');
} else {
  console.log('  חלון הסוכן פתוח. תתחבר לקומקס ותשאיר אותו פתוח.');
  console.log('  להתחברות אוטומטית: צור קובץ .env לפי .env.example');
}
console.log('  Ctrl+C כאן כדי לסגור.');
console.log('─────────────────────────────────────────────────────────────\n');

// Report the current URL whenever it changes, so we can capture the portal URL.
let last = '';
const timer = setInterval(async () => {
  try {
    const url = page.url();
    if (url && url !== last && url !== 'about:blank') {
      last = url;
      logger.step('url', url);
    }
  } catch { /* page may be navigating */ }
}, 2000);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(timer);

  // Sign off before closing. Comax holds the user's single seat for a few
  // minutes after a window simply disappears, and the next run is then refused
  // with "קוד משתמש בשימוש". This is the line that keeps the next start clean.
  console.log('\n  מתנתק מקומקס לפני הסגירה...');
  await logoff({ page, human, logger, cfg }).catch(() => {});

  try {
    const url = page.url();
    if (url && url.startsWith('http') && !cfg.portalUrl) {
      const next = { ...cfg, portalUrl: url };
      writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
      logger.step('config', `portalUrl saved: ${url}`);
    }
  } catch { /* ignore */ }
  // Only close a window this process opened. When we attached to one that was
  // already up, closing it would pull the window out from under whoever owns it.
  if (existing) {
    await existing.browser.close().catch(() => {});
  } else {
    await context.close().catch(() => {});
  }
  logger.done();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await new Promise(() => {});
