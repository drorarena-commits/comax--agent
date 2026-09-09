import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { login, isLoggedIn } from '../../src/session.js';
const logger = new RunLogger('relogin');
const s = await attachBrowser({ logger });
if (!s) { console.log('אין חלון'); process.exit(1); }
// כפוי: ה-DOM משקר, אז לא שואלים אותו — הולכים ישר למסך ההתחברות.
await s.human.goto(s.cfg.loginUrl);
const ok = await login({ ...s, logger });
console.log('התחברות:', ok, '| isLoggedIn:', await isLoggedIn(s.page, s.cfg));
await s.browser.close().catch(()=>{});
logger.done();
