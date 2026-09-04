/**
 * משחרר את הסשן בקומקס — התנתקות מסודרת דרך הכפתור של המערכת.
 *
 *   npm run logoff
 *
 * Comax gives the user code a single seat. Closing the window does not give it
 * back: the server keeps holding the session for a few minutes and refuses the
 * next login with "קוד משתמש בשימוש". Run this when a window was killed and the
 * next start is being turned away.
 */
import { attachBrowser } from '../src/browser.js';
import { RunLogger } from '../src/logger.js';
import { isLoggedIn, logoff } from '../src/session.js';
import { acquire, busyMessage } from '../src/lock.js';

const logger = new RunLogger('logoff');

// לוקח את אותה נעילה כמו משימה רגילה. בלי זה, התנתקות ידנית מהמחשב הייתה
// מושכת את המושב מתחת למשימה שרצה מהאייפון — בדיוק תרחיש "שני מחשבים".
const lock = await acquire('logoff', { waitMs: 10_000 });
if (!lock.ok) {
  console.error(`\n${busyMessage(lock.holder)}\n`);
  logger.done('failed');
  process.exit(1);
}
process.on('exit', () => lock.release());

const s = await attachBrowser({ logger });

if (!s) {
  console.log('\nאין חלון סוכן פתוח — אין ממה להתנתק.');
  console.log('אם קומקס עדיין אומר "קוד משתמש בשימוש", הסשן תקוע בשרת');
  console.log('ומשתחרר לבד תוך כ-3 דקות.\n');
  process.exit(0);
}

if (!(await isLoggedIn(s.page, s.cfg))) {
  console.log('\nהחלון פתוח אבל לא מחובר — הסשן כבר משוחרר.\n');
} else {
  const ok = await logoff({ ...s, logger });
  console.log(ok ? '\nהתנתקת. הסשן שוחרר.\n' : '\nההתנתקות לא הושלמה — המתן כ-3 דקות.\n');
}

await s.browser.close().catch(() => {});
logger.done();
