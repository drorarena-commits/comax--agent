/**
 * קולט חשבונית שכבר בנויה — טיוטה שנעצרה לפני הקליטה.
 *
 * המשלימה של `invoice-import-lines`: זו בונה ועוצרת, וזו קולטת אחרי אישור
 * מפורש. הפרדה בכוונה — הקליטה מזיזה מלאי ואין לה ביטול.
 *
 * ⚠️ **הכניסה לטיוטה כותבת מחדש את הכותרת** (כלל 15), ולכן חובה למסור לה שוב
 * את אותם מחסן/מחירון/פרטים. מחירון שונה היה מהפך את משטר המע"מ על מסמך
 * בנוי — 22,497 כולל מע"מ היו הופכים ל-22,497 לפניו.
 *
 * שני שערים מעל שערי `finalize`, ושניהם דורשים שדרור יאמר את המספר מראש:
 *   `expectDoc`   — זו הטיוטה שחשבנו, ולא מסמך חדש שנוצר כי היא לא נתפסה
 *   `expectTotal` — זה הסכום שאושר, ולא מסמך שהשתנה בין ההרצות
 */
import { ensureLoggedIn } from '../session.js';
import * as registry from '../documents/registry.js';
import { openList, startNew, fillHeader, readHeader, commitHeader, readDocNumber, readTotals, finalize } from '../documents/engine.js';

export const meta = {
  name: 'invoice-finalize',
  description: 'קולט טיוטת חשבונית קיימת — אחרי אישור מפורש של המספר והסכום',
  writes: true,
  input: {
    customer: 'string — קוד הלקוח. חובה',
    expectDoc: 'string — מספר הטיוטה שאמורה להיתפס. חובה',
    expectTotal: 'string/number — הסכום כולל מע"מ שאושר. חובה',
    store: 'string — מחסן. חובה, כי הכניסה כותבת את הכותרת מחדש',
    priceList: 'string — מחירון. חובה, מאותה סיבה, והוא קובע את משטר המע"מ',
    details: 'string, אופציונלי — שדה פרטים',
  },
  precheck(input) {
    if (!input.customer) return 'חסר customer.';
    if (!input.expectDoc) return 'חסר expectDoc — איזו טיוטה אמורה להיקלט?';
    if (input.expectTotal === undefined) return 'חסר expectTotal — איזה סכום אושר?';
    if (!input.store || !input.priceList) return 'חסר store/priceList — הכניסה לטיוטה כותבת את הכותרת מחדש.';
    return null;
  },
};

const num = (v) => Number(String(v ?? '').replace(/,/g, ''));

export async function run(ctx) {
  const { page, human, logger, cfg, input, confirm } = ctx;

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
  await commitHeader(ctx, profile, header);

  // ⛔ מספר חדש פירושו שהטיוטה **לא** נתפסה — ואז קליטה כאן יוצרת מסמך שני
  // בספרים בזמן שהמקורי נשאר תלוי. עוצרים לפני שנוגעים בכפתור הקליטה.
  const docNo = await readDocNumber(ctx, profile);
  if (String(docNo) !== String(input.expectDoc)) {
    throw new Error(
      `נפתח מסמך ${docNo} ולא הטיוטה ${input.expectDoc} שציפינו לה.\n`
      + '  הטיוטה לא נתפסה — לא קולטים, כדי לא ליצור חשבונית שנייה.',
    );
  }

  // הסיכום נצבע אחרי שהרשת נטענת (נמדד 11/09/2026) — ממתינים לו.
  let totals = null;
  for (let i = 0; i < 8; i++) {
    totals = await readTotals(ctx, profile).catch(() => null);
    if (num(totals?.total) > 0) break;
    await human.think('waiting for totals');
  }
  logger.step('totals', `לפני מע"מ ${totals?.beforeVat} · מע"מ ${totals?.vat} · סה"כ ${totals?.total}`);

  if (num(totals?.total) !== num(input.expectTotal)) {
    throw new Error(
      `הסכום במסמך הוא ${totals?.total} והאישור היה על ${input.expectTotal}.\n`
      + '  לא קולטים מסמך שהשתנה מאז שאושר.',
    );
  }
  await logger.shot(page, 'before-filing');

  if (!confirm) {
    console.log(`\n  מסמך ${docNo} · ${totals.total} — מוכן לקליטה. בלי --confirm לא נקלט.\n`);
    return { docNo, totals, header: head, filed: false };
  }

  const res = await finalize(ctx, profile);
  logger.step('filed', `חשבונית ${docNo} נקלטה — ${totals.total}`);
  await logger.shot(page, 'filed');
  return { docNo, totals, header: head, filed: true, finalize: res };
}
