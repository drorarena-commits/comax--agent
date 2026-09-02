/**
 * Exercises the gates in the transfer agent against a fake lines frame.
 * No browser, no Comax — just the shapes the gate has to tell apart.
 *
 *   node tools/_smoke/stock-gate.mjs
 *
 * The stock figures come from the real export in `content/`, so a refreshed
 * export can change what "enough" means. The codes below are picked to be far
 * from the boundary in both directions.
 */
import * as transfer from '../../src/documents/agents/transfer/index.js';

const IN_STOCK = '3468337082118'; // ראשי: 62 at the time of writing
const NOT_IN_EXPORT = '0000000000000';

/**
 * A stand-in for Doc470LinesV. Only the four reads the agent actually makes
 * are implemented: the two totals as inputs, and the four warehouse spans plus
 * `#DocId` as text.
 */
const fakeCtx = ({ from = 'ראשי', fromCode = '1', to = 'מחסן קבוצות', toCode = '11', quantity = '6.00', total = '' }) => {
  const text = {
    '#wrkStore': from, '#wrkStoreKod': fromCode,
    '#wrkStoreTo': to, '#wrkStoreKodTo': toCode,
    '#DocId': '4700239',
  };
  const values = { '#Scm_Cmt': quantity, '#ScmBeforeDis': total };
  const frame = {
    url: () => 'https://x/Erp/Mlay/TeydatAv/Doc/Doc470LinesV.asp',
    locator: (sel) => ({
      innerText: async () => text[sel] ?? null,
      inputValue: async () => values[sel] ?? null,
    }),
  };
  const steps = [];
  return {
    steps,
    ctx: {
      page: { frames: () => [frame] },
      logger: { step: (k, d) => steps.push(`${k}: ${d}`), save: () => {}, shot: async () => {} },
      human: {},
    },
  };
};

const cases = [
  {
    name: '1. ראשי → קבוצות, יש מלאי — עובר',
    screen: {},
    args: { items: [{ code: IN_STOCK, qty: 6 }] },
    expect: 'pass',
  },
  {
    name: '2. הקוד חוזר מקומקס כ"קוד - שם" — עדיין מזוהה',
    screen: {},
    args: { lines: [{ item: `${IN_STOCK} - משקפת קוברה אולטרה סוויפ מראה`, qty: '6.00' }] },
    expect: 'pass',
  },
  {
    name: '3. מבקש יותר ממה שיש בראשי — מסרב',
    screen: { quantity: '9999.00' },
    args: { items: [{ code: IN_STOCK, qty: 9999 }] },
    expect: 'throw',
  },
  {
    name: '4. פריט שלא בייצוא — לא ידוע, ולכן מסרב',
    screen: {},
    args: { items: [{ code: NOT_IN_EXPORT, qty: 1 }] },
    expect: 'throw',
  },
  {
    name: '5. מקור שהייצוא לא מכסה (קבוצות) — מסרב',
    screen: { from: 'מחסן קבוצות', fromCode: '11', to: 'ראשי', toCode: '1' },
    args: { items: [{ code: IN_STOCK, qty: 6 }] },
    expect: 'throw',
  },
  {
    name: '6. allowShort על אותו מקור לא מכוסה — עובר במפורש',
    screen: { from: 'מחסן קבוצות', fromCode: '11', to: 'ראשי', toCode: '1' },
    args: { items: [{ code: IN_STOCK, qty: 6 }], allowShort: true },
    expect: 'pass',
  },
  {
    name: '7. ממחסן == למחסן — מסרב על הכיוון',
    screen: { to: 'ראשי', toCode: '1' },
    args: { items: [{ code: IN_STOCK, qty: 6 }], expect: { storeFrom: 'ראשי', storeTo: 'ראשי' } },
    expect: 'throw',
  },
  {
    name: '8. הכיוון על המסך אינו הכיוון שהתבקש — מסרב',
    screen: {},
    args: { items: [{ code: IN_STOCK, qty: 6 }], expect: { storeFrom: 'ראשי', storeTo: 'רמת גן' } },
    expect: 'throw',
  },
  {
    name: '9. סה"כ כמות 0 — תעודה שלא מזיזה כלום, מסרב',
    screen: { quantity: '0.00' },
    args: { items: [{ code: IN_STOCK, qty: 6 }] },
    expect: 'throw',
  },
];

let failed = 0;
for (const c of cases) {
  const { ctx, steps } = fakeCtx(c.screen);
  let got;
  let msg = '';
  try {
    // The refusal cases run with confirm:true on purpose — a gate that only
    // works in dry run is no gate. The passing cases stay dry so the test does
    // not fall through into engine.finalize and its real clicking.
    await transfer.finalize(ctx, { confirm: c.expect === 'throw', ...c.args });
    got = 'pass';
  } catch (e) {
    got = 'throw';
    msg = e.message.split('\n')[0];
  }
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`      ציפינו ${c.expect}, קיבלנו ${got}`);
  if (got === 'throw') console.log(`      סירוב: ${msg}`);
  else console.log(`      ${steps.filter((s) => s.startsWith('מלאי') || s.startsWith('כיוון')).join(' | ') || '(לא נרשם)'}`);
}
console.log(failed ? `\n${failed} נכשלו` : '\nכל התרחישים עברו');
process.exit(failed ? 1 : 0);
