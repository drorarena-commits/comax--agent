/**
 * Reads the SOURCE of a JS function inside a program frame, without clicking it.
 *
 * Max2000 toolbar buttons call `top.S.runProgram("<path>.asp?...")`, so reading
 * the handler tells us which screen a button opens — and it costs nothing:
 * no click, no navigation, no document. This is how the a146 path was traced
 * from `AfKadot_onclick` instead of by pressing a button next to `#OKAfk`.
 *
 *   node tools/_smoke/read-fn.mjs "KabalaV" AfKadot_onclick OKAfk_onclick
 *
 * With no function names it lists every global function whose name ends with
 * _onclick, which is the map of the whole toolbar.
 */
import { attachBrowser } from '../../src/browser.js';
import { framePath } from '../../src/navigate.js';

const pattern = process.argv[2];
const names = process.argv.slice(3);

if (!pattern) {
  console.log('שימוש:  node tools/_smoke/read-fn.mjs "<regex של ה-frame>" [שם פונקציה ...]');
  process.exit(1);
}

const s = await attachBrowser();
if (!s) { console.log('אין חלון פתוח. תריץ קודם:  npm run open'); process.exit(1); }

const re = new RegExp(pattern, 'i');
// Match on the path only. The query string of a Max2000 frame carries FromFrame,
// DocId and friends, and matching against it turns an exact pattern into a
// coin flip.
const frames = s.page.frames().filter((f) => re.test(framePath(f.url())));

if (!frames.length) {
  console.log(`אין frame שמתאים ל-/${pattern}/. ה-frames הפתוחים:`);
  for (const f of s.page.frames()) console.log(`  ${(f.name() || '(anon)').padEnd(10)} ${framePath(f.url())}`);
  await s.browser.close().catch(() => {});
  process.exit(1);
}

for (const frame of frames) {
  console.log(`\n── frame "${frame.name() || '(anon)'}"  ${frame.url()}\n`);

  if (!names.length) {
    const handlers = await frame.evaluate(() =>
      Object.getOwnPropertyNames(window)
        .filter((k) => /_onclick$/i.test(k) && typeof window[k] === 'function')
        .sort());
    console.log(handlers.length
      ? `${handlers.length} handlers:\n  ${handlers.join('\n  ')}`
      : 'אין handlers גלובליים בשם *_onclick ב-frame הזה.');
    continue;
  }

  for (const name of names) {
    const src = await frame.evaluate((n) => {
      const fn = window[n];
      return typeof fn === 'function' ? fn.toString() : null;
    }, name);
    console.log(src === null ? `${name}: לא קיים ב-frame הזה` : `${name}:\n${src}\n`);
  }
}

await s.browser.close().catch(() => {});
