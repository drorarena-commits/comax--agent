/**
 * מאפס טיוטת חשבונית — מוחק את כל שורותיה ומשאיר אותה ריקה.
 *
 * למה זו משימה: טיוטה נתפסת מחדש **עם שורותיה** (כלל 15), וכל יבוא או הזנה
 * מוסיפים עליהן. טיוטה מלוכלכת שנשארת מאחור היא מלכודת לפעם הבאה — נמדד
 * 11/09/2026: 290.00 הפכו ל-580.00 בהרצה שנייה, בלי שגיאה.
 *
 * ⛔ **לא קולטת ולא מוחקת את המסמך עצמו.** רק את השורות; המספר והכותרת
 * נשארים, והמסמך נשאר טיוטה.
 */
import { ensureLoggedIn } from '../session.js';
import * as registry from '../documents/registry.js';
import { openList, startNew, fillHeader, readHeader, commitHeader, readDocNumber, readTotals } from '../documents/engine.js';
import { resetLines } from './invoice-import-lines.js';

export const meta = {
  name: 'invoice-reset',
  description: 'מוחק את כל שורות טיוטת החשבונית של לקוח ומשאיר אותה ריקה',
  writes: true,
  input: {
    customer: 'string — קוד הלקוח שהטיוטה שלו תאופס. חובה',
  },
  precheck(input) {
    if (!input.customer) return 'חסר customer — של איזה לקוח לאפס את הטיוטה?';
    return null;
  },
};

export async function run(ctx) {
  const { page, human, logger, cfg, input } = ctx;

  const agent = registry.get('חשבונית מס');
  registry.assertReady(agent);
  const profile = agent.profile;

  await ensureLoggedIn({ page, human, logger, cfg });
  const list = await openList(ctx, profile);
  const { frame: header } = await startNew(ctx, profile, list);
  await fillHeader(ctx, profile, header, { customer: input.customer });
  const head = await readHeader(profile, header);
  await commitHeader(ctx, profile, header);
  const docNo = await readDocNumber(ctx, profile);

  const grid = page.frames().find((f) => /Doc650LinesV/i.test(f.url()));
  if (!grid) throw new Error('frame השורות לא נמצא.');

  const before = await readTotals(ctx, profile).catch(() => null);
  const had = Number(String(before?.total ?? '0').replace(/,/g, '')) || 0;
  logger.step('before', `מסמך ${docNo} — סה"כ ${before?.total ?? '(לא נקרא)'}`);

  if (had === 0) {
    console.log(`\n  מסמך ${docNo} כבר ריק — לא נעשה דבר.\n`);
    return { docNo, customer: input.customer, had: 0, reset: false };
  }

  await resetLines(ctx, profile, grid);
  await logger.shot(page, 'after-reset');
  console.log(`\n  מסמך ${docNo}: ${before.total} ⇒ 0.00. הטיוטה ריקה.\n`);
  return { docNo, customer: input.customer, header: head, had, reset: true };
}
