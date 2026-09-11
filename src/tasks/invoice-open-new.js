/**
 * פותח חשבונית מס **חדשה** ומשאיר אותה פתוחה במסך השורות — לצורך לימוד.
 *
 * למה זו משימה נפרדת ולא `document`: `document` מצפה לשורות ומנהל זרימה שלמה
 * עד העצירה שלפני הקליטה. כאן המטרה הפוכה — להגיע למסך השורות **בלי שורה
 * אחת**, ולעצור שם כדי שדרור יצלם את מסלול "יבוא מאקסל" צעד אחר צעד
 * (11/09/2026).
 *
 * ⛔ **לא קולט, ולא נוגע ב-`#OK` של מסך השורות** (כלל 4). היא מפעילה את `#OK`
 * של ה**כותרת** בלבד, דרך `commitHeader`, שמסרב לרוץ על frame שאינו כותרת.
 * היציאה נשארת בידיים של מי שעובד מול המסך: `#DoExit` ואז `#Cancel`, או
 * `npm run run -- invoice-open-new --close`.
 *
 * ⚠️ **היא משאירה טיוטה מאחור בכוונה.** טיוטה אינה ניתנת לחיפוש (כלל 15),
 * ולכן מספר המסמך מודפס ונשמר ב-`result.json` — זו הידית היחידה אליה.
 */
import { ensureLoggedIn } from '../session.js';
import * as registry from '../documents/registry.js';
import { openList, startNew, fillHeader, readHeader, commitHeader, readDocNumber } from '../documents/engine.js';

export const meta = {
  name: 'invoice-open-new',
  description: 'פותח חשבונית מס חדשה ועוצר במסך השורות — ללימוד מסלול "יבוא מאקסל"',
  // כותבת: היא יוצרת טיוטה בקומקס. אין קליטה, אך גם טיוטה היא עקבה.
  writes: true,
  input: {
    customer: 'string — קוד לקוח. חובה',
    store: 'string, אופציונלי — מחסן. בלעדיו נשאר מה שקומקס טען מכרטיס הלקוח',
    priceList: 'string, אופציונלי — מחירון. בלעדיו נשאר מה שקומקס טען',
    date: 'string dd/mm/yyyy, אופציונלי',
    details: 'string, אופציונלי — שדה פרטים',
  },
  precheck(input) {
    if (!input.customer) return 'חסר customer — לאיזה לקוח לפתוח את החשבונית?';
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

  await fillHeader(ctx, profile, header, input);
  const head = await readHeader(profile, header);
  for (const [k, v] of Object.entries(head)) {
    if (v != null && String(v).trim()) logger.step('header', `${k}: ${String(v).trim()}`);
  }
  await logger.shot(page, 'header');

  // `#OK` של הכותרת מתקדם לשורות. `commitHeader` מסרב לרוץ על frame שאינו
  // כותרת, ולכן הוא לא יכול להפוך בטעות לקליטה.
  await commitHeader(ctx, profile, header);
  const docNo = await readDocNumber(ctx, profile);
  logger.step('lines', `מסך השורות פתוח — מסמך ${docNo ?? '(המספר לא נקרא)'}`);
  await logger.shot(page, 'lines-empty');

  const out = { docNo, header: head, customer: input.customer, filed: false };
  logger.save('result.json', out);

  // 💣 החלון נשאר פתוח **בכוונה**, וזו החריגה מכלל 10. סגירת התוכניות כאן
  // הייתה מוחקת בדיוק את המסך שנפתח כדי לצלם אותו.
  console.log('');
  console.log(`  מסך השורות של חשבונית ${docNo ?? '?'} פתוח וריק — מוכן לצילום.`);
  console.log('  ⛔ לא ללחוץ #OK במסך הזה — הוא קולט את החשבונית.');
  console.log('  ליציאה בלי קליטה: #DoExit ואז #Cancel, או npm run close -- all');
  console.log('');
  return out;
}
