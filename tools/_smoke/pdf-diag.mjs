const log = (m) => { process.stdout.write(m + '\n'); };
log('1. מתחבר...');
const { attachBrowser } = await import('../../src/browser.js');
const s = await attachBrowser();
if (!s) { log('   אין חלון'); process.exit(1); }
log('2. מחובר. טאבים: ' + s.page.context().pages().length);

const ctx = s.page.context();
for (const p of ctx.pages()) {
  if (p.url().startsWith('chrome://print')) { await p.close().catch(() => {}); log('3. סגרתי טאב הדפסה'); }
}
log('4. טאבים אחרי: ' + ctx.pages().length);

const main = ctx.pages().find((p) => p.url().includes('Max2000_run')) ?? s.page;
const fr = main.frames().find((f) => /Doc612_HtmlP/i.test(f.url()));
log('5. frame הדפסה: ' + (fr ? 'נמצא' : 'לא נמצא'));
if (!fr) { await s.browser.close().catch(() => {}); process.exit(1); }

log('6. פותח טאב חדש...');
const tab = await ctx.newPage();
log('7. טוען את הדוח...');
await tab.goto(fr.url(), { waitUntil: 'domcontentloaded', timeout: 30000 });
log('8. נטען. כותרת: ' + (await tab.title().catch(() => '?')));

log('9. מפיק PDF...');
const cdp = await ctx.newCDPSession(tab);
const res = await cdp.send('Page.printToPDF', { printBackground: true, paperWidth: 8.27, paperHeight: 11.69 });
log('10. PDF התקבל: ' + res.data.length + ' בתים base64');

const { writeFileSync, statSync } = await import('node:fs');
const out = 'C:\Users\drora\Downloads\test-quote.pdf';
writeFileSync(out, Buffer.from(res.data, 'base64'));
log('11. נשמר: ' + out + ' — ' + (statSync(out).size / 1024).toFixed(1) + ' KB');
await tab.close();
await s.browser.close().catch(() => {});
log('12. סיום');
