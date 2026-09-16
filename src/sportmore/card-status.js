/**
 * האם כרטיס הפריט עדכני — לפי **אירוע**, לא לפי זמן.
 *
 * עד 16/09/2026 הכרטיס נחשב "ישן" אחרי 30 יום. זה היה ניחוש: כרטיס בן חודשיים
 * שבו לא קרה כלום מדויק לגמרי, וכרטיס בן יומיים שהופק לפני שהעברנו להם מנת
 * הקמה מיושן כבר. דרור הבהיר מה באמת מיישן אותו:
 *
 *   **בספורט אנד מור לא מקימים שום פריט בלי הוראה מפורשת ממנו.** לכן הדבר
 *   היחיד שיכול להוסיף פריטים לכרטיס הוא קובץ הקמה שאנחנו הפקנו ושלחנו.
 *
 * ומכאן החישוב, שאין בו שיקול דעת:
 *
 *   כרטיס שתאריכו **אחרי** קובץ ההקמה האחרון  →  עדכני. אין מה לבקש ואין מה לשאול.
 *   כרטיס שתאריכו **לפני**                    →  מיושן. לבקש כרטיס טרי לפני המנה הבאה.
 *   אין קובץ הקמה בכלל                        →  עדכני. לא ביקשנו מהם להקים דבר.
 *
 * ⚠️ **ההנחה שעליה כל זה יושב:** ספורט אנד מור אינם מקימים פריטים ביוזמתם.
 * ברגע שזה ישתנה — אם הם יתחילו להקים מיוזמתם, או אם מישהו אחר אצלנו יעביר
 * להם מנה בלי לעבור כאן — הכלל נשבר **בשקט**: הכרטיס ייראה עדכני בזמן שנוספו
 * בו פריטים שאיננו יודעים עליהם. זה המקום לחפש בו.
 *
 * ⚠️ **ולמה הרישום בקובץ ולא מסריקת `sportmore/out/`:** התיקייה הזאת ב-
 * `.gitignore`, ולכן קובץ הקמה שהופק במחשב החנות אינו קיים במחשב הנייד. סריקה
 * שלה הייתה אומרת "אין קובץ הקמה, הכרטיס עדכני" על מחשב אחד ו"מיושן" על השני,
 * לאותו כרטיס בדיוק. הרישום נשמר ב-`sportmore/reference/`, שנשמר בגיט.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ROOT } from '../config.js';

export const LAST_SETUP_PATH = resolve(ROOT, 'sportmore/reference/last-setup.json');

/** `item-card-2026-08-25.xlsx` → `2026-08-25`, או null אם אין תאריך בשם. */
export function cardDate(file) {
  const m = /item-card-([0-9]{4}-[0-9]{2}-[0-9]{2})/i.exec(basename(String(file)));
  return m ? m[1] : null;
}

/**
 * הקובץ נשמר **בגיט** (החלטת דרור, 16/09/2026): הוא אינו קובץ עבודה אלא רישום
 * של אירוע עסקי, הוא קטן, וכל מודל העדכניות תלוי בו. בלי גיט מחשב אחר היה
 * אומר "אין קובץ הקמה — שקט" ונותן את התשובה ההפוכה.
 *
 * המבנה הוא `{ latest: {...} }` ולא הרשומה עצמה בשורש — כדי שאם תידרש היסטוריה
 * תתווסף `history: [...]` לצידה, בלי לשבור אף קורא קיים.
 */
export function readLastSetup() {
  try {
    return JSON.parse(readFileSync(LAST_SETUP_PATH, 'utf8'))?.latest ?? null;
  } catch {
    return null;
  }
}

/**
 * נרשם אחרי כתיבת קובץ הקמה, ורק ב---confirm: קובץ שלא נכתב לא שלחנו, והוא לא
 * מיישן שום דבר.
 *
 * `cardAtTheTime` הוא הכרטיס שהיה בתוקף כשהקובץ הופק, והוא מה שמאפשר לענות על
 * "האם מאז שהפקנו הגיע כרטיס חדש".
 */
export function recordSetup({ file, season, cardFile, parents = [], barcodes = [] }) {
  const record = {
    date: new Date().toISOString().slice(0, 10),
    file: basename(String(file)),
    season: season ?? null,
    cardAtTheTime: basename(String(cardFile)),
    // כל אב נשמר עם מק"ט חלופי ותיאור, כי כשהוא יופיע באזהרת "טרם הקימו" הוא
    // **לא** יהיה בכרטיס — ואין שום מקום אחר לקרוא ממנו את הפרטים האלה.
    parents: parents.map((p) => (typeof p === 'string' ? { sku: p } : { sku: p.sku, altSku: p.altSku, desc: p.desc })),
    barcodes: [...barcodes],
  };
  writeFileSync(LAST_SETUP_PATH, JSON.stringify({ latest: record }, null, 2) + '\n', 'utf8');
  return record;
}

/**
 * מצב הכרטיס מול קובץ ההקמה האחרון.
 *
 * `pendingParents` הוא האזהרה האמיתית, וזו שכדאי לקבל: הופק קובץ הקמה, אחריו
 * הגיע כרטיס טרי, **והפריטים מהקובץ עדיין לא בו**. המשמעות אינה שמשהו שבור אלא
 * שהם עוד לא ביצעו את ההקמה — כלומר "תזכיר להם".
 *
 * ⛔ ובמכוון **אין כאן השוואת מספרי פריטים בין כרטיסים.** כרטיס טרי בלי פריטים
 * חדשים הוא המצב הנורמלי כשלא העברנו מנה, ואזהרה שנדלקת על המצב הנורמלי מלמדת
 * להתעלם ממנה.
 *
 * @returns {{current:boolean, why:string, lastSetup:object|null, pendingParents:Array<{sku,altSku,desc}>}}
 */
export function cardStatus(card, lastSetup = readLastSetup()) {
  const date = cardDate(card.file);

  if (!lastSetup) {
    return {
      current: true,
      why: 'לא הופק קובץ הקמה, ולכן לא ביקשנו מהם להקים דבר — הכרטיס עדכני.',
      lastSetup: null,
      pendingParents: [],
    };
  }
  if (!date) {
    return {
      current: false,
      why: `אין תאריך בשם הקובץ "${basename(card.file)}", ולכן אי אפשר להשוות אותו לקובץ ההקמה `
        + `מ-${lastSetup.date}. לשנות את השם ל-item-card-<YYYY-MM-DD>.xlsx.`,
      lastSetup,
      pendingParents: [],
    };
  }

  const current = date >= lastSetup.date;
  const pendingParents = current
    ? (lastSetup.parents || [])
      .map((p) => (typeof p === 'string' ? { sku: p } : p))
      .filter((p) => !card.parents.has(p.sku))
    : [];

  return {
    current,
    why: current
      ? `הכרטיס (${date}) חדש מקובץ ההקמה האחרון (${lastSetup.date}) — עדכני.`
      : `הכרטיס (${date}) קודם לקובץ ההקמה שהופק ב-${lastSetup.date} (${lastSetup.file}). `
        + 'לבקש כרטיס טרי לפני מנת ההקמה הבאה.',
    lastSetup,
    pendingParents,
  };
}
