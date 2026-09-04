/**
 * מה באמת יושב על שולחן העבודה של קומקס כרגע.
 *
 *   node tools/_smoke/desktop-probe.mjs
 *   node tools/_smoke/desktop-probe.mjs a157 a132
 *
 * קומקס מסדר מחדש את השולחן בלי להודיע, ואייקון שנעלם נראה בדיוק כמו תוכנית
 * שנכשלת להיפתח. נמדד 04/09/2026: מתוך 51 אייקונים, `a157` פשוט לא היה שם.
 *
 * הכלי משווה את `knowledge/desktop-shortcuts.json` מול המצב החי ואומר מי חסר —
 * לכל קיצור חסר צריך נתיב `program` בקריאה ל-openProgram.
 */
import { attachBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { navFrame } from '../../src/session.js';
import { showDesktop, shortcuts } from '../../src/navigate.js';

const logger = new RunLogger('desktop-probe');
const s = await attachBrowser({ logger });
if (!s) {
  console.log('\nאין חלון סוכן פתוח. הרץ `npm run ensure`.\n');
  process.exit(1);
}

await showDesktop({ ...s, logger });
const nav = navFrame(s.page, s.cfg);

const live = await nav.evaluate(() =>
  [...document.querySelectorAll('a')]
    .map((a) => ({ id: a.id || null, text: (a.innerText || '').trim() }))
    .filter((a) => a.text),
);
const liveIds = new Set(live.map((a) => a.id).filter(Boolean));

console.log(`\nאייקונים בשולחן כרגע: ${live.length}\n`);

const asked = process.argv.slice(2);
// shortcuts() מחזיר את הקובץ כולו — הרשימה עצמה יושבת תחת `shortcuts`.
const catalog = shortcuts().shortcuts ?? [];
const rows = asked.length ? catalog.filter((c) => asked.includes(c.id)) : catalog;

const missing = [];
for (const c of rows) {
  const there = liveIds.has(c.id);
  if (!there) missing.push(c);
  if (asked.length || !there) console.log(`  ${there ? '✅' : '❌'} ${String(c.id).padEnd(6)} ${c.label}`);
}

console.log(`\nמתוך ${rows.length} קיצורים בקטלוג: ${rows.length - missing.length} קיימים, ${missing.length} חסרים.`);
if (missing.length) {
  console.log('\nלחסרים צריך נתיב חלופי (`program`) בקריאה ל-openProgram:');
  for (const c of missing) console.log(`  ${c.id} — ${c.label}`);
}

await s.browser.close().catch(() => {});
logger.done();
