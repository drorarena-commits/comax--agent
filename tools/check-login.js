/**
 * בודק שההתחברות האוטומטית מוגדרת ועובדת — בלי להציג את הסיסמה.
 *
 *   npm run check-login
 *
 * Reports only whether each field is present and whether the sign-in reached
 * the Max2000 desktop. The password is never printed, logged or returned.
 */
import { comaxCredentials, loadEnv } from '../src/env.js';
import { attachBrowser, openBrowser } from '../src/browser.js';
import { isLoggedIn, login } from '../src/session.js';
import { RunLogger } from '../src/logger.js';

const env = loadEnv();
const has = (k) => (env[k] ? `✓ הוגדר (${String(env[k]).length} תווים)` : '✗ חסר');
console.log('\nקובץ .env:');
console.log(`  COMAX_ORG   ${env.COMAX_ORG ? `✓ ${env.COMAX_ORG}` : '✗ חסר'}`);
console.log(`  COMAX_USER  ${env.COMAX_USER ? `✓ ${env.COMAX_USER}` : '✗ חסר'}`);
console.log(`  COMAX_PASS  ${has('COMAX_PASS')}`);

if (!comaxCredentials()) {
  console.log('\nההתחברות האוטומטית לא פעילה. צור .env לפי .env.example.\n');
  process.exit(1);
}

const logger = new RunLogger('check-login');
const s = (await attachBrowser({ logger })) ?? (await openBrowser({ logger }));

if (await isLoggedIn(s.page, s.cfg)) {
  console.log('\nכבר מחובר — לא ניסיתי להתחבר מחדש.\n');
} else {
  console.log('\nמנסה להתחבר...');
  const ok = await login({ ...s, logger });
  console.log(ok ? '\nההתחברות הצליחה.\n' : '\nההתחברות נכשלה — בדוק את הפרטים ב-.env.\n');
}

if (!s.owned) await s.browser.close().catch(() => {});
logger.done();
