// tools/site-swatch.js — ריבועי בחירת הצבע לאתר ארנה ישראל
//
// האתר אינו מייצר אותם לבד (הכרעת דרור, 13/09/2026): לכל צבע צריך ריבוע
// "דגימה" של הצבע האמיתי של המוצר, בגודל הקבוע של האתר — 50×50 WebP.
// הסקריפט חותך את הדגימה מצילום המוצר עצמו: הוא סורק את התמונה ומחפש את
// הריבוע שכולו מוצר (בלי הרקע הלבן) ושהשונות בו הנמוכה ביותר, כלומר משטח
// בד אחיד בלי לוגו, תפר או צל.
//
// שימוש:  node tools/site-swatch.js <תיקיית-מקור> <תיקיית-יעד> <דגם> <קוד:שם> ...
// דוגמה:  node tools/site-swatch.js data/images data/swatches 011938 \
//                100:MIDNIGHT-BLUE 200:SHIMMERED-WATER 400:BLACK
//
// מצפה לקובץ מקור בשם <דגם>-<קוד>-001.jpg, ומייצר <דגם><קוד>_thumb-<שם>.webp
// — אותה מוסכמת שמות של הריבועים הקיימים באתר.
//
// אחרי הייצור: להעלות למדיה, ואז לשייך לכל מונח pa_color דרך שדה **ux_image**
// במסך עריכת המונח. ראו knowledge/arena-site-items.md.

import sharp from "sharp";
import fs from "node:fs";

const CROP = 140;   // הריבוע שנחתך מהמקור
const SIZE = 50;    // הגודל הסופי — כמו הריבועים הקיימים באתר
const STEP = 20;    // צפיפות הסריקה
const SUB  = 7;     // דגימה בתוך הריבוע

async function swatch(file, out) {
  const img = sharp(file);
  const { width: W, height: H } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  // "מוצר" = לא לבן ולא אפור-בהיר. רקע הסטודיו של ארנה כמעט תמיד לבן נקי.
  const isProduct = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx < 235 || (mx - mn) > 25;
  };

  let best = null;
  for (let y = 0; y + CROP < H; y += STEP) {
    for (let x = 0; x + CROP < W; x += STEP) {
      let n = 0, sr = 0, sg = 0, sb = 0; const vals = [];
      for (let dy = 0; dy < CROP; dy += SUB) {
        for (let dx = 0; dx < CROP; dx += SUB) {
          const p = px(x + dx, y + dy);
          if (isProduct(p)) { n++; sr += p[0]; sg += p[1]; sb += p[2]; vals.push(p); }
        }
      }
      const total = Math.ceil(CROP / SUB) ** 2;
      if (n / total < 0.98) continue;            // רק ריבוע שכולו מוצר
      const mr = sr / n, mg = sg / n, mb = sb / n;
      let varr = 0;
      for (const p of vals) varr += (p[0] - mr) ** 2 + (p[1] - mg) ** 2 + (p[2] - mb) ** 2;
      varr /= n;
      if (!best || varr < best.varr) best = { x, y, varr, rgb: [mr, mg, mb].map(Math.round) };
    }
  }
  if (!best) throw new Error(`לא נמצא משטח אחיד ב-${file} — לבחור תמונת מקור אחרת`);

  await sharp(file)
    .extract({ left: best.x, top: best.y, width: CROP, height: CROP })
    .resize(SIZE, SIZE).webp({ quality: 90 }).toFile(out);
  return best;
}

(async () => {
  const [src, dst, model, ...colors] = process.argv.slice(2);
  if (!colors.length) { console.error("שימוש: node tools/site-swatch.js <מקור> <יעד> <דגם> <קוד:שם> ..."); process.exit(1); }
  fs.mkdirSync(dst, { recursive: true });
  for (const spec of colors) {
    const [code, name] = spec.split(":");
    const file = `${src}/${model}-${code}-001.jpg`;
    const out  = `${dst}/${model}${code}_thumb-${name}.webp`;
    const b = await swatch(file, out);
    console.log(`${code} ${name}  crop@${b.x},${b.y}  rgb(${b.rgb})  ${fs.statSync(out).size}B`);
  }
})();
