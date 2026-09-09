/**
 * קריאה בלבד: מריץ a162 לחודש/ים ושומר את שורות הדוח כ-JSON, לפי תאי <td>.
 *
 *   node tools/_smoke/a162-shifts.mjs 07/2026 08/2026
 *
 * למה <td> ולא innerText: עמודת אחוזים ריקה נעלמת ב-innerText, ולכן 0.07 ב-125%
 * ו-0.07 ב-150% מפיקים טקסט זהה. קוראים תא לפי אינדקס.
 * לא שולח מייל, לא מפיק PDF, לא כותב שום דבר בקומקס.
 */
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openBrowser } from '../../src/browser.js';
import { RunLogger } from '../../src/logger.js';
import { ensureLoggedIn, logoff } from '../../src/session.js';
import { openProgram, closePrograms } from '../../src/navigate.js';
import { acquire, busyMessage } from '../../src/lock.js';
import { ROOT } from '../../src/config.js';

const months = process.argv.slice(2).filter((a) => /^\d{2}\/\d{4}$/.test(a));
if (!months.length) { console.error('שימוש: node tools/_smoke/a162-shifts.mjs MM/YYYY [MM/YYYY]'); process.exit(1); }

const logger = new RunLogger('a162-shifts');
const lock = await acquire('a162-shifts', { waitMs: 60_000 });
if (!lock.ok) { console.error(`\n${busyMessage(lock.holder)}\n`); process.exit(1); }

let session = null;
const fail = async (msg) => {
  console.error(`\n⛔ ${msg}`);
  logger.step('fail', msg);
  if (session) {
    await closePrograms({ ...session, logger }).catch(() => {});
    await logoff({ ...session, logger }).catch(() => {});
    await session.context.close().catch(() => {});
  }
  lock.release();
  logger.done();
  process.exit(1);
};

try {
  session = await openBrowser({ logger });
  const { page, human } = session;
  await ensureLoggedIn({ ...session, logger });
  await closePrograms({ ...session, logger }).catch(() => {});

  const prog = () => page.frames().find((f) => (f.url() || '').includes('Hr_WorkTeken_HtmlP.aspx'));
  const ctrl = () => page.frames().find((f) => (f.url() || '').includes('Rpt_DafHtml_G'));
  const body = () => page.frames().find((f) => (f.url() || '').includes('ReadFile_HtmlP'));

  const dir = resolve(ROOT, 'runs', 'a162');
  mkdirSync(dir, { recursive: true });

  for (const month of months) {
    console.log(`\n================ ${month} ================`);
    await openProgram({ ...session, logger }, 'a162');
    for (let w = 0; w < 30_000 && !prog(); w += 1000) await page.waitForTimeout(1000);
    if (!prog()) await fail('a162 לא נפתח');

    const before = await prog().evaluate(() => document.getElementById('DMA')?.value);
    console.log(`#DMA לפני: ${before}`);
    await human.click('#Shonot', { scope: prog(), label: 'לשונית שונות' });
    await human.think('tab switch');
    await human.type('#DMA', month, { scope: prog(), label: `חודש = ${month}` });
    const after = await prog().evaluate(() => document.getElementById('DMA')?.value);
    if (after !== month) await fail(`החודש לא נתפס: ביקשנו ${month}, במסך ${after}`);
    console.log(`#DMA אחרי: ${after}`);

    // מצב המסננים, לתיעוד — קריאה בלבד, לא משנים כלום
    const filters = await prog().evaluate(() => {
      const v = (id) => { const e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : null; };
      return { SwLoHaserot: v('SwLoHaserot'), SwNotAfsakaShabaton: v('SwNotAfsakaShabaton'), SwAfsaka: v('SwAfsaka'), SwPail: v('SwPail'), SwUsersCompany: v('SwUsersCompany'), OvedM: v('OvedM'), OvedA: v('OvedA') };
    });
    console.log('מסננים:', JSON.stringify(filters));

    await human.click('#OK', { scope: prog(), label: 'הרצת הדוח' });
    await human.settle('report running');
    await human.think('report');
    for (let w = 0; w < 90_000 && !(ctrl() && body()); w += 1500) await page.waitForTimeout(1500);
    if (!ctrl() || !body()) await fail('הצופה לא נפתח');

    const pages = await ctrl().evaluate(() => (typeof MaxPages !== 'undefined' ? MaxPages : null));
    const data = await body().evaluate(() => ({
      text: (document.body.innerText || '').replace(/[ \t]+/g, ' ').trim(),
      rows: [...document.querySelectorAll('tr')].map((tr) =>
        [...tr.children].map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim())),
    }));

    const shownMonth = (data.text.match(/לחודש:\s*(\d{2}\/\d{4})/) || [])[1];
    const heads = [...data.text.matchAll(/פרוט לפי תקן:\s*(.+?)\s*\((\d+)\)/g)].map((m) => `${m[1]} (${m[2]})`);
    if (shownMonth !== month) await fail(`הדוח מציג "${shownMonth}" ולא ${month}`);
    if (pages !== heads.length) await fail(`${pages} עמודים מול ${heads.length} כותרות עובד`);
    console.log(`לחודש (מגוף הדוח): ${shownMonth} · MaxPages=${pages} · עובדים: ${heads.join(' | ')}`);

    const out = resolve(dir, `a162-${month.replace('/', '-')}.json`);
    writeFileSync(out, JSON.stringify({ month, shownMonth, pages, heads, filters, ...data }, null, 1), 'utf8');
    console.log(`נשמר: ${out}  (${data.rows.length} שורות טבלה)`);

    await closePrograms({ ...session, logger }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  await closePrograms({ ...session, logger }).catch(() => {});
  await logoff({ ...session, logger }).catch(() => {});
  await session.context.close().catch(() => {});
  lock.release();
  logger.done();
  console.log('\nהסתיים. המושב שוחרר והחלון נסגר.');
} catch (e) {
  await fail(e.stack || e.message);
}
