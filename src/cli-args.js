/**
 * פענוח הארגומנטים של `tools/run.js`, כמודול — כדי שאפשר יהיה לבדוק אותו.
 *
 * הפענוח ישב בתוך הסקריפט, ולכן כל בדיקה שלו הייתה חייבת להעתיק אותו. העתק
 * של לוגיקה הוא בדיוק המחלה שהבדיקה הזאת נועדה לרפא: שני הצדדים נפרדים בשקט,
 * והבדיקה ממשיכה לעבור על קוד שכבר לא רץ. כאן יושבת האמת, `run.js` מייבא אותה,
 * ו-`tools/tasks-selftest.js` בודק את אותה פונקציה בדיוק שרצה בפועל.
 *
 * הפונקציות טהורות ואינן מדפיסות ואינן יוצאות — הן מחזירות את הבעיות,
 * ו-`run.js` מנסח אותן. כך הבדיקה טוענת על מבנה ולא על ניסוח.
 */

export const KNOWN_FLAGS = new Set(['--json', '--json-file', '--confirm']);

/** המילים היחידות שמתקבלות לשדה שהוצהר בוליאני. */
const BOOLEAN_WORDS = new Map([['true', true], ['false', false]]);

/**
 * `--key value` ⇐ אובייקט קלט.
 *
 * שני מצבים, ואותה פונקציה:
 *
 *   **בלי אוצר מילים** — `parseFlags(argv)`, וזה מה ש-`run.js` עושה. כל `--key`
 *   מתקבל, כי המשימות מצהירות על השדות שלהן ב-`meta.input` והשער יושב שם.
 *
 *   **עם אוצר מילים** — `parseFlags(argv, { booleans, valued, ... })`, וזה מה
 *   שכלי `tools/` עושים. לכלי אין `meta`, ולכן ההצהרה מגיעה מהקורא עצמו: הוא
 *   יודע אילו דגלים יש לו ומאיזה טיפוס. זו הצהרה של הקורא, ולא מנגנון meta
 *   חדש לכלים.
 *
 * ההפרדה בין `valued` ל-`repeated` היא נכונות ולא ליטוש: `--attach` פעמיים הוא
 * שני קבצים, ו-`--pick` פעמיים הוא טעות. עד היום כל דגל שחזר בנה רשימה בשקט,
 * והכלי קיבל מערך במקום מחרוזת.
 *
 * @param {string[]} argv
 * @param {object} [opts]
 * @param {boolean} [opts.skipFirst=true]  לדלג על argv[0] (שם המשימה ב-run.js)
 * @param {string[]} [opts.booleans]  דגלים שאינם מקבלים ערך
 * @param {string[]} [opts.valued]    דגלים שמקבלים ערך יחיד
 * @param {string[]} [opts.repeated]  דגלים שחזרה שלהם בונה רשימה
 * @param {string[]} [opts.numbers]   דגלים שערכם חייב להיות מספר סופי
 * @returns {{input:object, _:string[], unknown:string[], confirmedWithValue:string[],
 *            booleanWithValue:Array, withoutValue:Array, duplicated:string[],
 *            badNumbers:Array, confirm:boolean}}
 */
export function parseFlags(argv, opts = {}) {
  const { skipFirst = true, booleans, valued, repeated = [], numbers = [] } = opts;
  const bool = new Set(booleans ?? []);
  const takesValue = new Set([...(valued ?? []), ...repeated, ...numbers]);
  const isRepeated = new Set(repeated);
  const isNumber = new Set(numbers);
  // אוצר מילים מוצהר הוא מה שמפעיל את השערים. בלעדיו מתנהגים כמו קודם, כי
  // ב-run.js ההצהרה יושבת ב-meta.input של המשימה ולא כאן.
  const declared = Boolean(booleans || valued);

  const input = {};
  const positional = [];
  const unknown = [];
  // הערכים של `--json` ו-`--json-file` נקראים כאן ולא ב-`indexOf` נפרד: שם הם
  // היו `argv[idx + 1]` בלי בדיקה, ו-`--json` בסוף השורה הגיע ל-JSON.parse
  // כ-undefined. זה נכשל רועש, אבל על השאלה הלא נכונה.
  const known = { json: undefined, jsonFile: undefined };
  const confirmedWithValue = [];
  const booleanWithValue = [];
  const withoutValue = [];
  const duplicated = [];
  const badNumbers = [];
  const seen = new Set();

  for (let i = skipFirst ? 1 : 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }

    if (!declared && KNOWN_FLAGS.has(a)) {
      // `--json` / `--json-file` בולעים את הערך שלהם בכוונה — הוא נקרא במקום אחר.
      if (a !== '--confirm') {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          withoutValue.push({ key: a.slice(2), next: value ?? null });
        } else {
          known[a === '--json' ? 'json' : 'jsonFile'] = value;
        }
        i++;
        continue;
      }
      // ⛔ `--confirm` הוא נוכחות, לא ערך. ערך אחריו נדחה ואינו מתפרש: קריאת
      // "false" כ"אל תאשר" היא ניחוש באותה מידה, ומבין שני ניחושים זה שמגיש
      // מסמך בלתי הפיך הוא זה ששווה לסרב.
      const after = argv[i + 1];
      if (after !== undefined && !after.startsWith('--')) confirmedWithValue.push(after);
      continue;
    }

    const key = a.slice(2);
    if (declared) {
      // אוצר מילים מוצהר: מה שלא הוצהר הוא טעות, ומקף בשם דגל לגיטימי לחלוטין
      // (`--body-file`, `--item-card`). בלי אוצר מילים נשמרת הבדיקה של run.js,
      // שבו שם השדה הופך למפתח ב-input ולכן חייב להיות מזהה תקין.
      if (!bool.has(key) && !takesValue.has(key)) { unknown.push(a); continue; }
    } else if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) {
      unknown.push(a);
      continue;
    }

    const next = argv[i + 1];

    if (declared && bool.has(key)) {
      input[key] = true;
      // דגל בוליאני שאחריו מילה שנראית כמו ניסיון למסור לו ערך. מילה אחרת היא
      // פוזישנל לגיטימי — `--all report.json` — ולכן רק הצורות האלה נתפסות.
      if (next !== undefined && /^(true|false|0|1|yes|no|כן|לא)$/i.test(next)) {
        booleanWithValue.push({ key, value: next });
      }
      continue;
    }

    if (next === undefined || next.startsWith('--')) {
      // דגל יחף הוא הכתיב הרגיל של שדה בוליאני — ולשדה שאינו בוליאני זו טעות
      // הקלדה שנקראה כ-true. באוצר מילים מוצהר זה ידוע כאן; ב-run.js זה מוכרע
      // מול ה-meta ב-checkFlagsWithoutValue.
      withoutValue.push({ key, next: next ?? null });
      input[key] = true;
      continue;
    }

    if (declared && seen.has(key) && !isRepeated.has(key)) duplicated.push(key);
    seen.add(key);

    if (isNumber.has(key)) {
      // ⛔ Number() שמחזיר NaN הוא הכשל הגרוע ביותר בכל המשפחה: `--limit abc`
      // נתן NaN, ו-`slice(0, NaN)` מחזיר מערך ריק — הכלי דיווח "0 תוקנו" ויצא
      // 0. הצלחה שאינה מבדילה מעצמה גרועה מקריסה.
      const n = Number(next);
      if (!Number.isFinite(n)) badNumbers.push({ key, value: next });
      else input[key] = n;
      i++;
      continue;
    }

    if (Object.hasOwn(input, key) && (isRepeated.has(key) || !declared)) {
      input[key] = [].concat(input[key], next);
    } else if (isRepeated.has(key)) {
      // דגל שחוזר מחזיר תמיד רשימה, גם כשנמסר פעם אחת — כדי שהקורא לא יצטרך
      // להסתעף על טיפוס הערך שקיבל.
      input[key] = [next];
    } else {
      input[key] = next;
    }
    i++;
  }

  return {
    input,
    _: positional,
    json: known.json,
    jsonFile: known.jsonFile,
    unknown,
    confirmedWithValue,
    booleanWithValue,
    withoutValue,
    duplicated,
    badNumbers,
    confirm: argv.includes('--confirm'),
  };
}

/**
 * הבעיות שנמצאו, כטקסט מוכן להדפסה. ריק = נקי.
 *
 * הניסוח יושב כאן ולא בכל כלי בנפרד, כי הודעה שמנוסחת מחדש בכל מקום נשחקת עד
 * ל-"ארגומנט לא תקין" — וזו בדיוק ההודעה שאי אפשר לתקן לפיה.
 */
export function flagProblems(parsed) {
  const out = [];
  for (const v of parsed.withoutValue) {
    out.push(`"--${v.key}" מצפה לערך, ו${v.next ? `אחריו נמצא "${v.next}" — הדגל הבא, לא ערך` : 'לא נמצא אחריו כלום'}.`);
  }
  for (const b of parsed.badNumbers) {
    out.push(`"--${b.key}" מצפה למספר וקיבל "${b.value}".`);
  }
  for (const b of parsed.booleanWithValue) {
    out.push(`"--${b.key}" הוא דגל ואינו מקבל ערך — אחריו נמצא "${b.value}". נוכחות הדגל היא ההפעלה; כדי לבטל, להשמיט אותו.`);
  }
  for (const k of parsed.duplicated) {
    out.push(`"--${k}" נמסר יותר מפעם אחת, והוא מקבל ערך יחיד.`);
  }
  for (const u of parsed.unknown) {
    out.push(`דגל לא מוכר: ${u}`);
  }
  return out;
}

/**
 * דגל שמצפה לערך וקיבל את הדגל הבא — או כלום.
 *
 * `--customer --confirm` נתן `customer: true`, ו-`true` אינו `undefined` ואינו
 * מחרוזת ריקה, ולכן **שער ה"חובה" אישר אותו**. ההרצה הגיעה לקומקס וחיפשה לקוח
 * בשם "true". ההודעה היחידה שהייתה יכולה לצאת היא "חסר customer" — תשובה נכונה
 * על הסיבה הלא נכונה, שמסתירה את מה שבאמת קרה: שני טוקנים שנכתבו בסדר הלא נכון.
 *
 * לכן השגיאה נוקבת בשניהם. הצורה המתגוננת קיימת כבר ב-`tools/wa.js`, שם ערך
 * שנראה כמו דגל נופל לברירת מחדל — כאן הוא מדווח, כי ל-`run.js` אין ברירת מחדל
 * לנפול אליה והשתקה היא בדיוק מה שעלה את הלוגין.
 *
 * שדה שהוצהר `boolean` פטור: שם דגל יחף הוא הכתיב הנכון. שדה שאינו מוצהר
 * ב-`meta.input` כלל אינו נבדק — הוא עניינה של המשימה, לא של הפרסר.
 *
 * @returns {Array<{key:string, next:string|null, spec:string}>}
 */
export function checkFlagsWithoutValue(withoutValue, metaInput = {}) {
  const problems = [];
  for (const { key, next } of withoutValue) {
    const spec = metaInput[key];
    if (typeof spec !== 'string') continue;
    if (/^boolean\b/.test(spec)) continue;
    problems.push({ key, next, spec });
  }
  return problems;
}

/**
 * מחיל על הקלט את הטיפוסים שהמשימה **הצהירה עליהם** ב-`meta.input`.
 *
 * `array` — ערך בודד עוטף לרשימה, כך ש-`--programs a157` מגיע כ-`['a157']`.
 *
 * `boolean` — המילה הופכת לבוליאני. `--key value` יכול למסור רק מחרוזת,
 * ו-`"false"` היא מחרוזת לא ריקה, ולכן כל `false` שהגיע כך היה `true`. זו אינה
 * כפיפה של הכלל "לא לנרמל ערך ממקור": הטיפוס מגיע מהצהרת המשימה עצמה ולא
 * מקריאת הערך, ומילה שאינה true או false **נדחית** במקום להיות מומרת.
 *
 * משנה את `input` במקום, ומחזיר בעיה ראשונה אם יש.
 *
 * @returns {{key:string, value:string, spec:string}|null}
 */
export function applyDeclaredTypes(input, metaInput = {}) {
  for (const [key, spec] of Object.entries(metaInput)) {
    if (typeof spec !== 'string') continue;

    if (/^array\b/.test(spec) && Object.hasOwn(input, key) && !Array.isArray(input[key])) {
      input[key] = [input[key]];
    }

    if (/^boolean\b/.test(spec) && typeof input[key] === 'string') {
      const word = BOOLEAN_WORDS.get(input[key].trim().toLowerCase());
      if (word === undefined) return { key, value: input[key], spec };
      input[key] = word;
    }
  }
  return null;
}

/** האם שדה חסר, לצורך שער ה"חובה". */
export const isMissing = (v) => v === undefined || v === '';

/** האם התיאור מסמן את השדה כחובה. */
export const isRequiredSpec = (spec) => typeof spec === 'string' && /חובה/.test(spec);
