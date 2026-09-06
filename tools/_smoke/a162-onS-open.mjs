/** Opens the report's e-mail envelope (onSend) WITHOUT sending anything. */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
const logger = new RunLogger('a162-onS-open');
const s = await attachBrowser({ logger });
const f = s.page.frames().find((x) => (x.url() || '').includes('ShowDoc_Prog_G'));
if (!f) { console.log('הצופה לא פתוח'); process.exit(1); }
const vars = await f.evaluate(() => ({
  SwHtml: typeof SwHtml !== 'undefined' ? SwHtml : null,
  arrCount: typeof arrCount !== 'undefined' ? arrCount : null,
  FrameName: typeof FrameName !== 'undefined' ? FrameName : null,
}));
console.log('משתנים:', JSON.stringify(vars));
const before = new Set(s.page.frames().map((x) => x.url()));
await f.evaluate(() => onSend());
await s.page.waitForTimeout(6000);
console.log('\n--- frames חדשים ---');
for (const fr of s.page.frames()) {
  const u = fr.url() || '';
  if (!before.has(u)) console.log(`${fr.name() || '(anon)'}  ${u.slice(0, 200)}`);
}
await logger.shot(s.page, 'onS');
await s.browser.close().catch(() => {});
logger.done();
