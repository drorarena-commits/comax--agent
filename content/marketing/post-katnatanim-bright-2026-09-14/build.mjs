import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/AGENT-COMAX-CLOAD/content/marketing/post-katnatanim-bright-2026-09-14';
const HERE = 'C:/AGENT-COMAX-CLOAD/runs/post-katnatanim-bright';
const IMG = 'C:/AGENT-COMAX-CLOAD/runs/post-katnatanim/img';
fs.mkdirSync(OUT, { recursive: true });

const BLUE = '#039EE3';
const INK = '#1C1C1B';
const BG = '#FFFDF7';

// הלוגו האמיתי של arena — אותו path מדויק שכבר אומת ושימש בשלט הדלת
// (content/marketing/arena-logo-black.svg), לא טקסט "arena" סתם.
const LOGO_PATH = 'M60.4353 8.57154C60.4353 5.46944 59.7766 4.08469 58.2128 4.08469C56.6491 4.08469 55.9904 5.46944 55.9904 8.57154C55.9904 11.6769 56.6491 13.0671 58.2128 13.0671C59.7766 13.0671 60.4353 11.6758 60.4353 8.57154ZM64.7955 16.7366H61.0951L60.8455 15.5953C60.1108 16.7366 58.7967 17.1453 57.3078 17.1453C53.602 17.1453 51.6324 14.2062 51.6324 8.57154C51.6324 3.10428 53.6888 0 57.3078 0C58.7967 0 60.1108 0.492379 60.8455 1.55214L61.0951 0.407598H64.7955V16.7366ZM46.162 0C44.6829 0 43.5283 0.492379 42.6244 1.55214L42.3737 0.407598H38.6744V16.7366H43.0357V6.53463C43.0357 4.90097 43.6954 4.08469 44.6851 4.08469C45.7518 4.08469 46.1631 4.73684 46.1631 6.53463V16.7366H50.5201V4.73685C50.519 1.55323 49.1213 0 46.1631 0H46.162ZM28.68 6.6955H33.2051C33.2051 4.90098 32.3804 3.92165 31.0652 3.92165C29.6675 3.92165 28.9274 4.81946 28.68 6.6955ZM33.2811 11.353H37.4047C37.2354 15.0225 35.0141 17.1453 31.0652 17.1453C26.7017 17.1453 24.2329 14.1247 24.2329 8.65306C24.2329 7.02266 24.4803 5.55313 24.9741 4.40968C24.7437 4.29637 24.4895 4.24044 24.2329 4.24664C23.1684 4.24664 21.9313 5.14444 21.9313 7.51178V16.7366H17.5678V0.407598H21.2682L21.5233 1.55214C22.5867 0.407598 23.8195 0 25.9649 0V2.53255C27.2019 0.897802 28.9274 0 31.0652 0C34.8535 0 37.1519 2.53255 37.4818 6.85528C37.5697 7.92048 37.5697 8.65307 37.5697 9.7976H28.5953C28.68 12.0834 29.5828 13.2258 31.1509 13.2258C32.3804 13.2258 33.1226 12.5736 33.2811 11.353ZM11.5419 8.57154C11.5419 5.46944 10.8821 4.08469 9.32378 4.08469C7.76114 4.08469 7.10135 5.46944 7.10135 8.57154C7.10135 11.6769 7.76005 13.0671 9.32378 13.0671C10.8821 13.0671 11.5419 11.6758 11.5419 8.57154ZM15.9042 0.408689V16.7366H12.2027L11.9564 15.5953C11.2185 16.7366 9.90001 17.1453 8.41658 17.1453C4.71615 17.1453 2.73897 14.2062 2.73897 8.57154C2.73897 3.10428 4.79103 0 8.41658 0C9.90001 0 11.2185 0.492379 11.9564 1.55214L12.2027 0.407598H15.9032L15.9042 0.408689ZM52.2878 19.9115C50.4061 19.9115 48.9108 20.4028 47.1354 21.4952L36.5735 27.9918L52.2867 37.6654L68 27.9917L57.4359 21.4952C55.6605 20.4028 54.1749 19.9115 52.2878 19.9115ZM15.7111 19.9115C13.8272 19.9115 12.3395 20.4028 10.5576 21.4952L0 27.9918L15.7111 37.6655L31.4222 27.9918L20.8646 21.4952C19.087 20.4028 17.5949 19.9115 15.7111 19.9115ZM28.846 45.7522L18.2884 39.2535L34.0016 29.5765L49.7095 39.2535L39.1508 45.7522C37.3711 46.8435 36.1427 47.6 34.0005 47.6C31.8541 47.6 30.6278 46.8435 28.846 45.7522Z';
const logoSvg = (color, w) => `<svg width="${w}" height="${w * 48 / 68}" viewBox="0 0 68 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="${LOGO_PATH}" fill="${color}"/></svg>`;

const shell = (inner, bg) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1080px;height:1350px}
  body{background:${bg || BG};font-family:'Heebo',Arial,sans-serif;-webkit-font-smoothing:antialiased;position:relative;overflow:hidden}
  .clip{position:absolute;left:0;top:0;width:1080px;height:1350px;overflow:hidden}
  .blob{position:absolute;border-radius:50%;opacity:.55;filter:blur(2px)}
  .title{position:absolute;right:100px;width:880px;text-align:right;color:${INK};
         font-weight:900;line-height:1.12}
  .sub{position:absolute;right:100px;width:880px;text-align:right;color:${BLUE};font-weight:700}
  .desc{position:absolute;right:100px;width:880px;text-align:right;color:${INK};opacity:.7;font-weight:400;line-height:1.5}
  footer{position:absolute;left:100px;right:100px;top:1248px;height:32px;
         display:flex;align-items:center;justify-content:space-between;direction:ltr}
  .wm{display:flex;align-items:center;height:32px}
  .nx{color:${INK};font-weight:400;font-size:24px;opacity:.7}
  .pg{color:${BLUE};font-weight:700;font-size:24px}
  .card{position:absolute;left:140px;top:120px;width:800px;height:560px;border-radius:32px;
        box-shadow:0 24px 48px rgba(28,28,27,.12)}
  .photo{position:absolute;left:31px;top:30px;width:458px;height:500px;overflow:hidden;
         display:flex;align-items:center;justify-content:center;background:#FFFFFF;border-radius:20px}
  .photo img{width:88%;height:88%;object-fit:contain;display:block}
  .badge{position:absolute;left:140px;top:150px;color:#fff;
        font-weight:900;font-size:32px;padding:14px 34px;border-radius:999px;
        transform:rotate(-8deg);box-shadow:0 8px 20px rgba(0,0,0,.18)}
  .pname{position:absolute;right:100px;width:880px;top:718px;text-align:right;color:${INK};
        font-weight:700;font-size:46px;line-height:1.25}
  .price{position:absolute;right:100px;top:890px;color:${BLUE};font-weight:900;font-size:80px}
  .pdesc{position:absolute;right:100px;width:880px;top:1000px;text-align:right;color:${INK};
        opacity:.65;font-weight:400;font-size:30px;line-height:1.5}
  .detail{position:absolute;right:100px;width:880px;text-align:right}
  .detail .row{display:flex;flex-direction:row-reverse;align-items:baseline;gap:20px;margin-bottom:44px}
  .detail .k{color:${BLUE};font-weight:700;font-size:34px;min-width:220px}
  .detail .v{color:${INK};font-weight:400;font-size:34px}
</style></head><body><div class="clip">${inner}</div></body></html>`;

const cover = shell(`
  <div class="blob" style="left:-120px;top:-100px;width:420px;height:420px;background:#FFD93D"></div>
  <div class="blob" style="right:-140px;top:180px;width:360px;height:360px;background:${BLUE}"></div>
  <div class="blob" style="left:-80px;bottom:120px;width:320px;height:320px;background:#FF9EC4"></div>
  <div style="position:absolute;right:100px;top:70px">${logoSvg(BLUE, 220)}</div>
  <div class="title" style="font-size:100px;top:470px">קטנטנים. 🧸</div>
  <div class="sub" style="font-size:58px;top:660px">קטגוריה חדשה אצלנו</div>
  <div class="desc" style="font-size:30px;top:740px">ציוד שחייה צבעוני לגיל הרך — עכשיו באתר ובחנות בוינגייט</div>
  <footer><span class="wm">${logoSvg(INK, 90)}</span><span class="nx">1/7 · החליקו ←</span></footer>
`);

const product = shell(`
  <div class="card" style="background:#DFF3FF"></div>
  <div class="photo"><img src="${pathToFileURL(path.join(IMG, 'product.webp')).href}"></div>
  <div class="badge" style="background:#FF4D6D">מבצע עכשיו 🎉</div>
  <div class="pname">בגד ים קטנטנות — Team Challenge Solid</div>
  <div class="price">100 ₪</div>
  <div class="pdesc">עמיד כלור, הגנת UV 50+. מידות 4-5 עד 10-11.</div>
  <footer><span class="wm">${logoSvg(INK, 90)}</span><span class="pg">2/7</span></footer>
`);

const other = (img, name, price, badge, badgeColor, cardColor, pg) => shell(`
  <div class="card" style="background:${cardColor}"></div>
  <div class="photo"><img src="${pathToFileURL(path.join(IMG, img)).href}"></div>
  ${badge ? `<div class="badge" style="background:${badgeColor}">${badge}</div>` : ''}
  <div class="pname">${name}</div>
  <div class="price" style="font-size:56px">${price}</div>
  <div class="pdesc">עוד מהקטגוריה החדשה, קטנטנים.</div>
  <footer><span class="wm">${logoSvg(INK, 90)}</span><span class="pg">${pg}</span></footer>
`);

const capName = 'כובע שחייה לפעוטות — ROY';
const gogglesName = 'משקפת שחייה מסיכה — Kids\u2019 Spider Swim Mask';

const capSlide = other('cap-roy.jpg', capName, 'מ-69.90 ₪', 'לגילאי 6-36 חודשים', '#00B4A6', '#FFF3D6', '3/7');
const warmsuitSlide = other('warmsuit.jpg', 'בגד ים שומר חום — Neoprene Warmsuit', '159.90 ₪', 'לגילאי 1-6', '#FFA800', '#E4F6FF', '4/7');
const gogglesSlide = other('goggles.jpg', gogglesName, '109.00 ₪', 'לגילאי 2-5', BLUE, '#FFE8F1', '5/7');

const details = shell(`
  <div class="blob" style="right:-100px;top:-100px;width:340px;height:340px;background:#FFD93D"></div>
  <div class="title" style="font-size:72px;top:170px">כל הפרטים</div>
  <div class="detail" style="top:420px">
    <div class="row"><span class="k">גילאים</span><span class="v">3 עד 9</span></div>
    <div class="row"><span class="k">מידות</span><span class="v">4-5 · 6-7 · 8-9 · 10-11</span></div>
    <div class="row"><span class="k">בד</span><span class="v">עמיד כלור, הגנת UV 50+</span></div>
    <div class="row"><span class="k">צבעים</span><span class="v">שישה גוונים לבחירה</span></div>
    <div class="row"><span class="k">מחיר</span><span class="v" style="color:${BLUE};font-weight:900">100 ₪ בלבד</span></div>
  </div>
  <footer><span class="wm">${logoSvg(INK, 90)}</span><span class="pg">6/7</span></footer>
`);

const closing = shell(`
  <div class="blob" style="left:-120px;top:-80px;width:380px;height:380px;background:#FF9EC4"></div>
  <div class="blob" style="right:-140px;bottom:-60px;width:400px;height:400px;background:${BLUE}"></div>
  <div class="title" style="font-size:80px;top:520px;text-align:center;right:100px;width:880px">בואו לבדוק —
  באתר או בחנות בוינגייט</div>
  <div style="position:absolute;right:100px;width:880px;top:700px;text-align:center;color:${BLUE};
       font-weight:700;font-size:44px">arenaisrael.co.il</div>
  <footer><span class="wm">${logoSvg(INK, 90)}</span><span class="pg">7/7</span></footer>
`);

const slides = [
  { name: 'slide-1.png', html: cover },
  { name: 'slide-2.png', html: product },
  { name: 'slide-3.png', html: capSlide },
  { name: 'slide-4.png', html: warmsuitSlide },
  { name: 'slide-5.png', html: gogglesSlide },
  { name: 'slide-6.png', html: details },
  { name: 'slide-7.png', html: closing },
];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files', '--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });

for (const s of slides) {
  const f = path.join(HERE, s.name + '.html');
  fs.writeFileSync(f, s.html, 'utf8');
  await page.goto(pathToFileURL(f).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, s.name), type: 'png' });
  console.log('rendered', s.name);
}
await browser.close();
