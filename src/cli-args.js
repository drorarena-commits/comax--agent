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
 * @param {string[]} argv  הארגומנטים אחרי node ואחרי הסקריפט. argv[0] הוא שם
 *                         המשימה ואינו נסרק.
 * @returns {{input:object, unknown:string[], confirmedWithValue:string[], confirm:boolean}}
 */
export function parseFlags(argv) {
  const input = {};
  const unknown = [];
  const confirmedWithValue = [];

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;

    if (KNOWN_FLAGS.has(a)) {
      // `--json` / `--json-file` בולעים את הערך שלהם בכוונה — הוא נקרא במקום אחר.
      if (a !== '--confirm') { i++; continue; }
      // ⛔ `--confirm` הוא נוכחות, לא ערך. ערך אחריו נדחה ואינו מתפרש: קריאת
      // "false" כ"אל תאשר" היא ניחוש באותה מידה, ומבין שני ניחושים זה שמגיש
      // מסמך בלתי הפיך הוא זה ששווה לסרב.
      const after = argv[i + 1];
      if (after !== undefined && !after.startsWith('--')) confirmedWithValue.push(after);
      continue;
    }

    const key = a.slice(2);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) { unknown.push(a); continue; }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      input[key] = true;
    } else {
      // דגל שחוזר בונה רשימה, כך ש-`--programs a157 --programs a132` עובד
      // לשדות מטיפוס array בלי להגיע ל---json.
      input[key] = Object.hasOwn(input, key) ? [].concat(input[key], next) : next;
      i++;
    }
  }

  return { input, unknown, confirmedWithValue, confirm: argv.includes('--confirm') };
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
