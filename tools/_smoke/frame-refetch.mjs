/**
 * סורק את כל ה-frames החיים ומבקש מחדש את הכתובת של כל אחד מהם.
 *
 *   node tools/_smoke/frame-refetch.mjs dead
 *   node tools/_smoke/frame-refetch.mjs live
 *
 * הרקע: הסבב הראשון של המדידה נכשל. חמישה דפי ASP שנבחרו בניחוש החזירו תשובה
 * **זהה בייט** על סשן חי ועל סשן שנהרג בוודאות (CloseSession.ashx החזיר 200) —
 * כלומר הם לא נוגעים בסשן בכלל. במקום לנחש עוד, הסקריפט הזה לוקח את הכתובות
 * האמיתיות של כל frame בפריים-סט, כולל הפרמטרים שקומקס עצמו בנה, ומודד את כולן.
 *
 * הרצה אחת על סשן מת, הרצה אחת על סשן חי, ואז diff. כל כתובת שהתשובה שלה שונה
 * בין השתיים היא מועמדת לבדיקת חיות; כל השאר חסרות תועלת.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { isLoggedIn, navFrame } from '../../src/session.js';
import { ROOT } from '../../src/config.js';

const label = process.argv[2] ?? 'run';
const logger = new RunLogger(`frame-refetch-${label}`);
const s = await attachBrowser({ logger });
if (!s) {
  console.log('\nאין חלון סוכן פתוח.\n');
  process.exit(1);
}
const { page, cfg } = s;

let frame;
try {
  frame = navFrame(page, cfg);
} catch {
  console.log('\nאין frame S — לא בתוך האפליקציה.\n');
  process.exit(1);
}

// כתובות ייחודיות של frames אמיתיים, בלי Blank ובלי about:blank.
const urls = [
  ...new Set(
    page
      .frames()
      .map((f) => f.url())
      .filter((u) => u && u.startsWith('http') && !/Blank/i.test(u)),
  ),
];

console.log(`\nisLoggedIn לפי DOM: ${await isLoggedIn(page, cfg)}`);
console.log(`נבדקות ${urls.length} כתובות\n`);

const results = {};
for (const url of urls) {
  results[url] = await frame
    .evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'include', redirect: 'follow' });
        const text = await res.text();
        return { status: res.status, finalUrl: res.url, bytes: text.length, sample: text.slice(0, 250) };
      } catch (e) {
        return { error: String(e) };
      }
    }, url)
    .catch((e) => ({ error: String(e) }));

  const r = results[url];
  const short = url.replace('https://www.comax.co.il/Max2000/', '').slice(0, 70);
  console.log(`  ${r.error ? 'שגיאה' : `${r.status} ${String(r.bytes).padStart(7)}B`}  ${short}`);
}

const out = resolve(ROOT, 'runs', `frame-refetch-${label}.json`);
writeFileSync(out, JSON.stringify(results, null, 2), 'utf8');
console.log(`\nנשמר: ${out}\n`);

await s.browser.close().catch(() => {});
logger.done();
