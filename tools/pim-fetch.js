/**
 * מוריד תמונות מוצר מה-CDN של ה-PIM וממיר אותן ל-WebP מוכן להעלאה לאתר.
 *
 *   node tools/pim-fetch.js <קובץ-json> <תיקיית-יעד>
 *
 * קובץ הקלט הוא מערך של `{ url, name }` — `url` היא כתובת התמונונת שנשלפה
 * מדף החיפוש ב-PIM (`img.src`), ו-`name` הוא שם הקובץ הסופי **בלי סיומת**,
 * לפי מוסכמת השמות של אתר ארנה ישראל:
 *   `<דגם>-<קוד צבע>-<שם המוצר באנגלית במקפים>-<מספר סידורי תלת-ספרתי>`
 *
 * ## 💣 שלוש מלכודות שנמדדו, ובלעדיהן הכלי מחזיר תמונות גרועות בשקט
 *
 * 1. 💣💣 **לכל וריאנט תמונונת יש hash תוכן משלו — אי אפשר להסיק את כתובת
 *    ה-`element-detail` מזו של ה-`element-teaser`.** נמדד 13/09/2026 על נכס
 *    92534: התמונונת היא `...-008-O.975ef26f.jpg` וה-detail היא
 *    `...-008-O.db85f87f.jpg`. **החלפת שם הווריאנט בלבד, בלי החלפת ה-hash,
 *    מחזירה 200 עם לוגו ארנה** — 1584×1117, 34KB, נראית לגמרי כמו הצלחה.
 *    ⛔ זו הטעות שעלתה לי סיבוב שלם: מדדתי "רזולוציה משופרת" והצגתי אותה
 *    כממצא, בזמן שמדדתי את מידות הלוגו. **ההוכחה היא מה שרואים בתמונה, לא
 *    מספר הבתים ולא הרוחב והגובה.**
 *    ⇒ הכתובת האמיתית מגיעה **רק מדף הנכס** `/en/assets/a~<id>` אחרי
 *    שהדפדפן רינדר אותו (`img.src`). ה-HTML הגולמי אינו מכיל אותה, ולכן
 *    `fetch` של הדף לא יספיק.
 * 2. **התמונונת עצמה כן ניתנת להורדה משורת הפקודה** (134×165) — ה-CDN אינו
 *    דורש סשן, ולכן אפשר לבנות ממנה **גיליון מגע** ולבחור תמונות בלי
 *    לטעון דף לכל נכס. טוענים בדפדפן רק את ה-4 שנבחרו.
 * 3. **המרה ל-WebP היא חובה** — אין באתר תוסף שממיר בשרת. איכות 85, כמו
 *    שנמדד על ההקמה הקודמת (חיסכון ~50%).
 *
 * הגודל האמיתי של `element-detail` הוא **628×768** — בדיוק מה שתועד ב-
 * `knowledge/arena-site-items.md`, ולא השתנה.
 *
 * ⚠️ **לא ממירים תמונה שנכשלה.** קובץ קטן מ-`MIN_BYTES` או צר מ-`MIN_PX` הוא
 * כישלון הורדה שמתחזה להצלחה; הכלי מדלג עליו ומדווח, כדי שלא תיווצר גלריה
 * עם ריבוע אפור אחד באמצע.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const MIN_BYTES = 8_000;
const MIN_PX = 400;
const QUALITY = 85;

/** @deprecated אי אפשר להסיק את כתובת ה-detail מהתמונונת — ראו מלכודת 1 בראש הקובץ. */
export function toDetailUrl(url) {
  return url.replace(/image-thumb__(\d+)__[^/]+/, 'image-thumb__$1__portal-engine_element-detail');
}

export async function fetchOne(url, outPath) {
  // `url` חייבת להיות כתובת ה-**detail** כפי שנקראה מדף הנכס. אין להסיק אותה.
  const res = await fetch(url);
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_BYTES) return { ok: false, why: `רק ${buf.length} בתים — כנראה עדיין התמונונת` };

  const img = sharp(buf);
  const meta = await img.metadata();
  if (Math.max(meta.width || 0, meta.height || 0) < MIN_PX)
    return { ok: false, why: `${meta.width}×${meta.height} — קטן מדי` };

  await img.webp({ quality: QUALITY }).toFile(outPath);
  return { ok: true, w: meta.width, h: meta.height, srcBytes: buf.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [listFile, outDir] = process.argv.slice(2);
  if (!listFile || !outDir) {
    console.error('שימוש: node tools/pim-fetch.js <קובץ-json> <תיקיית-יעד>');
    process.exit(1);
  }
  const items = JSON.parse(readFileSync(resolve(listFile), 'utf8'));
  mkdirSync(resolve(outDir), { recursive: true });

  const done = [], failed = [];
  for (const it of items) {
    const out = join(resolve(outDir), `${it.name}.webp`);
    let r;
    try { r = await fetchOne(it.url, out); }
    catch (e) { r = { ok: false, why: e.message }; }
    if (r.ok) { done.push({ ...it, out, ...r }); console.log(`✓ ${it.name}.webp  ${r.w}×${r.h}`); }
    else { failed.push({ ...it, why: r.why }); console.log(`✗ ${it.name}  — ${r.why}`); }
  }
  console.log(`\nהורדו ${done.length} · נכשלו ${failed.length}`);
  writeFileSync(join(resolve(outDir), '_manifest.json'), JSON.stringify({ done, failed }, null, 1));
  if (failed.length) process.exitCode = 2;
}
