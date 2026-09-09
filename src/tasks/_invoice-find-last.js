/**
 * זמני, קריאה בלבד — מוצא את החשבונית האחרונה של לקוח.
 * מנקה את כל תיבות הסינון (הן מצטברות), מסנן לפי קוד הלקוח, ומדפדף על כל
 * העמודים (10 שורות בעמוד) לפני שהוא מכריז מי האחרונה.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';

export const meta = {
  name: '_invoice-find-last',
  description: 'החשבונית האחרונה של לקוח — קריאה בלבד',
  writes: false,
  input: { customer: 'string — קוד לקוח' },
};

const readPage = (frame) => frame.evaluate(() => {
  const txt = (c) => (c.innerText || '').replace(/\s+/g, ' ').trim();
  for (const t of [...document.querySelectorAll('table')]) {
    const rows = [...t.rows].map((tr) => [...tr.cells].map(txt));
    const hi = rows.findIndex((r) => r.includes('שם לקוח'));
    if (hi < 0) continue;
    const head = rows[hi];
    const at = (l) => head.indexOf(l);
    const dc = [ 'חשבונית', 'מסמך', 'תעודה' ].map(at).find((i) => i >= 0);
    if (dc === undefined) continue;
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      const docNo = r[dc];
      if (!docNo || !/^\d+$/.test(docNo)) continue;
      out.push({
        docNo,
        date: at('מתאריך') >= 0 ? r[at('מתאריך')] : '',
        customer: at('שם לקוח') >= 0 ? r[at('שם לקוח')] : '',
        code: at('לקוח') >= 0 ? r[at('לקוח')] : '',
        amount: at('סכום') >= 0 ? r[at('סכום')] : '',
        store: at('מחסן') >= 0 ? r[at('מחסן')] : '',
      });
    }
    return { head, rows: out };
  }
  return { head: [], rows: [] };
});

export async function run(ctx) {
  const { page, human, logger, cfg, input } = ctx;
  if (!input.customer) throw new Error('חסר customer');

  await ensureLoggedIn({ page, human, logger, cfg });
  const { frame: list } = await openProgram(ctx, 'a157', { expect: /Doc650V\.asp/i });
  const year = (/[?&]CurrYear=(\d{4})/i.exec(list.url()) ?? [])[1] ?? null;

  for (const sel of ['#wFindDocNo', '#wFindDateM', '#wFindDateA']) {
    await list.locator(sel).fill('').catch(() => {});
  }
  await human.type('#wFindLkNm', String(input.customer), { scope: list, label: `סינון ללקוח ${input.customer}`, clear: true });
  await human.press('Enter', { label: 'החלת הסינון' });
  await human.settle('filtered');

  const seen = new Map();
  await list.locator('#first').click().catch(() => {});
  await human.settle('page 1');
  for (let p = 0; p < 20; p++) {
    const { rows } = await readPage(list);
    const before = seen.size;
    for (const r of rows) seen.set(r.docNo, r);
    logger.step('page', `עמוד ${p + 1}: ${rows.length} שורות (סה"כ ${seen.size})`);
    if (rows.length < 10 || seen.size === before) break;
    const next = list.locator('#next');
    if (!(await next.count().catch(() => 0))) break;
    await next.click().catch(() => {});
    await human.settle(`page ${p + 2}`);
  }

  const key = (d) => String(d).split('/').reverse().join('');
  const all = [...seen.values()].sort((a, b) => key(b.date).localeCompare(key(a.date)) || Number(b.docNo) - Number(a.docNo));
  await logger.shot(page, 'filtered-list');

  console.log(`\n════ חשבוניות ללקוח ${input.customer} · שנת כספים ${year ?? 'לא נקראה'} ════`);
  for (const r of all) console.log(`   ${r.docNo}  ${r.date}  ${r.code}  ${r.customer}  ${r.amount}  ${r.store}`);
  if (!all.length) console.log('   אין שורות.');
  console.log(`\nJSON ${JSON.stringify({ year, count: all.length, last: all[0] ?? null })}`);
  return { year, rows: all, last: all[0] ?? null };
}
