/**
 * החוזה של `meta.input` — הבדיקה שהופכת מוסכמה לחוזה נאכף.
 *
 *   npm run tasks-test
 *
 * שלושה באגים באותה משפחה נמצאו בשלושה ימים, וכולם נכשלו בשקט:
 *
 *   `quote-read` — הביטוי "אחד מהשניים חובה" בתיאור של שדה **אופציונלי**. שער
 *   ה"חובה" ב-`run.js` בודק /חובה/ על הטקסט, מצא אותו, וסירב להרצה תקינה.
 *
 *   שש משימות — שדה שהקוד זורק עליו "חסר" ואינו מסומן "חובה". השער לא נורה,
 *   המושב נתפס, קומקס נפתח, ורק אז המשימה אמרה מבפנים מה חסר. 128 שניות ושני
 *   לוגינים, נמדד.
 *
 *   `--flag false` — שדה בוליאני שהוצהר 'true — ...' ולא 'boolean'. ההמרה
 *   ב-`run.js` לא ראתה אותו, והמחרוזת "false" נשארה truthy. `--allowUpdate
 *   false` על הכותב הבלתי הפיך **אִפשר** עדכון למי שניסה למנוע אותו.
 *
 * לשלושתם שורש אחד: מוסכמה שנאכפת על טקסט חופשי, בלי שום דבר שבודק ששני
 * הצדדים — התיאור והקוד — מסכימים. כאן נבדק שהם מסכימים, בארבעה כיוונים, ועל
 * **אותן פונקציות** שרצות בפועל: `src/cli-args.js`, שמיובא גם ל-`run.js`.
 * העתק של הפרסר לבדיקה היה נפרד ממנו בשקט — בדיוק המחלה.
 *
 * קריאה בלבד. אינה נוגעת בקומקס, אין לה מושב ואין לה נעילה.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/config.js';
import { parseFlags, applyDeclaredTypes, checkFlagsWithoutValue, isRequiredSpec } from '../src/cli-args.js';

const TASK_DIR = resolve(ROOT, 'src/tasks');

let failures = 0;
const fail = (task, msg, fix) => {
  failures++;
  console.log('  X  ' + task);
  console.log('       ' + msg);
  if (fix) console.log('       => ' + fix);
};

const taskNames = readdirSync(TASK_DIR)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
  .map((f) => f.replace(/\.js$/, ''));

const tasks = [];
for (const name of taskNames) {
  const file = resolve(TASK_DIR, name + '.js');
  const src = readFileSync(file, 'utf8');
  const meta = (await import(pathToFileURL(file).href)).meta ?? {};
  const imported = [...src.matchAll(/from '\.\/([A-Za-z0-9_-]+)\.js'/g)]
    .map((x) => resolve(TASK_DIR, x[1] + '.js'))
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, 'utf8'));
  tasks.push({ name, src, meta, input: meta.input ?? {}, sources: [src, ...imported] });
}

console.log('\nחוזה meta.input — ' + tasks.length + ' משימות\n');
/**
 * השדות שהקוד עצמו זורק עליהם "חסר".
 *
 * מזוהה מהמקור ולא מהרצה, כי כדי לראות את הזריקה בפועל צריך דפדפן, מושב ולוגין
 * — וזה בדיוק המחיר שהשער נועד לחסוך. שתי הצורות שנתפסות הן אלה שבשימוש בפועל:
 * `if (!input.X) throw` ו-`if (!X) throw` אחרי פירוק מ-input.
 */
/** שמות שפורקו מ-input בהשמה כמו `const { customer } = input`. */
function destructuredFromInput(src) {
  const names = new Set();
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*input\b/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].split(':').pop().trim();
      if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * האם המשימה בכלל קוראת את השדה — ישירות, אחרי פירוק, או במשימה שאליה היא
 * מאצילה. `quote-email` יורש את meta של `document-email` ומעביר לו את הקלט;
 * השדות אמיתיים לגמרי, הם פשוט נקראים בקובץ השני.
 */
const readsInput = (task, field) =>
  task.sources.some((src) => src.includes('input.' + field) || destructuredFromInput(src).has(field));

function thrownOn(src) {
  const found = new Set();
  for (const m of src.matchAll(/if\s*\(\s*!\s*input\.([A-Za-z][A-Za-z0-9]*)\s*\)\s*throw/g)) found.add(m[1]);
  const destructured = destructuredFromInput(src);
  for (const m of src.matchAll(/if\s*\(\s*!\s*([A-Za-z][A-Za-z0-9]*)\s*\)\s*throw/g)) {
    if (destructured.has(m[1])) found.add(m[1]);
  }
  return found;
}

/**
 * האם ה-precheck של המשימה חוסם כשהשדה חסר.
 *
 * נקרא באמת, לא נקרא בעין: קלט שבו כל שאר השדות מלאים והשדה הנבדק חסר. זה מה
 * שהופך either/or לתשובה קבילה — `quote-read` ו-`quote-add-line` מכסים את
 * customer/docNo ואת code/items דרך precheck, ונכון שלא יסומנו "חובה".
 */
function precheckBlocks(meta, field) {
  if (typeof meta.precheck !== 'function') return false;
  const probe = {};
  for (const [k, spec] of Object.entries(meta.input ?? {})) {
    if (k === field) continue;
    const s = String(spec);
    probe[k] = /^array\b/.test(s) ? ['x'] : /^boolean\b/.test(s) ? true : 'x';
  }
  try {
    return Boolean(meta.precheck(probe));
  } catch {
    return true;
  }
}

console.log('1. שדה שהקוד דורש — נעצר לפני הדפדפן?');
{
  const before = failures;
  let checked = 0;
  for (const t of tasks) {
    for (const field of thrownOn(t.src)) {
      if (!Object.hasOwn(t.input, field)) continue;
      checked++;
      if (isRequiredSpec(t.input[field])) continue;
      if (precheckBlocks(t.meta, field)) continue;
      fail(t.name + '.' + field,
        'הקוד זורק "חסר" על השדה, אבל שום שער לא עוצר לפניו — ההרצה תגיע לקומקס ותיפול מבפנים.',
        'להוסיף "חובה" לתיאור, או precheck אם זה either/or.');
    }
  }
  if (failures === before) console.log('  v  ' + checked + ' שדות שהקוד דורש — כולם נעצרים מוקדם');
}

console.log('\n2. שדה מסומן "חובה" — באמת נדרש?');
{
  const before = failures;
  let checked = 0;
  for (const t of tasks) {
    for (const [field, spec] of Object.entries(t.input)) {
      if (typeof spec !== 'string' || !isRequiredSpec(spec)) continue;
      checked++;
      // זה הבאג של quote-read מהצד שלו: "אחד מהשניים חובה" בשדה אופציונלי.
      // הביטוי נראה כמו הצהרה והוא בדיוק ההפך ממנה, והרגקס אינו יודע להבחין.
      if (/אחד מ|לחלופין/.test(spec)) {
        fail(t.name + '.' + field,
          'התיאור מנסח either/or אבל מכיל את המילה "חובה" — השער יסרב להרצה תקינה שמוסרת את השני.',
          'להוציא את "חובה" מהשדה ולהעביר את התנאי ל-meta.precheck.');
        continue;
      }
      // "אין ברירת מחדל" הוא ההפך מברירת מחדל — לנקות לפני שבודקים.
      const claims = spec.split('אין ברירת מחדל').join('');
      if (/אופציונלי|ברירת מחדל|ברירת המחדל/.test(claims)) {
        fail(t.name + '.' + field,
          'מסומן "חובה" וגם מבטיח ברירת מחדל או אופציונליות — שניהם לא יכולים להיות נכונים.',
          'להכריע: או חובה, או ברירת מחדל.');
        continue;
      }
      if (!readsInput(t, field)) {
        fail(t.name + '.' + field,
          'מסומן "חובה" אבל המשימה לא קוראת אותו בשום מקום.',
          'להסיר את השדה, או להסיר את הסימון.');
      }
    }
  }
  if (failures === before) console.log('  v  ' + checked + ' שדות מסומנים "חובה" — כולם נדרשים באמת');
}

console.log('\n3. שדה שהוצהר boolean — הפרסר מחזיר בוליאני?');
{
  const before = failures;
  let checked = 0;
  for (const t of tasks) {
    for (const [field, spec] of Object.entries(t.input)) {
      if (typeof spec !== 'string' || !/^boolean\b/.test(spec)) continue;
      checked++;
      for (const word of ['true', 'false']) {
        // דרך הפרסר האמיתי, בדיוק כפי שהוא נקרא ב-run.js.
        const { input } = parseFlags([t.name, '--' + field, word]);
        const problem = applyDeclaredTypes(input, t.input);
        if (problem) {
          fail(t.name + '.' + field, 'הפרסר דחה "--' + field + ' ' + word + '".');
        } else if (input[field] !== (word === 'true')) {
          fail(t.name + '.' + field,
            '"--' + field + ' ' + word + '" חזר כ-' + JSON.stringify(input[field])
              + ' ולא כבוליאני — ערך כזה truthy תמיד.',
            'לוודא שהתיאור מתחיל במילה boolean.');
        }
      }
      const bare = parseFlags([t.name, '--' + field]);
      if (bare.input[field] !== true) fail(t.name + '.' + field, 'דגל יחף לא החזיר true.');
      const junk = parseFlags([t.name, '--' + field, 'ken']);
      if (!applyDeclaredTypes(junk.input, t.input)) {
        fail(t.name + '.' + field, 'מילה שאינה true/false התקבלה בשקט במקום להידחות.');
      }
    }
  }
  if (failures === before) console.log('  v  ' + checked + ' שדות בוליאניים — כולם חוזרים בוליאני');
}

console.log('\n4. תיאור שמדבר על true/false — הצהיר boolean?');
{
  const before = failures;
  for (const t of tasks) {
    for (const [field, spec] of Object.entries(t.input)) {
      if (typeof spec !== 'string') continue;
      if (/^boolean\b/.test(spec)) continue;
      if (!/\btrue\b|\bfalse\b/i.test(spec)) continue;
      fail(t.name + '.' + field,
        'התיאור מסביר איך למסור true/false אבל אינו מתחיל ב-boolean — ההמרה ב-run.js לא תראה אותו,'
          + ' ו-"false" יגיע כמחרוזת truthy.',
        'לפתוח את התיאור במילה boolean.');
    }
  }
  if (failures === before) console.log('  v  אין תיאור שמדבר true/false בלי להצהיר boolean');
}

console.log('\n5. שערי הפרסר עצמו');
{
  const t = (name, ok, detail) => {
    console.log((ok ? '  v  ' : '  X  ') + name + (detail ? '   ' + detail : ''));
    if (!ok) failures++;
  };
  const confirmFalse = parseFlags(['task', '--confirm', 'false']);
  t('"--confirm false" נתפס כשימוש שגוי', confirmFalse.confirmedWithValue.length === 1,
    confirmFalse.confirmedWithValue.join(''));
  t('...ואינו מתפרש בשקט כ"אל תאשר"', confirmFalse.confirm === true, String(confirmFalse.confirm));
  const bare = parseFlags(['task', '--confirm']);
  t('"--confirm" יחף עובר', bare.confirm === true && bare.confirmedWithValue.length === 0);
  const withFlag = parseFlags(['task', '--confirm', '--customer', '112001']);
  t('דגל אחרי --confirm אינו שימוש שגוי', withFlag.confirmedWithValue.length === 0);
  t('...והערך שאחריו נקרא נכון', withFlag.input.customer === '112001', String(withFlag.input.customer));
  const unknownFlag = parseFlags(['task', '--price-list', 'ראשי']);
  t('דגל עם מקף מדווח כלא מוכר', unknownFlag.unknown.length === 1, unknownFlag.unknown.join(''));
  const repeated = parseFlags(['task', '--programs', 'a157', '--programs', 'a132']);
  t('דגל שחוזר בונה רשימה', Array.isArray(repeated.input.programs) && repeated.input.programs.length === 2,
    JSON.stringify(repeated.input.programs));
  const leading = parseFlags(['task', '--customer', '0112001']);
  t('אפס מוביל נשמר כמחרוזת', leading.input.customer === '0112001', String(leading.input.customer));
  const one = parseFlags(['task', '--programs', 'a157']);
  applyDeclaredTypes(one.input, { programs: 'array — רשימה' });
  t('ערך בודד לשדה array נעטף', Array.isArray(one.input.programs), JSON.stringify(one.input.programs));

  // דגל שמצפה לערך וקיבל את הדגל הבא — לא להשתיק, ולנקוב בשני הטוקנים.
  const swallowed = parseFlags(['task', '--customer', '--confirm']);
  t('דגל בלי ערך נרשם', swallowed.withoutValue.length === 1, JSON.stringify(swallowed.withoutValue));
  const strSpec = { customer: 'string — קוד לקוח. חובה' };
  const flagged = checkFlagsWithoutValue(swallowed.withoutValue, strSpec);
  t('שדה מחרוזת שקיבל דגל — מדווח', flagged.length === 1, flagged.map((x) => x.key).join());
  t('...והדיווח נוקב בטוקן הבא', flagged[0]?.next === '--confirm', String(flagged[0]?.next));
  t('...ולא הושתק ל-true', swallowed.input.customer === true, String(swallowed.input.customer));
  const atEnd = parseFlags(['task', '--customer']);
  t('דגל בסוף השורה מדווח גם הוא', checkFlagsWithoutValue(atEnd.withoutValue, strSpec)[0]?.next === null);
  t('שדה בוליאני יחף פטור', checkFlagsWithoutValue(swallowed.withoutValue, { customer: 'boolean — כן' }).length === 0);
  t('שדה שאינו מוצהר אינו נבדק', checkFlagsWithoutValue(swallowed.withoutValue, {}).length === 0);
  const withValue = parseFlags(['task', '--customer', '112001']);
  t('דגל עם ערך אינו נרשם כחסר', withValue.withoutValue.length === 0);
}


/* ── 6 ─ הדפוס עצמו לא יכול לחזור ───────────────────────────────────────
 *
 * ארבעת הבאגים של הסבב הזה חלקו צורה אחת: טוקן שנקרא מהארגומנטים בלי לבדוק
 * מה הוא. תיקון נקודתי בכל כלי משאיר את השורש חי — הכלי הבא שייכתב יעתיק את
 * הדפוס מאחד הקיימים, וזה יתגלה בעוד חודשיים באמצע מנה.
 *
 * שתי הצורות שנחסמות:
 *
 *   `indexOf('--x') + 1`  — בלי הדגל מחזיר -1, ו--1+1 הוא **אפס**: הארגומנט
 *   הראשון הופך לערך. וגם עם הדגל, הטוקן הבא עשוי להיות דגל אחר או כלום.
 *
 *   `Number(args[...])`   — NaN אינו נבדק ואינו זורק. `slice(0, NaN)` מחזיר
 *   מערך ריק, והכלי מדווח "0 תוקנו" ויוצא 0.
 *
 * מי שצריך לפרסר ארגומנטים משתמש ב-`src/cli-args.js`. החרגה מותרת — אבל
 * מוצהרת ברשימה שלמטה עם סיבה בשורה אחת, ולא כדילוג שקט.
 */
console.log('');
console.log('6. הדפוס לא חוזר — indexOf(--x)+1 ו-Number(args[...]) ב-tools/');
{
  const before = failures;

  /** החרגות מוצהרות. קובץ, ולמה מותר לו. */
  const EXEMPT = [
    ['tools/wa.js', 'flagValue() מגן בעצמו — ערך שמתחיל ב-"--" נופל לברירת המחדל; תת-פקודות ופרסור מעורב הופכים המרה למסוכנת מהבאג.'],
    ['tools/payroll-report.js', '--to עובר ב-requireRecipient עם EMAIL_RE (כלל 14). ⚠️ --month נשאר לא מוגן, והוחרג בהסכמה מפורשת.'],
    ['tools/sportmore.js', 'פרסר משלו עם תת-פקודות ו-BOOLEAN_FLAGS, ונבדק במלואו ב-npm run sm-test.'],
  ];
  const exemptFiles = new Set(EXEMPT.map(([f]) => f));

  const TOOLS = resolve(ROOT, 'tools');
  // `_smoke/` מוחרג כולו: אלה בדיקות חד-פעמיות שנכתבו מול מסך אחד ואינן חלק
  // מהממשק. הן גם לא מופיעות ב-package.json.
  const files = readdirSync(TOOLS)
    .filter((f) => (f.endsWith('.js') || f.endsWith('.cjs')) && !f.endsWith('-selftest.js'))
    .map((f) => 'tools/' + f);

  const isComment = (line) => {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  };

  // הצריכה היא מה שנתפס, לא רק הצורה: `args[i + 1]` על מערך הארגומנטים הוא
  // הטוקן הבא שנקרא בלי לדעת מה הוא, בין אם ה-indexOf שמעליו כתוב במפורש ובין
  // אם שם הדגל הגיע במשתנה.
  const NEXT_TOKEN = /\b(args|argv|process\.argv)\s*\[[^\]]*\+\s*1\s*\]/;
  const INDEXOF = /indexOf\(('|"|`)--/;
  const NUMBER_ARG = /Number\(\s*(args|argv|process\.argv)\s*\[/;
  // `Number(...)` בשורה אחת ובדיקת סופיות בשורה הבאה היא הצורה התקינה, ולכן
  // נבדקות שלוש השורות שאחריה לפני שהיא נספרת כהפרה.
  const CHECKED = /Number\.isFinite|Number\.isInteger/;

  let scanned = 0;
  for (const rel of files) {
    const lines = readFileSync(resolve(ROOT, rel), 'utf8').split('\n');
    scanned++;
    const hits = [];
    lines.forEach((line, n) => {
      if (isComment(line)) return;
      if (INDEXOF.test(line) || NEXT_TOKEN.test(line)) {
        hits.push([n + 1, 'הטוקן הבא נקרא בלי בדיקה', line.trim()]);
      }
      if (NUMBER_ARG.test(line) && !lines.slice(n, n + 4).some((l) => CHECKED.test(l))) {
        hits.push([n + 1, 'Number(args[...]) — NaN אינו נבדק', line.trim()]);
      }
    });
    if (!hits.length) continue;
    if (exemptFiles.has(rel)) continue;
    for (const [n, why, text] of hits) {
      fail(rel + ':' + n, why + '  ' + text.slice(0, 70),
        'לעבור ל-parseFlags מ-src/cli-args.js, או להוסיף החרגה מוצהרת עם סיבה ב-tools/tasks-selftest.js.');
    }
  }

  // ⛔ החרגה שכבר אינה נחוצה היא החרגה ששוכחים: אם הקובץ נוקה או נמחק, היא
  // מכסה על הדפוס אם הוא יחזור. לכן היא נבדקת גם היא.
  for (const [rel, reason] of EXEMPT) {
    if (!existsSync(resolve(ROOT, rel))) {
      fail(rel, 'מוחרג אבל אינו קיים.', 'להסיר מרשימת ההחרגות.');
      continue;
    }
    const lines = readFileSync(resolve(ROOT, rel), 'utf8').split('\n');
    const still = lines.some((l, n) => !isComment(l) && (INDEXOF.test(l) || NEXT_TOKEN.test(l)
      || (NUMBER_ARG.test(l) && !lines.slice(n, n + 4).some((x) => CHECKED.test(x)))));
    if (!still) fail(rel, 'מוחרג אבל כבר אינו מכיל את הדפוס.', 'להסיר מרשימת ההחרגות: ' + reason.slice(0, 40));
  }

  if (failures === before) {
    console.log('  v  ' + scanned + ' כלים נסרקו · ' + EXEMPT.length + ' מוחרגים מוצהרים');
    for (const [rel, reason] of EXEMPT) console.log('       ' + rel + ' — ' + reason);
  }
}

console.log('\n' + (failures ? failures + ' בדיקות נכשלו' : 'הכל עבר') + '\n');
process.exit(failures ? 1 : 0);
