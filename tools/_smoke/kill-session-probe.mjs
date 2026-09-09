/**
 * הניסוי המכריע: להרוג את הסשן בצד השרת **בלי לגעת ב-DOM**, ואז למדוד.
 *
 * זה בדיוק התרחיש שכל התכנון תלוי בו — החלון ממשיך לצייר את ה-frameset הישן
 * בזמן שהשרת כבר שכח מאיתנו. `logoff()` הרגיל מנווט למסך ההתחברות בסוף ולכן
 * הורס את הראיה; כאן שולחים רק את בקשת השחרור (`CloseSession.ashx`, דרך
 * `top.onUnload('fset')`) ונשארים על אותו עמוד.
 *
 * מריצים את אותם probes של liveness-probe.mjs לפני ואחרי, ומשווים.
 *
 * משחרר את המושב שלנו — אפשר להתחבר שוב עם `npm run open`.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { isLoggedIn, navFrame } from '../../src/session.js';

const logger = new RunLogger('kill-session-probe');
const s = await attachBrowser({ logger });
if (!s) {
  console.log('\nאין חלון סוכן פתוח.\n');
  process.exit(1);
}
const { page, cfg } = s;

const M = (p) => `https://www.comax.co.il/Max2000/${p}`;
const CANDIDATES = [
  ['mainNew', M('MainNew_G.asp')],
  ['company', M('Company_G.asp')],
  ['atraa', M('Atraa.asp?FullGraf=5')],
  ['srcMenu', M('srcMenu_click.asp')],
  ['selectHtm', M('System/Select/Select_G.htm')],
];

async function probeAll(tag) {
  let frame;
  try {
    frame = navFrame(page, cfg);
  } catch {
    console.log(`  [${tag}] אין frame S`);
    return {};
  }
  const out = {};
  for (const [key, url] of CANDIDATES) {
    out[key] = await frame
      .evaluate(async (u) => {
        try {
          const res = await fetch(u, { credentials: 'include', redirect: 'follow' });
          const text = await res.text();
          return { status: res.status, finalUrl: res.url, bytes: text.length, sample: text.slice(0, 200) };
        } catch (e) {
          return { error: String(e) };
        }
      }, url)
      .catch((e) => ({ error: String(e) }));
  }
  return out;
}

const before = await probeAll('לפני');
const domBefore = await isLoggedIn(page, cfg);

// ── ההרג ────────────────────────────────────────────────────────────────────
console.log('\nשולח CloseSession.ashx בלי לנווט...');
const released = page
  .waitForResponse((r) => /CloseSession\.ashx/i.test(r.url()), { timeout: 20_000 })
  .then((r) => r.status())
  .catch(() => null);

const fired = await navFrame(page, cfg).evaluate(() => {
  if (typeof top.onUnload !== 'function') return false;
  top.onUnload('fset');
  return true;
});
const status = await released;
console.log(`  onUnload נורה: ${fired} · CloseSession החזיר: ${status ?? 'לא חזר'}`);

await new Promise((r) => setTimeout(r, 3000));

const domAfter = await isLoggedIn(page, cfg);
const after = await probeAll('אחרי');

// ── ההשוואה ─────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────────────────────');
console.log(`  isLoggedIn לפי DOM:  לפני=${domBefore}  אחרי=${domAfter}`);
console.log(`  URL העמוד: ${page.url().slice(0, 100)}`);
console.log('─────────────────────────────────────────────────────────────\n');

for (const [key] of CANDIDATES) {
  const b = before[key] ?? {};
  const a = after[key] ?? {};
  const f = (r) => (r.error ? `שגיאה` : `${r.status}·${r.bytes}B`);
  const changed = b.bytes !== a.bytes || b.finalUrl !== a.finalUrl;
  console.log(`  ${key.padEnd(12)} לפני ${f(b).padEnd(14)} אחרי ${f(a).padEnd(14)} ${changed ? '⇐ השתנה' : 'זהה'}`);
  if (changed && a.finalUrl) console.log(`      → ${a.finalUrl.slice(0, 110)}`);
}
console.log('');

logger.save('kill-probe.json', { domBefore, domAfter, before, after });
await s.browser.close().catch(() => {});
logger.done();
