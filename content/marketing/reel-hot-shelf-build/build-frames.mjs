import { chromium } from 'playwright-core';
import fs from 'fs';
import { pathToFileURL } from 'url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const IMG = 'C:/AGENT-COMAX-CLOAD/runs/carousel-top-stock/img';
const OUT = 'C:/AGENT-COMAX-CLOAD/runs/reel-video/frames';

const C = { bg: '#0D0F12', blue: '#039EE3', white: '#FFFFFF' };

const shell = (inner) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1080px;height:1920px}
  body{background:${C.bg};font-family:'Heebo',Arial,sans-serif;-webkit-font-smoothing:antialiased;position:relative;overflow:hidden}
  .wm{position:absolute;top:70px;left:0;right:0;text-align:center;color:${C.white};font-weight:700;font-size:40px}
  .hook{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;
        text-align:center;color:${C.white};font-weight:900;font-size:88px;line-height:1.3;padding:0 80px}
  .photo{position:absolute;left:140px;top:420px;width:800px;height:900px;border-radius:24px;overflow:hidden;
         display:flex;align-items:center;justify-content:center;background:#E5E5E5;border:4px solid ${C.blue}}
  .photo img{width:100%;height:100%;object-fit:contain;display:block}
  .pname{position:absolute;left:60px;right:60px;top:1380px;text-align:center;color:${C.white};
         font-weight:900;font-size:70px}
  .close{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;
         align-items:center;justify-content:center;text-align:center}
  .close .t1{color:${C.white};font-weight:900;font-size:74px;line-height:1.3;padding:0 80px}
  .close .t2{color:${C.blue};font-weight:700;font-size:50px;margin-top:40px}
</style></head><body>${inner}</body></html>`;

const hook = shell(`
  <div class="wm">arena</div>
  <div class="hook">המדף החם החודש 👀</div>
`);

const product = (img, name) => shell(`
  <div class="wm">arena</div>
  <div class="photo"><img src="${pathToFileURL(`${IMG}/${img}`).href}"></div>
  <div class="pname">${name}</div>
`);

const closing = shell(`
  <div class="close">
    <div class="t1">כל הפרטים<br>בלינק בביו</div>
    <div class="t2">arenaisrael.co.il</div>
  </div>
`);

const frames = [
  { name: '0-hook.png', html: hook, dur: 2.2 },
  { name: '1-p1.png', html: product('p1.jpg', 'מכנסי אימון נשים'), dur: 2.4 },
  { name: '2-p2.png', html: product('p2.jpg', 'ברמודה יוניסקס'), dur: 2.4 },
  { name: '3-p3.png', html: product('p3.webp', 'כובע קלאסי'), dur: 2.4 },
  { name: '4-p4.png', html: product('p4.jpg', 'טופ נשים'), dur: 2.4 },
  { name: '5-p5.png', html: product('p5.jpg', 'בגד ים נשים'), dur: 2.4 },
  { name: '6-p6.png', html: product('p6.webp', 'בגד ים נוער'), dur: 2.4 },
  { name: '7-close.png', html: closing, dur: 2.4 },
];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files', '--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });

// ⚠️ page.setContent() נותן למסמך מקור about:blank, וכרום חוסם טעינת
// file:// מתוך מקור כזה מטעמי אבטחה (cross-origin) — התמונות נכשלות בשקט
// עם סמל שבור, גם כשהנתיב עצמו תקין. הפתרון, כמו בסקריפט הקרוסלה שכבר
// עבד: לכתוב כל HTML לקובץ זמני ולנווט אליו עם page.goto(pathToFileURL),
// כך שהמסמך עצמו מקבל מקור file:// ורשאי לטעון תמונות file:// לצידו.
const manifest = [];
for (const f of frames) {
  const tmp = `${OUT}/${f.name}.html`;
  fs.writeFileSync(tmp, f.html, 'utf8');
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${f.name}` });
  manifest.push({ file: f.name, dur: f.dur });
  console.log('rendered', f.name);
}
await browser.close();

fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log('total duration:', manifest.reduce((s, m) => s + m.dur, 0));
