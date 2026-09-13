/**
 * גיליון מגע מהתמונונות של ה-PIM — כדי לבחור תמונות בלי לטעון דף לכל נכס.
 *
 *   node tools/pim-sheet.js <קובץ-json> <קובץ-jpg>
 *
 * קובץ הקלט הוא מערך של `{ url, label }`, כאשר `url` היא כתובת ה-**תמונונת**
 * (`element-teaser`) כפי שנקראה מ-`img.src` בדף החיפוש. ה-CDN אינו דורש סשן,
 * ולכן ההורדה עובדת משורת הפקודה גם בלי דפדפן.
 *
 * ⛔ **הכתובת נלקחת כפי שהיא ואין להסיק ממנה כתובת אחרת.** הגרסה הראשונה של
 * הכלי החליפה `element-teaser` ב-`element-detail` והרכיבה גיליון שכולו לוגו
 * ארנה — לכל וריאנט יש hash תוכן משלו, וה-CDN מחזיר **200 עם תמונת לוגו**
 * לכל שם וריאנט שאינו קיים. אותה מלכודת מתועדת בראש `tools/pim-fetch.js`.
 *
 * הזרימה: גיליון מגע ⇒ בוחרים ⇒ פותחים בדפדפן רק את הנכסים שנבחרו ⇒ קוראים
 * משם את כתובת ה-detail האמיתית ⇒ `tools/pim-fetch.js` מוריד וממיר ל-WebP.
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const CELL = 240;
const COLS = 6;

const urls = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tiles = [];
for (const u of urls) {
  const r = await fetch(u.url);
  if (!r.ok) { console.log('נכשל:', u.label, r.status); continue; }
  const b = Buffer.from(await r.arrayBuffer());
  const cap = `<svg width="${CELL}" height="30"><rect width="${CELL}" height="30" fill="#000b"/>`
    + `<text x="5" y="21" fill="#fff" font-size="17" font-family="monospace">${u.label}</text></svg>`;
  tiles.push(await sharp(b).resize(CELL, CELL, { fit: 'contain', background: '#fff' })
    .composite([{ input: Buffer.from(cap), top: 0, left: 0 }]).png().toBuffer());
}
const rows = Math.ceil(tiles.length / COLS);
await sharp({ create: { width: CELL * COLS, height: CELL * rows, channels: 3, background: '#ffffff' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL })))
  .jpeg({ quality: 82 }).toFile(process.argv[3]);
console.log('גיליון:', process.argv[3], '·', tiles.length, 'תמונות');
