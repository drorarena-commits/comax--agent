/**
 * יומן ערכי המאסטר שהקמנו — גשר בין ההקמה לייצוא הבא.
 *
 * למה זה קיים: שער המאסטר קורא דגמים וצבעים מ-`content/פריטים-מלא-*.csv`,
 * שהוא ייצוא **פריטים** ולכן מכיר רק ערכים **שבשימוש**. צבע חדש עם 0 פריטים
 * לא יופיע שם. דרור: "ברגע שנקים את המוצר, בדוח פריטים הבא הצבעים החדשים כבר
 * יופיעו" — כלומר המחזור הרגיל סוגר את הפער, ואין צורך בייצוא מאסטר נפרד.
 *
 * נשאר חלון אחד: מרגע ההקמה ועד הייצוא הבא. בדיוק החלון שבו רץ השער לפני
 * היבוא. היומן הזה מגשר עליו, ותו לא.
 *
 * ⛔ **היומן אינו מקור אמת חלופי.** הוא רושם רק מה ש**אנחנו** הקמנו ואימתנו
 *    בקומקס באותה הרצה. קוד שאינו בייצוא ואינו כאן — נחסם, כמו קודם. אחרת
 *    היינו מייצרים דרך לעקוף את השער בכתיבה לקובץ.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

const PATH = resolve(ROOT, 'content', 'מאסטר-שהוקם.json');
const EMPTY = { colors: [], models: [] };

export function readLedger() {
  try {
    const j = JSON.parse(readFileSync(PATH, 'utf8'));
    return { colors: j.colors ?? [], models: j.models ?? [] };
  } catch {
    return { ...EMPTY, colors: [], models: [] };
  }
}

function write(ledger) {
  mkdirSync(resolve(ROOT, 'content'), { recursive: true });
  writeFileSync(PATH, JSON.stringify(ledger, null, 2), 'utf8');
  return ledger;
}

/**
 * רושם קודים שהוקמו ואומתו.
 * @param {'colors'|'models'} kind
 * @param {string[]} codes
 * @param {string} by שם המשימה שיצרה
 */
export function recordCreated(kind, codes, by) {
  if (!codes?.length) return readLedger();
  const ledger = readLedger();
  const have = new Set(ledger[kind].map((e) => e.code));
  for (const code of codes) {
    if (!have.has(String(code))) ledger[kind].push({ code: String(code), at: new Date().toISOString(), by });
  }
  return write(ledger);
}

/**
 * מסיר מהיומן קודים שכבר נמצאים בייצוא — הגשר סיים את תפקידו.
 * נקרא אחרי כל ייצוא פריטים, ומתוך `masterIndex` כשהערך נמצא בשני המקומות.
 * @param {{models:Set<string>, colors:Set<string>}} inExport
 */
export function pruneLedger(inExport) {
  const ledger = readLedger();
  const before = ledger.colors.length + ledger.models.length;
  ledger.colors = ledger.colors.filter((e) => !inExport.colors?.has(e.code));
  ledger.models = ledger.models.filter((e) => !inExport.models?.has(e.code));
  const removed = before - (ledger.colors.length + ledger.models.length);
  if (removed) write(ledger);
  return removed;
}
