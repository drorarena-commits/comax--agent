import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/AGENT-COMAX-CLOAD/content/marketing/post-katnatanim-2026-09-13';
const HERE = 'C:/AGENT-COMAX-CLOAD/runs/post-katnatanim';

const C = { bg: '#0D0F12', card: '#161A1F', blue: '#039EE3', white: '#FFFFFF', body: '#9AA6B2', link: '#6FB9DE' };

const shell = (inner) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1080px;height:1350px}
  body{background:${C.bg};font-family:'Heebo',Arial,sans-serif;-webkit-font-smoothing:antialiased;position:relative;overflow:hidden}
  .accent{position:absolute;right:100px;top:390px;width:120px;height:6px;background:${C.blue}}
  .title{position:absolute;right:100px;left:100px;top:430px;text-align:right;color:${C.white};
         font-weight:900;font-size:104px;line-height:1.15}
  .sub{position:absolute;right:100px;left:100px;top:640px;text-align:right;color:${C.blue};
       font-weight:700;font-size:58px}
  .desc{position:absolute;right:100px;left:100px;top:720px;text-align:right;color:${C.body};
        font-weight:400;font-size:30px;line-height:1.5}
  footer{position:absolute;left:100px;right:100px;top:1248px;height:32px;
         display:flex;align-items:center;justify-content:space-between;direction:ltr}
  .wm{color:${C.white};font-weight:700;font-size:22px}
  .nx{color:${C.white};font-weight:400;font-size:24px}
  .card{position:absolute;left:140px;top:120px;width:800px;height:560px;background:${C.card};
        border:3px solid ${C.blue};border-radius:24px}
  .photo{position:absolute;left:171px;top:30px;width:458px;height:500px;overflow:hidden;
         display:flex;align-items:center;justify-content:center;background:#E5E5E5;border-radius:12px}
  .photo img{width:100%;height:100%;object-fit:contain;display:block}
  .pname{position:absolute;right:100px;left:100px;top:718px;text-align:right;color:${C.white};
        font-weight:700;font-size:46px;line-height:1.25}
  .price{position:absolute;right:100px;top:890px;color:${C.blue};font-weight:900;font-size:80px}
  .pdesc{position:absolute;right:100px;left:100px;top:1000px;text-align:right;color:${C.body};
        font-weight:400;font-size:30px;line-height:1.5}
  .pg{color:${C.blue};font-weight:400;font-size:24px}
  .badge{position:absolute;left:140px;top:150px;background:${C.blue};color:${C.white};
        font-weight:900;font-size:32px;padding:14px 34px;border-radius:999px;
        transform:rotate(-8deg);box-shadow:0 8px 24px rgba(3,158,227,.4)}
  .detail{position:absolute;right:100px;left:100px;text-align:right}
  .detail .row{display:flex;flex-direction:row-reverse;align-items:baseline;gap:20px;margin-bottom:44px}
  .detail .k{color:${C.blue};font-weight:700;font-size:34px;min-width:220px}
  .detail .v{color:${C.white};font-weight:400;font-size:34px}
</style></head><body>${inner}</body></html>`;

const cover = shell(`
  <div class="accent"></div>
  <div class="title">קטנטנים.</div>
  <div class="sub">קטגוריה חדשה אצלנו</div>
  <div class="desc">ציוד שחייה לגיל הרך, עכשיו באתר ובחנות בוינגייט</div>
  <footer><span class="wm">arena</span><span class="nx">1/6 · החליקו ←</span></footer>
`);

const product = shell(`
  <div class="card"><div class="photo"><img src="${pathToFileURL(path.join(HERE, 'img/product.webp')).href}"></div></div>
  <div class="badge">מבצע עכשיו</div>
  <div class="pname">בגד ים קטנטנות — Team Challenge Solid</div>
  <div class="price">100 ₪</div>
  <div class="pdesc">עמיד כלור, הגנת UV 50+. מידות 4-5 עד 10-11.<br>מהקטגוריה החדשה, קטנטנים.</div>
  <footer><span class="wm">arena</span><span class="pg">2/6</span></footer>
`);

const other = (img, name, price, badge, pg) => shell(`
  <div class="card"><div class="photo"><img src="${pathToFileURL(path.join(HERE, 'img/' + img)).href}"></div></div>
  ${badge ? `<div class="badge" style="background:${C.card};border:2px solid ${C.blue};color:${C.blue}">${badge}</div>` : ''}
  <div class="pname">${name}</div>
  <div class="price" style="font-size:56px">${price}</div>
  <div class="pdesc">עוד מהקטגוריה החדשה, קטנטנים.</div>
  <footer><span class="wm">arena</span><span class="pg">${pg}</span></footer>
`);

const capSlide = other('cap-roy.jpg', 'כובע שחייה לפעוטות — ROY', 'מ-69.90 ₪', 'לגילאי 6-36 חודשים', '3/6');
const warmsuitSlide = other('warmsuit.jpg', 'בגד ים שומר חום — Neoprene Warmsuit', '159.90 ₪', 'לגילאי 1-6', '4/6');

const details = shell(`
  <div class="accent"></div>
  <div class="title" style="font-size:72px;top:170px">כל הפרטים</div>
  <div class="detail" style="top:420px">
    <div class="row"><span class="k">גילאים</span><span class="v">3 עד 9</span></div>
    <div class="row"><span class="k">מידות</span><span class="v">4-5 · 6-7 · 8-9 · 10-11</span></div>
    <div class="row"><span class="k">בד</span><span class="v">עמיד כלור, הגנת UV 50+</span></div>
    <div class="row"><span class="k">צבעים</span><span class="v">שישה גוונים לבחירה</span></div>
    <div class="row"><span class="k">מחיר</span><span class="v" style="color:${C.blue};font-weight:900">100 ₪ בלבד</span></div>
  </div>
  <footer><span class="wm">arena</span><span class="pg">5/6</span></footer>
`);

const closing = shell(`
  <div class="title" style="font-size:80px;top:520px;text-align:center;right:80px;left:80px">בואו לבדוק —
  באתר או בחנות בוינגייט</div>
  <div style="position:absolute;right:80px;left:80px;top:700px;text-align:center;color:${C.blue};
       font-weight:700;font-size:44px">arenaisrael.co.il</div>
  <footer><span class="wm">arena</span><span class="pg">6/6</span></footer>
`);

const slides = [
  { name: 'slide-1.png', html: cover },
  { name: 'slide-2.png', html: product },
  { name: 'slide-3.png', html: capSlide },
  { name: 'slide-4.png', html: warmsuitSlide },
  { name: 'slide-5.png', html: details },
  { name: 'slide-6.png', html: closing },
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
