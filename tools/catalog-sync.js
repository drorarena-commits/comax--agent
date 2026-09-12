/**
 * מעתיק את **קטלוג הפריטים הטרי ביותר** מ-`data/exports/` אל `content/`,
 * ומוחק את העותקים הישנים שם.
 *
 *   node tools/catalog-sync.js          # מעתיק, אם יש חדש יותר
 *   node tools/catalog-sync.js --force  # מעתיק גם אם מה שב-content כבר טרי
 *
 * **למה זה קיים.** `data/` אינו נשמר ב-git ו-`content/` כן, ולכן הייצוא
 * שרץ בלילה נשאר על מחשב אחד בלבד עד שהוא מועתק לכאן. בנוסף, שער ההצלבה של
 * הקמת הפריטים ושל הקמת המוצרים באתר קורא **רק** מ-`content/`
 * (`newestContent` ב-[src/items/build-import.js](../src/items/build-import.js)),
 * כך שקובץ ישן שם שקול לשער שעובד מול קטלוג מיושן — והוא נראה תקין לחלוטין.
 * נמדד 13/09/2026: `data/exports/` החזיק ייצוא מאותו יום בזמן ש-`content/`
 * עמד על 07/09, שישה ימים אחורה, בלי שום סימן.
 *
 * ⚠️ **הבחירה היא לפי mtime ולא לפי השם**, בדיוק כמו `newestContent`, כדי
 * ששני המנגנונים יסכימו על אותו קובץ. שם עם תאריך מאוחר יותר על קובץ ישן
 * לא ישנה כאן דבר, וזה מכוון.
 */
import { readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';

const PATTERN = /^פריטים-מלא-.*\.csv$/;
const EXPORTS = resolve(ROOT, 'data/exports');
const CONTENT = resolve(ROOT, 'content');

/** @param {string} dir @returns {{name:string,path:string,mtime:number}[]} מהחדש לישן */
function catalogs(dir) {
  return readdirSync(dir)
    .filter((f) => PATTERN.test(f))
    .map((f) => ({ name: f, path: resolve(dir, f), mtime: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

const force = process.argv.includes('--force');
const [fresh] = catalogs(EXPORTS);
if (!fresh) {
  console.error('לא נמצא קובץ פריטים-מלא ב-data/exports — לא הועתק דבר.');
  process.exit(1);
}

const existing = catalogs(CONTENT);
const [current] = existing;
if (current && current.mtime >= fresh.mtime && !force) {
  console.log(`content/ כבר מחזיק את הטרי ביותר: ${current.name}`);
  process.exit(0);
}

copyFileSync(fresh.path, resolve(CONTENT, fresh.name));
console.log(`הועתק: ${fresh.name}`);

// מוחקים רק עותקים ישנים של אותו קטלוג — הקובץ שהרגע הועתק נשאר.
for (const old of existing) {
  if (old.name === fresh.name) continue;
  rmSync(old.path);
  console.log(`נמחק עותק ישן: ${old.name}`);
}
