/**
 * שער הסיטונאות — בלי דפדפן, בלי קומקס, בלי המושב.
 *
 * The same shape as `vat-gate.mjs`: the arithmetic that decides how much a
 * customer is charged is worth checking without a live document, because the
 * live document is a tax invoice and there is no unfiling it.
 *
 * The frame is faked at the one seam `readTotals` uses — `frame.evaluate()`
 * returning `{ fields, body }` — so the real `document-totals.js` parser runs,
 * footer regex and all. Stubbing higher would test the stub.
 *
 *   node tools/_smoke/wholesale-gate.mjs
 */
import { resolveWholesale, assertWholesaleLanded } from '../../src/documents/wholesale.js';

const frameWith = ({ footer, fields = {} }) => ({
  evaluate: async () => ({ fields, body: footer }),
});

/** מחירון קבוצות, כפי שהוא מודפס בפוטר — בלי הערת מע"מ, ולכן lists.json מכריע. */
const GROUPS = frameWith({
  footer: 'מחירון קבוצות\t:לפי מחירון\nסה"כ',
  fields: { ScmBeforeMaam: '570', Scm_Maam: '102.6', Scm: '672.6', AczM: '18' },
});

/** מכירה ראשי — המחירון מצהיר על עצמו ככולל מע"מ. */
const MAIN = frameWith({
  footer: ':לפי מחירון\tמכירה ראשי (כולל מע"מ)\nסה"כ',
  fields: { ScmBeforeMaam: '880', Scm_Maam: '158.4', Scm: '1038.4', AczM: '18' },
});

/** תעודת העברה — "לא נבחר", ואין מחירון בכלל. */
const NONE = frameWith({ footer: 'לא נבחר\t:לפי מחירון', fields: {} });

/** מחירון שלא ראינו מעולם — לא בפוטר ולא ב-lists.json. */
const UNKNOWN = frameWith({ footer: 'מחירון ניסוי 9\t:לפי מחירון', fields: { AczM: '18' } });

const logger = { step: () => {} };
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}\n     ${String(e.message).split('\n')[0]}`);
  }
}

const eq = (got, want, what) => {
  if (String(got) !== String(want)) throw new Error(`${what}: ${got} במקום ${want}`);
};

console.log('\n  שער הסיטונאות\n');

await check('מחירון קבוצות ⇒ סיטונאות כברירת מחדל, ברוטו 279.90 ⇒ 140, הנחה מאופסת', async () => {
  const r = await resolveWholesale({ logger, grid: GROUPS, gross: 279.9, item: {} });
  eq(r.price, 140, 'מחיר');
  eq(r.discount, 0, 'הנחה');
  eq(r.plan.mode, 'excluded', 'משטר');
});

await check('הכשל של 6120050: 289.90 ⇒ 145, לא 199.90 שקומקס מציע', async () => {
  const r = await resolveWholesale({ logger, grid: GROUPS, gross: 289.9, item: {} });
  eq(r.price, 145, 'מחיר');
});

await check('מכירה ראשי אינו מחירון סיטונאי — בלי דגל מפורש לא נוגעים בשורה', async () => {
  const r = await resolveWholesale({ logger, grid: MAIN, gross: 289.9, item: {} });
  if (r.plan) throw new Error('סיטונאות הוחלה על מחירון שלא מסומן wholesale');
});

await check('סיטונאות מפורשת על מחירון כולל מע"מ ⇒ המחיר נשאר, ההנחה עושה את העבודה (40.98%)', async () => {
  const r = await resolveWholesale({ logger, grid: MAIN, gross: 289.9, item: { wholesale: true } });
  eq(r.price, undefined, 'מחיר');
  eq(r.discount, 40.98, 'הנחה');
  eq(r.plan.mode, 'included', 'משטר');
});

await check('מחיר מפורש גובר — אין נגיעה בסיטונאות', async () => {
  const r = await resolveWholesale({ logger, grid: GROUPS, gross: 279.9, item: { price: 99 } });
  eq(r.price, 99, 'מחיר');
  if (r.plan) throw new Error('נבנתה תוכנית סיטונאית למרות מחיר מפורש');
});

await check('wholesale: false מבטל גם תחת מחירון קבוצות', async () => {
  const r = await resolveWholesale({ logger, grid: GROUPS, gross: 279.9, item: { wholesale: false } });
  if (r.plan) throw new Error('הסיטונאות לא בוטלה');
});

await check('תעודת העברה ("לא נבחר") ⇒ אין סיטונאות, השורה נשארת כפי שהיא', async () => {
  const r = await resolveWholesale({ logger, grid: NONE, gross: 0, item: { qty: 6 } });
  if (r.plan) throw new Error('סיטונאות הוחלה על מסמך בלי מחירון');
});

await check('מחירון לא ידוע ⇒ סירוב, לא ניחוש (כלל 9)', async () => {
  let threw = false;
  try {
    await resolveWholesale({ logger, grid: UNKNOWN, gross: 279.9, item: { wholesale: true } });
  } catch (e) {
    threw = /כולל מע/.test(e.message);
  }
  if (!threw) throw new Error('לא סירב על מחירון שמשטר המע"מ שלו לא ידוע');
});

await check('סיטונאות מבוקשת בלי ברוטו ⇒ סירוב', async () => {
  let threw = false;
  try {
    await resolveWholesale({ logger, grid: GROUPS, gross: null, item: { wholesale: true } });
  } catch { threw = true; }
  if (!threw) throw new Error('לא סירב בלי ברוטו');
});

await check('הקריאה-בחזרה תופסת הנחה שקומקס החזיר', async () => {
  const plan = { mode: 'excluded', rate: 18, gross: 279.9, target: 140 };
  assertWholesaleLanded(plan, { price: '140.00', discount: '0' }); // נחת
  let threw = false;
  try {
    assertWholesaleLanded(plan, { price: '140.00', discount: '17.25' }); // ההנחה חזרה
  } catch { threw = true; }
  if (!threw) throw new Error('הנחה שהוחזרה עברה בשקט');
});

await check('הקריאה-בחזרה תופסת מחיר חצוי שנכתב למחירון כולל מע"מ', async () => {
  const plan = { mode: 'included', rate: 18, gross: 289.9, target: 145 };
  let threw = false;
  try {
    assertWholesaleLanded(plan, { price: '145.00', discount: '0' }); // נטו 122.88
  } catch { threw = true; }
  if (!threw) throw new Error('הכשל של ה-15% עבר בשקט');
});

console.log(failed ? `\n  ${failed} נכשלו\n` : '\n  הכל עבר\n');
process.exit(failed ? 1 : 0);
