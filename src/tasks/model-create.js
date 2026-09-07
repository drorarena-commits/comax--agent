/**
 * מקים דגמים בקומקס — `a77` → `Erp/Prt_Degem/Prt_DegemV.asp`.
 *
 *   npm run run -- model-create --json '{"models":["006642"]}'
 *   npm run run -- model-create --json '{"models":["006642"]}' --confirm
 *
 * בלי `models` הרשימה נבנית לבד מקובץ ההקמה: כל דגם ששער המאסטר מדווח עליו
 * כחסר, עם השם מ`תאור פריט מרכז` של ספורט אנד מור. כך היא לא נכתבת ידנית
 * ואינה סוטה מהמקור.
 *
 * ⚠️ הגזירה האוטומטית קוראת xlsx דרך `unzip`, שאינו ב-PATH כשמריצים מ-PowerShell
 *    (נמדד 07/09/2026 — `spawnSync unzip ENOENT`). בסביבה כזאת יש להעביר את
 *    `models` מפורשות; אפשר לייצר את ה-JSON מ-Git Bash, שם `unzip` קיים.
 *
 * מתכון המסך: knowledge/screens/דגמים-רשימה.json · דגמים-הוספה.json
 *
 * הנוהל, כפי שדרור הסביר 07/09/2026:
 *   `קוד` = **מספר הדגם בלבד** · `שם` = התיאור מספורט אנד מור כמות שהוא ·
 *   כל שאר השדות ריקים (Name · מחלקה · קבוצה · ק. משנה · הערה).
 *
 * ⛔ **בלי `AR`.** הרשימה במסך מציגה רשומות מורשת בצורה `AR0095217310`, ומי
 *    שיעתיק את הצורה שרואים יקים דגם שגוי. הקידומת שייכת אך ורק לקוד החלופי
 *    של הפריט, כדי שיהיה זהה לזה של ספורט אנד מור.
 */
import { ensureLoggedIn } from '../session.js';
import { openProgram } from '../navigate.js';
import { recordCreated } from '../items/master-ledger.js';
import { loadSources, buildRows, IMPORT_HEADERS } from '../items/build-import.js';
import { masterGate } from '../items/master-gate.js';

export const meta = {
  name: 'model-create',
  description: 'מקים דגמים חדשים בקומקס (a77) — קוד = מספר הדגם, שם = התיאור מספורט אנד מור',
  writes: true,
  input: {
    models: 'מערך — קוד, או {code, name}. בלי זה: הדגמים החסרים לפי שער המאסטר',
  },
};

const LIST = /Erp\/Prt_Degem\/Prt_DegemV/i;
const FORM = /Erp\/Prt_Degem\/Prt_DegemU/i;

// מיקומי העמודות ברשת, נמדדו 07/09/2026:
// מחיר מכירה · מחיר קניה · נוסף3 · נוסף2 · שונות · נוסף · מידה · צבע ·
// פריטים · הערה · שם · קוד · Counter(נסתר)
const COL = { name: 10, code: 11 };

const frameOf = (page, re) => page.frames().find((f) => re.test(f.url()));

/** האורך שקומקס באמת שומר בשם הדגם — ראו `shortName`. */
export const NAME_MAX = 25;

/**
 * מקצר שם דגם כך שייכנס ב-25 תווים **בלי להיחתך באמצע מילה**.
 *
 * ⛔ נמדד 07/09/2026: `#Nm` מצהיר `maxlength=80`, אבל מה שנשמר בפועל נחתך
 *    ל-25 תווים, בלי שגיאה ובלי אזהרה. `FLAT SILICONE HERZLIYA ISR` נשמר
 *    כ-`FLAT SILICONE HERZLIYA IS`. כלומר הטופס משקר על המגבלה.
 *
 * הכרעת דרור: **לקצר בכוונה** במקום לתת לקומקס לחתוך. שתי המילים שיורדות
 * ראשונות הן `M ARENA` ו-`SWIM` — כל הקטלוג הוא ארנה וכולו שחייה, ולכן הן
 * אינן נושאות מידע. רק אם גם זה לא הספיק חותכים, ואז **בגבול מילה**.
 */
export function shortName(raw) {
  let s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (s.length <= NAME_MAX) return s;
  s = s.replace(/^M\s+ARENA\s+/i, '').trim();
  if (s.length <= NAME_MAX) return s;
  s = s.replace(/\bSWIM\s+/i, '').trim();
  if (s.length <= NAME_MAX) return s;
  const cut = s.slice(0, NAME_MAX);
  const atWord = cut.slice(0, cut.lastIndexOf(' '));
  return (atWord.length >= 12 ? atWord : cut).trim();
}

/** הדגמים החסרים לפי השער, עם השם מספורט אנד מור. */
function missingFromGate() {
  const src = loadSources();
  const { ready, pending } = buildRows(src);
  const gate = masterGate([...ready, ...pending], src.K);

  const S = src.S;
  const PM = S.head.indexOf('פריט מרכז/דגם');
  const TP = S.head.indexOf('תאור פריט מרכז');
  const nameOf = new Map();
  for (const r of S.rows) {
    const model = String(r[PM] ?? '').replace(/^AR/, '').slice(0, 6);
    if (model && !nameOf.has(model)) nameOf.set(model, String(r[TP] ?? '').trim());
  }
  return gate.missingModels.map((m) => ({ code: m.code, name: nameOf.get(m.code) ?? '' }));
}

/**
 * מחפש קוד דגם ברשימה דרך תיבת החיפוש `#wNm` (תוויתה `:דגם`).
 *
 * ⛔ שתי מלכודות, שתיהן נראות כמו הצלחה — נמדדו במסך הצבעים באותו יום:
 *   1. **Enter חייב להילחץ על השדה** (`locator.press`). `human.press` נשלח לדף,
 *      הרשימה לא מסתננת, והקריאה נשארת על עמוד ראשון ומדווחת "לא קיים" בשקט.
 *   2. **התא האחרון אינו הקוד** אלא `Counter` נסתר. הקוד הוא תא 11.
 *
 * ההשוואה היא שוויון מדויק: חיפוש `0116` מחזיר ארבעה דגמים שונים.
 */
async function findModel(list, page, code) {
  const box = list.locator('#wNm');
  await box.click();
  await box.fill(code);
  await box.press('Enter');
  await page.waitForTimeout(1200);

  const rows = await list.evaluate((col) =>
    [...document.querySelectorAll('tr')]
      .filter((tr) => tr.cells.length > col.code && tr.getBoundingClientRect().height > 0)
      .map((tr) => {
        const c = [...tr.cells].map((td) => (td.innerText || '').trim());
        return { name: c[col.name], code: c[col.code] };
      })
      .filter((r) => r.code && r.code !== 'קוד'), COL);
  return rows.filter((r) => r.code === code);
}

/** מנקה את הסינון — הוא דביק, וסינון שנשאר מסתיר את שאר הרשימה. */
async function clearSearch(list, page) {
  const box = list.locator('#wNm');
  await box.fill('');
  await box.press('Enter');
  await page.waitForTimeout(800);
}

async function waitForForm(page, human, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const f = frameOf(page, FORM);
    if (f && (await f.$('#Kod').catch(() => null))) return f;
    await human.settle('דיאלוג הדגם');
  }
  throw new Error('דיאלוג הוספת הדגם לא נפתח.');
}

export async function run({ page, human, logger, input, cfg, dryRun }) {
  const wanted = (input?.models?.length ? input.models : missingFromGate())
    .map((m) => (typeof m === 'string' ? { code: m, name: m } : m))
    .map((m) => ({ code: String(m.code).trim().replace(/^AR/i, ''), name: shortName(m.name) }))
    .filter((m) => m.code);
  if (!wanted.length) throw new Error('לא נמסרו דגמים להקמה ואין חסרים לפי השער.');

  const unnamed = wanted.filter((m) => !m.name);
  if (unnamed.length) throw new Error(`אין שם לדגמים: ${unnamed.map((m) => m.code).join(', ')} — לא מנחשים.`);

  await ensureLoggedIn({ page, human, logger, cfg });

  let list = frameOf(page, LIST);
  if (!list) ({ frame: list } = await openProgram({ page, human, logger, cfg }, 'a77', { expect: LIST }));
  if (!list) throw new Error('מסך ניהול דגם לא נפתח.');

  // דיאלוג פתוח מיירט כל קליק על הרשימה שמאחוריו. `#Cancel` על דיאלוג ADD
  // אינו מוחק דבר — הדגם עוד לא נשמר.
  const stale = frameOf(page, FORM);
  if (stale) {
    logger.step('cleanup', 'דיאלוג הוספה היה פתוח — סוגר אותו');
    await human.click('#Cancel', { scope: stale, label: 'ביטול' });
    await human.settle('סגירת הדיאלוג');
  }

  const todo = [];
  for (const m of wanted) {
    const hits = await findModel(list, page, m.code);
    if (hits.length) logger.step('skip', `דגם ${m.code} כבר קיים ("${hits[0].name}") — מדלג`);
    else todo.push(m);
  }
  await clearSearch(list, page);

  if (!todo.length) return { created: [], skipped: wanted.map((m) => m.code), reason: 'כולם קיימים' };
  logger.step('plan', `${todo.length} דגמים להקמה: ${todo.map((m) => m.code).join(' ')}`);

  const created = [];
  for (let i = 0; i < todo.length; i++) {
    const m = todo[i];

    // ⛔ **`#OKNew` אינו שומר במסך הזה.** נמדד 07/09/2026 על 14 דגמים: 13
    //    נשמרו ב-V הכחול ו**אף אחד מהם לא נוצר**, בלי שגיאה ובלי סימן; רק
    //    האחרון, שנשמר ב-✓ הירוק, קיים. במסך הצבעים `#OKNew` דווקא עובד —
    //    ולכן אין להסיק התנהגות ממסך אחד למשנהו. כאן: דיאלוג חדש לכל דגם,
    //    `#OK` בלבד, ואימות מיד אחריו.
    await human.click('#newRec', { scope: list, label: 'הוספה' });
    const form = await waitForForm(page, human);

    await human.type('#Kod', m.code, { scope: form, label: `קוד ${m.code}`, clear: true });
    await human.type('#Nm', m.name, { scope: form, label: `שם ${m.name}`, clear: true });

    const got = await form.evaluate(() => ({
      kod: document.getElementById('Kod')?.value ?? '',
      nm: document.getElementById('Nm')?.value ?? '',
    }));
    if (got.kod !== m.code || got.nm !== m.name) {
      await logger.shot(page, `verify-failed-${m.code}`);
      throw new Error(`השדות לא נקלטו: קוד="${got.kod}" שם="${got.nm}"`);
    }
    logger.step('verify', `קוד=${got.kod} שם=${got.nm}`);
    if (i === 0) await logger.shot(page, `before-ok-${m.code}`);

    if (dryRun) {
      logger.step('dryrun', `עוצר לפני #OK — ${todo.length} דגמים לא נוצרו`);
      return { dryRun: true, wouldCreate: todo, stoppedAt: m.code };
    }

    await human.click('#OK', { scope: form, label: 'אישור' });
    await human.settle('אחרי השמירה');

    // ⛔ אימות **מיד**, ורישום רק אחריו. הרישום נעשה קודם לפני הבדיקה, ואז
    //    היומן החזיק 13 דגמים שמעולם לא נוצרו — מצב מסוכן יותר מכישלון גלוי,
    //    כי שער המאסטר היה עובר על סמך יומן שקרי.
    const hits = await findModel(list, page, m.code);
    if (hits.length !== 1 || hits[0].name !== m.name) {
      await logger.shot(page, `not-saved-${m.code}`);
      throw new Error(`${m.code} לא נשמר (${hits.length} תוצאות). נוצרו לפניו: ${created.join(', ') || 'אף אחד'}`);
    }
    created.push(m.code);
    recordCreated('models', [m.code], meta.name);
    logger.step('saved', `${m.code} — ${created.length}/${todo.length}`);
  }

  await clearSearch(list, page);
  await logger.shot(page, 'after');
  logger.step('verify', `${created.length} דגמים נוצרו ואומתו`);

  return { created, skipped: wanted.filter((m) => !todo.includes(m)).map((m) => m.code) };
}
