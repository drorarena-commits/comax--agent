import { writeFileSync, statSync } from 'node:fs';
import { attachBrowser } from '../../src/browser.js';

const s = await attachBrowser();
const { page } = s;
const ctx = page.context();

for (const p of ctx.pages()) if (p.url().startsWith('chrome://print')) await p.close().catch(() => {});

const main = ctx.pages().find((p) => p.url().includes('Max2000_run')) ?? page;
const fr = main.frames().find((f) => /Doc612_HtmlP/i.test(f.url()));
if (!fr) { console.log('לא נמצא frame ההדפסה'); process.exit(1); }
console.log('מקור:', fr.url().slice(0, 100));

const tab = await ctx.newPage();
await tab.goto(fr.url(), { waitUntil: 'networkidle', timeout: 60000 });
console.log('תוכן:', (await tab.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 110))));

const cdp = await ctx.newCDPSession(tab);
const { data } = await cdp.send('Page.printToPDF', {
  printBackground: true, paperWidth: 8.27, paperHeight: 11.69,
  marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4,
});
const out = 'C:/Users/drora/Downloads/test-quote.pdf';
writeFileSync(out, Buffer.from(data, 'base64'));
console.log('\nנשמר:', out, '—', (statSync(out).size / 1024).toFixed(1), 'KB');
await tab.close();
await s.browser.close().catch(() => {});
