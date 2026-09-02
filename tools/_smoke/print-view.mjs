import { attachBrowser } from '../../src/browser.js';
const doc = process.argv[2];
const s = await attachBrowser();
const { page } = s;
const src = page.frames().find((f) => /Doc612_HtmlP/i.test(f.url()));
if (!src) { console.log('אין תצוגת הדפסה פתוחה לגזור ממנה כתובת'); process.exit(1); }
const u = new URL(src.url());
u.searchParams.set('Doc', doc);
const tab = await page.context().newPage();
await tab.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 45000 });
const t = await tab.evaluate(() => document.body.innerText);
console.log(t.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 14).join('\n'));
await tab.close();
await s.browser.close().catch(() => {});
