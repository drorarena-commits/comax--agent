import { attachBrowser } from '../../src/browser.js';
import { isLoggedIn, sessionInfo } from '../../src/session.js';
const s = await attachBrowser();
if (!s) { console.log('NO WINDOW'); process.exit(1); }
console.log('logged in:', await isLoggedIn(s.page, s.cfg));
console.log(JSON.stringify(await sessionInfo(s.page, s.cfg), null, 2));
await s.browser.close().catch(()=>{});
