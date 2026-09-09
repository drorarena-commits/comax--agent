/**
 * מקים סוגי צבע בקומקס — `a125` → `Erp/Prt_Gimor/Prt_GimorV.asp`.
 *
 *   npm run run -- color-create --json '{"colors":["206","220"]}'
 *   npm run run -- color-create --json '{"colors":["206","220"]}' --confirm
 *
 * מתכון המסך: knowledge/screens/צבעים-רשימה.json · צבעים-הוספה.json
 *
 * הנוהל, כפי שדרור הסביר 07/09/2026: **הקוד והתיאור מקבלים את אותו מספר**,
 * ושאר השדות (Name · קבוצה · מחלקה · סדר · דגם) נשארים ריקים. בסוף כל צבע —
 * `#OKNew` ("אישור+חדש", ה-V הכחול) כדי להמשיך לצבע הבא, ובאחרון `#OK`
 * (ה-✓ הירוק) שסוגר. `#Cancel` הוא ה-X האדום ואינו בשימוש.
 *
 * ⛔ **הקמה כפולה אינה הפיכה בשקט.** מסד הצבעים מחזיק `11` ו-`011` כרשומות
 *    נפרדות (ממצא ב-MAP.md), ולכן "כבר קיים" אינו נראה לעין. לפני כל הקמה
 *    הקוד מחפש את הקוד ברשימה ומדלג עליו אם הוא שם — כמו בדיקת הכפילות של
 *    הקבלות, כלל 11.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';
import { recordCreated } from '../items/master-ledger.js';

export const meta = {
  name: 'color-create',
  description: 'מקים סוגי צבע חדשים בקומקס (a125) — קוד ותיאור זהים',
  writes: true,
  input: {
    colors: 'מערך — קודי הצבע להקמה. מחרוזת, או {code, name} אם התיאור שונה מהקוד',
  },
};

const LIST = /Erp\/Prt_Gimor\/Prt_GimorV/i;
const FORM = /Erp\/Prt_Gimor\/Prt_GimorU/i;

const frameOf = (page, re) => page.frames().find((f) => re.test(f.url()));

/** מחכה שהפריים ייפתח ויהיה בו השדה `#Kod` — פתיחת הדיאלוג אינה מיידית. */
async function waitForForm(page, human, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const f = frameOf(page, FORM);
    if (f && (await f.$('#Kod').catch(() => null))) return f;
    await human.settle('דיאלוג הצבע');
  }
  throw new Error('דיאלוג הוספת הצבע לא נפתח.');
}

/**
 * מחפש קוד צבע ברשימה דרך תיבת החיפוש `#wNm`, ומחזיר את השורות התואמות.
 *
 * ⛔ שתי מלכודות שעלו בדם 07/09/2026, ושתיהן נראות בדיוק כמו הצלחה:
 *
 * 1. **Enter חייב להילחץ על השדה עצמו.** `human.press('Enter')` שולח את
 *    המקש לדף ולא לשדה שבתוך הפריים, והרשימה לא מסתננת — היא נשארת על עמוד
 *    ראשון של 10 מתוך 271, והקריאה מדווחת "לא קיים" בשקט. `locator.press`
 *    על `#wNm` מסנן כמצופה.
 * 2. **העמודה האחרונה אינה הקוד** — היא `Counter` נסתר. הסדר הוא
 *    `פריטים · סדר · מחלקה · קבוצה · תאור · קוד · Counter`, כלומר הקוד הוא
 *    **התא החמישי**. קריאה מהסוף החזירה מזהים פנימיים שנראים כמו קודי צבע
 *    (הצבע `25` נושא Counter `206`) ודיווחה "206 קיים" על צבע אחר לגמרי.
 *
 * ההשוואה היא **שוויון מדויק** על עמודת הקוד: חיפוש `20` מחזיר גם `206` וגם
 * `220`, והכלה הייתה מדווחת "קיים" על שניהם.
 */
async function findColor(list, page, code) {
  const box = list.locator('#wNm');
  await box.click();
  await box.fill(code);
  await box.press('Enter');           // על השדה, לא על הדף — ראו מלכודת 1
  await page.waitForTimeout(1200);

  const rows = await list.evaluate(() =>
    [...document.querySelectorAll('tr')]
      .filter((tr) => tr.cells.length >= 6 && tr.getBoundingClientRect().height > 0)
      .map((tr) => {
        const c = [...tr.cells].map((td) => (td.innerText || '').trim());
        return { items: c[0], name: c[4], code: c[5] };
      })
      .filter((r) => r.code && r.code !== 'קוד'));   // שורת הכותרת נקראת גם היא
  return rows.filter((r) => r.code === code);
}

/** מנקה את תיבת החיפוש — היא דביקה, וסינון שנשאר מסתיר את שאר הרשימה. */
async function clearSearch(list, page) {
  const box = list.locator('#wNm');
  await box.fill('');
  await box.press('Enter');
  await page.waitForTimeout(800);
}

export async function run({ page, human, logger, input, cfg, dryRun }) {
  const wanted = (input?.colors ?? []).map((c) => (typeof c === 'string' ? { code: c, name: c } : c))
    .map((c) => ({ code: String(c.code).trim(), name: String(c.name ?? c.code).trim() }))
    .filter((c) => c.code);
  if (!wanted.length) throw new Error('לא נמסרו צבעים להקמה.');

  await ensureLoggedIn({ page, human, logger, cfg });

  let list = frameOf(page, LIST);
  if (!list) ({ frame: list } = await openProgram({ page, human, logger, cfg }, 'a125', { expect: LIST }));
  if (!list) throw new Error('מסך ניהול סוגי צבע לא נפתח.');

  // דיאלוג פתוח חוסם את הרשימה שמאחוריו — הוא מיירט כל קליק, וגם תיבת החיפוש
  // אינה נגישה. סוגרים אותו לפני בדיקת הכפילות. `#Cancel` על דיאלוג ADD אינו
  // מוחק דבר: הצבע עוד לא נשמר.
  const stale = frameOf(page, FORM);
  if (stale) {
    logger.step('cleanup', 'דיאלוג הוספה היה פתוח — סוגר אותו לפני בדיקת הכפילות');
    await human.click('#Cancel', { scope: stale, label: 'ביטול' });
    await human.settle('סגירת הדיאלוג');
  }

  // ── בדיקת כפילות, לפני שנוגעים בכפתור ההוספה ──────────────────────────────
  const todo = [];
  for (const c of wanted) {
    const hits = await findColor(list, page, c.code);
    if (hits.length) logger.step('skip', `צבע ${c.code} כבר קיים ("${hits[0].name}") — מדלג`);
    else todo.push(c);
  }
  await clearSearch(list, page);

  if (!todo.length) return { created: [], skipped: wanted.map((c) => c.code), reason: 'כולם קיימים' };

  await human.click('#newRec', { scope: list, label: 'הוספה' });
  let form = await waitForForm(page, human);

  const created = [];
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    const last = i === todo.length - 1;

    await human.type('#Kod', c.code, { scope: form, label: `קוד ${c.code}`, clear: true });
    await human.type('#Nm', c.name, { scope: form, label: `תאור ${c.name}`, clear: true });

    // לקרוא בחזרה לפני הקליק — שדה שלא נקלט נראה בדיוק כמו שדה שנקלט.
    const got = await form.evaluate(() => ({
      kod: document.getElementById('Kod')?.value ?? '',
      nm: document.getElementById('Nm')?.value ?? '',
    }));
    if (got.kod !== c.code || got.nm !== c.name) {
      await logger.shot(page, `verify-failed-${c.code}`);
      throw new Error(`השדות לא נקלטו: קוד="${got.kod}" תאור="${got.nm}"`);
    }
    logger.step('verify', `קוד=${got.kod} תאור=${got.nm}`);
    await logger.shot(page, `before-ok-${c.code}`);

    if (dryRun) {
      logger.step('dryrun', `עוצר לפני ${last ? '#OK' : '#OKNew'} — הצבע ${c.code} לא נוצר`);
      return { dryRun: true, wouldCreate: todo.map((x) => x.code), stoppedAt: c.code };
    }

    // ה-✓ הירוק סוגר, ה-V הכחול שומר וממשיך לצבע הבא.
    await human.click(last ? '#OK' : '#OKNew', { scope: form, label: last ? 'אישור' : 'אישור+חדש' });
    created.push(c.code);
    await human.settle('אחרי השמירה');
    if (!last) form = await waitForForm(page, human);
  }

  // ── אימות: כל צבע שנוצר מופיע ברשימה **פעם אחת**, עם התיאור שביקשנו ───────
  const listAfter = frameOf(page, LIST) ?? list;
  const problems = [];
  for (const c of todo) {
    const hits = await findColor(listAfter, page, c.code);
    if (hits.length === 0) problems.push(`${c.code} לא נמצא`);
    else if (hits.length > 1) problems.push(`${c.code} מופיע ${hits.length} פעמים`);
    else if (hits[0].name !== c.name) problems.push(`${c.code} תואר כ-"${hits[0].name}"`);
  }
  await clearSearch(listAfter, page);
  await logger.shot(page, 'after');

  if (problems.length) throw new Error(`אימות נכשל: ${problems.join(' · ')}`);
  logger.step('verify', `${created.length} צבעים אומתו ברשימה`);

  // רק אחרי האימות: צבע חדש לא יופיע בייצוא הפריטים עד שיהיה עליו פריט, ובלי
  // הרישום הזה שער המאסטר יחסום עליו עד הייצוא הבא.
  recordCreated('colors', created, meta.name);
  logger.step('ledger', `נרשמו ביומן המאסטר: ${created.join(', ')}`);

  return { created, skipped: wanted.filter((c) => !todo.includes(c)).map((c) => c.code) };
}
