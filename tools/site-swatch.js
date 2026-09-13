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

const CROP = 90;    // הריבוע שנחתך מהמקור
const SIZE = 50;    // הגודל הסופי — כמו הריבועים הקיימים באתר
const STEP = 6;     // צפיפות הסריקה
const SUB  = 3;     // דגימה בתוך הריבוע
// 💣 מוצר עם פאנל טרים שחור (תיק, נעל, בגד עם חלקים כהים) — המשטח הכי אחיד
// בתמונה הוא הפאנל השחור, לא צבע המוצר. נמדד 13/09/2026 על 010231-800 "ICE":
// הריבוע יצא rgb(28,44,63), כמעט שחור, בזמן שהתיק אפור בהיר. לכן דוחים משטח
// כהה מדי — הוא כמעט תמיד טרים ולא הצבע ששם הצבע מתאר.
// ⚠️ ולצבע שהוא **באמת** כהה (BLACK, ANTHRACITE) הסף הזה דוחה את כל התמונה
// והכלי נופל ב"לא נמצא משטח אחיד". במקרה כזה מריצים עם `MIN_LUM=0` — אין דרך
// להבחין אוטומטית בין טרים שחור לבגד שחור, וזו הכרעה של מי שמסתכל על התמונה.
const MIN_LUM = Number(process.env.MIN_LUM ?? 100);
// 💣💣 **הדוגמן לובש בגד תחתון בצבע אחר, והוא המשטח האחיד ביותר בפריים.**
// נמדד 13/09/2026 על 1D352: הריבוע ל-080 ROYAL יצא `rgb(207,61,66)` — אדום,
// כי הסריקה נחתה על המכנסיים האדומים שמתחת לז'קט הכחול; ול-070 NAVY יצא
// כחול-רויאל מהמכנסיים. הריבוע נראה תקין לגמרי בפני עצמו, והטעות מתגלה רק
// כשמשווים אותו לשם הצבע. לכן הסריקה מוגבלת לחלק **העליון** של התמונה.
// ⚠️ לאביזרים (תיק, כובע, משקפת) שיושבים במרכז או בתחתית — `SCAN_TOP=1`.
const SCAN_TOP = Number(process.env.SCAN_TOP ?? 0.60);
// ⚠️ וגם ראש הפריים פסול: הפנים והצוואר של הדוגמן הם משטח אחיד לגמרי, וב-1D352-070
// הריבוע יצא rgb(159,122,113) — גוון עור. לכן הסריקה יושבת על **חלון הגו**:
// רצועה אנכית מתחת לפנים ומעל למותן, ורצועה אופקית סביב מרכז הפריים.
const SCAN_BOTTOM = Number(process.env.SCAN_BOTTOM ?? 0.20);  // מתחילים מתחת לפנים
const SCAN_SIDE = Number(process.env.SCAN_SIDE ?? 0.22);      // שוליים מימין ומשמאל

async function swatch(file, out) {
  const img = sharp(file);
  const { width: W, height: H } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  // "מוצר" = לא לבן ולא אפור-בהיר. רקע הסטודיו של ארנה כמעט תמיד לבן נקי.
  // 💣 **בגד לבן אינו ניתן להבחנה מרקע הסטודיו הלבן** — הכלל למטה דוחה את כולו
  // והכלי נופל. ל-1D347-010 WHITE מריצים עם  **וגם** חלון סריקה צר
  // שיושב בוודאות על החזה (למשל SCAN_SIDE=0.36 SCAN_BOTTOM=0.26 SCAN_TOP=0.5),
  // כי בלי מסנן הרקע כל ריבוע לבן — כולל רקע — נראה למכונה כמו הבד.
  const ANY = process.env.ANY_PIXEL === "1";
  const isProduct = ([r, g, b]) => {
    if (ANY) return true;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx < 235 || (mx - mn) > 25;
  };

  let best = null;
  const yMin = Math.floor(H * SCAN_BOTTOM), yMax = Math.floor(H * SCAN_TOP);
  const xMin = Math.floor(W * SCAN_SIDE), xMax = Math.ceil(W * (1 - SCAN_SIDE));
  for (let y = yMin; y + CROP < yMax; y += STEP) {
    for (let x = xMin; x + CROP < xMax; x += STEP) {
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
      if (Math.max(mr, mg, mb) < MIN_LUM) continue;   // ראו MIN_LUM למעלה
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
    // מוסכמת השמות של `pim-fetch` כוללת את שם המוצר באמצע ומסתיימת ב-.webp,
    // ולכן חיפוש לפי שם מדויק החמיץ אותם. מחפשים לפי תחילית דגם-צבע וסיומת 001.
    const cand = [`${model}-${code}-001.jpg`, `${model}-${code}-001.webp`];
    const found = cand.find((f) => fs.existsSync(`${src}/${f}`))
      ?? fs.readdirSync(src).find((f) => f.startsWith(`${model}-${code}-`) && /-001\.(jpe?g|png|webp)$/i.test(f));
    if (!found) throw new Error(`אין תמונת מקור ל-${model}-${code} בתיקייה ${src}`);
    const file = `${src}/${found}`;
    const out  = `${dst}/${model}${code}_thumb-${name}.webp`;
    const b = await swatch(file, out);
    console.log(`${code} ${name}  crop@${b.x},${b.y}  rgb(${b.rgb})  ${fs.statSync(out).size}B`);
  }
})();
