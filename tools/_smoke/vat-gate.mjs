/**
 * Exercises the VAT gate in the invoice agent against a fake lines frame.
 * No browser, no Comax — just the five shapes the gate has to tell apart.
 *
 *   node tools/_smoke/vat-gate.mjs
 */
import * as invoice from '../../src/documents/agents/invoice/index.js';

const fakeCtx = (fields, body) => {
  const frame = {
    url: () => 'https://x/Erp/Mehirot/Doc650/Inv_Mlay/Doc650LinesV.aspx',
    evaluate: async () => ({ fields, body }),
  };
  const steps = [];
  return {
    steps,
    ctx: {
      page: { frames: () => [frame] },
      logger: {
        step: (k, d) => steps.push(`${k}: ${d}`),
        save: () => {},
        shot: async () => {},
      },
      human: {},
    },
  };
};

const FOOTER_INCL = 'סה"כ\nלפי מחירון: מכירה ראשי (כולל מע\'\'מ)\nמשהו';
const FOOTER_PLAIN = 'סה"כ\nמחירון קבוצות\t:לפי מחירון\nמשהו';
const FOOTER_NONE = 'סה"כ\nאין כאן שום הצהרה\n';

const cases = [
  {
    name: '1. מחירון קבוצות — שורות לפני מע"מ, אין הצהרה בפוטר',
    fields: { ScmBeforeMaam: '570.34', Scm_Maam: '102.66', Scm: '673.00', AczM: '18.00' },
    body: FOOTER_PLAIN,
    lines: [{ amount: '570.00' }],
    expect: 'excluded',
  },
  {
    name: '2. מכירה ראשי (כולל מע"מ) — שורות כוללות, שני העדים מסכימים',
    fields: { ScmBeforeMaam: '879.78', Scm_Maam: '158.36', Scm: '1038.14', AczM: '18.00' },
    body: FOOTER_INCL,
    lines: [{ amount: '1,038.14' }],
    expect: 'included',
  },
  {
    name: '3. סתירה — הפוטר אומר "כולל", הסכומים אומרים "לפני" (צורת 6120045)',
    fields: { ScmBeforeMaam: '145.00', Scm_Maam: '26.10', Scm: '171.10', AczM: '18.00' },
    body: FOOTER_INCL,
    lines: [{ amount: '145.00' }],
    expect: 'throw',
  },
  {
    name: '4. לא ידוע — אין הצהרה, והשורות לא נופלות על אף צד',
    fields: { ScmBeforeMaam: '500.00', Scm_Maam: '90.00', Scm: '590.00', AczM: '18.00' },
    body: FOOTER_NONE,
    lines: [{ amount: '123.45' }],
    expect: 'throw',
  },
  {
    name: '5. סה"כ לא נקרא — נופל עוד לפני שאלת המע"מ',
    fields: { ScmBeforeMaam: '570.34' },
    body: FOOTER_PLAIN,
    lines: [{ amount: '570.00' }],
    expect: 'throw',
  },
];

let failed = 0;
for (const c of cases) {
  const { ctx, steps } = fakeCtx(c.fields, c.body);
  let got;
  try {
    // The refusal cases run with confirm:true on purpose — a gate that only
    // works in dry run is no gate. The passing cases stay dry so the test does
    // not fall through into engine.finalize and its real clicking.
    const r = await invoice.finalize(ctx, { confirm: c.expect === 'throw', lines: c.lines });
    got = r.vat.mode;
  } catch (e) {
    got = 'throw';
    var msg = e.message.split('\n')[0];
  }
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`      ציפינו ${c.expect}, קיבלנו ${got}`);
  if (got === 'throw') console.log(`      סירוב: ${msg}`);
  else console.log(`      ${steps.filter((s) => s.startsWith('מע"מ')).join(' | ') || '(לא נרשם משטר)'}`);
}
console.log(failed ? `\n${failed} נכשלו` : '\nכל התרחישים עברו');
process.exit(failed ? 1 : 0);
